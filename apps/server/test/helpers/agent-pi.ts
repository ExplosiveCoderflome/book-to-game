import type { ServerResponse } from 'node:http';
import { createAssistantMessageEventStream, type AssistantMessage } from '@mariozechner/pi-ai';
import type { AgentChatMessage, AgentChatToolCall } from '@novel-game/contracts';
import { AgentChatCompletionsModel, emptyUsage } from '../../src/platform/model/agent-chat.js';

export function scriptedChat(respond: (messages: AgentChatMessage[]) => Promise<{text: string; calls: AgentChatToolCall[]}>) {
  return new AgentChatCompletionsModel({baseUrl: 'http://localhost/v1', model: 'scripted-agent', apiKey: '', timeoutMs: 5000}, (_model, context) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message: AssistantMessage = {role: 'assistant', content: [], api: 'openai-completions', provider: 'openai',
        model: 'scripted-agent', usage: emptyUsage(), stopReason: 'stop', timestamp: Date.now()};
      try {
        const history = context.messages.map((item, index): AgentChatMessage => ({id: String(index),
          role: item.role === 'toolResult' ? 'tool' : item.role, createdAt: new Date(item.timestamp).toISOString(),
          content: typeof item.content === 'string' ? item.content : item.content.filter(part => part.type === 'text').map(part => part.text).join(''),
          ...(item.role === 'assistant' ? {toolCalls: item.content.filter(part => part.type === 'toolCall').map(part => ({id: part.id, name: part.name, arguments: part.arguments}))} : {}),
          ...(item.role === 'toolResult' ? {toolCallId: item.toolCallId, toolName: item.toolName} : {}),
        }));
        const reply = await respond(history);
        message.content = [...(reply.text ? [{type: 'text' as const, text: reply.text}] : []), ...reply.calls.map(call => ({type: 'toolCall' as const, ...call}))];
        message.stopReason = reply.calls.length ? 'toolUse' : 'stop';
        stream.push({type: 'done', reason: message.stopReason, message});
      } catch {message.stopReason = 'error'; message.errorMessage = 'scripted failure'; stream.push({type: 'error', reason: 'error', error: message});}
      stream.end();
    })();
    return stream;
  });
}

/** Real SSE framing used by the OpenAI-compatible Pi adapter. */
export function streamChatReply(res: ServerResponse, reply: {content?: string | null; tool_calls?: unknown[] | null}) {
  res.setHeader('Content-Type', 'text/event-stream');
  const delta = {role: 'assistant', content: reply.content, ...(reply.tool_calls ? {tool_calls: reply.tool_calls.map((call, index) => ({...call as object, index}))} : {})};
  const delimiter = String.fromCharCode(10, 10);
  res.write(`data: ${JSON.stringify({id: 'test-completion', choices: [{index: 0, delta, finish_reason: null}]})}${delimiter}`);
  res.write(`data: ${JSON.stringify({id: 'test-completion', choices: [{index: 0, delta: {}, finish_reason: reply.tool_calls?.length ? 'tool_calls' : 'stop'}]})}${delimiter}`);
  res.end(`data: [DONE]${delimiter}`);
}
