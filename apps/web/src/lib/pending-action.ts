import type { ActInput } from '@novel-game/contracts';

export interface PendingActionValue { sessionId: string; input: ActInput }

/** Keep the same input until the server has confirmed an action. */
export class PendingAction {
  value: PendingActionValue | null;
  constructor(value: PendingActionValue | null = null) { this.value = value; }
  begin(sessionId: string, choiceId: string, expectedTurn: number): ActInput {
    if (this.value) {
      if (this.value.sessionId !== sessionId || this.value.input.choiceId !== choiceId) {
        throw new Error('上一选择的结果尚未确认，请先重试该选择。');
      }
      return this.value.input;
    }
    const input = { choiceId, expectedTurn, requestId: crypto.randomUUID() };
    this.value = { sessionId, input };
    return input;
  }
  confirm() { this.value = null; }
}
