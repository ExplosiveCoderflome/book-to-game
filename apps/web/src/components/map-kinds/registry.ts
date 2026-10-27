import type { ComponentType } from 'react';
import type { WorldContent, WorldMap, WorldMapKind } from '@novel-game/contracts';

/** Contract every map-kind editor (canvas + tools) implements. */
export interface MapEditorProps {
  content: WorldContent;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  /** Called with the next map (undefined = remove map layer). Caller persists via the world save path. */
  onMapChange: (map: WorldMap | undefined) => void;
  readOnly?: boolean;
  /** Stable per-world key; undo history is kept across editor remounts under this key. */
  historyKey?: string;
}

/** Read-only viewer (play view / previews). Overlays are session-derived and never written back. */
export interface MapViewerProps {
  map: WorldMap;
  content: WorldContent;
  playerLocationId?: string;
  reachableLocationIds?: string[];
  /** Explored cells; when provided, all other cells are fogged. */
  exploredCells?: string[];
  npcMarkers?: { locationId: string; label: string; color?: string }[];
  onSelectLocation?: (locationId: string) => void;
  height?: number;
}

export interface MapKindEditor {
  kind: WorldMapKind;
  label: string;
  Editor: ComponentType<MapEditorProps>;
  Viewer?: ComponentType<MapViewerProps>;
}

const editors = new Map<WorldMapKind, MapKindEditor>();
/** Kind used for the "create map" empty state. */
export const DEFAULT_MAP_KIND: WorldMapKind = 'hex';

export function registerMapKindEditor(entry: MapKindEditor): void { editors.set(entry.kind, entry); }
export function mapKindEditor(kind: WorldMapKind): MapKindEditor | undefined { return editors.get(kind); }
export function listMapKindEditors(): MapKindEditor[] { return [...editors.values()]; }
