import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ChatTool } from '../../modules/agent/index.js';

export const FOCUS_CATALOG = 'discover_agent_tools';
export const FOCUS_SELECT = 'select_agent_tools';
export const MAX_FOCUS_TOOLS = 8;
export const MAX_FOCUS_BYTES = 128 * 1024;
type Definition = Pick<AgentTool, 'name' | 'description' | 'parameters'>;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Ephemeral advertisement state only: never authorization or command dispatch. */
export class AgentToolFocus {
  readonly enabled: boolean;
  readonly meta: Definition[];
  private selected: string[] = [];
  private advertised = new Set<string>();
  constructor(private readonly tools: ChatTool[], private readonly definitions: Definition[]) {
    this.enabled = tools.length > 24 || bytes(definitions) > 64 * 1024;
    if (this.enabled && tools.some(t => this.isMeta(t.name))) throw new Error('CHAT_TOOL_FOCUS_NAME_COLLISION');
    this.meta = [
      {name: FOCUS_CATALOG, description: 'Read the complete available tool inventory (compact capability summaries and author-confirmation flags). Does not execute or authorize any command. No schemas in this receipt.',
        parameters: {type: 'object', properties: {}, additionalProperties: false} as AgentTool['parameters']},
      {name: FOCUS_SELECT, description: 'Replace the focused native tool set for the NEXT model request. Select exact inventory names, at most 8 and 128 KiB of original definitions. Empty names clears focus. No business execution or authorization; original schemas appear only in next native tools.',
        parameters: {type: 'object', properties: {names: {type: 'array', items: {type: 'string'}, maxItems: MAX_FOCUS_TOOLS, uniqueItems: true}}, required: ['names'], additionalProperties: false} as AgentTool['parameters']},
    ];
  }
  isMeta(name: string) {return name === FOCUS_CATALOG || name === FOCUS_SELECT;}
  available(name: string) {return this.advertised.has(name);}
  /** Freeze a request's authority to call tools, even when a batch changes focus. */
  next() {
    const definitions = this.enabled ? [...this.meta, ...this.definitions.filter(t => this.selected.includes(t.name))] : this.definitions;
    this.advertised = new Set(definitions.map(t => t.name));
    return definitions;
  }
  instructions() {
    return this.enabled ? `\n[Explicit bounded tool-focus mode] All ${this.tools.length} registered capabilities remain discoverable via ${FOCUS_CATALOG}({}). Call ${FOCUS_SELECT}({names:[exact inventory names]}) to replace focus (max ${MAX_FOCUS_TOOLS} tools, ${MAX_FOCUS_BYTES} definition bytes); exact original schemas become native tools on the NEXT request only. Never call an unadvertised tool, including in the selection batch. Discovery/selection are read-only metadata and never author approval. Current available business tools: ${JSON.stringify([...this.advertised].filter(n => !this.isMeta(n)))}. Focus resets at every run, including confirmation continuation and new intent; historical selections are not authority. Rediscover/reselect as needed. Existing budgets and author confirmations still apply.\n` : '';
  }
  denied() {return JSON.stringify({error: 'CHAT_TOOL_UNAVAILABLE', status: 'not_executed', message: 'Tool is not advertised for this request. Discover the inventory and select supported names for the next request.'});}
  invoke(name: string, args: unknown): string {
    const fail = (reason: string) => JSON.stringify({error: 'CHAT_TOOL_FOCUS_INVALID', status: 'not_executed', reason, focus: this.selected});
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('Expected an object');
    const input = args as Record<string, unknown>;
    if (name === FOCUS_CATALOG) {
      if (Object.keys(input).length) return fail('Discovery accepts no arguments');
      return JSON.stringify({mode: 'bounded-tool-focus', complete: true, total: this.tools.length, maxTools: MAX_FOCUS_TOOLS, maxDefinitionBytes: MAX_FOCUS_BYTES, availableNow: [...this.advertised].filter(n => !this.isMeta(n)), nextFocus: this.selected, inventory: this.tools.map(t => ({name: t.name, requiresConfirmation: t.requiresConfirmation, summary: t.description.slice(0, 160)}))});
    }
    if (name !== FOCUS_SELECT || Object.keys(input).some(k => k !== 'names') || !Array.isArray(input.names)
      || input.names.length > MAX_FOCUS_TOOLS || input.names.some(n => typeof n !== 'string') || new Set(input.names).size !== input.names.length) return fail('Expected unique names within the focus count bound');
    const names = input.names as string[];
    if (names.some(n => !this.definitions.some(t => t.name === n))) return fail('Unknown or unsupported inventory name');
    const selected = this.definitions.filter(t => names.includes(t.name));
    if (bytes(selected) > MAX_FOCUS_BYTES) return fail('Focus definition byte bound exceeded');
    this.selected = [...names];
    return JSON.stringify({status: 'selected_for_next_request', focus: this.selected, definitionBytes: bytes(selected), message: 'Original schemas are advertised next request; this receipt grants no execution or author approval.'});
  }
}
