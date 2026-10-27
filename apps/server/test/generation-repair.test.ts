import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { createWorkbench } from '../src/app/workbench.js';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { JsonlLogger } from '../src/platform/logger.js';

const novel = 'UNIQUE_NOVEL_SENTENCE_SHOULD_NOT_BE_LOGGED';
const apiKey = 'sk-test-should-not-leak';

function playable(evidence: unknown) {
  return {title: '雾渡', mode: 'story', premise: '决定航向', adaptationNotes: '仅改编渡口片段', startSceneId: 'dock', scenes: [
    {id: 'dock', title: '渡口', text: '你登上哪条船？', origin: 'source', evidence, choices: [
      {id: 'a', label: '白船', targetSceneId: 'city'},
      {id: 'b', label: '黑船', targetSceneId: 'hill'},
    ]},
    {id: 'city', title: '城中', text: '抵达城中。', origin: 'adapted', evidence: [], choices: [], ending: '回家'},
    {id: 'hill', title: '山里', text: '抵达山里。', origin: 'adapted', evidence: [], choices: [], ending: '探险'},
  ]};
}
function unreachable(evidence: unknown) {
  const game = playable(evidence);
  game.scenes[0].choices = [{id: 'a', label: '白船', targetSceneId: 'city'}];
  return game;
}
async function read(req: IncomingMessage): Promise<string> {
  let body = ''; for await (const part of req) body += part; return body;
}

test('semantic repair fixes evidence and an unreachable scene without repeating completed chunks', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repair-job-'));
  const db = new Database(path.join(dir, 'workbench.sqlite'));
  let longCalls = 0; let shortCalls = 0; let generateCalls = 0; let repairSawEvidence = false; let repairSawScene = false;
  let acceptEvidence = false;
  const stub = createServer(async (req, res) => {
    const body = JSON.parse(await read(req));
    const data = JSON.parse(body.messages[1].content);
    const repair = body.messages.slice(2).map((message: {content: string}) => message.content).join('\n');
    let content: unknown;
    if (data.paragraphs) {
      const paragraph = data.paragraphs[0];
      const long = paragraph.text.length >= 5000;
      if (long) longCalls++; else shortCalls++;
      if (!long && repair.includes('locations.0.evidence')) repairSawEvidence = true;
      const evidence = [{chapterId: paragraph.chapterId, paragraphId: paragraph.paragraphId}];
      const bad = !long && !acceptEvidence;
      content = bad
        ? {summary: '渡口', characters: [], locations: [{name: '渡口', description: '岸边', evidence: [{chapterId: paragraph.chapterId, paragraphId: 'missing'}]}], worldRules: [], uncertainties: []}
        : {summary: '渡口', characters: [], locations: long ? [] : [{name: '渡口', description: '岸边', evidence}], worldRules: [], uncertainties: []};
    } else {
      generateCalls++;
      if (repair.includes('场景不可达') || repair.includes('scenes.hill')) repairSawScene = true;
      const evidence = data.dossier.locations[0].evidence;
      content = generateCalls === 1 ? unreachable(evidence) : playable(evidence);
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const logs = path.join(dir, 'logs');
  const logger = new JsonlLogger(logs, 'worker');
  try {
    const settings = createModelSettings(db, dir, {baseUrl: 'http://127.0.0.1:9/v1', model: 'stub', apiKey: '', timeoutMs: 2000});
    const w = createWorkbench(db, settings, logger, {repairAttempts: 2});
    const source = w.sources.importFile({title: '夜渡', filename: 'night.txt', bytes: Buffer.from(`第一章 渡口\n${novel}${'渡'.repeat(13000)}`)});
    const requestId = crypto.randomUUID();
    const job = w.jobs.create({sourceId: source.id, requestId, direction: '从渡口出发'});
    const model = new ChatCompletionsProvider({baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, model: 'stub', apiKey, timeoutMs: 2000,
      maxAttempts: 1, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1}, logger);
    await w.createRunner(model).runOnce();
    const failed = w.jobs.get(job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.completedChunks, 1);
    assert.equal(failed.failure?.code, 'INVALID_EVIDENCE');
    assert.equal(failed.failure?.path, 'locations.0.evidence');
    assert.equal(failed.failure?.step, 'analyze:1');
    assert.equal(failed.failure?.attempt, 2);
    assert.equal(failed.failure?.requestId, requestId);
    assert.match(failed.error ?? '', /INVALID_EVIDENCE/);
    assert.match(failed.error ?? '', /locations\.0\.evidence/);
    assert.match(failed.error ?? '', new RegExp(requestId));
    assert.equal((failed.error ?? '').includes(novel), false);
    assert.equal(longCalls, 1);
    assert.equal(shortCalls, 2);
    assert.equal(repairSawEvidence, true);
    assert.equal(generateCalls, 0);
    acceptEvidence = true;
    w.jobs.retry(job.id);
    await w.createRunner(model).runOnce();
    const finished = w.jobs.get(job.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(longCalls, 1);
    assert.equal(repairSawEvidence, true);
    assert.equal(repairSawScene, true);
    assert.equal(generateCalls, 2);
    assert.equal(w.games.list().length, 1);
    assert.equal(w.games.validate(finished.draftId!).valid, true);
    const logged = readFileSync(path.join(logs, `worker-${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8');
    assert.match(logged, /INVALID_EVIDENCE/);
    assert.match(logged, /locations\.0\.evidence/);
    assert.match(logged, new RegExp(requestId));
    assert.equal(logged.includes(novel), false);
    assert.equal(logged.includes(apiKey), false);
  } finally {
    db.close(); await new Promise<void>(resolve => stub.close(() => resolve())); rmSync(dir, {recursive: true, force: true});
  }
});

test('permanent schema failure keeps the completed analysis and records the failing field', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'schema-job-'));
  const db = new Database(path.join(dir, 'workbench.sqlite'));
  let analyses = 0; let generates = 0;
  const stub = createServer(async (req, res) => {
    const data = JSON.parse(JSON.parse(await read(req)).messages[1].content);
    let content: unknown;
    if (data.paragraphs) {
      analyses++;
      const {chapterId, paragraphId} = data.paragraphs[0];
      content = {summary: '渡口', characters: [], locations: [{name: '渡口', description: '岸边', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else {
      generates++;
      content = {title: '', mode: 'story', premise: '决定航向', adaptationNotes: '边界', startSceneId: 'dock', scenes: []};
    }
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const logs = path.join(dir, 'logs');
  const logger = new JsonlLogger(logs, 'worker');
  try {
    const settings = createModelSettings(db, dir, {baseUrl: 'http://127.0.0.1:9/v1', model: 'stub', apiKey: '', timeoutMs: 2000});
    const w = createWorkbench(db, settings, logger, {repairAttempts: 2});
    const source = w.sources.importFile({title: '夜渡', filename: 'night.txt', bytes: Buffer.from(`第一章 渡口\n${novel}`)});
    const requestId = crypto.randomUUID();
    const job = w.jobs.create({sourceId: source.id, requestId, direction: '从渡口出发'});
    const model = new ChatCompletionsProvider({baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, model: 'stub', apiKey, timeoutMs: 2000,
      maxAttempts: 2, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 2}, logger);
    await w.createRunner(model).runOnce();
    const failed = w.jobs.get(job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.completedChunks, 1);
    assert.equal(analyses, 1);
    assert.equal(generates, 2);
    assert.equal(failed.failure?.code, 'SCHEMA_VALIDATION_FAILED');
    assert.equal(failed.failure?.path, 'title');
    assert.equal(failed.failure?.step, 'generate');
    assert.equal(failed.failure?.attempt, 2);
    assert.equal(failed.failure?.requestId, requestId);
    assert.match(failed.error ?? '', /SCHEMA_VALIDATION_FAILED/);
    assert.match(failed.error ?? '', /title/);
    assert.equal((failed.error ?? '').includes(novel), false);
    assert.equal(w.games.list().length, 0);
    const logged = readFileSync(path.join(logs, `worker-${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8');
    assert.match(logged, /SCHEMA_VALIDATION_FAILED/);
    assert.match(logged, /"path":"title"/);
    assert.match(logged, /"step":"generate"/);
    assert.match(logged, /"attempt":2/);
    assert.equal(logged.includes(novel), false);
    assert.equal(logged.includes(apiKey), false);
  } finally {
    db.close(); await new Promise<void>(resolve => stub.close(() => resolve())); rmSync(dir, {recursive: true, force: true});
  }
});
