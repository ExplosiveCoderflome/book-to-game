/** C9 author routes (never imported by src/package/*). */
import type { LintReport, PlaytestReport } from '@novel-game/contracts';
import { request } from './api';

export interface WorldPreflight { lint?: LintReport; playtest?: PlaytestReport; draftVersion: number; stale: { lint: boolean; playtest: boolean } }

export const lintWorldDraft = (token: string, id: string) => request<LintReport>(token, `/worlds/drafts/${id}/lint`, 'POST', {});
export const playtestWorldDraft = (token: string, id: string, seeds?: number) =>
  request<PlaytestReport>(token, `/worlds/drafts/${id}/playtest`, 'POST', seeds ? { seeds } : {});
export const getWorldPreflight = (token: string, id: string) => request<WorldPreflight>(token, `/worlds/drafts/${id}/preflight`);

/** Display helpers kept pure so they can be unit-tested. */
export const percent1 = (share: number) => (Math.round(share * 1000) / 10).toFixed(1).replace(/\.0$/, '');
export function preflightTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export type StripTone = 'error' | 'warn' | 'ok' | 'muted';
export const lintTone = (r: Pick<LintReport, 'errors' | 'warnings'>): StripTone => r.errors > 0 ? 'error' : r.warnings > 0 ? 'warn' : 'ok';
export const playtestTone = (r: Pick<PlaytestReport, 'checks'>): StripTone => r.checks.every(c => c.pass) ? 'ok' : 'warn';
