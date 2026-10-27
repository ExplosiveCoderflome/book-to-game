import { FACTION_STANCES, type FactionStance, type WorldCondition, type WorldContent, type WorldEffect } from '@novel-game/contracts';
import { STANCE_LABEL, worldConditionKinds, worldEffectKinds, worldFactions } from '@novel-game/rules';
import { useI18n } from '../lib/i18n';

type Action = WorldContent['actions'][number];
type Slot = 'availableWhen' | 'requires';

/** Default condition per kind — kinds come from the registry; params are authored here. */
function defaultCondition(kind: string, w: WorldContent): WorldCondition | null {
  const fact = w.facts[0]?.id ?? 'fact'; const npc = w.npcs[0]?.id ?? 'npc';
  switch (kind) {
    case 'fact': return { kind, factId: fact, value: true };
    case 'known': return { kind, factId: fact };
    case 'npc_knows': return { kind, npcId: npc, factId: fact };
    case 'time': return { kind, atLeast: 1 };
    case 'at_terrain': return { kind, terrainIds: [w.map?.layers?.terrain?.palette[0]?.id ?? 'terrain'] };
    case 'in_faction_territory': return { kind, factionIds: [w.map?.layers?.factions?.factions[0]?.id ?? 'faction'] };
    case 'in_region': return { kind, regionIds: [w.map?.layers?.regions?.regions[0]?.id ?? 'region'] };
    case 'faction_relation': { const f = worldFactions(w); return { kind, a: f[0]?.id ?? 'a', b: f[1]?.id ?? f[0]?.id ?? 'b', stances: ['hostile'] }; }
    case 'npc_at_location': return { kind, npcId: npc, locationId: w.locations[0]?.id ?? 'loc' };
    default: return null;
  }
}

/** Condition editor for world actions at one location. Kind list + labels come from worldConditionKinds. */
export function WorldActionRulesEditor({ content: w, locationId, onChange }: { content: WorldContent; locationId: string; onChange: (next: WorldContent) => void }) {
  const { t } = useI18n();
  const kinds = worldConditionKinds.list();
  const actions = w.actions.filter(a => a.locationId === locationId);
  const terrains = w.map?.layers?.terrain?.palette.map(p => ({ id: p.id, label: p.label, color: p.color })) ?? [];
  const factions = w.map?.layers?.factions?.factions.map(f => ({ id: f.id, label: f.name, color: f.color })) ?? [];
  const regions = w.map?.layers?.regions?.regions.map(r => ({ id: r.id, label: r.name, color: r.color })) ?? [];
  const allFactions = worldFactions(w);
  const factionSel = (value: string, onSet: (id: string) => void) => <select value={value} onChange={e => onSet(e.target.value)}>
    {!allFactions.some(f => f.id === value) && <option value={value}>{value}</option>}
    {allFactions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>;

  function setAction(id: string, patch: Partial<Action>) {
    onChange({ ...w, actions: w.actions.map(a => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function setRules(a: Action, slot: Slot, rules: WorldCondition[]) { setAction(a.id, { [slot]: rules } as Partial<Action>); }

  function idChips(selected: string[], options: { id: string; label: string; color: string }[], set: (ids: string[]) => void, empty: string) {
    if (!options.length) return <span className="hint">{empty}</span>;
    return <div className="wr-chips">{options.map(o => {
      const on = selected.includes(o.id);
      return <button key={o.id} type="button" className={`wr-chip${on ? ' on' : ''}`} onClick={() => {
        const next = on ? selected.filter(x => x !== o.id) : [...selected, o.id];
        if (next.length) set(next);
      }}><i style={{ background: o.color }} />{o.label}</button>;
    })}</div>;
  }

  function params(c: WorldCondition, set: (c: WorldCondition) => void) {
    const factSel = (value: string, onSet: (id: string) => void) => <select value={value} onChange={e => onSet(e.target.value)}>
      {!w.facts.some(f => f.id === value) && <option value={value}>{value}</option>}
      {w.facts.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select>;
    switch (c.kind) {
      case 'fact': return <>{factSel(c.factId, factId => set({ ...c, factId }))}
        <select value={String(c.value)} onChange={e => set({ ...c, value: e.target.value === 'true' })}><option value="true">{t('成立')}</option><option value="false">{t('不成立')}</option></select></>;
      case 'known': return factSel(c.factId, factId => set({ ...c, factId }));
      case 'npc_knows': return <><select value={c.npcId} onChange={e => set({ ...c, npcId: e.target.value })}>
        {w.npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select>{factSel(c.factId, factId => set({ ...c, factId }))}</>;
      case 'time': return <input type="number" min={0} max={100} value={c.atLeast} onChange={e => set({ ...c, atLeast: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />;
      case 'at_terrain': return idChips(c.terrainIds, terrains, terrainIds => set({ ...c, terrainIds }), t('地图没有地形图层'));
      case 'in_faction_territory': return idChips(c.factionIds, factions, factionIds => set({ ...c, factionIds }), t('地图没有势力图层'));
      case 'in_region': return idChips(c.regionIds, regions, regionIds => set({ ...c, regionIds }), t('地图没有区域图层'));
      case 'faction_relation': return <>{factionSel(c.a, a => set({ ...c, a }))}{factionSel(c.b, b => set({ ...c, b }))}
        <select value={c.stances?.[0] ?? ''} onChange={e => set({ ...c, stances: e.target.value ? [e.target.value as FactionStance] : undefined })}><option value="">{t('任意立场')}</option>{FACTION_STANCES.map(x => <option key={x} value={x}>{t(STANCE_LABEL[x])}</option>)}</select>
        <input type="number" placeholder="≥" title={t('好感至少')} value={c.atLeast ?? ''} onChange={e => set({ ...c, atLeast: e.target.value === '' ? undefined : Number(e.target.value) })} /></>;
      case 'npc_at_location': return <><select value={c.npcId} onChange={e => set({ ...c, npcId: e.target.value })}>{w.npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
        <select value={c.locationId} onChange={e => set({ ...c, locationId: e.target.value })}>{w.locations.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></>;
    }
  }

  function slotEditor(a: Action, slot: Slot) {
    const rules = a[slot];
    return <div className="wr-slot">
      <div className="wr-slot-head"><strong>{t(slot === 'availableWhen' ? '出现条件' : '执行条件')}</strong><span className="hint">{t('全部满足')}</span></div>
      {rules.map((c, i) => {
        const meta = worldConditionKinds.get(c.kind);
        return <div key={i} className="wr-row" data-testid={`wr-row-${a.id}-${slot}-${i}`}>
          <select className="wr-kind" value={c.kind} title={meta?.description} onChange={e => { const d = defaultCondition(e.target.value, w); if (d) setRules(a, slot, rules.map((r, j) => (j === i ? d : r))); }}>
            {kinds.map(k => <option key={k.kind} value={k.kind}>{t(k.label)}</option>)}
          </select>
          <div className="wr-params">{params(c, next => setRules(a, slot, rules.map((r, j) => (j === i ? next : r))))}</div>
          <button type="button" className="quiet tiny" title={t('删除')} onClick={() => setRules(a, slot, rules.filter((_, j) => j !== i))}>×</button>
          {meta && <p className="wr-desc">{t(meta.description)}</p>}
        </div>;
      })}
      <select className="wr-add" value="" data-testid={`wr-add-${a.id}-${slot}`} onChange={e => { const d = defaultCondition(e.target.value, w); if (d) setRules(a, slot, [...rules, d]); }}>
        <option value="">+ {t('添加条件…')}</option>
        {kinds.map(k => <option key={k.kind} value={k.kind}>{t(k.label)}</option>)}
      </select>
    </div>;
  }

  /** Map/world effects (territory + relations). Other effect kinds stay read-only chips here. */
  function effectEditor(a: Action) {
    const MAP_KINDS = ['set_territory', 'set_faction_relation'];
    const setEff = (effects: WorldEffect[]) => setAction(a.id, { effects });
    const def = (kind: string): WorldEffect | null => kind === 'set_territory'
      ? { kind, factionId: allFactions[0]?.id ?? null, regionId: regions[0]?.id, ...(regions[0] ? {} : { cells: [w.map?.pois.find(p => p.locationId === a.locationId)?.anchor.cell ?? '0,0'] }) }
      : kind === 'set_faction_relation' ? { kind, a: allFactions[0]?.id ?? 'a', b: allFactions[1]?.id ?? 'b', standingDelta: -20 } : null;
    return <div className="wr-slot">
      <div className="wr-slot-head"><strong>{t('执行效果')}</strong><span className="hint">{a.effects.filter(e => !MAP_KINDS.includes(e.kind)).map(e => t(worldEffectKinds.get(e.kind)?.label ?? e.kind)).join(' · ')}</span></div>
      {a.effects.map((e, i) => {
        if (e.kind !== 'set_territory' && e.kind !== 'set_faction_relation') return null;
        const put = (n: WorldEffect) => setEff(a.effects.map((x, j) => j === i ? n : x));
        return <div key={i} className="wr-row" data-testid={`wr-eff-${a.id}-${i}`}>
          <span className="wr-kind">{t(worldEffectKinds.get(e.kind)?.label ?? e.kind)}</span>
          <div className="wr-params">{e.kind === 'set_territory' ? <>
            <select value={e.regionId ?? ''} onChange={ev => put({ ...e, regionId: ev.target.value || undefined, cells: ev.target.value ? undefined : e.cells?.length ? e.cells : [w.map?.pois.find(p => p.locationId === a.locationId)?.anchor.cell ?? '0,0'] })}>
              <option value="">{t('此地所在格')}</option>{regions.map(r => <option key={r.id} value={r.id}>{t('区域')}·{r.label}</option>)}</select>
            <span>→</span>
            <select value={e.factionId ?? ''} onChange={ev => put({ ...e, factionId: ev.target.value || null })}><option value="">{t('无主')}</option>{allFactions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </> : <>
            {factionSel(e.a, x => put({ ...e, a: x }))}{factionSel(e.b, x => put({ ...e, b: x }))}
            <select value={e.stance ?? ''} onChange={ev => put({ ...e, stance: (ev.target.value || undefined) as FactionStance | undefined })}><option value="">{t('立场不变')}</option>{FACTION_STANCES.map(x => <option key={x} value={x}>{t(STANCE_LABEL[x])}</option>)}</select>
            <input type="number" title={t('好感增减')} value={e.standingDelta ?? 0} onChange={ev => put({ ...e, standingDelta: Number(ev.target.value) || undefined })} />
          </>}</div>
          <button type="button" className="quiet tiny" onClick={() => setEff(a.effects.filter((_, j) => j !== i))}>×</button>
        </div>;
      })}
      {allFactions.length > 0 && <select className="wr-add" value="" data-testid={`wr-add-eff-${a.id}`} onChange={ev => { const d = def(ev.target.value); if (d) setEff([...a.effects, d]); }}>
        <option value="">+ {t('添加地图效果…')}</option>{MAP_KINDS.map(k => <option key={k} value={k}>{t(worldEffectKinds.get(k)?.label ?? k)}</option>)}</select>}
    </div>;
  }

  if (!actions.length) return null;
  return <div className="world-rules" data-testid="world-action-rules">
    <p className="world-map-tray-label">{t('此地行动条件')} · {actions.length}</p>
    {actions.map(a => <details key={a.id} className="wr-action" open={a.availableWhen.length + a.requires.length > 0}>
      <summary><span>{a.label}</span><span className="wr-count">{a.availableWhen.length + a.requires.length}</span></summary>
      {slotEditor(a, 'availableWhen')}
      {slotEditor(a, 'requires')}
      {effectEditor(a)}
    </details>)}
  </div>;
}
