import type { WorldContent, WorldCondition, WorldEffect } from '@novel-game/contracts';

export function WorldOverview({content: w}: {content: WorldContent}) {
  const fact = (id: string) => w.facts.find(f => f.id === id)?.label ?? id;
  const npc = (id: string) => w.npcs.find(n => n.id === id)?.name ?? id;
  const location = (id: string) => w.locations.find(l => l.id === id)?.title ?? id;
  const condition = (c: WorldCondition): string => c.kind === 'time' ? `耗时至少 ${c.atLeast}` : c.kind === 'npc_knows' ? `${npc(c.npcId)}知道「${fact(c.factId)}」` : c.kind === 'known' ? `玩家知道「${fact(c.factId)}」` : `「${fact(c.factId)}」${c.value ? '成立' : '不成立'}`;
  const effect = (e: WorldEffect): string => e.kind === 'move' ? `玩家前往${location(e.locationId)}` : e.kind === 'npc_move' ? `${npc(e.npcId)}前往${location(e.locationId)}` : e.kind === 'npc_learn' ? `${npc(e.npcId)}获知「${fact(e.factId)}」` : e.kind === 'reveal' ? `向玩家揭示「${fact(e.factId)}」` : `「${fact(e.factId)}」变为${e.value ? '成立' : '不成立'}`;
  const provenance = (v: {origin: 'source' | 'adapted'; evidence: {chapterId: string; paragraphId: string}[]}) => <div className="hint">{v.origin === 'source' ? '依据原作' : '改编新增'} · {v.evidence.length} 处证据{v.evidence.length > 0 && <details><summary>证据标识</summary>{v.evidence.map((e, i) => <div key={i}><code>{e.chapterId} / {e.paragraphId}</code></div>)}</details>}</div>;
  return <div className="world-overview">
    <p className="hint">作者审阅包含私有知识、事件条件与后果；试玩仅显示角色已知内容。</p>
    <details open><summary>地点 · {w.locations.length}</summary><div className="world-grid">{w.locations.map(l => <article key={l.id}><h4>{l.title}{l.id === w.initialLocationId ? ' · 开局' : ''}</h4><p>{l.text}</p>{provenance(l)}</article>)}</div></details>
    <details><summary>事实与线索 · {w.facts.length}</summary>{w.facts.map(f => <article key={f.id}><h4>{f.label} · {({clue: '线索', item: '物品', relationship: '关系', event: '事件'})[f.kind]}</h4><p>{f.description}</p><p className="hint">初始{f.initialValue ? '成立' : '不成立'} · 玩家初始{f.playerKnown ? '已知' : '未知'}</p>{provenance(f)}</article>)}</details>
    <details><summary>人物 · {w.npcs.length}</summary>{w.npcs.map(n => <article key={n.id}><h4>{n.name} · {location(n.initialLocationId)}</h4><p>{n.description}</p><p>私有目标：{n.goal}</p><p>知道：{n.knownFactIds.map(fact).join('、') || '暂无'}</p>{provenance(n)}</article>)}</details>
    <details open><summary>行动 · {w.actions.length}</summary>{w.actions.map(a => <article key={a.id}><h4>{a.label} · {location(a.locationId)}{a.npcId ? ` / ${npc(a.npcId)}` : ''}</h4><p>{a.description}</p><p className="hint">耗时 {a.timeCost} · {a.once ? '只能一次' : '可重复'} · 风险：{a.risk || '无特别提示'}</p><p>出现条件：{a.availableWhen.map(condition).join('，且') || '始终显示'}</p><p>执行条件：{a.requires.map(condition).join('，且') || '无额外条件'} · 阻止提示：{a.blockedReason}</p><p>后果：{a.effects.map(effect).join('；')}</p><p>{a.text}</p>{provenance(a)}</article>)}</details>
    <details><summary>事件 · {w.events.length}</summary>{w.events.map(e => <article key={e.id}><h4>{e.label} · {e.visibility === 'public' ? '公开' : '隐藏'}</h4><p>{e.when.map(condition).join('，且')}</p><p>{e.effects.map(effect).join('；')}</p><p>{e.text}</p></article>)}</details>
    <details><summary>结局 · {w.endings.length}</summary>{w.endings.map(e => <article key={e.id}><h4>{e.title}</h4><p>{e.when.map(condition).join('，且')}</p><p>{e.text}</p></article>)}<article><h4>超时结局</h4><p>{w.timeoutEnding}</p></article></details>
  </div>;
}
