const RETRY_AFTER_CAP_MS = 60_000;

export type FailureClass = 'retryable' | 'permanent';

export function classifyStatus(status: number): FailureClass {
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return 'retryable';
  return 'permanent';
}

/** Seconds or HTTP-date. Invalid headers return undefined so the caller can fall back to backoff. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, Number(trimmed) * 1000));
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, when - now));
}

export function backoffMs(attempt: number, baseMs: number, maxMs: number, random: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * 0.2 * (random * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/** Retry-After wins over exponential backoff, including an explicit zero. */
export function retryDelayMs(input: {attempt: number; baseMs: number; maxMs: number; random: number; retryAfterMs?: number}): number {
  if (typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs)) {
    return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, input.retryAfterMs));
  }
  return backoffMs(input.attempt, input.baseMs, input.maxMs, input.random);
}
