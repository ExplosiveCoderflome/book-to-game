import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { productionBriefSchema, worldContentSchema, type GenerationJob, type ProductionNarrative, type ProductionPlan, type ProductionUnit, type SourceDocument, type WorldEffect } from '@novel-game/contracts';
import { AgentSupervisor } from '../src/modules/agent/index.js';
import { triageFailure } from '../src/modules/agent/domain/policy.js';
import { SqliteDecisionRepository } from '../src/modules/agent/infrastructure/sqlite-decision-repository.js';
import type { AgentAction, AgentDecision, AgentDecisionRepository } from '../src/modules/agent/domain/ports.js';
import { assertProductionPlan, productionTarget, productionUnits } from '../src/modules/generation/index.js';
import { SqliteDatabase } from '../src/platform/database.js';

const brief = productionBriefSchema.parse(JSON.parse(readFileSync(new URL('../../../examples/wulin-waizhuan.production.json', import.meta.url), 'utf8')));
const source: SourceDocument = {id: 's', title: '测试资料', filename: 'test.txt', encoding: 'utf8', chapterCount: 1, charCount: 3,
  createdAt: '2026-10-28T00:00:00Z', chapters: [{id: 'shoudeng-c1', index: 0, title: '一', paragraphs: [{id: 'p', index: 0, text: '灯亮了。'}]}]};

function plan(): ProductionPlan {
  const world = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/shoudeng.batch3.content.json', import.meta.url), 'utf8')));
  world.playerRole = brief.playerRole;
  return {world, bible: {premise: '用于验证 agent 监督：审阅检查与单元质检，不评价武林外传内容质量。',
    identityBoundaries: ['保持作者指定的玩家身份', '文案不能修改引擎中的资源和规则'],
    cast: ['甲', '乙', '丙'].map(name => ({name, role: '测试配角', relationshipToPlayer: '有独立诉求的测试人物'})), styleGuide: '测试复用已有黄金夹具正文。'},
    routes: world.endings.slice(0, 3).map((ending, index) => ({id: `route-${index}`, name: `策略${index}`, strategy: '通过不同的资源与关系路线推进到已声明的不同结局。', endingIds: [ending.id]}))};
}

function enough(text: string, min: number): string {
  const body = text || '这是 agent 监督测试中的公开事件文案，只验证质检行为。';
  return body.repeat(Math.max(1, Math.ceil(min / body.replace(/\s/g, '').length)));
}

function narrative(p: ProductionPlan, unit: ProductionUnit): ProductionNarrative {
  const target = productionTarget(p, unit);
  const card = unit.kind === 'storylet' ? p.world.storylets!.find(item => item.id === unit.id)! : undefined;
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

function baseJob(overrides: Partial<GenerationJob>): GenerationJob {
  return {id: randomUUID(), sourceId: 's', status: 'queued', stage: '等待分析', progress: 0,
    completedChunks: 0, totalChunks: 1, error: null, draftId: null, analysis: null,
    createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', ...overrides};
}

class MemoryDecisions implements AgentDecisionRepository {
  private rows: AgentDecision[] = [];
  private beatAt: string | null = null;
  record(d: Omit<AgentDecision, 'id' | 'createdAt'>): AgentDecision {
    const full: AgentDecision = {id: `d${this.rows.length}`, ...d, createdAt: new Date().toISOString()};
    this.rows.push(full); return full;
  }
  list(limit: number): AgentDecision[] { return [...this.rows].reverse().slice(0, limit); }
  exists(jobId: string, action: AgentAction, jobUpdatedAt: string): boolean {
    return this.rows.some(r => r.jobId === jobId && r.action === action && r.jobUpdatedAt === jobUpdatedAt);
  }
  count(jobId: string, action: AgentAction): number {
    return this.rows.filter(r => r.jobId === jobId && r.action === action).length;
  }
  total(): number { return this.rows.length; }
  beat(): void { this.beatAt = new Date().toISOString(); }
  lastBeat(): string | null { return this.beatAt; }
}

function failedJob(code: string): GenerationJob {
  return baseJob({status: 'failed', stage: '等待重试',
    failure: {code, message: '模拟失败', step: 'generate', attempt: 1, requestId: randomUUID()},
    error: `模拟失败（${code}）`});
}

test('policy: transient failures retry, content failures escalate, cap escalates', () => {
  assert.equal(triageFailure(failedJob('MODEL_CONNECTION_FAILED'), 0)?.action, 'retry');
  assert.equal(triageFailure(failedJob('UNEXPECTED_ERROR'), 0)?.action, 'retry');
  assert.equal(triageFailure(baseJob({status: 'failed', failure: null, error: '无失败对象'}), 0)?.action, 'retry');
  assert.equal(triageFailure(failedJob('INVALID_PRODUCTION'), 0)?.action, 'escalate');
  assert.equal(triageFailure(failedJob('SCHEMA_VALIDATION_FAILED'), 0)?.action, 'escalate');
  assert.equal(triageFailure(failedJob('MODEL_CONNECTION_FAILED'), 2)?.action, 'escalate');
  assert.equal(triageFailure(baseJob({status: 'queued'}), 0), null);
});

test('supervisor retries a transient failure once and never touches it again', () => {
  const job = failedJob('MODEL_CONNECTION_FAILED');
  const jobs = [job];
  let retries = 0;
  const supervisor = new AgentSupervisor({jobs: {list: () => jobs, retry: (id: string) => {
    retries++;
    const target = jobs.find(item => item.id === id)!;
    target.status = 'queued'; target.updatedAt = '2026-10-29T00:01:00Z'; target.error = null; target.failure = null;
    return target;
  }}, sources: {get: () => source}, decisions: new MemoryDecisions()});
  const first = supervisor.runOnce();
  assert.equal(retries, 1);
  assert.equal(first.decisions[0]?.action, 'retried');
  const second = supervisor.runOnce();
  assert.equal(retries, 1, 'queued jobs are not retried again');
  assert.equal(second.decisions.length, 0);
});

test('supervisor escalates content failures and capped jobs without retrying', () => {
  const bad = failedJob('INVALID_PRODUCTION');
  const capped = failedJob('MODEL_CONNECTION_FAILED');
  const decisions = new MemoryDecisions();
  decisions.record({jobId: capped.id, action: 'retried', jobUpdatedAt: '2026-10-28T00:00:00Z', summary: 'earlier'});
  decisions.record({jobId: capped.id, action: 'retried', jobUpdatedAt: '2026-10-28T01:00:00Z', summary: 'earlier'});
  let retries = 0;
  const supervisor = new AgentSupervisor({jobs: {list: () => [bad, capped], retry: () => { retries++; throw new Error('must not retry'); }},
    sources: {get: () => source}, decisions});
  const report = supervisor.runOnce();
  assert.equal(retries, 0);
  assert.deepEqual(report.decisions.map(d => d.action), ['escalated', 'escalated']);
});

test('supervisor escalates blocked plan mechanics without attempting automatic regeneration', () => {
  const job = failedJob('PLAN_CHECK_BLOCKED');
  const decisions = new MemoryDecisions();
  let retries = 0;
  const supervisor = new AgentSupervisor({jobs: {list: () => [job], retry: () => {
    retries++; return job;
  }}, sources: {get: () => source}, decisions});
  const first = supervisor.runOnce();
  assert.equal(retries, 0, 'a rule error cannot be repaired by blindly retrying the whole task');
  assert.equal(first.decisions[0]?.action, 'escalated');
  assert.equal(job.status, 'failed');
  assert.equal(supervisor.runOnce().decisions.length, 0, 'the same failure is escalated only once');
});

test('supervisor summarizes review plans but never approves them', () => {
  const p = plan();
  const good = baseJob({status: 'awaiting_review', stage: '请审阅人物与玩法规划', mode: 'open',
    productionBrief: brief, productionState: {plan: p, approved: false, texts: {}}});
  const broken = structuredClone(p); broken.world.playerRole = '路过的新人';
  const bad = baseJob({status: 'awaiting_review', stage: '请审阅人物与玩法规划', mode: 'open',
    productionBrief: brief, productionState: {plan: broken, approved: false, texts: {}}});
  const decisions = new MemoryDecisions();
  const supervisor = new AgentSupervisor({jobs: {list: () => [good, bad], retry: () => { throw new Error('must not retry'); }},
    sources: {get: () => source}, decisions});
  const report = supervisor.runOnce();
  assert.equal(report.decisions.length, 2);
  assert.equal(report.decisions[0]?.action, 'review_summary');
  assert.match(report.decisions[0]?.summary ?? '', /通过/);
  assert.match(report.decisions[1]?.summary ?? '', /玩家身份/);
  assert.equal(good.status, 'awaiting_review', 'supervisor must never approve');
  assert.equal(good.productionState?.approved, false);
  const again = supervisor.runOnce();
  assert.equal(again.decisions.length, 0, 'same job version is summarized once');
});

test('supervisor review rejects rules that the current production approval gate would block', () => {
  const p = plan();
  const removeExposure = (effects: WorldEffect[]) => {
    for (const effect of effects) {
      if (effect.kind === 'set' && effect.factId === 'wenren_exposed') effect.value = false;
      if (effect.kind === 'roll') { removeExposure(effect.success); removeExposure(effect.failure); }
    }
  };
  for (const action of p.world.actions) removeExposure(action.effects);
  for (const card of p.world.storylets ?? []) for (const choice of card.choices) removeExposure(choice.effects);
  for (const event of p.world.events) removeExposure(event.effects);
  assert.doesNotThrow(() => assertProductionPlan(p, brief, source), 'the older structural checks alone accept this plan');
  const job = baseJob({status: 'awaiting_review', mode: 'open', productionBrief: brief,
    productionState: {plan: p, approved: false, texts: {}}});
  const supervisor = new AgentSupervisor({jobs: {list: () => [job], retry: () => { throw new Error('must not retry'); }},
    sources: {get: () => source}, decisions: new MemoryDecisions()});
  const report = supervisor.runOnce();
  assert.equal(report.decisions[0]?.action, 'review_summary');
  const detail = report.decisions[0]?.detail as {passed: boolean; issues?: {message: string}[]};
  assert.equal(detail.passed, false);
  assert.ok(detail.issues?.some(issue => /闻人|wenren/.test(issue.message)));
  assert.equal(job.status, 'awaiting_review');
  assert.equal(job.productionState?.approved, false, 'mechanics checks never grant approval');
});

test('supervisor QA-reports production units without rewriting them', () => {
  const p = plan();
  const units = productionUnits(p);
  const location = units.find(unit => unit.kind === 'location')!;
  const goodText = narrative(p, units[0]!);
  const texts: Record<string, ProductionNarrative> = {[units[0]!.key]: goodText, [location.key]: {texts: ['太短'], outcomes: {}}};
  const job = baseJob({status: 'succeeded', stage: '草稿已生成', mode: 'open',
    productionBrief: brief, productionState: {plan: p, approved: true, texts}});
  const decisions = new MemoryDecisions();
  const supervisor = new AgentSupervisor({jobs: {list: () => [job], retry: () => { throw new Error('must not retry'); }},
    sources: {get: () => source}, decisions});
  const report = supervisor.runOnce();
  assert.equal(report.decisions.length, 1);
  assert.equal(report.decisions[0]?.action, 'qa_report');
  assert.match(report.decisions[0]?.summary ?? '', new RegExp(location.key));
  assert.deepEqual(Object.keys(job.productionState!.texts).sort(), Object.keys(texts).sort(), 'QA never rewrites texts');
});

test('sqlite decision repository round-trips decisions and heartbeat', () => {
  const db = new SqliteDatabase(':memory:');
  try {
    const repo = new SqliteDecisionRepository(db);
    assert.equal(repo.lastBeat(), null);
    repo.beat();
    assert.ok(repo.lastBeat());
    repo.record({jobId: 'j1', action: 'retried', jobUpdatedAt: 't1', summary: 's1'});
    repo.record({jobId: 'j1', action: 'escalated', jobUpdatedAt: 't2', summary: 's2'});
    assert.equal(repo.total(), 2);
    assert.equal(repo.count('j1', 'retried'), 1);
    assert.equal(repo.exists('j1', 'retried', 't1'), true);
    assert.equal(repo.exists('j1', 'retried', 't2'), false);
    assert.equal(repo.list(10)[0]?.summary, 's2', 'newest first');
    assert.equal(repo.list(10)[1]?.summary, 's1');
    assert.equal(repo.list(1).length, 1);
  } finally { db.close(); }
});
