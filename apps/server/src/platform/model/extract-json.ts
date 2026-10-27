export type JsonContentReason = 'empty' | 'truncated' | 'invalid' | 'too_large';

export class JsonContentError extends Error {
  constructor(message: string, readonly reason: JsonContentReason) {
    super(message);
    this.name = 'JsonContentError';
  }
}

/** Pull one JSON value out of model text: fences, surrounding prose, trailing commas. */
export function extractJsonValue(raw: string): unknown {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) throw new JsonContentError('模型返回为空', 'empty');
  const direct = parseJson(text);
  if (direct.ok) return unwrapString(direct.value);
  const unfenced = unwrapFence(text);
  if (unfenced !== text) {
    if (!unfenced) throw new JsonContentError('模型返回为空', 'empty');
    const fenced = parseJson(unfenced);
    if (fenced.ok) return unwrapString(fenced.value);
  }
  const extracted = extractBalancedObject(unfenced);
  if (!extracted) throw new JsonContentError('模型返回中没有 JSON 对象', 'invalid');
  if (extracted.truncated) throw new JsonContentError('模型返回的 JSON 被截断', 'truncated');
  const parsed = parseJson(extracted.value);
  if (!parsed.ok) throw new JsonContentError('模型返回的 JSON 无法解析', 'invalid');
  return unwrapString(parsed.value);
}

function unwrapString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = parseJson(value.trim());
  return parsed.ok ? parsed.value : value;
}

function unwrapFence(text: string): string {
  const closed = text.match(/```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/);
  if (closed) return closed[1].trim();
  if (!text.includes('```')) return text;
  const open = text.match(/```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*)$/);
  return open ? open[1].trim() : text;
}

function parseJson(text: string): {ok: true; value: unknown} | {ok: false} {
  try {
    return {ok: true, value: JSON.parse(stripTrailingCommas(text))};
  } catch {
    return {ok: false};
  }
}

function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {inString = true; out += ch; continue;}
    if (ch === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function extractBalancedObject(text: string): {value: string; truncated: boolean} | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {inString = true; continue;}
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return {value: text.slice(start, i + 1), truncated: false};
    }
  }
  return {value: text.slice(start), truncated: true};
}
