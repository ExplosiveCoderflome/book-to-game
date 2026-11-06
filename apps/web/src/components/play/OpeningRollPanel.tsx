import type { AdventureView, OpeningRollCommand, OpeningRollSet, WorldRevision } from '@novel-game/contracts';
import { Notice } from '../Notice';

type Props={session:AdventureView;revision:WorldRevision;busy:boolean;error?:string|null;onCommand:(command:OpeningRollCommand)=>void};
export function OpeningRollPanel({session,revision,busy,error,onCommand}:Props){
  const config=revision.content.openingRoll; const roll=session.openingRoll;
  if(!config?.enabled||!roll)return null;
  const tags=(set:OpeningRollSet)=>set.tags?.map(id=>config.tags.find(tag=>tag.id===id)).filter((tag):tag is NonNullable<typeof tag>=>!!tag)??[];
  const current=roll.selectedIndex===null?undefined:roll.history[roll.selectedIndex];
  const showSet=(set:OpeningRollSet, index:number, selectable:boolean)=>{
    const selected=roll.selectedIndex===index;
    return <section key={`${set.presetId??'roll'}-${index}`} className={`opening-roll-set${selected?' is-selected':''}`}>
      {selectable&&<button type="button" className="opening-roll-select" role="radio" aria-checked={selected} disabled={busy} onClick={()=>onCommand({command:'select',index})}>{selected?'已选':`第 ${index+1} 套`}</button>}
       <div className="play-stats-chart">{config.stats.map(stat=>{const value=set.values[stat.resourceId];const def=revision.content.resourceDefs?.[stat.resourceId];const label=def?.label??stat.resourceId;const max=def?.max??stat.max;const fill=max>stat.min&&value!==undefined?Math.max(0,Math.min(100,(value-stat.min)/(max-stat.min)*100)):0;
          return <div className="play-stats-item is-bar" key={stat.resourceId}><div className="play-stats-item-head"><span className="play-stats-name">{label}</span><span className="play-stats-value">{value===undefined?`${stat.min}–${stat.max}`:value}</span></div><div className="play-stats-meter" aria-hidden="true"><span className="play-stats-meter-fill" style={{width:`${fill}%`}}/></div></div>;
      })}</div>
      {set.tierLabel&&<strong className="opening-roll-tier">{set.tierLabel}</strong>}
      {set.verdict&&<p className="opening-roll-verdict">{set.verdict}</p>}
      {tags(set).length>0&&<div className="opening-roll-tags"><strong>命里带着</strong>{tags(set).map(tag=><p key={tag.id}><b>{tag.label}</b> — {tag.effect}</p>)}</div>}
    </section>;
  };
  return <section className="opening-roll" data-testid="opening-roll-panel" aria-labelledby="opening-roll-title">
    <h3 id="opening-roll-title">投胎</h3><p className="hint">掷一次定下你的起点。起点不决定结局。</p><Notice text={error??null}/>
    {roll.history.length===0?<div className="play-stats-chart">{config.stats.map(stat=><div className="play-stats-item is-bar" key={stat.resourceId}><div className="play-stats-item-head"><span className="play-stats-name">{revision.content.resourceDefs?.[stat.resourceId]?.label??stat.resourceId}</span><span className="play-stats-value">{stat.min}–{stat.max}</span></div><div className="play-stats-meter" aria-hidden="true"><span className="play-stats-meter-fill" style={{width:0}}/></div></div>)}</div>:null}
    {config.choice.kind==='pickOf'?<div className="opening-roll-options" role="radiogroup" aria-label="选择一套开局">{roll.history.map((set,index)=>showSet(set,index,true))}</div>:current&&showSet(current,roll.selectedIndex!,false)}
    {roll.history.length>1&&config.keepBest&&<details className="opening-roll-history"><summary>掷过的</summary>{roll.history.map((set,index)=><button type="button" key={index} disabled={busy} aria-current={roll.selectedIndex===index?'true':undefined} onClick={()=>onCommand({command:'select',index})}>第 {index+1} 次 · {set.tierLabel??set.presetId??'开局'}{tags(set).map(tag=>` · ${tag.label}`).join('')}{roll.selectedIndex===index?' · 当前':''}</button>)}</details>}
    <div className="opening-roll-actions">
      {roll.history.length===0&&<button type="button" disabled={busy} onClick={()=>onCommand({command:'roll'})}>掷</button>}
      {roll.history.length===0&&config.standard&&<button type="button" className="quiet" disabled={busy} onClick={()=>onCommand({command:'useStandard'})}>用标准开局</button>}
      {current||config.choice.kind==='pickOf'&&roll.selectedIndex!==null?<button type="button" className="primary" disabled={busy||roll.selectedIndex===null} onClick={()=>onCommand({command:'confirm'})}>{busy?'正在开局…':'就这样，开局'}</button>:null}
      {roll.history.length>0&&roll.rerollsLeft>0&&<button type="button" disabled={busy} onClick={()=>onCommand({command:'reroll'})}>重掷（剩 {roll.rerollsLeft}）</button>}
      {roll.history.length>0&&roll.rerollsLeft===0&&<p className="hint">重掷次数已用完。可以从掷过的里选一套，或就这样开局。</p>}
    </div>
  </section>;
}
