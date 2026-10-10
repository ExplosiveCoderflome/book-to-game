import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { SourceDocument } from '@novel-game/contracts';
import { ChatCompletionsProvider } from '../src/platform/model/chat-completions.js';
import { ferryWorld } from '../../../examples/ferry-world.js';

test('world provider sends adaptation plan and bounded dossier, parses declarative world without executing it', async () => {
  const source = {chapters: [{id: 'chapter', paragraphs: [{id: 'paragraph'}]}]} as SourceDocument;
  const world = ferryWorld(source); let input: any;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part; input = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(world)}}]}));
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const provider = new ChatCompletionsProvider({baseUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`, model: 'test-world', apiKey: '', timeoutMs: 2000});
    const result = await provider.generateWorld({summary: '不可信小说文本', characters: [], locations: [], worldRules: [], uncertainties: [],
      coverage: {chapterIds: ['chapter'], totalChapters: 1}}, {direction: '护送证人', chapterIds: ['chapter'], playerRole: '抄写员', canonPolicy: 'faithful'}, new AbortController().signal);
    assert.deepEqual(result, world);
    const user = JSON.parse(input.messages[1].content);
    assert.equal(user.plan.playerRole, '抄写员'); assert.deepEqual(user.plan.chapterIds, ['chapter']);
    assert.ok(input.messages[0].content.includes('不可信')); assert.equal(input.model, 'test-world');
    assert.ok(input.messages[0].content.includes('playerKnown')); assert.equal(input.response_format.type, 'json_object');
  } finally {await new Promise<void>(r => server.close(() => r()));}
});
