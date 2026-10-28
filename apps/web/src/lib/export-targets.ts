import { useEffect, useState } from 'react';
import { request } from './api';

/** Windows player availability (slice §5 X5). Global — the player file has nothing to do with drafts. */
export type ExeAvailability = 'ready' | 'missing' | 'unknown';
export type ExportTargetsView = {
  html: { available: boolean };
  'windows-exe': { available: boolean; unavailableReason?: string; playerPath?: string; version?: string; hostApiVersion?: number };
};

export function availabilityOf(view: ExportTargetsView | null | undefined): ExeAvailability {
  const exe = view?.['windows-exe'];
  if (!exe || typeof exe.available !== 'boolean') return 'unknown';
  return exe.available ? 'ready' : 'missing';
}

let current: ExeAvailability = 'unknown';
let queried: Promise<void> | null = null;
const listeners = new Set<(value: ExeAvailability) => void>();
function set(value: ExeAvailability) { current = value; for (const l of listeners) l(value); }

/** An export answered EXPORT_TARGET_UNAVAILABLE: disable the button everywhere until the page reloads. */
export function markExeMissing() { set('missing'); }
/** Test hook. */
export function resetExeAvailability() { current = 'unknown'; queried = null; listeners.clear(); }

/**
 * Query once per page load (no polling). Query failure ⇒ `unknown`, and the button stays clickable:
 * the click-time `EXPORT_TARGET_UNAVAILABLE` is the honest fallback.
 */
export function useExeAvailability(token: string): ExeAvailability {
  const [value, setValue] = useState<ExeAvailability>(current);
  useEffect(() => {
    listeners.add(setValue);
    setValue(current);
    if (!queried) {
      queried = request<ExportTargetsView>(token, '/exports/targets')
        .then(view => { if (current !== 'missing') set(availabilityOf(view)); })
        .catch(() => { /* stays unknown */ });
    }
    return () => { listeners.delete(setValue); };
  }, [token]);
  return value;
}
