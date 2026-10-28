/** Key-order-independent JSON, used to recognise a byte-for-byte copy of draft content (S1 ⑦ copy carries the mock mark). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
}
