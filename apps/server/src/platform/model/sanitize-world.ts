/** Soften common model quirks before worldContentSchema validation. Does not invent structure. */
export function sanitizeWorldCandidate(value: unknown): unknown {
  return scrub(value, {action: true});
}

function scrub(value: unknown, context: {action?: boolean}): unknown {
  if (Array.isArray(value)) return value.map(item => scrub(item, context));
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (child === null) continue;
    if (context.action && key === 'blockedReason' && typeof child === 'string' && !child.trim()) {
      out[key] = '尚未满足执行条件。';
      continue;
    }
    if (key === 'actions' && Array.isArray(child)) {
      out[key] = child.map(item => scrub(item, {action: true}));
      continue;
    }
    out[key] = scrub(child, {});
  }
  return out;
}
