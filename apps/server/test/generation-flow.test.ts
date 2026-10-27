import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';

test('novel → model HTTP → persisted checkpoint → restart retry → valid draft → published playable game', async () => {
  let analyzeCalls = 0; let gameCalls = 0; let failGame = true;
  const mockProvider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(JSON.parse(body).messages[1].content);
    let content;
    if (data.paragraphs) {
      analyzeCalls++;
      const {chapterId, paragraphId} = data.paragraphs[0];
      content = {summary: '渡口有两条船。', characters: [], locations: [{name: '渡口', description: '故事起点', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else {
      gameCalls++;
      if (failGame) {res.statusCode = 503; res.end('test outage'); return;}
      const evidence = data.dossier.locations[0].evidence;
      content = {title: '雾渡', mode: 'story', premise: '决定航向', adaptationNotes: '仅改编渡口片段', startSceneId: 'dock', variables: {trust: 0}, scenes: [
        {id: 'dock', title: '渡口', text: '你登上哪条船？', origin: 'source', evidence, choices: [
          {id: 'a', label: '白船', targetSceneId: 'city', conditions: [{type: 'variable.gte', variable: 'trust', value: 1}]},
          {id: 'b', label: '黑船', targetSceneId: 'hill'},
          {id: 'prepare', label: '帮助船夫整理缆绳', targetSceneId: 'dock', conditions: [{type: 'variable.equals', variable: 'trust', value: 0}], effects: [{type: 'variable.increment', variable: 'trust', value: 1}]},
        ]},
        {id: 'city', title: '城中', text: '抵达城中。', origin: 'adapted', evidence: [], choices: [], ending: '回家'},
        {id: 'hill', title: '山里', text: '抵达山里。', origin: 'adapted', evidence: [], choices: [], ending: '探险'},
      ]};
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}]}));
  }).listen(0, '127.0.0.1');
  await once(mockProvider, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'novel-flow-'));
  const databasePath = path.join(dir, 'test.sqlite');
  let db = openDatabase(databasePath);
  try {
    const defaults = {baseUrl: `http://127.0.0.1:${(mockProvider.address() as {port: number}).port}/v1`, apiKey: '', model: 'integration-test', timeoutMs: 2000, maxAttempts: 3, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1};
    const model = new ChatCompletionsProvider(defaults);
    let w = createWorkbench(db, createModelSettings(db, dir, defaults));
    const source = w.sources.importFile({title: '雾渡', filename: 'source.txt', bytes: Buffer.from('第一章 渡口\n渡口有两条船，一条向城，一条向山。')});
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '从渡口开始'});
    await w.createRunner(model).runOnce();
    assert.equal(w.jobs.get(job.id).status, 'failed');
    assert.equal(w.jobs.get(job.id).completedChunks, 1);
    assert.equal(w.games.list().length, 0);
    db.close(); db = openDatabase(databasePath); w = createWorkbench(db, createModelSettings(db, dir, defaults));
    failGame = false; w.jobs.retry(job.id);
    await w.createRunner(model).runOnce();
    const finished = w.jobs.get(job.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(analyzeCalls, 1); assert.equal(gameCalls, 4);
    const draft = w.games.get(finished.draftId!);
    assert.deepEqual(draft.content.variables, {trust: 0});
    assert.equal(w.games.validate(draft.id).valid, true);
    const revision = w.games.publish(draft.id, {version: draft.version});
    const session = w.sessions.start({gameRevisionId: revision.id});
    assert.deepEqual(session.scene.choices.map(choice => choice.id), ['b', 'prepare']);
    assert.throws(() => w.sessions.act(session.id, {choiceId: 'a', expectedTurn: 0, requestId: crypto.randomUUID()}));
    const preparation = {choiceId: 'prepare', expectedTurn: 0, requestId: crypto.randomUUID()};
    const prepared = w.sessions.act(session.id, preparation);
    assert.deepEqual(prepared.variables, {trust: 1});
    assert.deepEqual(prepared.scene.choices.map(choice => choice.id), ['a', 'b']);
    assert.deepEqual(w.sessions.act(session.id, preparation), prepared);
    db.close(); db = openDatabase(databasePath); w = createWorkbench(db, createModelSettings(db, dir, defaults));
    assert.deepEqual(w.sessions.get(session.id).variables, {trust: 1});
    assert.deepEqual(w.sessions.act(session.id, preparation), prepared);
    const result = w.sessions.act(session.id, {choiceId: 'a', expectedTurn: 1, requestId: crypto.randomUUID()});
    assert.equal(result.ended, true); assert.equal(result.scene.ending, '回家');
  } finally {
    db.close(); await new Promise<void>(r => mockProvider.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});
