/**
 * Export-time secret scan (slice §7.1): the package must never carry the author's model key,
 * the workbench access code, or anything that looks like a credential. Reports WHERE, never the value.
 */
export type SecretHit = { location: string; rule: string };

const PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { rule: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { rule: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
];

function pathOf(value: unknown, needle: (text: string) => boolean, path = ''): string | undefined {
  if (typeof value === 'string') return needle(value) ? (path || '$') : undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = pathOf(value[i], needle, `${path}[${i}]`);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (needle(key)) return path ? `${path}.${key}` : key;
      const hit = pathOf(child, needle, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * @param content  the package content object (for readable JSON paths)
 * @param sections named raw texts that will be written into the file (manifest, content, player template)
 * @param secrets  exact secret values known to this workbench (model key, access code, env keys)
 */
export function scanForSecrets(content: unknown, sections: Record<string, string>, secrets: string[]): SecretHit[] {
  const known = [...new Set(secrets.filter(s => typeof s === 'string' && s.trim().length >= 8).map(s => s.trim()))];
  const hits: SecretHit[] = [];
  const checks: { rule: string; test: (text: string) => boolean }[] = [
    ...known.map(secret => ({ rule: 'configured-secret', test: (text: string) => text.includes(secret) })),
    ...PATTERNS.map(({ rule, re }) => ({ rule, test: (text: string) => re.test(text) })),
  ];
  for (const check of checks) {
    for (const [name, text] of Object.entries(sections)) {
      if (!check.test(text)) continue;
      const location = name === 'content' ? `content.${pathOf(content, check.test) ?? '$'}` : name;
      if (!hits.some(hit => hit.location === location && hit.rule === check.rule)) hits.push({ location, rule: check.rule });
    }
  }
  return hits;
}
