import type { ModelSettingsFields } from './model-settings-form';

export type ModelProviderPresetId =
  | 'custom'
  | 'openai'
  | 'deepseek'
  | 'aliyun'
  | 'siliconflow'
  | 'moonshot'
  | 'openrouter'
  | 'mistral'
  | 'xfyun'
  | 'ollama'
  | 'lmstudio';

export interface ModelProviderPreset {
  id: ModelProviderPresetId;
  label: string;
  baseUrl: string;
  model?: string;
  hint?: string;
}

/**
 * These are OpenAI-compatible entry points only. Model IDs normally remain
 * manual because provider catalogues change; task-specific presets may pin one.
 */
export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {id: 'custom', label: '自定义 / 本地服务', baseUrl: ''},
  {id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1'},
  {id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com'},
  {id: 'aliyun', label: '阿里云百炼（Qwen）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    hint: '阿里云业务空间可替换为地域专属兼容地址。'},
  {id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1'},
  {id: 'moonshot', label: '月之暗面 / Kimi', baseUrl: 'https://api.moonshot.cn/v1'},
  {id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1'},
  {id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1'},
  {id: 'xfyun', label: '讯飞星火', baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v1', model: 'spark-x2.6',
    hint: '已验证 Chat Completions 与原生工具调用；环境初始配置可直接使用 XFYUN_API_KEY。'},
  {id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://127.0.0.1:11434/v1'},
  {id: 'lmstudio', label: 'LM Studio（本地）', baseUrl: 'http://127.0.0.1:1234/v1'},
];

export function providerPresetForBaseUrl(baseUrl: string): ModelProviderPresetId {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return MODEL_PROVIDER_PRESETS.find(preset => preset.baseUrl && preset.baseUrl.replace(/\/+$/, '') === normalized)?.id ?? 'custom';
}

export function applyProviderPreset(fields: ModelSettingsFields, presetId: ModelProviderPresetId): ModelSettingsFields {
  const preset = MODEL_PROVIDER_PRESETS.find(candidate => candidate.id === presetId);
  if (!preset || preset.id === 'custom') return {...fields, baseUrl: '', model: ''};
  return {...fields, baseUrl: preset.baseUrl, model: preset.model ?? '', clearApiKey: false};
}
