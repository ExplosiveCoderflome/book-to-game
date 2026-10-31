import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorldMap } from '@novel-game/contracts';
import { SvgHexRenderer } from '../src/components/map-kinds/hex/SvgHexRenderer';
import { buildHexTopology } from '../src/components/map-kinds/hex/topology';

const map: WorldMap = { mapSchemaVersion: 1, geometry: { kind: 'hex', orientation: 'pointy', cols: 4, rows: 3, size: 20 }, layers: {},
  pois: [{ locationId: 'a', anchor: { cell: '0,0' } }, { locationId: 'b', anchor: { cell: '2,1' } }] };

test('svg renderer play overlay: fog hides unexplored cells and their POIs; player + reachable drawn', () => {
  const topo = buildHexTopology(map.geometry);
  const hidden = new Set(topo.cells.map(c => c.key).filter(k => k !== '0,0' && k !== '1,0'));
  const html = renderToStaticMarkup(createElement(SvgHexRenderer, { view: { x: 0, y: 0, zoom: 1 }, state: {
    map, topo, mode: 'poi', titles: new Map([['a', 'A'], ['b', 'B']]), selectedCells: [], dropCell: null, brushCells: [],
    play: { playerCell: '0,0', reachableCells: ['1,0'], hiddenCells: hidden },
    npcMarkers: [{ cell: '0,0', label: '老周' }],
    fillIcons: [
      {id: 'shop_visible', kind: 'shop', cell: '0,0', locationId: 'a', label: '渡口商店', color: '#c9a227', icon: '店'},
      {id: 'boss_hidden', kind: 'boss', cell: '2,1', locationId: 'b', label: '不可剧透', color: '#9b2226', icon: '王'},
      {id: 'cell_marker', kind: 'encounter', cell: '0,0', label: '路上遇怪', color: '#e76f51', icon: '战', illustrative: true},
    ],
  } }));
  assert.match(html, /data-testid="map-player" data-cell="0,0"/);
  assert.match(html, /data-reachable="1,0"/);
  assert.equal((html.match(/data-fog=/g) ?? []).length, hidden.size);
  assert.ok(html.includes('data-poi="a"') && !html.includes('data-poi="b"'));
  assert.match(html, /data-npc-marker="老周"/);
  assert.match(html, /data-fill-id="shop_visible"/);
  assert.match(html, /data-fill-id="cell_marker"[^>]*data-illustrative="true"/);
  assert.ok(!html.includes('data-fill-id="boss_hidden"'));
  assert.ok(!html.includes('不可剧透'));
});
