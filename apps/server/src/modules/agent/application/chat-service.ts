import { createHash, randomUUID } from 'node:crypto';
import type { AgentChatAction, AgentChatConversation, AgentChatSummary, AgentChatToolCall } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { ChatDeps, ChatModel, ChatTool } from './chat-ports.js';
import { chatError, chatMessage, chatResult, chatValidationError } from './chat-data.js';

const LEASE_MS = 600_000;
const DEFAULT_TOOL_ROUNDS = 24;
const configuredRounds = Number(process.env.AGENT_CHAT_MAX_TOOL_ROUNDS);
export const MAX_TOOL_ROUNDS = Number.isInteger(configuredRounds) && configuredRounds > 0 ? Math.min(configuredRounds, 32) : DEFAULT_TOOL_ROUNDS;

export class AgentChatService {
  constructor(private readonly deps: ChatDeps) {}
  create(): AgentChatConversation {
    const now = new Date().toISOString();
    const c: AgentChatConversation = {id: randomUUID(), title: '新对话', version: 1, status: 'idle', leaseUntil: 0,
      messages: [], actions: [], createdAt: now, updatedAt: now};
    this.deps.repository.insert(c); return c;
  }
  list(): AgentChatSummary[] {return this.deps.repository.list().map(({id, title, status, updatedAt}) => ({id, title, status, updatedAt}));}
  get(id: string): AgentChatConversation {
    let c = this.deps.repository.get(id);
    if (!c) throw new AppError('CHAT_NOT_FOUND', '对话不存在', 404);
    if (c.status === 'running' && c.leaseUntil <= Date.now()) {
      for (const action of c.actions.filter(a => a.status === 'executing')) {
        action.status = 'uncertain'; action.result = '执行结果未确认，请先查询业务状态；不会自动重复执行。';
      }
      this.pairInterruptedCalls(c);
      c.messages.push(chatMessage('assistant', '上一轮已中断。执行结果未确认的操作不会自动重做，请先查询实际任务或草稿状态。'));
      c.status = 'idle'; c.leaseUntil = 0; c = this.save(c);
    }
    return c;
  }
  async send(input: {id: string; requestId: string; text: string}): Promise<AgentChatConversation> {
    let c = this.get(input.id);
    const requestHash = createHash('sha256').update(input.text.trim()).digest('hex');
    const existing = c.messages.find(m => m.requestId === input.requestId);
    if (existing) {
      if (existing.requestHash ? existing.requestHash !== requestHash : existing.content !== input.text.trim()) throw new AppError('CHAT_REQUEST_CONFLICT', '同一消息标识不能提交不同内容', 409);
      return c;
    }
    this.idle(c);
    if (!input.text.trim() || input.text.length > 8000) throw new AppError('INVALID_CHAT_MESSAGE', '请输入1–8000字的消息', 400);
    if (c.messages.length > 240) throw new AppError('CHAT_HISTORY_LIMIT', '本会话已较长，请新建对话继续', 409);
    const requestId = input.requestId || randomUUID();
    const model = this.deps.model();
    const text = this.deps.redact?.(input.text.trim()) ?? input.text.trim();
    if (!c.messages.length) c.title = text.slice(0, 36);
    c.messages.push(chatMessage('user', text, {requestId, requestHash}));
    c = this.claim(c); return this.run(c, model);
  }

  async decide(input: {id: string; actionId: string; decision: 'confirm' | 'reject'}): Promise<AgentChatConversation> {
    let c = this.get(input.id);
    const found = c.actions.find(a => a.id === input.actionId);
    if (!found) throw new AppError('CHAT_ACTION_NOT_FOUND', '待确认操作不存在', 404);
    if (found.status !== 'pending') return c;
    this.idle(c); c = this.claim(c);
    const action = c.actions.find(a => a.id === input.actionId)!;
    c.messages.push(chatMessage('user', `${input.decision === 'confirm' ? '确认执行' : '拒绝执行'}：${action.summary}`));
    if (input.decision === 'reject') {
      action.status = 'rejected'; action.result = chatResult({status: 'rejected', message: '作者已拒绝，未执行。'});
      this.receipt(c, action); c = this.save(c);
    } else {
      try {
        const tool = this.deps.tools().find(t => t.name === action.toolName);
        if (!tool) throw new AppError('CHAT_TOOL_UNAVAILABLE', '工具不再可用', 409);
        if (tool.prepare(action.arguments).guard !== action.guard) throw new AppError('CHAT_ACTION_STALE', '目标状态已变化，请重新查询并确认', 409);
        action.status = 'executing'; c = this.save(c);
        const live = c.actions.find(a => a.id === action.id)!;
        live.result = chatResult(await tool.execute(action.arguments)); live.status = 'succeeded';
        this.receipt(c, live); c = this.save(c);
      } catch (error) {
        const live = c.actions.find(a => a.id === action.id)!;
        const knownFailure = error instanceof AppError && error.status < 500;
        live.status = knownFailure ? 'failed' : 'uncertain'; live.result = chatError(error); this.receipt(c, live);
        const stale = (error as {code?: string})?.code === 'CHAT_ACTION_STALE';
        c.messages.push(chatMessage('assistant', stale ? '目标状态已变化，本次没有执行。请重新查询，再确认新的操作。'
          : knownFailure ? `操作未完成，不会自动重试。${live.result}` : '操作执行结果未确认。请先查询实际任务或草稿状态，此操作不会自动重复执行。'));
        c.status = 'idle'; c.leaseUntil = 0; return this.save(c);
      }
    }
    try {return await this.run(c, this.deps.model());}
    catch {c.messages.push(chatMessage('assistant', '操作回执已保存，模型总结未完成。请检查模型配置后继续对话。')); c.status = 'idle'; c.leaseUntil = 0; return this.save(c);}
  }

  private async run(initial: AgentChatConversation, model: ChatModel): Promise<AgentChatConversation> {
    let c = initial;
    try {
      const tools = this.deps.tools();
      let assistantId: string | undefined, streamedAt = 0;
      const result = await model.run(c.messages, tools, AbortSignal.timeout(330_000), {
        maxRounds: MAX_TOOL_ROUNDS,
        startTurn: () => {assistantId = undefined; streamedAt = 0; c.leaseUntil = Date.now() + LEASE_MS; c = this.save(c);},
        assistant: (reply, final) => {
          if (!final && Date.now() - streamedAt < 150) return;
          streamedAt = Date.now();
          let message = assistantId ? c.messages.find(item => item.id === assistantId) : undefined;
          if (!message) {message = chatMessage('assistant', ''); assistantId = message.id; c.messages.push(message);}
          message.content = reply.text;
          // Only persist complete tool calls; partial JSON is never executable.
          if (final && reply.calls.length) message.toolCalls = reply.calls;
          c = this.save(c);
        },
        execute: async call => {
          const result = await this.useTool(c, tools, call, c.actions.some(a => a.status === 'pending'));
          return {...result, content: this.deps.redact?.(result.content) ?? result.content};
        },
        toolResult: (call, content) => {
          c.messages.push(chatMessage('tool', content, {toolCallId: call.id, toolName: call.name}));
          c = this.save(c);
        },
      });
      if (result.limited) c.messages.push(chatMessage('assistant', '已达到本轮工具调用上限，已完成的结果已保存。请继续说明下一步。'));
    } catch (error) {
      // A failed provider response never erases successful tools or exposes upstream bodies/credentials.
      this.pairInterruptedCalls(c);
      c.messages.push(chatMessage('assistant', `这一轮请求未完成。${chatError(error)}`));
    }
    c.status = 'idle'; c.leaseUntil = 0; return this.save(c);
  }

  private async useTool(c: AgentChatConversation, tools: ChatTool[], call: AgentChatToolCall, stop: boolean) {
    try {
      if (stop) return {content: chatResult({status: 'not_executed', reason: '先处理上一项待确认操作'}), proposed: false};
      const tool = tools.find(t => t.name === call.name);
      if (!tool) throw new AppError('CHAT_TOOL_DENIED', '未开放的工具', 403);
      const args = tool.validate(call.arguments);
      if (!tool.requiresConfirmation) return {content: chatResult(await tool.execute(args)), proposed: false};
      if (c.actions.some(a => a.status === 'pending')) return {content: chatResult({status: 'pending_action_exists', reason: '请先确认或拒绝已有操作，模型无权确认'}), proposed: false};
      const preview = tool.prepare(args), now = new Date().toISOString();
      const action: AgentChatAction = {id: randomUUID(), callId: call.id, toolName: tool.name, arguments: args,
        summary: preview.summary, guard: preview.guard, status: 'pending', createdAt: now, updatedAt: now};
      c.actions.push(action);
      return {content: chatResult({status: 'awaiting_author_confirmation', actionId: action.id, summary: action.summary}), proposed: true};
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError' && 'issues' in error) {
        const fingerprint = JSON.stringify(call.arguments ?? null);
        const repeated = c.messages.some(message => message.role === 'tool' && message.toolName === call.name
          && message.content.includes('CHAT_INVALID_ARGS') && c.messages.some(prior => prior.role === 'assistant'
            && prior.toolCalls?.some(previous => previous.id === message.toolCallId && previous.name === call.name
              && JSON.stringify(previous.arguments ?? null) === fingerprint)));
        return {content: repeated ? chatResult({error: 'CHAT_INVALID_ARGS', message: '参数与上次相同已失败，请修改后重试。'}) : chatValidationError(error as import('zod').ZodError), proposed: false};
      }
      return {content: chatError(error), proposed: false};
    }
  }
  private receipt(c: AgentChatConversation, action: AgentChatAction) {
    action.updatedAt = new Date().toISOString();
    const result = c.messages.find(m => m.role === 'tool' && m.toolCallId === action.callId);
    if (result) result.content = action.result ?? chatResult({status: action.status});
  }
  private pairInterruptedCalls(c: AgentChatConversation) {
    const paired = new Set(c.messages.filter(m => m.role === 'tool').map(m => m.toolCallId));
    for (const call of c.messages.flatMap(m => m.toolCalls ?? [])) {
      if (paired.has(call.id)) continue;
      const action = c.actions.find(a => a.callId === call.id);
      const content = action?.result ?? chatResult(action?.status === 'pending'
        ? {status: 'awaiting_author_confirmation', actionId: action.id, summary: action.summary}
        : {error: 'CHAT_INTERRUPTED', status: 'interrupted', message: '工具回执未完成，请先查询实际状态；不会自动重做写操作。'});
      c.messages.push(chatMessage('tool', content, {toolCallId: call.id, toolName: call.name}));
      paired.add(call.id);
    }
  }
  private claim(c: AgentChatConversation) {c.status = 'running'; c.leaseUntil = Date.now() + LEASE_MS; return this.save(c);}
  private idle(c: AgentChatConversation) {if (c.status === 'running') throw new AppError('CHAT_BUSY', '这一轮仍在执行，请稍候或重新读取状态', 409);}
  private save(c: AgentChatConversation) {
    const clean = this.deps.redact ? JSON.parse(JSON.stringify(c, (_key, value) => typeof value === 'string' ? this.deps.redact!(value) : value)) as AgentChatConversation : c;
    return this.deps.repository.save(clean, c.version);
  }
}
