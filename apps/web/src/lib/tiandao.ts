/** Play-time「天道修正」toggle — localStorage, default OFF (same pattern as L1 narrate). */
export const tiandaoStorageKey = 'novel-game.tiandao-correct';

export function readTiandaoCorrect(): boolean {
  try { return window.localStorage.getItem(tiandaoStorageKey) === '1'; } catch { return false; }
}

export function writeTiandaoCorrect(value: boolean): void {
  try { window.localStorage.setItem(tiandaoStorageKey, value ? '1' : '0'); } catch { /* ignore */ }
}
