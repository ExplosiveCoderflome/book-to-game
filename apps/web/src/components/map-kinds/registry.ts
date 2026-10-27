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
}

export interface MapKindEditor {
  kind: WorldMapKind;
  label: string;
  Editor: ComponentType<MapEditorProps>;
}

const editors = new Map<WorldMapKind, MapKindEditor>();
/** Kind used for the "create map" empty state. */
export const DEFAULT_MAP_KIND: WorldMapKind = 'hex';

export function registerMapKindEditor(entry: MapKindEditor): void { editors.set(entry.kind, entry); }
export function mapKindEditor(kind: WorldMapKind): MapKindEditor | undefined { return editors.get(kind); }
export function listMapKindEditors(): MapKindEditor[] { return [...editors.values()]; }
