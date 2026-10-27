import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BorderCache, buildHexTopology, cellBorders, dirtyKeys } from '../src/components/map-kinds/hex/topology';

const geometry = { kind: 'hex' as const, orientation: 'pointy' as const, cols: 6, rows: 5, size: 20 };

test('topology: every interior edge has a neighbour, counts match', () => {
  const t = buildHexTopology(geometry);
  assert.equal(t.cells.length, 30);
  const shared = t.cells.flatMap(c => c.edges).filter(e => e.n).length;
  assert.ok(shared > 0 && shared % 2 === 0);
});

test('incremental border cache equals full recompute after paints', () => {
  const t = buildHexTopology(geometry); const colors = new Map([['a', '#ff0000'], ['b', '#00ff00']]);
  let values: Record<string, string> = {}; for (const c of t.cells) values[c.key] = 'a';
  const cache = new BorderCache(t); cache.reset(values, colors);
  const full = (v: Record<string, string>) => t.cells.flatMap(c => cellBorders(c, v, colors)).length;
  assert.equal(cache.all().length, full(values));
  for (const k of [t.cells[7].key, t.cells[8].key, t.cells[20].key]) {
    const next = { ...values, [k]: 'b' }; assert.deepEqual(dirtyKeys(t, values, next), [k]);
    assert.ok(cache.update(next)); values = next;
    assert.equal(cache.all().length, full(values));
  }
  const erased = { ...values }; delete erased[t.cells[7].key];
  cache.update(erased); assert.equal(cache.all().length, full(erased));
  assert.equal(cache.update(erased), false);
});
