import { Application, BitmapText, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { hexToPixel, parseCellKey } from '@novel-game/rules';
import { layerCells, layerCentroids, layerPalette, type MapLayerKind } from '../../../lib/world-map-edit';
import { labelWorldSize, type HexRenderState, type HexView } from './renderer';
import { BorderCache, dirtyKeys, type BorderSeg, type HexTopology } from './topology';

const BASE = 0xfbfcfa, BASE_POI = 0xe7f0ea, GRID = 0xd6dbd3;
const hex = (c: string | undefined, fb = 0): number => {
  if (!c) return fb; const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim()); if (!m) return fb;
  const s = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]; return parseInt(s, 16);
};
function cssColor(name: string, fb: number): number {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return hex(v, fb); } catch { return fb; }
}
const colorsOf = (s: HexRenderState, kind: MapLayerKind) => new Map(layerPalette(s.map, kind).map(p => [p.id, p.color]));

interface LayerSprites { sprites: Map<string, Sprite>; cells: Record<string, string> | undefined; colors: Map<string, string> | null; borders: BorderCache }

/**
 * Retained-mode Pixi scene for one hex map. Per-layer containers; on each update only dirty cells are
 * re-tinted and borders are recomputed incrementally. Rendering is on demand (no idle ticker).
 */
export class HexPixiScene {
  private app = new Application();
  private vp!: Viewport;
  private ready = false; private destroyed = false; private frame = 0;
  private topo: HexTopology | null = null;
  private layers = { terrain: new Container(), grid: new Graphics(), faction: new Container(), factionBorders: new Graphics(), region: new Container(), regionBorders: new Graphics(), regionLabels: new Container(), overlay: new Graphics(), pois: new Container() };
  private terrain: LayerSprites | null = null; private faction: LayerSprites | null = null; private region: LayerSprites | null = null;
  private hexTex: Texture | null = null; private dotTex: Texture | null = null;
  private poiLabels: BitmapText[] = [];
  private last: HexRenderState | null = null; private lastPoiSig = ''; private lastRegionLabelsRef: unknown = null;
  private view: HexView = { x: 0, y: 0, zoom: 1 };
  private colors = { green: 0x2f7d55, rust: 0xb5532c, ink: 0x1b1f1d };
  private pending: HexRenderState | null = null;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, antialias: true, backgroundAlpha: 0, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), preference: 'webgl', autoStart: false });
    if (this.destroyed) { this.app.destroy(true); return; }
    this.app.ticker.stop();
    const canvas = this.app.canvas; canvas.style.display = 'block'; canvas.dataset.renderer = 'pixi'; canvas.style.position = 'absolute'; canvas.style.inset = '0';
    host.appendChild(canvas);
    this.vp = new Viewport({ events: this.app.renderer.events, screenWidth: host.clientWidth, screenHeight: host.clientHeight, noTicker: true });
    this.vp.eventMode = 'none'; this.app.stage.eventMode = 'none';
    this.app.stage.addChild(this.vp);
    const L = this.layers; this.vp.addChild(L.terrain, L.grid, L.faction, L.factionBorders, L.region, L.regionBorders, L.regionLabels, L.overlay, L.pois);
    this.colors = { green: cssColor('--green', this.colors.green), rust: cssColor('--rust', this.colors.rust), ink: cssColor('--ink', this.colors.ink) };
    this.app.renderer.on('resize', () => { this.vp.resize(this.app.screen.width, this.app.screen.height); this.requestRender(); });
    this.ready = true;
    if (this.pending) { const p = this.pending; this.pending = null; this.update(p); }
    this.applyView(this.view);
  }
  destroy(): void {
    this.destroyed = true; cancelAnimationFrame(this.frame);
    if (this.ready) { this.app.destroy(true, { children: true, texture: true }); this.ready = false; }
  }
  requestRender(): void {
    if (!this.ready || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.ready) this.app.render(); });
  }
  applyView(v: HexView): void {
    this.view = v; if (!this.ready) return;
    this.vp.position.set(v.x, v.y); this.vp.scale.set(v.zoom);
    const s = labelWorldSize(v.zoom) / 24; for (const t of this.poiLabels) t.scale.set(s);
    this.requestRender();
  }

  private rebuildGeometry(topo: HexTopology): void {
    const L = this.layers; this.topo = topo;
    for (const c of [L.terrain, L.faction, L.region]) c.removeChildren().forEach(ch => ch.destroy());
    this.hexTex?.destroy(true); this.dotTex?.destroy(true);
    const c0 = topo.cells[0];
    const g = new Graphics();
    if (c0) g.poly(c0.corners.flatMap(p => [p.x - c0.c.x, p.y - c0.c.y]), true).fill(0xffffff);
    this.hexTex = this.app.renderer.generateTexture({ target: g, resolution: 4, antialias: true }); g.destroy();
    const r = topo.geometry.size * 0.38;
    const d = new Graphics().circle(0, 0, r).fill(0xffffff);
    this.dotTex = this.app.renderer.generateTexture({ target: d, resolution: 4, antialias: true }); d.destroy();
    const mk = (parent: Container) => { const m = new Map<string, Sprite>(); for (const cell of topo.cells) { const s = new Sprite(this.hexTex!); s.anchor.set(0.5); s.position.set(cell.c.x, cell.c.y); s.visible = false; parent.addChild(s); m.set(cell.key, s); } return m; };
    this.terrain = { sprites: mk(L.terrain), cells: undefined, colors: null, borders: new BorderCache(topo) };
    this.faction = { sprites: mk(L.faction), cells: undefined, colors: null, borders: new BorderCache(topo) };
    this.region = { sprites: mk(L.region), cells: undefined, colors: null, borders: new BorderCache(topo) };
    for (const s of this.terrain.sprites.values()) s.visible = true;
    L.grid.clear(); for (const cell of topo.cells) L.grid.poly(cell.corners.flatMap(p => [p.x, p.y]), true);
    L.grid.stroke({ width: 1, color: GRID, alignment: 0.5 });
  }

  private syncLayer(layer: LayerSprites, cells: Record<string, string>, colors: Map<string, string>, colorsChanged: boolean, paint: (s: Sprite, col: string | undefined, key: string) => void): boolean {
    const topo = this.topo!; const keys = colorsChanged || !layer.colors ? topo.cells.map(c => c.key) : dirtyKeys(topo, layer.cells, cells);
    for (const k of keys) paint(layer.sprites.get(k)!, colors.get(cells[k]), k);
    const bordersChanged = colorsChanged || !layer.colors ? (layer.borders.reset(cells, colors), true) : layer.borders.update(cells);
    layer.cells = cells; layer.colors = colors; return bordersChanged;
  }

  update(s: HexRenderState): void {
    if (!this.ready) { this.pending = s; return; }
    const prev = this.last; const L = this.layers; const map = s.map;
    if (!this.topo || this.topo !== s.topo) { this.rebuildGeometry(s.topo); this.last = null; }
    const full = !prev || this.last === null;
    const modeChanged = full || prev!.mode !== s.mode;
    const poiCells = new Set(map.pois.map(p => p.anchor.cell));
    const poisChanged = full || prev!.map.pois !== map.pois;
    // terrain
    const tPal = map.layers?.terrain?.palette; const tColorsChanged = full || modeChanged || poisChanged || prev!.map.layers?.terrain?.palette !== tPal;
    const tColors = tColorsChanged || !this.terrain!.colors ? colorsOf(s, 'terrain') : this.terrain!.colors;
    const alpha = s.mode === 'faction' ? 0.55 : 1;
    this.syncLayer(this.terrain!, map.layers?.terrain?.cells ?? {}, tColors, tColorsChanged, (sp, col, k) => { sp.tint = col ? hex(col, BASE) : (poiCells.has(k) ? BASE_POI : BASE); sp.alpha = col ? alpha : 1; });
    // faction
    const fPalChanged = full || modeChanged || prev!.map.layers?.factions?.factions !== map.layers?.factions?.factions;
    const fColors = fPalChanged || !this.faction!.colors ? colorsOf(s, 'faction') : this.faction!.colors;
    const fa = s.mode === 'faction' ? 0.5 : 0.22;
    if (this.syncLayer(this.faction!, layerCells(map, 'faction'), fColors, fPalChanged, (sp, col) => { sp.visible = !!col; if (col) { sp.tint = hex(col); sp.alpha = fa; } }))
      this.drawBorders(L.factionBorders, this.faction!.borders.all(), s.mode === 'faction' ? 3 : 2.5);
    // region
    const rPalChanged = full || modeChanged || prev!.map.layers?.regions?.regions !== map.layers?.regions?.regions;
    const rColors = rPalChanged || !this.region!.colors ? colorsOf(s, 'region') : this.region!.colors;
    const showRegionFill = s.mode === 'region';
    L.region.visible = showRegionFill;
    if (this.syncLayer(this.region!, layerCells(map, 'region'), rColors, rPalChanged, (sp, col) => { sp.visible = !!col; if (col) { sp.tint = hex(col); sp.alpha = 0.2; } }))
      this.drawBorders(L.regionBorders, this.region!.borders.all(), s.mode === 'region' ? 2.5 : 1.6, true);
    // region labels (recomputed only when region cells/palette change)
    const regionsRef = map.layers?.regions;
    if (full || modeChanged || regionsRef !== this.lastRegionLabelsRef) { this.lastRegionLabelsRef = regionsRef; this.drawRegionLabels(s); }
    // POIs
    const poiSig = JSON.stringify([map.pois, s.selectedLocationId, s.initialLocationId, s.mode, [...s.titles]]);
    if (poiSig !== this.lastPoiSig) { this.lastPoiSig = poiSig; this.drawPois(s); }
    this.drawOverlay(s);
    this.last = s;
    this.requestRender();
  }

  private drawBorders(g: Graphics, segs: BorderSeg[], width: number, dashed = false): void {
    g.clear();
    const byColor = new Map<string, BorderSeg[]>(); for (const e of segs) { const a = byColor.get(e.color) ?? []; a.push(e); byColor.set(e.color, a); }
    for (const [color, list] of byColor) {
      for (const e of list) {
        if (!dashed) { g.moveTo(e.a.x, e.a.y).lineTo(e.b.x, e.b.y); continue; }
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, len = Math.hypot(dx, dy);
        for (let t = 0; t < len; t += 10) { const t2 = Math.min(len, t + 6); g.moveTo(e.a.x + dx * t / len, e.a.y + dy * t / len).lineTo(e.a.x + dx * t2 / len, e.a.y + dy * t2 / len); }
      }
      g.stroke({ width, color: hex(color), cap: 'round' });
    }
  }
  private drawRegionLabels(s: HexRenderState): void {
    const L = this.layers; L.regionLabels.removeChildren().forEach(c => c.destroy());
    const map = s.map; if (!map.layers?.regions) return; const g = map.geometry;
    const cents = layerCentroids(map, 'region', key => { const a = parseCellKey(key); return a ? hexToPixel(g, a) : null; });
    for (const r of map.layers.regions.regions) {
      const c = cents.get(r.id); if (!c) continue;
      const size = Math.max(14, Math.min(40, g.size * 0.9 + Math.sqrt(c.n) * 1.5));
      const t = new BitmapText({ text: r.name, style: { fontFamily: 'system-ui, "Noto Sans CJK SC", sans-serif', fontSize: 40, fontWeight: '700', fill: 0x2a2118, stroke: { color: 0xfffaf0, width: 8 }, letterSpacing: 4 } });
      t.anchor.set(0.5); t.scale.set(size / 40); t.position.set(c.x, c.y); t.alpha = s.mode === 'region' ? 0.95 : 0.7;
      L.regionLabels.addChild(t);
    }
  }
  private drawPois(s: HexRenderState): void {
    const L = this.layers; L.pois.removeChildren().forEach(c => c.destroy()); this.poiLabels = [];
    const g = s.map.geometry; const r = g.size * 0.38; const passive = s.mode !== 'poi';
    L.pois.alpha = passive ? 0.85 : 1;
    for (const p of s.map.pois) {
      const a = parseCellKey(p.anchor.cell); if (!a) continue; const c = hexToPixel(g, a);
      const selected = p.locationId === s.selectedLocationId; const missing = !s.titles.has(p.locationId); const start = p.locationId === s.initialLocationId;
      const ring = new Graphics().circle(c.x, c.y, r).stroke({ width: selected ? 3.5 : 2.5, color: selected ? 0xf5b301 : 0xffffff });
      const dot = new Sprite(this.dotTex!); dot.anchor.set(0.5); dot.position.set(c.x, c.y); dot.tint = missing ? this.colors.rust : start ? 0x1f4fbf : this.colors.green;
      const raw = p.label ?? s.titles.get(p.locationId) ?? p.locationId; const label = raw.length > 8 ? `${raw.slice(0, 8)}…` : raw;
      const t = new BitmapText({ text: label, style: { fontFamily: 'system-ui, "Noto Sans CJK SC", sans-serif', fontSize: 24, fontWeight: '600', fill: this.colors.ink, stroke: { color: 0xffffff, width: 6 } } });
      t.anchor.set(0.5, 0); t.position.set(c.x, c.y + r + 1); t.scale.set(labelWorldSize(this.view.zoom) / 24);
      this.poiLabels.push(t); L.pois.addChild(dot, ring, t);
    }
  }
  private drawOverlay(s: HexRenderState): void {
    const o = this.layers.overlay; o.clear(); const topo = this.topo!;
    const poly = (k: string) => { const c = topo.byKey.get(k); return c ? c.corners.flatMap(p => [p.x, p.y]) : null; };
    if (s.dropCell) { const p = poly(s.dropCell); if (p) o.poly(p, true).fill({ color: this.colors.green, alpha: 0.28 }).stroke({ width: 1.5, color: this.colors.green }); }
    for (const k of s.selectedCells) { const p = poly(k); if (p) o.poly(p, true).stroke({ width: 2.2, color: this.colors.green }); }
    if (s.brushCells.length) {
      for (const k of s.brushCells) { const p = poly(k); if (p) o.poly(p, true); }
      o.fill({ color: 0xffffff, alpha: 0.28 }).stroke({ width: 1.6, color: 0x1b1f1d });
    }
  }
}
