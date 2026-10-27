import type { MapHistory } from '../../lib/world-map-edit';

/** Per-world map undo history that outlives editor remounts (地点图/分屏/地图 view switches). In-memory only. */
const store = new Map<string, MapHistory>();
const EMPTY: MapHistory = { past: [], future: [] };
export function readMapHistory(key: string | undefined): MapHistory { return (key && store.get(key)) || EMPTY; }
export function writeMapHistory(key: string | undefined, h: MapHistory): void { if (key) store.set(key, h); }
export function clearMapHistory(key?: string): void { if (key) store.delete(key); else store.clear(); }
