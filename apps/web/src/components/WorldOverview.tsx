import type { WorldContent, WorldCondition, WorldEffect } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';

interface Props {
  content: WorldContent;
  /** When set, prioritize this location and its actions / NPCs in the floating inspector. */
  focusLocationId?: string;
}

export function WorldOverview({ content: w, focusLocationId }: Props) {
  const { t } = useI18n();
  const fact = (id: string) => w.facts.find(f => f.id === id)?.label ?? id;
  const npc = (id: string) => w.npcs.find(n => n.id === id)?.name ?? id;
  const location = (id: string) => w.locations.find(l => l.id === id)?.title ?? id;
  const truth = (value: boolean) => t(value ? '成立' : '不成立');
  const terrain = (id: string) => w.map?.layers?.terrain?.palette.find(p => p.id === id)?.label ?? id;
  const faction = (id: string) => w.map?.layers?.factions?.factions.find(f => f.id === id)?.name ?? id;
  const condition = (c: WorldCondition): string => c.kind === 'at_terrain' ? t('所在地形为 {list}', { list: c.terrainIds.map(terrain).join('/') })
    : c.kind === 'in_faction_territory' ? t('位于 {list} 领土', { list: c.factionIds.map(faction).join('/') })
    : c.kind === 'in_region' ? t('位于区域 {list}', { list: c.regionIds.map(id => w.map?.layers?.regions?.regions.find(r => r.id === id)?.name ?? id).join('/') })
    : c.kind === 'time' ? t('耗时至少 {time}', { time: c.atLeast })
    : c.kind === 'npc_knows' ? t('{npc}知道「{fact}」', { npc: npc(c.npcId), fact: fact(c.factId) })
    : c.kind === 'known' ? t('玩家知道「{fact}」', { fact: fact(c.factId) }) : t('「{fact}」{value}', { fact: fact(c.factId), value: truth(c.value) });
  const effect = (e: WorldEffect): string => e.kind === 'move' ? t('玩家前往{location}', { location: location(e.locationId) })
    : e.kind === 'npc_move' ? t('{npc}前往{location}', { npc: npc(e.npcId), location: location(e.locationId) })
    : e.kind === 'npc_learn' ? t('{npc}获知「{fact}」', { npc: npc(e.npcId), fact: fact(e.factId) })
    : e.kind === 'reveal' ? t('向玩家揭示「{fact}」', { fact: fact(e.factId) })
    : e.kind === 'resource' ? t('资源 {id} {delta}', { id: e.resourceId, delta: e.delta > 0 ? `+${e.delta}` : String(e.delta) })
    : t('「{fact}」变为{value}', { fact: fact(e.factId), value: truth(e.value) });
  const provenance = (v: { origin: 'source' | 'adapted'; evidence: { chapterId: string; paragraphId: string }[] }) => <div className="hint">{t(v.origin === 'source' ? '依据原作' : '改编新增')} · {t('{count} 处证据', { count: v.evidence.length })}{v.evidence.length > 0 && <details><summary>{t('证据标识')}</summary>{v.evidence.map((e, i) => <div key={i}><code>{e.chapterId} / {e.paragraphId}</code></div>)}</details>}</div>;

  const focus = focusLocationId ? w.locations.find(l => l.id === focusLocationId) : undefined;
  const focusActions = focus ? w.actions.filter(a => a.locationId === focus.id) : w.actions;
  const focusNpcs = focus ? w.npcs.filter(n => n.initialLocationId === focus.id) : w.npcs;
  const otherLocations = focus ? w.locations.filter(l => l.id !== focus.id) : w.locations;

  return <div className={`world-overview${focus ? ' focused' : ''}`} data-testid={focus ? 'world-location-inspector' : 'world-overview'}>
    <p className="hint">{t('作者审阅包含私有知识、事件条件与后果；试玩仅显示角色已知内容。')}</p>
    {focus && (
      <article className="world-focus-card" data-testid="world-focus-location">
        <h4>{focus.title}{focus.id === w.initialLocationId ? t(' · 开局') : ''}</h4>
        <p>{focus.text}</p>
        {provenance(focus)}
      </article>
    )}
    <details open={!!focus}><summary>{t(focus ? '此地行动' : '行动')} · {focusActions.length}</summary>{focusActions.map(a => <article key={a.id}><h4>{a.label}{!focus ? ` · ${location(a.locationId)}` : ''}{a.npcId ? ` / ${npc(a.npcId)}` : ''}</h4><p>{a.description}</p><p className="hint">{t('耗时 {time} · {repeat} · 风险：{risk}', { time: a.timeCost, repeat: t(a.once ? '只能一次' : '可重复'), risk: a.risk || t('无特别提示') })}</p><p>{t('出现条件：')}{a.availableWhen.map(condition).join(t('，且')) || t('始终显示')}</p><p>{t('执行条件：')}{a.requires.map(condition).join(t('，且')) || t('无额外条件')} · {t('阻止提示：')}{a.blockedReason}</p><p>{t('后果：')}{a.effects.map(effect).join(t('；'))}</p><p>{a.text}</p>{provenance(a)}</article>)}</details>
    <details open={!!focus && focusNpcs.length > 0}><summary>{t(focus ? '此地人物' : '人物')} · {focusNpcs.length}</summary>{focusNpcs.map(n => <article key={n.id}><h4>{n.name}{!focus ? ` · ${location(n.initialLocationId)}` : ''}</h4><p>{n.description}</p><p>{t('私有目标：')}{n.goal}</p><p>{t('知道：')}{n.knownFactIds.map(fact).join(t('、')) || t('暂无')}</p>{provenance(n)}</article>)}</details>
    {!focus && <details open><summary>{t('地点')} · {w.locations.length}</summary><div className="world-grid">{w.locations.map(l => <article key={l.id}><h4>{l.title}{l.id === w.initialLocationId ? t(' · 开局') : ''}</h4><p>{l.text}</p>{provenance(l)}</article>)}</div></details>}
    {focus && otherLocations.length > 0 && (
      <details><summary>{t('其他地点')} · {otherLocations.length}</summary><div className="world-grid">{otherLocations.map(l => <article key={l.id}><h4>{l.title}{l.id === w.initialLocationId ? t(' · 开局') : ''}</h4><p>{l.text}</p></article>)}</div></details>
    )}
    <details><summary>{t('事实与线索')} · {w.facts.length}</summary>{w.facts.map(f => <article key={f.id}><h4>{f.label} · {t(({ clue: '线索', item: '物品', relationship: '关系', event: '事件' })[f.kind])}</h4><p>{f.description}</p><p className="hint">{t('初始{value} · 玩家初始{knowledge}', { value: truth(f.initialValue), knowledge: t(f.playerKnown ? '已知' : '未知') })}</p>{provenance(f)}</article>)}</details>
    {!focus && <details><summary>{t('人物')} · {w.npcs.length}</summary>{w.npcs.map(n => <article key={n.id}><h4>{n.name} · {location(n.initialLocationId)}</h4><p>{n.description}</p><p>{t('私有目标：')}{n.goal}</p><p>{t('知道：')}{n.knownFactIds.map(fact).join(t('、')) || t('暂无')}</p>{provenance(n)}</article>)}</details>}
    <details><summary>{t('事件')} · {w.events.length}</summary>{w.events.map(e => <article key={e.id}><h4>{e.label} · {t(e.visibility === 'public' ? '公开' : '隐藏')}</h4><p>{e.when.map(condition).join(t('，且'))}</p><p>{e.effects.map(effect).join(t('；'))}</p><p>{e.text}</p></article>)}</details>
    <details><summary>{t('结局')} · {w.endings.length}</summary>{w.endings.map(e => <article key={e.id}><h4>{e.title}</h4><p>{e.when.map(condition).join(t('，且'))}</p><p>{e.text}</p></article>)}<article><h4>{t('超时结局')}</h4><p>{w.timeoutEnding}</p></article></details>
  </div>;
}
