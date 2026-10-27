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
import { playableSkeleton, playableStory, unreachableSkeleton } from './helpers/playable-story.js';

test('two-step generation repairs unplayable skeleton then expands without rewriting edges', async () => {
  let skeletonCalls = 0; let expandCalls = 0;
  const stub = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(JSON.parse(body).messages[1].content);
    let content: unknown;
    if (data.paragraphs) {
      const {chapterId, paragraphId} = data.paragraphs[0];
      content = {summary: '渡口抉择', characters: [], locations: [{name: '渡口', description: '起点', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else if (data.skeleton) {
      expandCalls++;
      // Attempt to rewrite an edge — runner must reject and repair.
      const evidence = data.dossier.locations[0].evidence;
      if (expandCalls === 1) {
        const bad = playableStory(evidence);
        bad.scenes[0].choices[1].targetSceneId = 'hill';
        content = bad;
      } else {
        content = playableStory(evidence);
      }
    } else {
      skeletonCalls++;
      const evidence = data.dossier.locations[0].evidence;
      content = skeletonCalls === 1 ? unreachableSkeleton(evidence) : playableSkeleton(evidence);
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'skeleton-gen-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    const defaults = {baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, apiKey: '', model: 'stub', timeoutMs: 2000, maxAttempts: 1, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1};
    const w = createWorkbench(db, createModelSettings(db, dir, defaults), undefined, {repairAttempts: 3});
    const source = w.sources.importFile({title: '雾', filename: 'a.txt', bytes: Buffer.from('第一章\n渡口有船。')});
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '从渡口开始'});
    await w.createRunner(new ChatCompletionsProvider(defaults)).runOnce();
    const finished = w.jobs.get(job.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(skeletonCalls, 2);
    assert.equal(expandCalls, 2);
    const draft = w.games.get(finished.draftId!);
    assert.equal(w.games.validate(draft.id).valid, true);
    assert.equal(draft.content.scenes[0].choices[1].targetSceneId, 'channel');
  } finally {
    db.close(); await new Promise<void>(r => stub.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});
