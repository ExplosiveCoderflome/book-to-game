import { useEffect, useState } from 'react';
import type { ModelConnectionResult, ModelSettingsView } from '@novel-game/contracts';
import { errorMessage, request } from '../lib/api';
import { settingsInput, type ModelSettingsFields } from '../lib/model-settings-form';
import { Notice } from './Notice';
import './ModelSettingsPanel.css';

interface Props {token: string; onSaved: () => Promise<void>}
export function ModelSettingsPanel({token, onSaved}: Props) {
  const [saved, setSaved] = useState<ModelSettingsView | null>(null);
  const [fields, setFields] = useState<ModelSettingsFields>({baseUrl: '', model: '', timeoutSeconds: '90', apiKey: '', clearApiKey: false});
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<ModelConnectionResult | null>(null);
  const [reload, setReload] = useState(0);
  const accept = (value: ModelSettingsView) => {
    setSaved(value);
    setFields({baseUrl: value.baseUrl, model: value.model, timeoutSeconds: String(value.timeoutMs / 1000), apiKey: '', clearApiKey: false});
  };
  useEffect(() => {
    let active = true; setBusy('load'); setError(null); setMessage(null); setProbe(null);
    request<ModelSettingsView>(token, '/settings/model').then(value => {if (active) accept(value);})
      .catch(e => {if (active) setError(errorMessage(e));}).finally(() => {if (active) setBusy(null);});
    return () => {active = false;};
  }, [token, reload]);
  function change<K extends keyof ModelSettingsFields>(key: K, value: ModelSettingsFields[K]) {
    setFields(previous => ({...previous, [key]: value})); setMessage(null); setProbe(null);
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
  return <section className="work-section">
    <div className="section-heading"><div><p className="eyebrow">SETTINGS / 模型设置</p>
      <h2>为故事接上创作引擎</h2><p>在这里设置模型服务，保存后即可回到“改编生成”。</p></div></div>
    <div className="model-settings-layout">
      <form className="panel stack" onSubmit={event => {event.preventDefault(); void operate('save');}}>
        <div className="panel-heading"><h3>生成模型</h3><span className="hint">{saved?.source === 'workspace' ? `工作台配置 · v${saved.revision}` : '尚未在工作台保存配置'}</span></div>
        <Notice text={error} /><Notice kind="success" text={message} />
        {probe && <Notice kind={probe.modelAvailable ? 'success' : 'info'} text={probe.message} />}
        {busy === 'load' ? <p role="status">正在读取模型配置…</p> : !saved ?
          <button type="button" onClick={() => setReload(n => n + 1)}>重新读取</button> : <>
          {saved.source === 'environment' && saved.configured && <p className="hint">当前使用启动环境配置；在这里保存后，以工作台配置为准。</p>}
          <fieldset className="model-settings-fields" disabled={busy !== null}>
            <label>模型服务地址<input type="url" required maxLength={2000} value={fields.baseUrl}
              onChange={event => change('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" /></label>
            <p className="hint">填写支持 OpenAI 兼容接口的基础地址，通常包含 /v1，不需要附加 /chat/completions。</p>
            <label>模型名称<input required maxLength={200} value={fields.model} onChange={event => change('model', event.target.value)} placeholder="填写服务商提供的模型 ID" /></label>
            <label>模型 API Key<input type="password" autoComplete="new-password" maxLength={8192}
              value={fields.apiKey} disabled={fields.clearApiKey} onChange={event => change('apiKey', event.target.value)}
              placeholder={saved.hasApiKey ? '已保存密钥；留空保持不变' : '填写模型服务商的 API Key'} /></label>
            <p className="hint">{saved.hasApiKey ? '已保存 API Key，原值不会回传到页面。' : '尚未保存 API Key；本机无鉴权模型服务可留空。'} 模型密钥只保存在本地服务端，不写入浏览器存储。</p>
            {saved.hasApiKey && <label className="model-key-clear"><input type="checkbox" checked={fields.clearApiKey}
              onChange={event => {change('clearApiKey', event.target.checked); if (event.target.checked) change('apiKey', '');}} />保存时清除已有模型 API Key</label>}
            <label>请求超时（秒）<input type="number" min="1" max="300" step="1" required
              value={fields.timeoutSeconds} onChange={event => change('timeoutSeconds', event.target.value)} /></label>
            <div className="actions"><button className="primary" type="submit">{busy === 'save' ? '正在保存…' : '保存模型配置'}</button>
              <button type="button" onClick={() => void operate('test')}>{busy === 'test' ? '正在测试…' : '测试连接'}</button>
              <button type="button" className="quiet" onClick={() => setReload(n => n + 1)}>重新载入已保存配置</button></div>
          </fieldset>
          <p className="hint">测试连接不会保存表单，也不调用文本生成。正在执行的任务沿用开始时的配置；后续执行和重试读取新配置。</p>
        </>}
      </form>
      <aside className="panel stack model-key-explanation"><p className="eyebrow">两种凭据，各有用途</p>
        <h3>模型 API Key</h3><p>由模型服务商提供，用于让本地后端调用你的模型服务。分析和生成时，正文会发送给这里指定的模型服务。</p>
        <div className="divider" /><h3>工作台访问码</h3><p>用于进入这个本地工作台，以及允许外部 Agent 通过 MCP 控制项目。它由本项目生成，与模型服务商无关。</p>
        <p className="hint">登录页使用的是 data/access-token.txt 中的工作台访问码，不是这里的模型 API Key。</p>
      </aside>
    </div>
  </section>;
}
