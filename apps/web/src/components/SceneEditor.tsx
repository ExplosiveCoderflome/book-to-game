import type { Choice, Scene, VariableValue } from '@novel-game/contracts';
import { useI18n } from '../lib/i18n';
import { ChoiceRulesEditor } from './ChoiceRulesEditor';

export function SceneEditor({ scene, scenes, variables = {}, update, remove, onFillText, fillBusy }: {
  scene: Scene;
  scenes: Scene[];
  variables?: Record<string, VariableValue>;
  update: (value: Scene) => void;
  remove: () => void;
  onFillText?: () => void;
  fillBusy?: boolean;
}) {
  const { t } = useI18n();
  const updateChoice = (index: number, value: Choice) => update({ ...scene, choices: scene.choices.map((choice, i) => i === index ? value : choice) });
  return <div className="scene-editor stack">
    <div className="panel-heading"><h4>{t('场景内容')}</h4><button type="button" className="quiet danger small" onClick={remove}>{t('删除场景')}</button></div>
    <div className="field-row"><label>{t('场景 ID')}<input value={scene.id} maxLength={80} onChange={e => update({ ...scene, id: e.target.value })} /></label><label>{t('标题')}<input value={scene.title} maxLength={200} onChange={e => update({ ...scene, title: e.target.value })} /></label></div>
    <label>{t('叙事正文')}<textarea className="story-input" rows={9} maxLength={12000} value={scene.text} onChange={e => update({ ...scene, text: e.target.value })} /></label>
    {onFillText && (
      <div className="fill-scene-row" data-testid="fill-scene-row">
        <button type="button" className="small primary" data-testid="fill-scene-text" disabled={!!fillBusy} onClick={() => { if (!fillBusy) onFillText(); }}>
          {t(fillBusy ? '补全文中…' : '补全文')}
        </button>
        <span className="hint">{t('用模型加深本场景正文，不改选项与连线；结果写入本地未保存编辑。')}</span>
      </div>
    )}
    <div className="field-row"><label>{t('内容来源')}<select value={scene.origin} onChange={e => update({ ...scene, origin: e.target.value as Scene['origin'] })}><option value="source">{t('依据原作')}</option><option value="adapted">{t('改编新增')}</option></select></label><label>{t('结局描述（仅结局场景）')}<input value={scene.ending ?? ''} maxLength={1000} onChange={e => update({ ...scene, ending: e.target.value || undefined })} placeholder={t('留空表示尚未结束')} /></label></div>
    <fieldset><legend>{t('原文证据')}</legend><p className="hint">{t('从原文预览中复制章节与段落 ID；原作场景须关联真实证据。')}</p>
      {scene.evidence.map((item, index) => <div className="evidence-row" key={index}><label>{t('章节 ID')}<input value={item.chapterId} onChange={e => update({ ...scene, evidence: scene.evidence.map((v, i) => i === index ? { ...v, chapterId: e.target.value } : v) })} /></label><label>{t('段落 ID')}<input value={item.paragraphId} onChange={e => update({ ...scene, evidence: scene.evidence.map((v, i) => i === index ? { ...v, paragraphId: e.target.value } : v) })} /></label><button type="button" className="quiet small" aria-label={t('移除证据 {index}', { index: index + 1 })} onClick={() => update({ ...scene, evidence: scene.evidence.filter((_, i) => i !== index) })}>{t('移除')}</button></div>)}
      <button type="button" className="small" disabled={scene.evidence.length >= 30} onClick={() => update({ ...scene, evidence: [...scene.evidence, { chapterId: '', paragraphId: '' }] })}>{t('＋ 添加证据')}</button>
    </fieldset>
    <fieldset><legend>{t('读者选择')}</legend>{scene.choices.length === 0 && <p className="hint">{t('此场景暂时没有选项。结局场景应填写结局描述。')}</p>}
      {scene.choices.map((choice, index) => <div className="choice-editor stack" key={index}>
        <div className="field-row"><label>{t('选项 ID')}<input maxLength={80} value={choice.id} onChange={e => updateChoice(index, { ...choice, id: e.target.value })} /></label><label>{t('前往场景')}<select value={choice.targetSceneId} onChange={e => updateChoice(index, { ...choice, targetSceneId: e.target.value })}><option value="">{t('选择目标场景')}</option>{!scenes.some(s => s.id === choice.targetSceneId) && choice.targetSceneId && <option value={choice.targetSceneId}>{t('{name}（不存在）', { name: choice.targetSceneId })}</option>}{scenes.map((s, i) => <option key={i} value={s.id}>{s.title || s.id}</option>)}</select></label></div>
        <label>{t('选择文案')}<input maxLength={300} value={choice.label} onChange={e => updateChoice(index, { ...choice, label: e.target.value })} /></label>
        <ChoiceRulesEditor choice={choice} variables={variables} update={value => updateChoice(index, value)} />
        <button type="button" className="quiet small danger" onClick={() => update({ ...scene, choices: scene.choices.filter((_, i) => i !== index) })}>{t('移除选项')}</button>
      </div>)}
      <button type="button" className="small" disabled={scene.choices.length >= 8} onClick={() => update({ ...scene, choices: [...scene.choices, { id: `choice-${crypto.randomUUID().slice(0, 8)}`, label: '', targetSceneId: '' }] })}>{t('＋ 添加选择')}</button>
    </fieldset>
  </div>;
}
