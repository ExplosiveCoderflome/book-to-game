import { useState } from 'react';
import { demoGame } from '../lib/demo';
import { useI18n } from '../lib/i18n';

interface Props { onBack: () => void }
type Values = Record<string, string | number | boolean>;

function canChoose(choice: (typeof demoGame.scenes)[number]['choices'][number], values: Values): boolean {
  return (choice.conditions ?? []).every(condition => condition.type === 'variable.equals'
    ? values[condition.variable] === condition.value
    : Number(values[condition.variable]) >= condition.value);
}

export function DemoPreview({ onBack }: Props) {
  const { t } = useI18n();
  const [sceneId, setSceneId] = useState(demoGame.startSceneId);
  const [values, setValues] = useState<Values>({...demoGame.variables});
  const [history, setHistory] = useState<string[]>([]);
  const scene = demoGame.scenes.find(item => item.id === sceneId)!;

  function choose(choice: (typeof scene.choices)[number]) {
    if (!canChoose(choice, values)) return;
    const next = {...values};
    for (const effect of choice.effects ?? []) next[effect.variable] = effect.type === 'variable.increment' ? Number(next[effect.variable]) + effect.value : effect.value;
    setValues(next); setHistory(current => [...current, choice.label]); setSceneId(choice.targetSceneId);
  }

  function reset() { setSceneId(demoGame.startSceneId); setValues({...demoGame.variables}); setHistory([]); }

  return <section className="demo-page">
    <div className="demo-topbar"><button className="quiet" onClick={onBack}>← {t('返回连接')}</button><span className="eyebrow">{t('内置可玩示例 · 无需模型')}</span><button className="quiet" onClick={reset}>{t('重新开始')}</button></div>
    <div className="demo-heading"><p className="eyebrow">NOVEL → TEXT ADVENTURE</p><h1>{demoGame.title}</h1><p>{demoGame.premise}</p><div className="demo-badge">{t('这是一个三分钟体验：选择、后果、结局。')}</div></div>
    <div className="demo-layout"><aside className="panel demo-sidebar"><h3>{t('体验说明')}</h3><p>{t('这是项目内置的完整小故事。它不调用模型，用来先体验读者看到的成品。')}</p><div className="divider"/><h4>{t('已经发生')}</h4>{history.length ? <ol>{history.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol> : <p className="hint">{t('你的第一个选择会出现在这里。')}</p>}<div className="divider"/><h4>{t('故事状态')}</h4><dl className="demo-state">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></aside>
      <article className="panel demo-reader"><div className="reader-meta"><span>{demoGame.title}</span><span>{scene.ending ? t('结局') : t('第 {turn} 幕', {turn: history.length + 1})}</span></div><h2>{scene.title}</h2><div className="reader-text">{scene.text.split(/\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{scene.ending ? <div className="ending"><p className="eyebrow">{t('故事抵达了一个结局')}</p><h3>{scene.ending}</h3><p>{t('你可以重新开始，看看另一条路。')}</p></div> : <div className="reader-choices"><p className="eyebrow">{t('你将如何选择？')}</p>{scene.choices.filter(choice => canChoose(choice, values)).map((choice, index) => <button key={choice.id} onClick={() => choose(choice)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{choice.label}<span aria-hidden="true">→</span></button>)}</div>}</article></div>
    <div className="demo-next"><strong>{t('想把自己的小说变成这样的故事？')}</strong><span>{t('进入工作台后，可以导入原文、编辑分支、校验并发布。')}</span><button className="primary" onClick={onBack}>{t('进入工作台 →')}</button></div>
  </section>;
}
