/**
 * M1b-1 export_play_package: single-file HTML, frozen content + catalog snapshot, inlined images,
 * manifest fields, honest failure codes, and the secret scan (location only, never the value).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildingLibrary, GameContent, GameRevision, ItemCatalog, WorldRevision } from '@novel-game/contracts';
import { projectFillActions } from '@novel-game/rules';
import {
  CONTENT_SCRIPT_ID, MANIFEST_SCRIPT_ID, PACKAGE_FORMAT_VERSION, RUNTIME_VERSION, loadPackage,
  type OpenPackageContent, type PackageManifest,
} from '@novel-game/play-runtime';
import { AppError } from '../src/shared/errors.js';
import {
  CONTENT_PLACEHOLDER, ExportService, MANIFEST_PLACEHOLDER, packageFileName, scanForSecrets, snapshotCatalogs,
  type ExportRevisionSources, type MediaReader,
} from '../src/modules/exports/index.js';
import { fillDemoWorld } from './helpers/fill-fixture.js';

const TEMPLATE = `<!doctype html><html><head><title>player</title></head><body><div id="root"></div>${MANIFEST_PLACEHOLDER}${CONTENT_PLACEHOLDER}<script type="module">/*player*/</script></body></html>`;
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const MODEL_KEY = 'mk-super-secret-model-key-0123456789';

const story = (title = '关卡'): GameRevision => ({
  id: 'rev-game-2', draftId: 'draft-game', sourceId: 'src', version: 2, createdAt: '2026-10-28T00:00:00.000Z',
  content: {
    title, mode: 'story', premise: '寻找通行机会', adaptationNotes: '', startSceneId: 'gate', variables: {},
    scenes: [
      { id: 'gate', title: '关卡', text: '你来到关卡。', origin: 'adapted', evidence: [], choices: [{ id: 'go', label: '通过', targetSceneId: 'end' }, { id: 'leave', label: '离开', targetSceneId: 'lost' }] },
      { id: 'lost', title: '离开', text: '你离开了关卡。', origin: 'adapted', evidence: [], choices: [], ending: '另一条路' },
      { id: 'end', title: '城中', text: '抵达。', origin: 'adapted', evidence: [], choices: [], ending: '抵达城中' },
    ],
  } as GameContent,
});

function world(assetId = 'shop_asset'): WorldRevision {
  const content = fillDemoWorld();
  const placement = content.map!.fill!.placements.find(p => p.id === 'pl_shop_empty')!;
  placement.buildingAssetId = assetId;
  return { id: 'rev-world-3', draftId: 'draft-world', sourceId: 'src', version: 3, createdAt: '2026-10-28T00:00:00.000Z', content };
}

const library = (): BuildingLibrary => ({
  schemaVersion: 1,
  assets: [
    { id: 'shop_asset', version: 1, label: '码头杂货', kind: 'shop', imageUrl: '/media/building-images/shop.svg', imagePath: 'building-images/shop.svg', shop: { shelf: [{ itemId: 'dry_ration' }] } },
    { id: 'gone_img', version: 1, label: '没用到的', kind: 'supply', imageUrl: '/media/building-images/none.svg' },
  ],
});
const catalog = (): ItemCatalog => ({
  schemaVersion: 1,
  items: [
    { id: 'dry_ration', version: 1, label: '干粮', category: 'consumable', imageUrl: '/media/item-images/missing.png' },
    { id: 'unused_item', version: 1, label: '无关物品', category: 'material' },
  ],
});

function make(over: { lib?: BuildingLibrary; game?: GameRevision; world?: WorldRevision; maxBytes?: number; template?: string | null } = {}) {
  const sources: ExportRevisionSources = {
    getGameRevision: id => { const g = over.game ?? story(); if (id !== g.id) throw new AppError('GAME_REVISION_NOT_FOUND', 'x', 404); return g; },
    getWorldRevision: id => { const w = over.world ?? world(); if (id !== w.id) throw new AppError('WORLD_REVISION_NOT_FOUND', 'x', 404); return w; },
    buildingLibrary: () => over.lib ?? library(),
    itemCatalog: catalog,
  };
  const media: MediaReader = { read: p => p === 'building-images/shop.svg' ? { bytes: SVG, mime: 'image/svg+xml' } : null };
  return new ExportService(sources, media, { read: () => over.template === undefined ? TEMPLATE : over.template }, {
    appVersion: '0.2.0', maxBytes: over.maxBytes, now: () => '2026-10-28T08:00:00.000Z', secrets: () => [MODEL_KEY],
  });
}

function scripts(html: string) {
  const grab = (id: string) => html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1] ?? null;
  return { manifest: grab(MANIFEST_SCRIPT_ID), content: grab(CONTENT_SCRIPT_ID) };
}

function code(fn: () => unknown): { code: string; details: unknown; message: string } {
  try { fn(); } catch (e) { if (e instanceof AppError) return { code: e.code, details: e.details, message: e.message }; throw e; }
  assert.fail('expected AppError');
}

test('export story: one HTML, manifest fields, ai.mode none, contentHash verifies in the player loader', () => {
  const report = make().exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2' });
  assert.equal(report.fileName, '关卡-v2.html');
  assert.equal(report.mode, 'story');
  assert.equal(report.size, Buffer.byteLength(report.html));
  const { manifest, content } = scripts(report.html);
  const loaded = loadPackage(manifest, content);
  assert.ok(loaded.ok, JSON.stringify(loaded));
  const m = loaded.manifest as PackageManifest;
  assert.equal(m.formatVersion, PACKAGE_FORMAT_VERSION);
  assert.equal(m.runtimeVersion, RUNTIME_VERSION);
  assert.deepEqual(m.ai, { mode: 'none' });
  assert.equal(m.packageId, 'btg-game-draft-game');
  assert.deepEqual(m.revision, { id: 'rev-game-2', version: 2, createdAt: '2026-10-28T00:00:00.000Z', kind: 'game' });
  assert.equal(m.catalogSnapshot, null);
  assert.deepEqual(m.exporter, { app: 'book-to-game', appVersion: '0.2.0' });
  assert.equal(m.contentHash, report.contentHash);
  assert.match(report.html, /<title>关卡<\/title>/);
  assert.ok(!report.html.includes('__BTG_'));
});

test('export world: catalog snapshot is the referenced subset; images inlined or degraded; imagePath dropped', () => {
  const report = make().exportPlayPackage({ kind: 'world', revisionId: 'rev-world-3' });
  const loaded = loadPackage(scripts(report.html).manifest, scripts(report.html).content);
  assert.ok(loaded.ok);
  const content = loaded.content as OpenPackageContent;
  assert.deepEqual(content.catalogSnapshot.buildingLibrary.assets.map(a => a.id), ['shop_asset']);
  assert.deepEqual(content.catalogSnapshot.itemCatalog.items.map(i => i.id), ['dry_ration']);
  const shop = content.catalogSnapshot.buildingLibrary.assets[0];
  assert.match(shop.imageUrl ?? '', /^data:image\/svg\+xml;base64,/);
  assert.equal(shop.imagePath, undefined);
  assert.equal(content.catalogSnapshot.itemCatalog.items[0].imageUrl, undefined);
  assert.equal(report.degraded.length, 1);
  assert.equal(report.degraded[0].kind, 'image');
  assert.equal(loaded.manifest.catalogSnapshot?.subset, true);
  assert.equal(loaded.manifest.mode, 'open');
  assert.ok(!report.html.includes('/media/'));
});

test('catalog subset projects the same fill actions as the full catalog', () => {
  const w = world().content;
  const snap = snapshotCatalogs(w, library(), catalog());
  assert.equal(snap.subset, true);
  assert.deepEqual(
    projectFillActions(w, { library: snap.buildingLibrary, catalog: snap.itemCatalog }),
    projectFillActions(w, { library: library(), catalog: catalog() }),
  );
});

test('export failures carry honest codes and never produce a file', () => {
  assert.equal(code(() => make().exportPlayPackage({ kind: 'game', revisionId: 'nope' })).code, 'EXPORT_REVISION_NOT_PUBLISHED');
  assert.equal(code(() => make().exportPlayPackage({ kind: 'world', revisionId: 'nope' })).code, 'EXPORT_REVISION_NOT_PUBLISHED');

  const broken = story();
  (broken.content as GameContent).startSceneId = 'missing_scene';
  const invalid = code(() => make({ game: broken }).exportPlayPackage({ kind: 'game', revisionId: broken.id }));
  assert.equal(invalid.code, 'EXPORT_CONTENT_INVALID');
  assert.ok(Array.isArray((invalid.details as { issues: string[] }).issues));

  const tooLarge = code(() => make({ maxBytes: 1000 }).exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2' }));
  assert.equal(tooLarge.code, 'EXPORT_TOO_LARGE');
  assert.equal((tooLarge.details as { limit: number }).limit, 1000);
  assert.ok((tooLarge.details as { size: number }).size > 1000);

  const unsupported = code(() => make({ world: world('deleted_asset') }).exportPlayPackage({ kind: 'world', revisionId: 'rev-world-3' }));
  assert.equal(unsupported.code, 'EXPORT_UNSUPPORTED_CONTENT');
  assert.deepEqual((unsupported.details as { items: unknown[] }).items, [{ kind: 'building-asset', label: '歇业铺面', ref: 'deleted_asset' }]);

  assert.equal(code(() => make({ template: null }).exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2' })).code, 'EXPORT_PLAYER_UNAVAILABLE');
  assert.equal(code(() => make().exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2', target: 'windows-exe' })).code, 'EXPORT_TARGET_UNAVAILABLE');
});

test('secret scan: configured key or key-shaped text aborts; error names the location, never the value', () => {
  const leaky = story();
  leaky.content.scenes[0].text = `钥匙是 ${MODEL_KEY}`;
  const hit = code(() => make({ game: leaky }).exportPlayPackage({ kind: 'game', revisionId: leaky.id }));
  assert.equal(hit.code, 'EXPORT_SECRET_DETECTED');
  assert.deepEqual((hit.details as { locations: string[] }).locations, ['content.revision.content.scenes[0].text']);
  assert.ok(!JSON.stringify(hit).includes(MODEL_KEY));

  const shaped = story();
  shaped.content.premise = 'sk-abcdefghijklmnopqrstuvwxyz0123';
  const hit2 = code(() => make({ game: shaped }).exportPlayPackage({ kind: 'game', revisionId: shaped.id }));
  assert.equal(hit2.code, 'EXPORT_SECRET_DETECTED');
  assert.ok(!JSON.stringify(hit2).includes('sk-abcdefghijklmnopqrstuvwxyz0123'));

  // template itself scanned too
  const hit3 = code(() => make({ template: TEMPLATE.replace('/*player*/', `/*${MODEL_KEY}*/`) }).exportPlayPackage({ kind: 'game', revisionId: 'rev-game-2' }));
  assert.deepEqual((hit3.details as { locations: string[] }).locations, ['player']);

  // short / empty secrets are ignored (no false positives on "")
  assert.deepEqual(scanForSecrets({ a: 'hello' }, { content: '{"a":"hello"}' }, ['', 'abc']), []);
});

test('script-safe embedding: </script> in content cannot break out', () => {
  const tricky = story('标题</script><script>alert(1)</script>');
  const report = make({ game: tricky }).exportPlayPackage({ kind: 'game', revisionId: tricky.id });
  const s = scripts(report.html);
  const loaded = loadPackage(s.manifest, s.content);
  assert.ok(loaded.ok);
  assert.equal(loaded.manifest.title, tricky.content.title);
  assert.ok(!report.html.includes('<script>alert(1)'));
  assert.equal(packageFileName('a/b:c*?', 4), 'abc-v4.html');
});
