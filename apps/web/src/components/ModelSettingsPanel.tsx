import { useI18n } from '../lib/i18n';
import { useEffect, useState } from 'react';
import type { ModelConnectionResult, ModelListResult, ModelSettingsView } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { modelListInput, settingsInput, type ModelSettingsFields } from '../lib/model-settings-form';
import { applyProviderPreset, MODEL_PROVIDER_PRESETS, providerPresetForBaseUrl, type ModelProviderPresetId } from '../lib/model-provider-presets';
import { Notice } from './Notice';
import './ModelSettingsPanel.css';

interface Props {token: string; onSaved: () => Promise<void>}
export function ModelSettingsPanel({token, onSaved}: Props) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<ModelSettingsView | null>(null);
  const [fields, setFields] = useState<ModelSettingsFields>({baseUrl: '', model: '', timeoutSeconds: '90', apiKey: '', clearApiKey: false});
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'models' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<ModelConnectionResult | null>(null);
  const [modelList, setModelList] = useState<ModelListResult | null>(null);
  const [manualModel, setManualModel] = useState(false);
  const [providerPreset, setProviderPreset] = useState<ModelProviderPresetId>('custom');
  const [reload, setReload] = useState(0);
  const accept = (value: ModelSettingsView) => {
    setSaved(value);
    setFields({baseUrl: value.baseUrl, model: value.model, timeoutSeconds: String(value.timeoutMs / 1000), apiKey: '', clearApiKey: false});
    setManualModel(false);
    setProviderPreset(providerPresetForBaseUrl(value.baseUrl));
  };
  useEffect(() => {
    let active = true; setBusy('load'); setError(null); setMessage(null); setProbe(null); setModelList(null); setManualModel(false);
    request<ModelSettingsView>(token, '/settings/model').then(value => {if (active) accept(value);})
      .catch(e => {if (active) setError(errorMessage(e));}).finally(() => {if (active) setBusy(null);});
    return () => {active = false;};
  }, [token, reload]);
  function change<K extends keyof ModelSettingsFields>(key: K, value: ModelSettingsFields[K]) {
    setFields(previous => ({...previous, [key]: value})); setMessage(null); setProbe(null);
    if (key === 'baseUrl') setProviderPreset('custom');
    if (key !== 'model') {setModelList(null); setManualModel(false);}
  }
  function chooseProvider(id: ModelProviderPresetId) {
    setProviderPreset(id);
    setFields(previous => applyProviderPreset(previous, id));
    setModelList(null); setManualModel(false); setMessage(null); setProbe(null); setError(null);
  }
  async function fetchModels() {
    if (!saved) return;
    setError(null); setMessage(null); setProbe(null); setModelList(null); setBusy('models');
    try {
      const result = await request<ModelListResult>(token, '/settings/model/models', 'POST', modelListInput(fields, saved.revision));
      setModelList(result);
      const currentModel = fields.model.trim();
      const selected = result.models.includes(currentModel);
      setManualModel(Boolean(currentModel && !selected));
      if (!currentModel && result.models[0]) setFields(previous => ({...previous, model: result.models[0]}));
    } catch (e) {
      const issues = (e as {issues?: {message: string}[]})?.issues;
      setError(issues ? issues.map(i => i.message).join('；') : errorMessage(e));
    } finally {setBusy(null);}
  }
  async function operate(action: 'save' | 'test') {
    if (!saved) return;
    setError(null); setMessage(null); setProbe(null);
    try {
      const input = settingsInput(fields, saved.revision); setBusy(action);
      if (action === 'test') {
        setProbe(await request<ModelConnectionResult>(token, '/settings/model/test', 'POST', input));
      } else {
        accept(await request<ModelSettingsView>(token, '/settings/model', 'PUT', input));
        setMessage('模型配置已保存，新执行的任务直接生效，无需重启。');
        await onSaved();
      }
    } catch (e) {
      const issues = (e as {issues?: {message: string}[]})?.issues;
      setError(issues ? issues.map(i => i.message).join('；') : errorMessage(e));
    } finally {setBusy(null);}
  }
  const selectedPreset = MODEL_PROVIDER_PRESETS.find(preset => preset.id === providerPreset);
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">{t("SETTINGS / 模型设置")}</p>
      <h2>{t("为故事接上创作引擎")}</h2><p>{t("在这里设置模型服务，保存后即可回到“改编生成”。")}</p></div></div>
    <div className="model-settings-layout">
      <form className="panel stack" onSubmit={event => {event.preventDefault(); void operate('save');}}>
        <div className="panel-heading"><h3>{t("生成模型")}</h3><span className="hint">{saved?.source === 'workspace' ? t('工作台配置 · v{version}', {version: saved.revision}) : t("尚未在工作台保存配置")}</span></div>
        <Notice text={error} /><Notice kind="success" text={message} />
        {probe && <Notice kind={probe.modelAvailable ? 'success' : 'info'} text={probe.message} />}
        {modelList && <Notice kind="success" text={t(modelList.message, {count: modelList.models.length})} />}
        {busy === 'load' ? <p role="status">{t("正在读取模型配置…")}</p> : !saved ?
          <button type="button" onClick={() => setReload(n => n + 1)}>{t("重新读取")}</button> : <>
          {saved.source === 'environment' && saved.configured && <p className="hint">{t("当前使用启动环境配置；在这里保存后，以工作台配置为准。")}</p>}
          <fieldset className="model-settings-fields" disabled={busy !== null}>
            <label>{t("常用服务商")}<select aria-label={t("常用服务商")} value={providerPreset} onChange={event => chooseProvider(event.target.value as ModelProviderPresetId)}>
              {MODEL_PROVIDER_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{t(preset.label)}</option>)}
            </select></label>
            <p className="hint">{t("预置只填写 OpenAI 兼容接口地址，不会填入或覆盖 API Key；选择后请获取模型列表。")}</p>
            {selectedPreset?.hint && <p className="hint">{t(selectedPreset.hint)}</p>}
            {saved.hasApiKey && providerPreset !== providerPresetForBaseUrl(saved.baseUrl) && <p className="hint">{t("切换模型服务商后，保存时需要重新填写新的 API Key，或明确清除旧 Key。")}</p>}
            <label>{t("模型服务地址")}<input type="url" required maxLength={2000} value={fields.baseUrl}
              onChange={event => change('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" /></label>
            <p className="hint">{t("填写支持 OpenAI 兼容接口的基础地址，通常包含 /v1，不需要附加 /chat/completions。")}</p>
            <div className="model-field-row"><label>{t("模型名称")}{modelList?.models.length && !manualModel ? <select required value={fields.model} onChange={event => {setFields(previous => ({...previous, model: event.target.value})); setMessage(null); setProbe(null);}}>{modelList.models.map(model => <option key={model} value={model}>{model}</option>)}</select> : <input required list="available-models" maxLength={200} value={fields.model} onChange={event => change('model', event.target.value)} placeholder={t("先获取列表或填写服务商提供的模型 ID")} />}</label>
              <button type="button" className="quiet model-list-button" onClick={() => void fetchModels()}>{busy === 'models' ? t("正在获取…") : t("获取模型列表")}</button>
            </div><datalist id="available-models">{modelList?.models.map(model => <option key={model} value={model} />)}</datalist>
            {modelList?.models.length ? <button type="button" className="quiet model-manual-button" onClick={() => {
              if (manualModel) {setManualModel(false); setFields(previous => ({...previous, model: modelList.models[0]}));}
              else setManualModel(true);
            }}>{manualModel ? t("从模型列表选择") : t("手动填写其他模型")}</button> : null}
            <p className="hint">{t("优先获取服务端模型列表；如果服务不支持 /models，仍可手动填写模型 ID。")}</p>
            <label>{t("模型 API Key")}<input type="password" autoComplete="new-password" maxLength={8192}
              value={fields.apiKey} disabled={fields.clearApiKey} onChange={event => change('apiKey', event.target.value)}
              placeholder={saved.hasApiKey ? t("已保存密钥；留空保持不变") : t("填写模型服务商的 API Key")} /></label>
            <p className="hint">{saved.hasApiKey ? t("已保存 API Key，原值不会回传到页面。") : t("尚未保存 API Key；本机无鉴权模型服务可留空。")} {t('模型密钥只保存在本地服务端，不写入浏览器存储。')}</p>
            {saved.hasApiKey && <label className="model-key-clear"><input type="checkbox" checked={fields.clearApiKey}
              onChange={event => {change('clearApiKey', event.target.checked); if (event.target.checked) change('apiKey', '');}} />{t("保存时清除已有模型 API Key")}</label>}
            <label>{t("请求超时（秒）")}<input type="number" min="1" max="300" step="1" required
              value={fields.timeoutSeconds} onChange={event => change('timeoutSeconds', event.target.value)} /></label>
            <div className="actions"><button className="primary" type="submit">{busy === 'save' ? t("正在保存…") : t("保存模型配置")}</button>
              <button type="button" onClick={() => void operate('test')}>{busy === 'test' ? t("正在测试…") : t("测试连接")}</button>
              <button type="button" className="quiet" onClick={() => setReload(n => n + 1)}>{t("重新载入已保存配置")}</button></div>
          </fieldset>
          <p className="hint">{t("测试连接不会保存表单，也不调用文本生成。正在执行的任务沿用开始时的配置；后续执行和重试读取新配置。")}</p>
        </>}
      </form>
      <aside className="panel stack model-key-explanation"><p className="eyebrow">{t("两种凭据，各有用途")}</p>
        <h3>{t("模型 API Key")}</h3><p>{t("由模型服务商提供，用于让本地后端调用你的模型服务。分析和生成时，正文会发送给这里指定的模型服务。")}</p>
        <div className="divider" /><h3>{t("MCP 工作台访问码")}</h3><p>{t("仅用于外部 Agent 通过 MCP 控制项目。浏览器中的本地 Web 工作台通过本机来源校验访问，不需要输入访问码。")}</p>
        <p className="hint">{t("访问码来自 data/access-token.txt，与这里的模型 API Key 无关。")}</p>
      </aside>
    </div>
  </section>;
}
