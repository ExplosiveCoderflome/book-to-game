import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatTool } from '../modules/agent/index.js';
import type { Command } from './commands/definition.js';

const automatic = new Set(['runtime_info', 'list_sources', 'read_source', 'list_jobs', 'get_job', 'list_world_drafts', 'get_world_draft',
  'get_world_preflight', 'validate_world_draft', 'lint_world_draft', 'playtest_world_draft', 'agent_status', 'list_agent_decisions',
  'list_agent_repairs', 'create_agent_repair', 'list_drafts', 'get_draft', 'validate_draft', 'lint_draft', 'list_world_revisions', 'list_games']);
const confirmed = new Set(['create_generation_job', 'create_production_job', 'retry_job', 'cancel_job', 'rewrite_production_unit',
  'apply_agent_repair', 'reject_agent_repair', 'publish_world_draft', 'publish_draft', 'edit_world_summary']);

/** Small author tool surface. Model settings, raw files, exports, player actions and chat-control tools are excluded. */
export function createAgentChatTools(commands: Command[], preview: (name: string, args: Record<string, unknown>) => {summary: string; guard?: string}): ChatTool[] {
  return commands.filter(c => automatic.has(c.name) || confirmed.has(c.name)).map(c => ({
    name: c.name, description: c.description + (c.name === 'playtest_world_draft' ? '（对话内最多40种子）' : ''),
    parameters: z.toJSONSchema(c.inputSchema, {unrepresentable: 'any', reused: 'ref'}) as Record<string, unknown>,
    requiresConfirmation: confirmed.has(c.name),
    validate: input => {
      const value = input && typeof input === 'object' ? {...input} as Record<string, unknown> : {};
      if ('requestId' in c.inputSchema.shape && !value.requestId) value.requestId = randomUUID();
      if (c.name === 'playtest_world_draft') value.seeds = Math.min(typeof value.seeds === 'number' ? value.seeds : 40, 40);
      return c.inputSchema.parse(value) as Record<string, unknown>;
    },
    prepare: args => preview(c.name, args),
    execute: async args => {
      const result = await c.execute(args);
      if (Array.isArray(result) && ['list_world_drafts', 'list_drafts', 'list_jobs', 'list_world_revisions', 'list_games'].includes(c.name)) {
        return result.map(row => ({id: row.id, sourceId: row.sourceId, version: row.version, title: row.content?.title,
          status: row.status, stage: row.stage, draftId: row.draftId, updatedAt: row.updatedAt, failure: row.failure?.code}));
      }
      if (c.name === 'edit_world_summary' && result && typeof result === 'object' && 'content' in result) {
        const draft = result as {id: string; version: number; content: {title: string}};
        return {id: draft.id, version: draft.version, title: draft.content.title, changed: Object.keys(args).filter(k => !['id', 'version'].includes(k))};
      }
      return result;
    },
  }));
}
