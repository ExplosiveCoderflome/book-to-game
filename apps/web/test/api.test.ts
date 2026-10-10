import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request, RequestError } from '../src/lib/api.ts';

test('API client omits the MCP bearer token for Web requests and returns the direct DTO', async () => {
  const server = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ authorization: incoming.headers.authorization, method: incoming.method, path: incoming.url, input: JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => nativeFetch(`http://127.0.0.1:${address.port}${url}`, init);
  try {
    const result = await request('', '/drafts', 'POST', { sourceId: 'source-a' });
    assert.deepEqual(result, { method: 'POST', path: '/api/drafts', input: { sourceId: 'source-a' } });
    assert.equal(result.authorization, undefined);
  } finally { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('structured version conflict remains distinguishable from an uncertain server failure', async () => {
  const server = createServer((incoming, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.statusCode = incoming.url?.endsWith('/conflict') ? 409 : 500;
    response.end(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: '草稿已修改', details: { currentVersion: 2 } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => nativeFetch(`http://127.0.0.1:${address.port}${url}`, init);
  try {
    await assert.rejects(request('token', '/conflict'), error => {
      assert(error instanceof RequestError); assert.equal(error.status, 409); assert.equal(error.uncertain, false);
      assert.deepEqual(error.details, { currentVersion: 2 }); return true;
    });
    await assert.rejects(request('token', '/failed'), error => {
      assert(error instanceof RequestError); assert.equal(error.uncertain, true); return true;
    });
  } finally { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
});
