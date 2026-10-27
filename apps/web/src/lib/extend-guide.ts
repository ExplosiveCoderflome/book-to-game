const prefix = 'novel-game.extend-guide-dismissed:';

function storage(): Storage | null {
  try {
    const g = globalThis as typeof globalThis & { sessionStorage?: Storage };
    return g.sessionStorage ?? null;
  } catch { return null; }
}

export function isExtendGuideDismissed(draftId: string): boolean {
  if (!draftId) return true;
  try { return storage()?.getItem(prefix + draftId) === '1'; } catch { return false; }
}

export function dismissExtendGuide(draftId: string): void {
  if (!draftId) return;
  try { storage()?.setItem(prefix + draftId, '1'); } catch { /* ignore */ }
}

export function clearExtendGuideDismiss(draftId: string): void {
  if (!draftId) return;
  try { storage()?.removeItem(prefix + draftId); } catch { /* ignore */ }
}
