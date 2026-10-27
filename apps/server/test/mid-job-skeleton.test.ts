import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createWorkbench } from '../src/app/workbench.js';
import { openDatabase } from '../src/platform/database.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { playableSkeleton, playableStory } from './helpers/playable-story.js';

test('mid-job skeleton is persisted on the job before expand finishes', async () => {
  let expandStarted: () => void;
  const expandGate = new Promise<void>(resolve => { expandStarted = resolve; });
  let releaseExpand: () => void;
  const holdExpand = new Promise<void>(resolve => { releaseExpand = resolve; });

  const stub = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(JSON.parse(body).messages[1].content);
    let content: unknown;
    if (data.paragraphs) {
      const {chapterId, paragraphId} = data.paragraphs[0];
      content = {summary: '渡口', characters: [], locations: [{name: '渡口', description: '起点', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else if (data.skeleton) {
      expandStarted!();
      await holdExpand;
      content = playableStory(data.dossier.locations[0].evidence);
    } else {
      content = playableSkeleton(data.dossier.locations[0].evidence);
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'mid-skel-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    const defaults = {baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, apiKey: '', model: 'stub', timeoutMs: 10000, maxAttempts: 1, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1};
    const w = createWorkbench(db, createModelSettings(db, dir, defaults), undefined, {repairAttempts: 1});
    const source = w.sources.importFile({title: '雾', filename: 'a.txt', bytes: Buffer.from('第一章\n渡口有船。')});
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '从渡口开始'});
    const run = w.createRunner(new ChatCompletionsProvider(defaults)).runOnce();
    await expandGate;
    // While expand is held, public job must already expose skeleton.
    const mid = w.jobs.get(job.id);
    assert.equal(mid.status, 'running');
    assert.ok(mid.skeleton, 'skeleton should be on the job DTO');
    assert.equal(mid.skeleton!.startSceneId, 'dock');
    assert.ok(mid.skeleton!.scenes.length >= 3);
    assert.match(mid.stage, /骨架|正文/);
    assert.equal(mid.draftId, null);
    releaseExpand!();
    await run;
    const finished = w.jobs.get(job.id);
    assert.equal(finished.status, 'succeeded');
    assert.ok(finished.draftId);
    assert.ok(finished.skeleton, 'skeleton retained after success for audit');
  } finally {
    db.close(); await new Promise<void>(r => stub.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});
