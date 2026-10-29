import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { productionBriefSchema, worldContentSchema, type Analysis, type ProductionPlan, type ProductionUnit, type ProductionNarrative, type SourceDocument, type WorldContent } from '@novel-game/contracts';
import { GenerationRunner, JobService, SqliteJobRepository, productionUnits, productionTarget, assembleProduction, assertProductionNarrative, assertProductionPlan, type GenerationProvider } from '../src/modules/generation/index.js';
import { SqliteDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { lintWorld } from '@novel-game/rules/preflight';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { simulateWorld } from '@novel-game/play-runtime/sim';
import { fillDemoWorld } from './helpers/fill-fixture.js';
import { createApp } from '../src/adapters/http/app.js';

const brief = productionBriefSchema.parse(JSON.parse(readFileSync(new URL('../../../examples/wulin-waizhuan.production.json', import.meta.url), 'utf8')));
const source: SourceDocument = {id: 's', title: '测试资料', filename: 'test.txt', encoding: 'utf8', chapterCount: 1, charCount: 3,
  createdAt: '2026-10-28T00:00:00Z', chapters: [{id: 'shoudeng-c1', index: 0, title: '一', paragraphs: [{id: 'p', index: 0, text: '灯亮了。'}]}]};
const analysis: Analysis = {summary: '只用于验证生产流程的已有引擎夹具', characters: [], locations: [], worldRules: [], uncertainties: []};
// This is an engine regression fixture, NOT a generated Wulin game or user-facing sample.
function plan(): ProductionPlan {
  const world = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/shoudeng.batch3.content.json', import.meta.url), 'utf8')));
  world.playerRole = brief.playerRole;
  return {world, bible: {premise: '用于验证分阶段写作、确认以及检查点恢复，不用于评价武林外传的内容质量。',
    identityBoundaries: ['保持作者指定的玩家身份', '文案不能修改引擎中的资源和规则'],
    cast: ['甲', '乙', '丙'].map(name => ({name, role: '测试配角', relationshipToPlayer: '有独立诉求的测试人物'})), styleGuide: '本测试复用已有黄金夹具的正文，只检查生产管线行为，不作为真实模型生成的质量证据。'},
    routes: world.endings.slice(0, 3).map((ending, index) => ({id: `route-${index}`, name: `策略${index}`, strategy: '通过不同的资源与关系路线推进到已声明的不同结局。', endingIds: [ending.id]}))};
}
function enough(text: string, min: number): string {
  const body = text || '这是引擎回归测试中的公开事件文案，专门验证写作检查点，不作为玩家内容。';
  return body.repeat(Math.max(1, Math.ceil(min / body.replace(/\s/g, '').length)));
}
function narrative(p: ProductionPlan, unit: ProductionUnit): ProductionNarrative {
  const target = productionTarget(p, unit);
  const card = unit.kind === 'storylet' ? p.world.storylets!.find(card => card.id === unit.id)! : undefined;
  const bodies = card?.textVariants ?? [target.text ?? ('label' in target ? target.label : '测试正文')];
  return {texts: Array.from({length: unit.variants}, (_, i) => enough(bodies[i] ?? `${bodies[0]}这是另一个测试情境。`, 300)),
    outcomes: Object.fromEntries((card?.choices ?? (unit.kind === 'action' ? [p.world.actions.find(action => action.id === unit.id)!] : [])).map(choice => {
      const roll = choice.effects.find(effect => effect.kind === 'roll');
      return [choice.id, {text: enough(choice.text, 80), ...(roll?.kind === 'roll' ? {
        successText: enough(roll.successText ?? '测试中的成功后果，与规则一致。', 80),
        failureText: enough(roll.failureText ?? '测试中的失败后果，与规则一致。', 80),
      } : {})}];
    }))};
}

test('production pauses for review; retry resumes saved units without redoing analysis or mechanics', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    const repository = new SqliteJobRepository(db);
    const sources = {get: () => source};
    const service = new JobService(repository, sources, () => true);
    const job = service.create({sourceId: 's', requestId: crypto.randomUUID(), direction: brief.goal, mode: 'open', playerRole: brief.playerRole, productionBrief: brief});
    const p = plan(); let plans = 0; let analyses = 0; let failed = false; let created: WorldContent | undefined;
    const drafts = new Map<string, WorldContent>();
    const rewrites: ProductionUnit[] = [];
    const calls = new Map<string, number>();
    const provider: GenerationProvider = {modelName: 'mock-production',
      async analyze() { analyses++; return analysis; },
      async planProduction() { plans++; return structuredClone(p); },
      async writeProductionUnit(locked, unit) {
        calls.set(unit.key, (calls.get(unit.key) ?? 0) + 1);
        if (unit.direction) {
          rewrites.push(structuredClone(unit));
          if (rewrites.length === 1) throw new Error('rewrite transport interrupted');
          const revised = narrative(locked, unit);
          revised.texts[0] += '这句修订只属于新的回归草稿。';
          return revised;
        }
        if (calls.size === 3 && !failed) { failed = true; throw new Error('simulated transport failure'); }
        return narrative(locked, unit);
      },
    };
    const runner = new GenerationRunner(repository, sources, provider, () => {throw new Error('story path not expected');}, input => {
      created = input.content; const id = `draft-produced-${drafts.size}`;
      drafts.set(id, structuredClone(input.content)); return {id};
    });
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'awaiting_review');
    assert.equal(calls.size, 0, 'no paid prose calls before plan approval');
    assert.equal(await runner.runOnce(), false, 'review jobs cannot be claimed');
    service.cancel(job.id); service.retry(job.id); await runner.runOnce();
    assert.equal(service.get(job.id).status, 'awaiting_review', 'cancel/retry cannot bypass plan approval');
    assert.equal(plans, 1, 'the pending plan is reused');
    assert.equal(calls.size, 0);
    const invalid = structuredClone(p); invalid.world.playerRole = '路过的新人';
    assert.throws(() => service.approveProduction(job.id, invalid), /玩家身份/);
    service.approveProduction(job.id, p);
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'failed');
    assert.equal(Object.keys(service.get(job.id).productionState!.texts).length, 2);
    const saved = Object.keys(service.get(job.id).productionState!.texts);
    service.retry(job.id);
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'succeeded', service.get(job.id).error ?? '');
    assert.equal(analyses, 1); assert.equal(plans, 1);
    for (const key of saved) assert.equal(calls.get(key), 1, `${key} was not regenerated`);
    assert.equal(Object.keys(service.get(job.id).productionState!.texts).length, productionUnits(p).length);
    assert.equal(created!.playerRole, brief.playerRole);
    assert.deepEqual(created!.storylets![0]!.choices[0]!.effects, p.world.storylets![0]!.choices[0]!.effects);
    assert.deepEqual(created!.resourceDefs, p.world.resourceDefs);
    assert.deepEqual(created!.production, {complete: true, tier: 'S'});
    assert.ok(service.get(job.id).productionState!.lint, 'quality report remains visible even if author edits are needed');
    assert.equal(service.get(job.id).productionState!.playtest?.seeds, 20, 'assembled content is exercised by the actual play runtime');
    const original = service.get(job.id); const originalDraft = structuredClone(drafts.get(original.draftId!)!);
    const counts = new Map(calls); const unit = productionUnits(p)[0]!;
    assert.throws(() => service.rewriteProduction(job.id, 'location:missing', '增加可行动的线索'), /不存在/);
    assert.ok(service.rewriteProduction(job.id, unit.key, '减少抽象形容，增加可行动的线索').progress < 1, 'a pending revision is not shown as complete');
    assert.throws(() => service.rewriteProduction(job.id, unit.key, '不能重复启动修订'), /完成或失败/);
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'failed');
    service.retry(job.id); await runner.runOnce();
    const revised = service.get(job.id);
    assert.equal(revised.status, 'succeeded', revised.error ?? '');
    assert.equal(rewrites.length, 2, 'rewrite resumes with feedback after an interruption');
    assert.deepEqual(rewrites[1]!.currentText, original.productionState!.texts[unit.key]);
    assert.equal(rewrites[1]!.direction, '减少抽象形容，增加可行动的线索');
    assert.equal(revised.productionState!.rewrite, undefined, 'completed rewrite does not leak into future runs');
    for (const key of Object.keys(original.productionState!.texts)) {
      if (key === unit.key) { assert.equal(calls.get(key), counts.get(key)! + 2); continue; }
      assert.equal(calls.get(key), counts.get(key), `${key} is reused during a targeted rewrite`);
      assert.deepEqual(revised.productionState!.texts[key], original.productionState!.texts[key]);
    }
    assert.notEqual(revised.draftId, original.draftId);
    assert.deepEqual(drafts.get(original.draftId!), originalDraft, 'old draft content remains intact');
    assert.deepEqual(created!.resourceDefs, originalDraft.resourceDefs);
    assert.deepEqual(revised.productionState!.plan, original.productionState!.plan);
    assert.equal(analyses, 1); assert.equal(plans, 1);
  } finally { db.close(); }
});

test('OpenAI-compatible adapter sends a schema for planning and a single locked target for prose', async () => {
  const p = plan(); const unit = productionUnits(p).find(unit => unit.kind === 'storylet')!;
  const captured: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw); captured.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(captured.length === 1 ? p : narrative(p, unit))}, finish_reason: 'stop'}]}));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const provider = new ChatCompletionsProvider({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, model: 'mock-production', apiKey: '', timeoutMs: 10000});
    const planned = await provider.planProduction({...analysis, coverage: {chapterIds: ['shoudeng-c1'], totalChapters: 1}}, brief, ['shoudeng-c1'], AbortSignal.timeout(10000));
    assert.deepEqual(planned.world.playerRole, brief.playerRole);
    const feedback = {direction: '减少形容词，强化线索', currentText: narrative(p, unit)};
    await provider.writeProductionUnit(p, {...unit, ...feedback}, [], AbortSignal.timeout(10000));
    const payload = (index: number) => JSON.parse((captured[index]!.messages as {content: string}[])[1]!.content);
    assert.ok(payload(0).schema.properties.world, 'provider receives executable contract, not vague prose directions');
    assert.equal(payload(0).brief.playerRole, brief.playerRole);
    assert.deepEqual(payload(1).target.id, unit.id);
    assert.equal(payload(1).variants, unit.variants);
    assert.equal(payload(1).requirements.minCharsPerBody, 120);
    assert.equal(payload(1).schema.properties.texts.items.minLength, 120);
    assert.equal(payload(1).schema.properties.texts.minItems, unit.variants);
    assert.equal(payload(1).schema.properties.texts.maxItems, unit.variants);
    assert.equal(captured[1]!.max_tokens, unit.variants === 2 ? 8000 : 4000);
    assert.equal(payload(1).nearbyWriting, undefined, 'the next unit must not copy the preceding scene as its own body');
    assert.equal(payload(1).unit.direction, feedback.direction);
    assert.deepEqual(payload(1).unit.currentText, feedback.currentText);
    assert.equal(payload(1).world, undefined, 'prose step cannot rewrite the whole world');
    assert.equal(captured[0]!.max_tokens, 32768);
    assert.equal(payload(0).schema.properties.world.properties.storylets.minItems, 25);
    assert.ok(JSON.stringify(payload(0).schema).length < 60000, 'shared schemas are referenced instead of expanded at every use');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('three successful strategies cannot be satisfied by substituting a failure ending', () => {
  const p = plan();
  assert.doesNotThrow(() => assertProductionPlan(p, brief, source));
  p.routes[2]!.endingIds = [p.world.endings.find(ending => ending.kind === 'failure')!.id];
  assert.throws(() => assertProductionPlan(p, brief, source), /失败结局不能替代通关策略/);
});

test('official DeepSeek uses modest planning reasoning and direct prose without changing other providers', async t => {
  const p = plan(); const unit = productionUnits(p)[0]!; const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string); requests.push(request);
    const extraAlternative = narrative(p, unit); extraAlternative.texts.push('模型多给出的备用文案，只需保留本次请求的变体数量。');
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(request.max_tokens === 32768 ? p : extraAlternative)}, finish_reason: 'stop'}]}));
  });
  for (const baseUrl of ['https://api.deepseek.com', 'https://example.invalid/v1']) {
    const written = await new ChatCompletionsProvider({baseUrl, model: 'test', apiKey: '', timeoutMs: 10000})
      .writeProductionUnit(p, unit, [], AbortSignal.timeout(10000));
    assert.equal(written.texts.length, unit.variants, 'an unused extra alternative does not trigger regeneration');
  }
  assert.deepEqual(requests[0]!.thinking, {type: 'disabled'});
  assert.equal(requests[1]!.thinking, undefined);
  await new ChatCompletionsProvider({baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: '', timeoutMs: 10000})
    .planProduction({...analysis, coverage: {chapterIds: ['shoudeng-c1'], totalChapters: 1}}, brief, ['shoudeng-c1'], AbortSignal.timeout(10000));
  assert.deepEqual(requests[2]!.thinking, {type: 'enabled'});
  assert.equal(requests[2]!.reasoning_effort, 'low');
});

test('text-only assembly preserves choices and rejects missing outcomes, short bodies and template prose', () => {
  const p = plan(); const unit = productionUnits(p).find(unit => unit.kind === 'storylet')!;
  const valid = narrative(p, unit);
  assert.doesNotThrow(() => assertProductionNarrative(p, unit, valid));
  assert.throws(() => assertProductionNarrative(p, unit, {...valid, outcomes: {}}), /恰好覆盖/);
  assert.throws(() => assertProductionNarrative(p, unit, {...valid, texts: ['气氛紧绷。']}), /至少需要|模板句/);
  const rollingUnit = productionUnits(p).find(unit => unit.kind === 'storylet' && p.world.storylets!.find(card => card.id === unit.id)!.choices.some(choice => choice.effects.some(effect => effect.kind === 'roll')))!;
  const rollingText = narrative(p, rollingUnit);
  assert.doesNotThrow(() => assertProductionNarrative(p, rollingUnit, rollingText));
  Object.values(rollingText.outcomes).forEach(outcome => {delete outcome.successText; delete outcome.failureText;});
  assert.throws(() => assertProductionNarrative(p, rollingUnit, rollingText), /成功与失败结果/);
  const texts = Object.fromEntries(productionUnits(p).map(unit => [unit.key, narrative(p, unit)]));
  const assembled = assembleProduction(p, texts, brief);
  assert.equal(assembled.initialLocationId, p.world.initialLocationId);
  assert.equal(assembled.timeoutEnding, texts['timeout:timeout']!.texts[0], 'the time limit ending is expanded instead of leaving planning notes');
  assert.deepEqual(assembled.actions.map(action => [action.id, action.requires, action.effects]), p.world.actions.map(action => [action.id, action.requires, action.effects]));
  assert.equal(lintWorld(assembled).tier, 'S', 'publication lint uses the declared size instead of silently enforcing M');
});

test('production creation is idempotent including its source; unavailable models leave no orphan source', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-production-'));
  const db = new SqliteDatabase(':memory:');
  try {
    const settings = createModelSettings(db, dir, {baseUrl: 'http://127.0.0.1:4399/v1', model: 'mock-production', apiKey: '', timeoutMs: 90000});
    const w = createWorkbench(db, settings, undefined, {dataDir: dir});
    const input = {requestId: crypto.randomUUID(), brief};
    const created = w.createProductionJob(input);
    assert.equal(w.createProductionJob(input).id, created.id);
    assert.equal(w.sources.list().length, 1);
    assert.throws(() => w.createProductionJob({...input, brief: {...brief, goal: `${brief.goal}另一个目标`}}), /冲突/);
    assert.equal(w.sources.list().length, 1);
    const offDb = new SqliteDatabase(':memory:');
    try {
      const off = createModelSettings(offDb, dir, {baseUrl: 'https://example.invalid/v1', model: '', apiKey: '', timeoutMs: 90000});
      const unavailable = createWorkbench(db, off, undefined, {dataDir: dir});
      assert.throws(() => unavailable.createProductionJob({...input, requestId: crypto.randomUUID()}), /模型/);
      assert.equal(w.sources.list().length, 1);
    } finally { offDb.close(); }
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('non-cultivation playtests use the actual currency and action time, not months and cultivation labels', async () => {
  const world = fillDemoWorld();
  world.resourceDefs = {
    money: {label: '银两', min: 0, max: 100, initial: 5},
    hp: {label: '体力', min: 0, max: 10, initial: 3},
    tong_trust: {label: '掌柜信任', min: 0, max: 100, initial: 20},
  };
  const report = await simulateWorld({id: 'r', draftId: 'd', sourceId: 's', content: world, version: 1, createdAt: source.createdAt}, {seeds: 1, maxSteps: 8});
  assert.equal(report.timeUnit, 'turn');
  assert.match(report.checks.find(check => check.id === 'G1')!.measured, /行动耗时/);
  assert.doesNotMatch(report.strategies.map(strategy => strategy.label).join(' '), /修炼|魔道/);
  assert.match(report.strategies.find(strategy => strategy.id === 'merchant')!.label, /银两/);
  assert.equal(new Set(report.strategies.map(s=>s.id)).size,report.strategies.length,'money and growth strategies have distinct result buckets');
  assert.ok(report.strategies.some(s=>s.id==='greedy-tong_trust'),'relationship resources are recognized without a cultivation id');
  assert.equal(lintWorld(world).checks.find(check=>check.id==='G6-structure')!.pass,true,'an action deadline does not require a cultivation calendar');
});

test('S pass-line counts use the selected tier and recognize boundary consequences implemented as events', () => {
  const world=plan().world; const all=world.storylets!;
  world.production={complete:true,tier:'S'};
  world.storylets=[...all.filter(c=>c.repeat).slice(0,8),...all.filter(c=>!c.repeat).slice(0,17)];
  for(const d of Object.values(world.resourceDefs!)){delete d.onMin;delete d.onMax;}
  world.events=Object.entries(world.resourceDefs!).slice(0,2).map(([id,d],i)=>({id:`boundary-${i}`,label:'资源触底',when:[{kind:'resource' as const,resourceId:id,atMost:d.min}],effects:[{kind:'set' as const,factId:world.facts[0]!.id,value:true}],text:'资源触底后产生持续后果。',visibility:'public' as const}));
  const checks=lintWorld(world).checks;
  assert.equal(checks.find(c=>c.id==='G4-count')!.pass,true,'25 cards / 8 repeats meet S instead of M');
  world.storylets=all;
  assert.equal(lintWorld(world).checks.find(c=>c.id==='G3')!.pass,true,'event-based boundary triggers count too');
  assert.match(checks.find(c=>c.id==='G2-count')!.line,/≥ 2 普通/);
});

test('production creation and approval are available through the same HTTP command layer', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'btg-production-http-'));
  const db = new SqliteDatabase(':memory:');
  const settings = createModelSettings(db, dir, {baseUrl: 'http://127.0.0.1:4399/v1', model: 'mock-production', apiKey: '', timeoutMs: 90000});
  const w = createWorkbench(db, settings, undefined, {dataDir: dir});
  const server = createApp(w, {token: 'production-test-token-at-least-24', allowedOrigins: []}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
    const response = await fetch(`${base}/api/production/jobs`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({requestId: crypto.randomUUID(), brief})});
    assert.equal(response.status, 200);
    const job = await response.json() as {id: string; status: string; productionBrief: typeof brief};
    assert.equal(job.status, 'queued'); assert.equal(job.productionBrief.playerRole, brief.playerRole);
    const premature = await fetch(`${base}/api/jobs/${job.id}/approve-plan`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan: plan()})});
    assert.equal(premature.status, 422, 'invalid source scope/plan cannot be approved through transport');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); rmSync(dir, {recursive: true, force: true}); }
});
