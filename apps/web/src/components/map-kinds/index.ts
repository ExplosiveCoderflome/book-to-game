import { registerMapKindEditor } from './registry';
import { lazy } from 'react';

/** Map editors are code-split: the world page only loads them when a map view opens. */
const HexMapEditor = lazy(() => import('./HexMapEditor').then(m => ({ default: m.HexMapEditor })));

/** Built-in map kind editors. New kinds register here (or from a plugin) — WorldMapCanvas never branches on kind. */
const HexMapViewer = lazy(() => import('./hex/HexMapViewer').then(m => ({ default: m.HexMapViewer })));
registerMapKindEditor({ kind: 'hex', label: '六边形', Editor: HexMapEditor, Viewer: HexMapViewer });

export { DEFAULT_MAP_KIND, listMapKindEditors, mapKindEditor, registerMapKindEditor, type MapEditorProps, type MapViewerProps, type MapKindEditor } from './registry';
