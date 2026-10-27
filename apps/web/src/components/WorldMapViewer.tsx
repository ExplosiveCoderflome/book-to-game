import { Suspense } from 'react';
import { DEFAULT_MAP_KIND, mapKindEditor, type MapViewerProps } from './map-kinds';

/** Read-only map viewer dispatcher (by grid kind). Kinds without a viewer render nothing. */
export function WorldMapViewer(props: MapViewerProps) {
  const entry = mapKindEditor(props.map.geometry.kind ?? DEFAULT_MAP_KIND);
  if (!entry?.Viewer) return null;
  return <Suspense fallback={<div className="map-viewer" style={{ height: props.height ?? 360 }} />}><entry.Viewer {...props} /></Suspense>;
}
