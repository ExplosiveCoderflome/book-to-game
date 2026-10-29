/** S4: lint for state-dependent storylet bodies (`textCases`). Pure, heuristic, warnings only. */
import { storyletBodies, type Storylet, type WorldCondition, type WorldContent } from '@novel-game/contracts';

export interface StateVariantIssue {ruleId: 'pool.case-shadowed' | 'pool.case-unreachable' | 'pool.state-contradiction'; message: string; storyletId: string; title: string}

/** A fact label/description that says a person died or left. */
export const GONE_WORDS = /死|亡|身故|离世|过世|殒|遇害|被杀|离开|离去|远走|出走|辞别|失踪|下落不明|不知所踪|走了/;

/** Words before a name that make it a memory or comparison rather than the person being there. */
const MEMORY_WORDS = /当年|从前|以前|想起|想到|像|那时|曾经|记得|梦见|梦里|忆/;

const flat = (conds: readonly WorldCondition[] = []): WorldCondition[] => conds.flatMap(c => c.kind === 'anyOf' ? [] : [c]);
const key = (c: WorldCondition) => JSON.stringify(c);
const factIs = (conds: readonly WorldCondition[] | undefined, factId: string, value: boolean) => flat(conds).some(c => c.kind === 'fact' && c.factId === factId && c.value === value);

function disjoint(a: WorldCondition, b: WorldCondition): boolean {
  if (a.kind === 'fact' && b.kind === 'fact') return a.factId === b.factId && a.value !== b.value;
  if (a.kind === 'resource' && b.kind === 'resource' && a.resourceId === b.resourceId)
    return (a.atLeast !== undefined && b.atMost !== undefined && a.atLeast > b.atMost) || (b.atLeast !== undefined && a.atMost !== undefined && b.atLeast > a.atMost);
  if (a.kind === 'storylet_seen' && b.kind === 'storylet_seen' && a.storyletId === b.storyletId)
    return (a.atLeast !== undefined && b.atMost !== undefined && a.atLeast > b.atMost) || (b.atLeast !== undefined && a.atMost !== undefined && b.atLeast > a.atMost);
  return false;
}

/** Facts that can become true during play (some effect sets them, or they start true). */
function settableTrue(world: WorldContent): Set<string> {
  const out = new Set(world.facts.filter(f => f.initialValue).map(f => f.id));
  const seen = JSON.stringify(world);
  for (const f of world.facts) if (seen.includes(`"kind":"set","factId":"${f.id}","value":true`)) out.add(f.id);
  return out;
}

/** The text shows the person as present: names them, and not only next to words saying they died or left. */
function presents(text: string, npc: string): boolean {
  let i = text.indexOf(npc);
  while (i >= 0) {
    const near = text.slice(Math.max(0, i - 4), i), before = text.slice(Math.max(0, i - 10), i), after = text.slice(i + npc.length, i + npc.length + 8);
    // Not presence: next to died/left words, a memory (当年、想起、像…) or a possessive mention (「哑伯的账」).
    if (!GONE_WORDS.test(near + npc + after) && !MEMORY_WORDS.test(before) && !/^(的|那)/.test(after)) return true;
    i = text.indexOf(npc, i + npc.length);
  }
  return false;
}
const setsTrue = (sl: Storylet, factId: string) => JSON.stringify(sl.choices).includes(`"kind":"set","factId":"${factId}","value":true`);

export function lintStateVariants(world: WorldContent): StateVariantIssue[] {
  const issues: StateVariantIssue[] = [];
  const settable = settableTrue(world);
  // Person-gone facts: label/description names an NPC and says they died or left.
  const gone = world.facts.flatMap(f => {
    const text = `${f.label} ${f.description}`;
    if (!GONE_WORDS.test(text) || !settable.has(f.id)) return [];
    return world.npcs.filter(n => n.name.length >= 2 && text.includes(n.name)).map(n => ({fact: f, npc: n.name}));
  });
  for (const sl of world.storylets ?? []) {
    const add = (ruleId: StateVariantIssue['ruleId'], message: string) => issues.push({ruleId, message, storyletId: sl.id, title: sl.title});
    const cases = sl.textCases ?? [];
    cases.forEach((cs, j) => {
      const label = `「${sl.title}」条件变体 ${cs.id ?? j + 1}`;
      // Shadowed: an earlier case's conditions are a subset of this one's → that earlier case always wins first.
      const mine = new Set(flat(cs.when).map(key));
      const earlier = cases.slice(0, j).findIndex(o => o.when.length && o.when.every(c => c.kind !== 'anyOf' && mine.has(key(c))));
      if (earlier >= 0) add('pool.case-shadowed', `${label} 永远显示不出来：前面的变体 ${cases[earlier]!.id ?? earlier + 1} 条件更宽，总是先命中（先写更具体的条件）`);
      // Unreachable: contradicts the card's own `when`, or asks for more plays than the card allows.
      const clash = flat(cs.when).find(c => flat(sl.when).some(w => disjoint(c, w)));
      if (clash) add('pool.case-unreachable', `${label} 的条件与卡片出现条件互相矛盾，永远不会显示`);
      const self = flat(cs.when).find(c => c.kind === 'storylet_seen' && c.storyletId === sl.id && c.atLeast !== undefined) as Extract<WorldCondition, {kind: 'storylet_seen'}> | undefined;
      const maxShows = sl.repeat ? sl.repeat.maxTimes ?? Infinity : 1;
      if (self && self.atLeast! >= maxShows) add('pool.case-unreachable', `${label} 要求本卡已出现 ≥ ${self.atLeast} 次，但这张卡最多出现 ${maxShows} 次（第 k 次出现时已出现 k−1 次）`);
    });
    // State contradiction: a body names someone who may already be dead / gone, and nothing earlier catches that state.
    // Only repeat scenes: a one-time card is read once, usually before or as part of that change.
    if (!sl.repeat) continue;
    for (const {fact, npc} of gone) {
      if (factIs(sl.when, fact.id, false)) continue; // the card cannot appear after it
      if (setsTrue(sl, fact.id)) continue;            // the card itself causes the change
      const caught = (upTo: number) => cases.slice(0, upTo).some(o => factIs(o.when, fact.id, true));
      const bad: string[] = [];
      cases.forEach((cs, j) => { if (presents(cs.text, npc) && !factIs(cs.when, fact.id, true) && !factIs(cs.when, fact.id, false) && !caught(j)) bad.push(`条件变体 ${cs.id ?? j + 1}`); });
      if (!caught(cases.length) && storyletBodies(sl).some(b => presents(b, npc))) bad.push(cases.length ? '默认正文' : '正文');
      if (bad.length) add('pool.state-contradiction', `「${sl.title}」的${bad.join('、')}写到「${npc}」，但「${fact.label}」成立后这张卡仍可能出现，会让${npc}以原状态出场；加一段 when 为「${fact.label}」的条件变体，或在卡片 when 里排除`);
    }
  }
  return issues;
}

export function hasStateCases(sl: Storylet): boolean { return !!sl.textCases?.length; }
