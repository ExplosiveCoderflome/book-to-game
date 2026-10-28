/** Text metrics for lint v2 (§6.6 文本): banned phrases, length, 5-gram Jaccard, frequent 12-char fragments. */

/** Starting banned-phrase table (extendable via LintOptions.bannedPhrases). */
export const DEFAULT_BANNED_PHRASES = ['气氛紧绷', '每个选择都有代价', '你来到「', '结局将近', '命运的齿轮'] as const;

/** Visible character count (whitespace excluded). */
export function textLength(text: string): number { return [...text.replace(/\s+/g, '')].length; }

const PUNCT = /[\s，。、；：？！“”‘’「」『』（）《》〈〉…—\-,.;:?!'"()[\]{}]/g;
function normalize(text: string): string[] { return [...text.replace(PUNCT, '')]; }

export function shingles(text: string, n = 5): Set<string> {
  const chars = normalize(text); const out = new Set<string>();
  for (let i = 0; i + n <= chars.length; i++) out.add(chars.slice(i, i + n).join(''));
  return out;
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface TextUnit {owner: string; ownerKind: 'storylet' | 'location' | 'ending' | 'scene'; label: string; text: string; minLength?: number}

/** Pairs of bodies from different owners whose 5-gram Jaccard exceeds the limit. */
export function similarPairs(units: TextUnit[], limit = 0.6): {a: TextUnit; b: TextUnit; score: number}[] {
  const sets = units.map(u => shingles(u.text));
  const out: {a: TextUnit; b: TextUnit; score: number}[] = [];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    if (units[i]!.owner === units[j]!.owner) continue;
    const si = sets[i]!; const sj = sets[j]!;
    // Upper bound on Jaccard is min/max of sizes: skip hopeless pairs fast.
    if (Math.min(si.size, sj.size) / Math.max(si.size, sj.size || 1) <= limit) continue;
    const score = jaccard(si, sj);
    if (score > limit) out.push({a: units[i]!, b: units[j]!, score});
  }
  return out;
}

/** 12-char fragments (punctuation-stripped) that occur more than `maxCount` times across all units; greedy, non-overlapping. */
export function frequentFragments(units: TextUnit[], size = 12, maxCount = 3, limit = 10): {fragment: string; count: number; owners: string[]}[] {
  const counts = new Map<string, {count: number; owners: Set<string>}>();
  for (const u of units) {
    const chars = normalize(u.text);
    for (let i = 0; i + size <= chars.length; i++) {
      const key = chars.slice(i, i + size).join('');
      const entry = counts.get(key) ?? {count: 0, owners: new Set<string>()};
      entry.count++; entry.owners.add(u.owner); counts.set(key, entry);
    }
  }
  const hits = [...counts.entries()].filter(([, v]) => v.count > maxCount && v.owners.size > 1).sort((a, b) => b[1].count - a[1].count);
  const picked: {fragment: string; count: number; owners: string[]}[] = [];
  for (const [fragment, v] of hits) {
    // Skip fragments that overlap one already reported (share ≥ 6 chars).
    if (picked.some(p => overlap(p.fragment, fragment) >= 6)) continue;
    picked.push({fragment, count: v.count, owners: [...v.owners]});
    if (picked.length >= limit) break;
  }
  return picked;
}
function overlap(a: string, b: string): number {
  let best = 0;
  for (let k = 1; k <= Math.min(a.length, b.length); k++) if (a.endsWith(b.slice(0, k)) || b.endsWith(a.slice(0, k))) best = k;
  return a.includes(b) || b.includes(a) ? Math.min(a.length, b.length) : best;
}
