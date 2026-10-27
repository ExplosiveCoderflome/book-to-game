import { FACTION_STANCES, type FactionStance, type WorldContent } from '@novel-game/contracts';
import { effectiveRelation, relationKey, STANCE_LABEL, worldFactions } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';

const STANCE_CLASS: Record<FactionStance, string> = { ally: 'st-ally', neutral: 'st-neutral', hostile: 'st-hostile' };
const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'stat';

/** Authored faction relation matrix + faction stats (stats are plain world resources — shared numeric substrate). */
export function FactionRelationsEditor({ content: w, onChange }: { content: WorldContent; onChange: (next: WorldContent) => void }) {
  const { t } = useI18n();
  const factions = worldFactions(w);
  if (factions.length < 1) return <p className="hint">{t('地图上还没有势力。先在地图「势力」图层添加势力。')}</p>;
  function setRelation(a: string, b: string, patch: { stance?: FactionStance; standing?: number }) {
    const k = relationKey(a, b); const cur = effectiveRelation(w, undefined, a, b);
    const rest = (w.factionRelations ?? []).filter(r => relationKey(r.a, r.b) !== k);
    const [x, y] = a < b ? [a, b] : [b, a];
    onChange({ ...w, factionRelations: [...rest, { a: x, b: y, stance: patch.stance ?? cur.stance, standing: Math.max(-100, Math.min(100, Math.round(patch.standing ?? cur.standing))) }] });
  }
  function setFactionStats(fid: string, stats: { label: string; resourceId: string }[], resources = w.resources) {
    const patchMap = (m: NonNullable<WorldContent['map']>) => m.layers?.factions ? { ...m, layers: { ...m.layers, factions: { ...m.layers.factions, factions: m.layers.factions.factions.map(f => f.id === fid ? { ...f, stats: stats.length ? stats : undefined } : f) } } } : m;
    onChange({ ...w, resources, ...(w.map ? { map: patchMap(w.map) } : {}), ...(w.subMaps ? { subMaps: w.subMaps.map(patchMap) } : {}) });
  }
  return <div className="faction-editor" data-testid="faction-relations-editor">
    <p className="world-map-tray-label">{t('势力关系矩阵')} · {t('行 × 列，点击格子改立场，数字为好感 −100…100')}</p>
    <div className="faction-matrix-wrap"><table className="faction-matrix">
      <thead><tr><th />{factions.map(f => <th key={f.id}><span className="faction-chip" style={{ ['--chip' as string]: f.color }}>{f.name}</span></th>)}</tr></thead>
      <tbody>{factions.map(row => <tr key={row.id}>
        <th><span className="faction-chip" style={{ ['--chip' as string]: row.color }}>{row.name}</span></th>
        {factions.map(col => {
          if (col.id === row.id) return <td key={col.id} className="self">—</td>;
          const r = effectiveRelation(w, undefined, row.id, col.id);
          return <td key={col.id} className={STANCE_CLASS[r.stance]} data-testid={`rel-${row.id}-${col.id}`}>
            <select value={r.stance} onChange={e => setRelation(row.id, col.id, { stance: e.target.value as FactionStance })}>
              {FACTION_STANCES.map(s => <option key={s} value={s}>{t(STANCE_LABEL[s])}</option>)}</select>
            <input type="number" min={-100} max={100} step={5} value={r.standing} onChange={e => setRelation(row.id, col.id, { standing: Number(e.target.value) })} />
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
    <p className="world-map-tray-label">{t('势力数值')} · {t('存为世界资源，可被规则、世界书和事件读写')}</p>
    <div className="faction-stats">{factions.map(f => <div key={f.id} className="faction-stat-card">
      <strong className="faction-chip" style={{ ['--chip' as string]: f.color }}>{f.name}</strong>
      {(f.stats ?? []).map((st, i) => <div key={i} className="faction-stat-row">
        <input value={st.label} maxLength={40} onChange={e => setFactionStats(f.id, (f.stats ?? []).map((x, j) => j === i ? { ...x, label: e.target.value || x.label } : x))} />
        <input type="number" value={w.resources?.[st.resourceId] ?? 0} onChange={e => setFactionStats(f.id, f.stats ?? [], { ...(w.resources ?? {}), [st.resourceId]: Number(e.target.value) })} />
        <code title={t('资源 id')}>{st.resourceId}</code>
        <button type="button" className="quiet tiny" onClick={() => setFactionStats(f.id, (f.stats ?? []).filter((_, j) => j !== i))}>×</button>
      </div>)}
      <div className="faction-stat-add">{['兵力', '财富', '声望'].filter(l => !(f.stats ?? []).some(s => s.label === l)).map(l => {
        const rid = `${slug(f.id)}_${{ 兵力: 'troops', 财富: 'wealth', 声望: 'prestige' }[l]}`;
        return <button key={l} type="button" className="tiny" onClick={() => setFactionStats(f.id, [...(f.stats ?? []), { label: l, resourceId: rid }], { ...(w.resources ?? {}), [rid]: w.resources?.[rid] ?? 50 })}>+ {t(l)}</button>;
      })}</div>
    </div>)}</div>
  </div>;
}
