import { adventureActSchema, type AdventureActInput } from '@novel-game/contracts';
import { newRequestId } from './request-id';
export interface PendingAdventureValue { sessionId: string; input: AdventureActInput }
export const adventurePendingKey = 'novel-game.pending-adventure';
export function restoreAdventure(storage: Pick<Storage, 'getItem'>): PendingAdventureValue | null {
  try {
    const value = JSON.parse(storage.getItem(adventurePendingKey) ?? 'null');
    const input = adventureActSchema.safeParse(value?.input);
    return typeof value?.sessionId === 'string' && input.success ? {sessionId: value.sessionId, input: input.data} : null;
  } catch { return null; }
}
export class PendingAdventure {
  constructor(public value: PendingAdventureValue | null = null) {}
  begin(sessionId: string, actionId: string, expectedTurn: number): AdventureActInput {
    if (this.value) {
      if (this.value.sessionId !== sessionId || this.value.input.actionId !== actionId) throw new Error('上一行动结果尚未确认，请先重试。');
      return this.value.input;
    }
    const input = {actionId, expectedTurn, requestId: newRequestId()};
    this.value = {sessionId, input}; return input;
  }
  confirm() { this.value = null; }
}
