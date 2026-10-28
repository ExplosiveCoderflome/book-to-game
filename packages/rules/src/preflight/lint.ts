/**
 * Lint v2 (§6.6). Pure: content in, LintReport out. Runs on every world and story draft; per D7 only
 * content that uses the S1 systems (resourceDefs / clock / storylets) gets `blocking: true`.
 */
import { storyletBodies, type GameContent, type LintCategory, type LintIssue, type LintReport, type LintTarget, type PassCheck, type VolumeTier, type WorldCondition, type WorldContent, type WorldEffect } from '@novel-game/contracts';
import { assessOpeningActions } from '../world-opening.js';
import { validateS1References, walkWorldLogic } from '../s1-references.js';
import { DEFAULT_BANNED_PHRASES, frequentFragments, similarPairs, textLength, type TextUnit } from './text-metrics.js';

export interface VolumeTarget {cards: number; repeatable: number; endings: number; failureEndings: number; chars: number}
/** §6.1 tiers (S ≈ 15 min / 25 cards, M ≈ 30 min / 60 cards, L ≈ 60 min / 120 cards); M floors follow §1 G2/G4. */
export const VOLUME_TIERS: Record<VolumeTier, VolumeTarget> = {
  S: {cards: 25, repeatable: 8, endings: 2, failureEndings: 1, chars: 15000},
  M: {cards: 40, repeatable: 15, endings: 4, failureEndings: 2, chars: 30000},
  L: {cards: 120, repeatable: 30, endings: 6, failureEndings: 3, chars: 60000},
};
export interface LintOptions {
  tier?: VolumeTier; bannedPhrases?: readonly string[];
  minStoryletChars?: number; minLocationChars?: number; minSceneChars?: number;
  draftId?: string; draftVersion?: number; now?: string;
}
const EMPTY_LABEL = /^(继续|往前走|向前走|随便看看|离开|下一步|继续前进|看看周围|无事发生|走吧|…|\.{2,}|—+|-+)$/;

class Collector {
  issues: LintIssue[] = [];
  add(severity: 'error' | 'warning', category: LintCategory, ruleId: string, message: string, target?: LintTarget) {
    this.issues.push({severity, category, ruleId, message, ...(target ? {target} : {})});
  }
}

function textRules(c: Collector, units: TextUnit[], opts: LintOptions): void {
  const banned = [...DEFAULT_BANNED_PHRASES, ...(opts.bannedPhrases ?? [])];
  for (const u of units) {
    const target: LintTarget = {kind: u.ownerKind, id: u.owner, label: u.label};
    for (const phrase of banned) if (u.text.includes(phrase)) c.add('error', 'text', 'text.banned-phrase', `${u.label}：命中禁用句「${phrase}」`, target);
    if (u.minLength !== undefined) {
      const len = textLength(u.text);
      if (len < u.minLength) c.add('error', 'text', 'text.too-short', `${u.label}：正文 ${len} 字，低于最短 ${u.minLength} 字`, target);
    }
  }
  for (const pair of similarPairs(units, 0.6)) c.add('error', 'text', 'text.near-duplicate',
    `${pair.a.label} 与 ${pair.b.label} 正文相似度 ${pair.score.toFixed(2)}（> 0.60）`, {kind: pair.a.ownerKind, id: pair.a.owner, label: pair.a.label});
  for (const f of frequentFragments(units)) c.add('warning', 'text', 'text.frequent-fragment',
    `句式重复：「${f.fragment}」出现 ${f.count} 次（${f.owners.slice(0, 4).join('、')}${f.owners.length > 4 ? ' 等' : ''}）`);
}

const check = (id: string, label: string, line: string, measured: string, pass: boolean): PassCheck => ({id, label, line, measured, pass});

export function lintWorld(world: WorldContent, opts: LintOptions = {}): LintReport {
  const c = new Collector();
  const s1 = !!(world.resourceDefs || world.clock || world.storylets);
  const tier = opts.tier ?? 'M';
  const target = VOLUME_TIERS[tier];
  // Content delivered in batches: tier shortfalls are reported, not blocking, until the last batch.
  const partial = world.production?.complete === false;
  const tierSeverity = partial ? 'warning' as const : 'error' as const;
  const tierNote = partial ? `（分批交付中${world.production?.batch ? `：第 ${world.production.batch} 批` : ''}）` : '';
  const storylets = world.storylets ?? [];
  const defs = world.resourceDefs ?? {};
  // ── structure
  const opening = assessOpeningActions(world);
  if (!opening.ok) c.add('error', 'structure', 'structure.opening', opening.message ?? '开局可执行行动不足', {kind: 'world', id: 'opening', label: '开局'});
  if (s1) for (const issue of validateS1References(world)) {
    const category: LintCategory = issue.ruleId === 's1.gate-out-of-range' || issue.ruleId === 's1.unknown-resource' || issue.ruleId === 's1.resource-bounds' ? 'resource' : 'structure';
    c.add(issue.level, category, issue.ruleId, issue.message, issue.target ? {kind: targetKind(world, issue.target), id: issue.target} : undefined);
  }
  // ── resources: sources / sinks / gates
  const sources = new Map<string, number>(); const sinks = new Map<string, number>(); const gates = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let choiceCount = 0; let changingChoices = 0;
  const onEffect = (e: WorldEffect) => {
    if (e.kind === 'resource') {
      const amount = e.delta ?? 0;
      if (amount > 0) bump(sources, e.resourceId); else if (amount < 0) bump(sinks, e.resourceId);
    }
  };
  const onCondition = (cond: WorldCondition) => { if (cond.kind === 'resource') bump(gates, cond.resourceId); };
  walkWorldLogic(world, onCondition, onEffect);
  for (const sl of storylets) for (const mod of sl.weight?.mods ?? []) if (mod.resourceId) bump(gates, mod.resourceId);
  for (const [id, def] of Object.entries(defs)) {
    const label = def.label;
    const t: LintTarget = {kind: 'resource', id, label};
    if (!sources.get(id)) c.add('error', 'resource', 'resource.no-source', `资源「${label}」没有任何来源（没有效果会增加它）`, t);
    // Spec lists no-sink as error; ordinal progress / counters (境界、线索) legitimately only grow → warning (see report).
    if (!sinks.get(id)) c.add('warning', 'resource', 'resource.no-sink', `资源「${label}」没有任何去处（没有效果会减少它）`, t);
  }
  // ── pool
  const repeatable = storylets.filter(sl => sl.repeat);
  for (const sl of repeatable) if (storyletBodies(sl).length < 2) c.add('warning', 'pool', 'pool.few-variants', `可重复卡「${sl.title}」只有 ${storyletBodies(sl).length} 段正文，建议 ≥ 2 段变体`, {kind: 'storylet', id: sl.id, label: sl.title});
  if (s1 && storylets.length && repeatable.length < target.repeatable) c.add(tierSeverity, 'pool', 'pool.repeatable-below-tier', `可重复卡 ${repeatable.length} 张，低于 ${tier} 档目标 ${target.repeatable}${tierNote}`);
  // ── choices: empty labels + G8 cost/effect share
  const allChoices = [...world.actions.map(a => ({id: a.id, label: a.label, effects: a.effects, owner: `行动 ${a.id}`})),
    ...storylets.flatMap(sl => sl.choices.map(ch => ({id: `${sl.id}/${ch.id}`, label: ch.label, effects: ch.effects, owner: `剧情卡「${sl.title}」`})))];
  for (const ch of allChoices) {
    if (EMPTY_LABEL.test(ch.label.trim())) c.add('warning', 'text', 'text.empty-label', `${ch.owner} 的选项标签空洞：「${ch.label}」`, {kind: 'choice', id: ch.id, label: ch.label});
    choiceCount++;
    if (ch.effects.some(e => e.kind === 'resource' || e.kind === 'set' || e.kind === 'roll' || e.kind === 'resource_max' || e.kind === 'ending')) changingChoices++;
  }
  // ── text units
  const minSl = opts.minStoryletChars ?? 120; const minLoc = opts.minLocationChars ?? 150;
  const units: TextUnit[] = [];
  for (const sl of storylets) storyletBodies(sl).forEach((text, i, all) => units.push({owner: sl.id, ownerKind: 'storylet', label: `剧情卡「${sl.title}」${all.length > 1 ? `变体 ${i + 1}` : ''}`, text, minLength: minSl}));
  for (const loc of world.locations) {
    units.push({owner: loc.id, ownerKind: 'location', label: `地点「${loc.title}」`, text: loc.text, minLength: minLoc});
    // Conditional variants: similarity/banned rules apply; length is checked separately as a warning.
    (loc.textVariants ?? []).forEach((v, i) => units.push({owner: loc.id, ownerKind: 'location', label: `地点「${loc.title}」变体 ${i + 1}`, text: v.text}));
  }
  for (const loc of world.locations) (loc.textVariants ?? []).forEach((v, i) => {
    const len = textLength(v.text);
    if (len < minLoc) c.add('warning', 'text', 'text.variant-short', `地点「${loc.title}」变体 ${i + 1}：正文 ${len} 字，低于地点最短 ${minLoc} 字`, {kind: 'location', id: loc.id, label: loc.title});
  });
  const endingUnits: TextUnit[] = world.endings.map(e => ({owner: e.id, ownerKind: 'ending', label: `结局「${e.title}」`, text: e.text}));
  textRules(c, [...units, ...endingUnits], opts);
  // Result texts (choices / actions / roll outcomes) are short by design: banned phrases only, no length/similarity.
  const bannedList = [...DEFAULT_BANNED_PHRASES, ...(opts.bannedPhrases ?? [])];
  const rollTexts = (effects: WorldContent['actions'][number]['effects']) => effects.flatMap(e => e.kind === 'roll' ? [e.successText ?? '', e.failureText ?? ''] : []);
  const resultTexts: {target: LintTarget; text: string}[] = [
    ...storylets.flatMap(sl => sl.choices.map(ch => ({target: {kind: 'choice' as const, id: `${sl.id}/${ch.id}`, label: `剧情卡「${sl.title}」·「${ch.label}」`}, text: [ch.text, ...rollTexts(ch.effects)].join('\n')}))),
    ...world.actions.map(a => ({target: {kind: 'action' as const, id: a.id, label: `行动「${a.label}」`}, text: [a.text, ...rollTexts(a.effects)].join('\n')})),
    // K15: ending passages and 「这一生」 lines are short conditional texts → banned phrases only.
    ...world.endings.flatMap(e => (e.passages ?? []).map(p => ({target: {kind: 'ending' as const, id: e.id, label: `结局「${e.title}」附加段落 ${p.id}`}, text: p.text}))),
    ...(world.recap ?? []).map(r => ({target: {kind: 'world' as const, id: r.id, label: `回顾 ${r.id}`}, text: r.text})),
  ];
  for (const r of resultTexts) for (const phrase of bannedList) if (r.text.includes(phrase)) c.add('error', 'text', 'text.banned-phrase', `${r.target.label}：命中禁用句「${phrase}」`, r.target);
  // ── volume
  const chars = [...units, ...endingUnits].reduce((n, u) => n + textLength(u.text), 0)
    + storylets.reduce((n, sl) => n + sl.choices.reduce((m, ch) => m + textLength(ch.text) + rollTextLength(ch.effects), 0), 0)
    + world.actions.reduce((n, a) => n + textLength(a.text), 0)
    // K15: player-visible ending passages and recap lines count toward volume.
    + world.endings.reduce((n, e) => n + (e.passages ?? []).reduce((m, p) => m + textLength(p.text), 0), 0)
    + (world.recap ?? []).reduce((n, r) => n + textLength(r.text), 0);
  const normalEndings = world.endings.filter(e => (e.kind ?? 'ending') === 'ending').length;
  const failureEndings = world.endings.filter(e => e.kind === 'failure').length;
  if (chars < target.chars) c.add(tierSeverity, 'volume', 'volume.chars', `篇幅不足：正文共 ${chars} 字，低于 ${tier} 档目标 ${target.chars} 字${tierNote}`);
  if (s1 || storylets.length) {
    if (storylets.length < target.cards) c.add(tierSeverity, 'volume', 'volume.cards', `剧情卡 ${storylets.length} 张，低于 ${tier} 档目标 ${target.cards} 张${tierNote}`);
    if (normalEndings < target.endings) c.add(tierSeverity, 'volume', 'volume.endings', `普通结局 ${normalEndings} 个，低于 ${tier} 档目标 ${target.endings} 个${tierNote}`);
    if (failureEndings < target.failureEndings) c.add(tierSeverity, 'volume', 'volume.failure-endings', `失败结局 ${failureEndings} 个，低于 ${tier} 档目标 ${target.failureEndings} 个${tierNote}`);
  }
  // ── pass-line checks decided by lint (G2 counts, G3, G4 counts, G6 structure, G7, G8 structure)
  const bounded = Object.values(defs).filter(d => d.max !== undefined).length;
  const resCount = Object.keys(defs).length;
  const gated = Object.keys(defs).filter(id => (gates.get(id) ?? 0) >= 3).length;
  const underGated = Object.keys(defs).filter(id => (gates.get(id) ?? 0) < 3).map(id => `${defs[id]!.label} ${gates.get(id) ?? 0} 处`);
  const consequences = Object.values(defs).filter(d => d.onMin || d.onMax).length;
  const textErrors = c.issues.filter(i => i.category === 'text' && i.severity === 'error');
  const banned = textErrors.filter(i => i.ruleId === 'text.banned-phrase').length;
  const short = textErrors.filter(i => i.ruleId === 'text.too-short').length;
  const dup = textErrors.filter(i => i.ruleId === 'text.near-duplicate').length;
  const destinations = new Set(world.actions.filter(a => opening.executableIds.includes(a.id)).map(a => a.effects.find(e => e.kind === 'move')?.locationId ?? `stay:${a.id}`));
  const changeShare = choiceCount ? changingChoices / choiceCount : 0;
  const timeoutEnding = !!world.clock?.timeoutEndingId || world.endings.some(e => e.kind === 'timeout') || !!world.timeoutEnding;
  const checks: PassCheck[] = [
    check('G2-count', '结局数量', '≥ 4 普通 + ≥ 2 失败 + 1 时限', `${normalEndings} 普通 · ${failureEndings} 失败 · ${timeoutEnding ? 1 : 0} 时限`, normalEndings >= 4 && failureEndings >= 2 && timeoutEnding),
    check('G3', '资源', '≥ 4 种且都有上下限；每种 ≥ 3 处门控；≥ 2 种触底/封顶有后果', `${resCount} 种（${bounded} 有上限）；${gated} 种门控 ≥ 3${underGated.length ? `（不足：${underGated.join('、')}）` : ''}；${consequences} 种有后果`, resCount >= 4 && bounded === resCount && gated === resCount && consequences >= 2),
    check('G4-count', '卡池', `≥ 40 张，其中 ≥ 15 张可重复且各 ≥ 2 段变体`, `${storylets.length} 张 · 可重复 ${repeatable.length} 张 · 变体不足 ${repeatable.filter(sl => storyletBodies(sl).length < 2).length} 张`, storylets.length >= 40 && repeatable.length >= 15 && repeatable.every(sl => storyletBodies(sl).length >= 2)),
    check('G6-structure', '时钟', '可见年月 + 倒计时；≥ 2 个限时窗口', world.clock ? `${world.clock.windows?.length ?? 0} 个窗口 · 倒计时 ${world.clock.countdownResourceId ? defs[world.clock.countdownResourceId]?.label ?? world.clock.countdownResourceId : '无'}` : '没有时钟', !!world.clock && (world.clock.windows?.length ?? 0) >= 2 && !!world.clock.countdownResourceId),
    check('G7', '正文', '禁用句 0；剧情卡 ≥ 120 字、地点 ≥ 150 字；相似度 < 0.6', `禁用句 ${banned} · 过短 ${short} · 近重复 ${dup}`, banned === 0 && short === 0 && dup === 0),
    check('G8-structure', '取舍', '开局 ≥ 3 个去向不同的行动；≥ 70% 选项改动资源或事实', `开局去向 ${destinations.size + opening.executableIds.filter(id => id.startsWith('sl__')).length} · 改动占比 ${Math.round(changeShare * 100)}%`, opening.count >= 3 && changeShare >= 0.7),
  ];
  return finish(c, checks, opts, 'world', s1, tier, {cards: storylets.length, repeatableCards: repeatable.length, endings: world.endings.length, locations: world.locations.length, chars});
}

export function lintStory(story: GameContent, opts: LintOptions = {}): LintReport {
  const c = new Collector();
  const tier = opts.tier ?? 'M';
  const min = opts.minSceneChars ?? 120;
  const units: TextUnit[] = story.scenes.map(s => ({owner: s.id, ownerKind: 'scene', label: `场景「${s.title}」`, text: s.text, minLength: min}));
  textRules(c, units, opts);
  for (const s of story.scenes) for (const ch of s.choices) if (EMPTY_LABEL.test(ch.label.trim())) c.add('warning', 'text', 'text.empty-label', `场景「${s.title}」的选项标签空洞：「${ch.label}」`, {kind: 'choice', id: `${s.id}/${ch.id}`, label: ch.label});
  const chars = units.reduce((n, u) => n + textLength(u.text), 0);
  if (chars < VOLUME_TIERS[tier].chars) c.add('error', 'volume', 'volume.chars', `篇幅不足：正文共 ${chars} 字，低于 ${tier} 档目标 ${VOLUME_TIERS[tier].chars} 字`);
  const textErrors = c.issues.filter(i => i.category === 'text' && i.severity === 'error');
  const checks = [check('G7', '正文', '禁用句 0；场景 ≥ 120 字；相似度 < 0.6',
    `禁用句 ${textErrors.filter(i => i.ruleId === 'text.banned-phrase').length} · 过短 ${textErrors.filter(i => i.ruleId === 'text.too-short').length} · 近重复 ${textErrors.filter(i => i.ruleId === 'text.near-duplicate').length}`, textErrors.length === 0)];
  return finish(c, checks, opts, 'story', false, tier, {cards: 0, repeatableCards: 0, endings: story.scenes.filter(s => s.ending !== undefined).length, locations: story.scenes.length, chars});
}

function finish(c: Collector, checks: PassCheck[], opts: LintOptions, contentKind: 'world' | 'story', blocking: boolean, tier: VolumeTier, stats: LintReport['stats']): LintReport {
  const errors = c.issues.filter(i => i.severity === 'error').length;
  return {...(opts.draftId ? {draftId: opts.draftId} : {}), draftVersion: opts.draftVersion ?? 0, createdAt: opts.now ?? new Date().toISOString(),
    contentKind, blocking, tier, errors, warnings: c.issues.length - errors,
    issues: [...c.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)), checks, stats};
}
function rollTextLength(effects: WorldEffect[]): number {
  return effects.reduce((n, e) => n + (e.kind === 'roll' ? textLength(e.successText ?? '') + textLength(e.failureText ?? '') : 0), 0);
}
function targetKind(world: WorldContent, id: string): LintTarget['kind'] {
  if (world.storylets?.some(s => s.id === id)) return 'storylet';
  if (world.endings.some(e => e.id === id)) return 'ending';
  if (world.resourceDefs?.[id]) return 'resource';
  if (world.locations.some(l => l.id === id)) return 'location';
  return 'world';
}
