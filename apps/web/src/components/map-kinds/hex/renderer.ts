import type { WorldMap } from '@novel-game/contracts';
import type { MapLayerKind } from '../../../lib/world-map-edit';
import type { HexTopology } from './topology';

export type HexEditMode = 'poi' | MapLayerKind;
export interface HexView { x: number; y: number; zoom: number }

/** Pure, presentational input for a hex renderer. All interaction lives in the controller hook. */
export interface HexRenderState {
  map: WorldMap;
  topo: HexTopology;
  mode: HexEditMode;
  titles: Map<string, string>;
  initialLocationId?: string;
  selectedLocationId?: string;
  /** Selected cell outline (poi mode). */
  selectedCells: string[];
  /** Drag-and-drop target cell. */
  dropCell: string | null;
  /** Brush footprint preview. */
  brushCells: string[];
}

/** Imperative handle: the controller owns pan/zoom outside React state and pushes it here. */
export interface HexRendererHandle { applyView(view: HexView): void }

export interface HexRendererProps { state: HexRenderState; view: HexView }

export type HexRendererId = 'pixi' | 'svg';
const KEY = 'novel-game.mapRenderer';

let webgl: boolean | null = null; let softwareGl = false;
/** Probed once per page (creating a WebGL context is expensive — never call per render uncached). */
export function webglAvailable(): boolean {
  if (webgl === null) webgl = probeWebgl();
  return webgl;
}
function probeWebgl(): boolean {
  try { if (typeof document === 'undefined') return false; const c = document.createElement('canvas'); const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    softwareGl = !!(gl && info && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))));
    (gl?.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.(); return !!gl; } catch { return false; }
}
/** Feature flag: `?mapRenderer=svg|pixi` or localStorage; default Pixi when WebGL exists, else SVG. */
export function preferredHexRenderer(): HexRendererId {
  try {
    const q = new URLSearchParams(window.location.search).get('mapRenderer');
    const v = q ?? window.localStorage.getItem(KEY);
    if (v === 'svg') return 'svg';
    if (v === 'pixi') return webglAvailable() ? 'pixi' : 'svg';
  } catch { /* no window */ }
  // Software-emulated WebGL (SwiftShader/llvmpipe) rasterises slower than Chrome's SVG path: default to SVG there.
  return webglAvailable() && !softwareGl ? 'pixi' : 'svg';
}
export function isSoftwareWebgl(): boolean { webglAvailable(); return softwareGl; }
export function setPreferredHexRenderer(id: HexRendererId): void { try { window.localStorage.setItem(KEY, id); } catch { /* ignore */ } }

export function labelWorldSize(zoom: number): number { return Math.max(10, Math.min(28, 12 / zoom)); }
