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
import { extendDraftScene } from '../src/modules/generation/application/extend-scene-service.js';
import { playableStory } from './helpers/playable-story.js';

test('extendDraftScene merges neighbors without wiping unrelated nodes', async () => {
  const stub = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(JSON.parse(body).messages[1].content);
    const sceneId = data.sceneId || 'dock';
    const existing = new Set(data.existingSceneIds || []);
    const a = existing.has(`${sceneId}_spur`) ? `${sceneId}_spur_2` : `${sceneId}_spur`;
    const payload = {
      scenes: [{ id: a, title: '岔路', text: '延伸出的岔路。', origin: 'adapted', evidence: [], choices: [
        { id: 'back', label: '回去', targetSceneId: sceneId },
      ]}],
      anchorChoices: [{ id: `${sceneId}_to_spur`, label: '走向岔路', targetSceneId: a }],
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(payload)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'ext-scene-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    const defaults = {baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, apiKey: '', model: 'stub', timeoutMs: 10000, maxAttempts: 1, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1};
    const w = createWorkbench(db, createModelSettings(db, dir, defaults), undefined, {repairAttempts: 1});
    const source = w.sources.importFile({title: '雾', filename: 'a.txt', bytes: Buffer.from('第一章\n渡口有船。')});
    const content = playableStory([{chapterId: source.chapters[0]!.id, paragraphId: source.chapters[0]!.paragraphs[0]!.id}]);
    const before = content.scenes.map(s => s.id).sort();
    const draft = w.games.create({sourceId: source.id, content});
    const provider = new ChatCompletionsProvider(defaults);
    const updated = await extendDraftScene(w.games, provider, {id: draft.id, version: draft.version, sceneId: 'dock'});
    assert.equal(updated.version, draft.version + 1);
    assert.ok(updated.content.scenes.some(s => s.id === 'dock_spur' || s.id.startsWith('dock_spur')));
    assert.ok(updated.content.scenes.find(s => s.id === 'dock')!.choices.some(c => c.targetSceneId.includes('spur')));
    assert.deepEqual(updated.content.scenes.filter(s => !s.id.includes('spur')).map(s => s.id).sort(), before);
  } finally {
    db.close(); await new Promise<void>(r => stub.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});

test('scanDepth is stored on the job and forwarded into skeleton user payload', async () => {
  let seenDepth: string | undefined;
  const stub = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    const system = parsed.messages[0].content as string;
    const data = JSON.parse(parsed.messages[1].content);
    let content: unknown;
    if (system.startsWith('你是小说资料编辑')) {
      const {chapterId, paragraphId} = data.paragraphs[0];
      content = {summary: '渡口', characters: [], locations: [{name: '渡口', description: '起点', evidence: [{chapterId, paragraphId}]}], worldRules: [], uncertainties: []};
    } else if (system.startsWith('你是文字分支冒险的关卡设计师')) {
      seenDepth = data.scanDepth;
      content = playableStory(data.dossier.locations[0].evidence);
      (content as {scenes: {text: string; ending?: string}[]}).scenes = (content as {scenes: {text: string; ending?: string}[]}).scenes.map(s => ({...s, text: s.ending ? s.text : ''}));
    } else {
      content = playableStory(data.skeleton ? data.dossier.locations[0].evidence : data.dossier.locations[0].evidence);
      if (data.skeleton) content = {...data.skeleton, scenes: data.skeleton.scenes.map((s: {text?: string; ending?: string; title: string}) => ({...s, text: (s.text && s.text.trim()) || (s.ending ? s.text : `来到${s.title}`)}))};
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]}));
  }).listen(0, '127.0.0.1');
  await once(stub, 'listening');
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-depth-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    const defaults = {baseUrl: `http://127.0.0.1:${(stub.address() as {port: number}).port}/v1`, apiKey: '', model: 'stub', timeoutMs: 10000, maxAttempts: 1, retryBaseMs: 0, retryMaxMs: 0, repairAttempts: 1};
    const w = createWorkbench(db, createModelSettings(db, dir, defaults), undefined, {repairAttempts: 1});
    const source = w.sources.importFile({title: '雾', filename: 'a.txt', bytes: Buffer.from('第一章\n渡口有船。')});
    const job = w.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '粗扫', mode: 'story', scanDepth: 'coarse'});
    assert.equal(job.scanDepth, 'coarse');
    await w.createRunner(new ChatCompletionsProvider(defaults)).runOnce();
    assert.equal(seenDepth, 'coarse');
    const finished = w.jobs.get(job.id);
    assert.equal(finished.status, 'succeeded');
  } finally {
    db.close(); await new Promise<void>(r => stub.close(() => r())); rmSync(dir, {recursive: true, force: true});
  }
});
