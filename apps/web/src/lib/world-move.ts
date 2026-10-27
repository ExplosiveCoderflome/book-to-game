import type { WorldEffect } from '@novel-game/contracts';

/** First `move` effect target, if any — display/topology only; does not submit state. */
export function moveTarget(effects: WorldEffect[]): string | null {
  const move = effects.find(e => e.kind === 'move');
  return move && move.kind === 'move' ? move.locationId : null;
}
