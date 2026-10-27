import { useI18n } from '../lib/i18n';
import { DEFAULT_MAP_KIND, mapKindEditor, type MapEditorProps } from './map-kinds';

/** Optional world map layer. Dispatches to the editor registered for the map's grid kind. */
export function WorldMapCanvas(props: MapEditorProps) {
  const { t } = useI18n();
  const kind = props.content.map?.geometry.kind ?? DEFAULT_MAP_KIND;
  const entry = mapKindEditor(kind);
  if (!entry) return <div className="branch-canvas primary world-map-pane" data-testid="world-map-canvas"><p className="hint">{t('不支持的地图类型：{kind}', { kind })}</p></div>;
  return <entry.Editor {...props} />;
}
