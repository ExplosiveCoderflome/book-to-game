import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { encodeModule, inlinePlayerTemplate } from '../scripts/inline-player.mjs';

const MANIFEST_SLOT = '<script id="btg-manifest" type="application/json">__BTG_MANIFEST__</script>';
const CONTENT_SLOT = '<script id="btg-content" type="application/json">__BTG_CONTENT__</script>';
const originalModule = [
  'export const answer = 42;',
  'const closer = "</script>";',
  'const comment = "<!--";',
  'const slots = "__BTG_MANIFEST__/__BTG_CONTENT__";',
].join('\n');

const fixtureHtml = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" crossorigin href="./assets/style.css">',
  '</head><body><div id="root"></div>',
  MANIFEST_SLOT,
  CONTENT_SLOT,
  '<script type="module" crossorigin src="./assets/main.js"></script>',
  '</body></html>',
].join('');

const files = new Map([
  ['./assets/main.js', originalModule],
  ['./assets/style.css', '.package-error{color:#555}'],
]);
const read = (rel: string) => {
  const content = files.get(rel);
  assert.ok(content !== undefined, `unexpected asset ${rel}`);
  return content;
};

const template = inlinePlayerTemplate(fixtureHtml, read);
const scriptSafeModule = originalModule.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const encoded = /<script type="application\/octet-stream" id="btg-code">([^<]*)<\/script>/.exec(template)?.[1];
assert.ok(encoded, 'template carries the compressed player payload');

const bootstrapSource = (() => {
  const scripts = [...template.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  const found = scripts.find(source => source.includes('btg-code') && source.includes('DecompressionStream'));
  assert.ok(found, 'template carries the decompression bootstrap');
  return found;
})();

async function decodeWithDecompressionStream(value: string) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

function runBootstrap(source: string, payload: string, supported: boolean) {
  const root = { innerHTML: '' };
  const appended: Array<{ type?: string; textContent?: string }> = [];
  const document = {
    getElementById(id: string) {
      if (id === 'root') return root;
      if (id === 'btg-code') return { textContent: payload };
      return null;
    },
    createElement(tag: string) {
      return { tagName: tag, type: '', textContent: '' };
    },
    body: {
      append(node: { type?: string; textContent?: string }) {
        appended.push(node);
      },
    },
  };
  const body = `return (async()=>{${source}})();`;
  const args = ['document', 'DecompressionStream', 'Blob', 'Response', 'atob', 'Uint8Array'];
  const values = [
    document,
    supported ? DecompressionStream : undefined,
    Blob,
    Response,
    atob,
    Uint8Array,
  ];
  // vm keeps the bootstrap's bare globals visible; the Function body adds top-level await support.
  const run = vm.runInNewContext(`(function(${args.join(',')}){${body}})`, { Blob, Response, atob, Uint8Array, DecompressionStream });
  return { promise: run(...values) as Promise<void>, root, appended };
}

test('gzip + base64 round-trips the player module through DecompressionStream', async () => {
  assert.equal(await decodeWithDecompressionStream(encodeModule(originalModule)), originalModule);
  assert.equal(await decodeWithDecompressionStream(encoded!), scriptSafeModule);
});

test('without DecompressionStream the bootstrap renders the Chinese package-error instead of a blank page', async () => {
  const { promise, root, appended } = runBootstrap(bootstrapSource, encoded!, false);
  await promise;
  assert.equal(appended.length, 0);
  assert.ok(root.innerHTML.length > 0, 'root is not left blank');
  assert.match(root.innerHTML, /work-section package-error/);
  assert.match(root.innerHTML, /data-testid="package-error-unsupported"/);
  assert.match(root.innerHTML, /当前浏览器无法打开这个播放器/);
  assert.match(root.innerHTML, /DecompressionStream/);
});

test('with DecompressionStream the bootstrap appends the recovered module', async () => {
  const { promise, root, appended } = runBootstrap(bootstrapSource, encoded!, true);
  await promise;
  assert.equal(root.innerHTML, '');
  assert.equal(appended.length, 1);
  assert.equal(appended[0]!.type, 'module');
  assert.equal(appended[0]!.textContent, scriptSafeModule);
});

test('the compressed payload contains no live </script> and no server slot markers', () => {
  assert.match(encoded!, /^[A-Za-z0-9+/]+=*$/);
  assert.ok(!encoded!.includes('</script'));
  assert.ok(!encoded!.includes('__BTG_MANIFEST__'));
  assert.ok(!encoded!.includes('__BTG_CONTENT__'));
  assert.equal(template.split(MANIFEST_SLOT).length, 2, 'manifest slot remains exactly once');
  assert.equal(template.split(CONTENT_SLOT).length, 2, 'content slot remains exactly once');
  assert.equal(template.split('__BTG_MANIFEST__').length, 2, 'no extra manifest marker in the payload');
  assert.equal(template.split('__BTG_CONTENT__').length, 2, 'no extra content marker in the payload');
  assert.ok(template.indexOf(MANIFEST_SLOT) < template.indexOf('id="btg-code"'));
  assert.ok(template.indexOf(CONTENT_SLOT) < template.indexOf('id="btg-code"'));
});
