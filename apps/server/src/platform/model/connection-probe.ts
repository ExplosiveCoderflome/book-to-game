import type { ModelConnectionResult, ModelListResult } from '@novel-game/contracts';
import type { ProviderConfiguration } from '../../modules/model-settings/index.js';
import { AppError } from '../../shared/errors.js';

export class ModelConnectionProbe {
  async list(config: ProviderConfiguration): Promise<ModelListResult> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/models`, {method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10000)),
        headers: config.apiKey ? {Authorization: `Bearer ${config.apiKey}`} : {}});
    } catch {throw new AppError('MODEL_CONNECTION_FAILED', '连接失败或超时，请检查模型服务地址与网络', 502);}
    if (!response.ok) {
      await response.body?.cancel();
      const hint = response.status === 401 || response.status === 403
        ? (config.apiKey ? '当前 API Key 无效或没有访问模型列表的权限。' : '当前没有提供 API Key；请填写模型服务商的 API Key。')
        : response.status === 404 || response.status === 405 ? '该服务可能不支持 /models 检查；仍可保存配置后尝试生成。' : '请检查服务地址、API Key 和访问权限。';
      throw new AppError('MODEL_CONNECTION_FAILED', `模型服务返回 HTTP ${response.status}。${hint}`, 502);
    }
    let parsed: {data?: {id?: string}[]};
    try {
      const reader = response.body?.getReader(); if (!reader) throw new Error('empty');
      const parts: Uint8Array[] = []; let size = 0;
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1024 * 1024) {await reader.cancel(); throw new Error('too large');}
        parts.push(value);
      }
      parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!Array.isArray(parsed?.data)) throw new Error('invalid');
    } catch {throw new AppError('MODEL_CONNECTION_FAILED', '模型服务未返回有效的模型列表；可保存后尝试生成以检查兼容性', 502);}
    const models = [...new Set(parsed.data!.map(item => item?.id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    return {models, message: '模型列表获取成功，共 {count} 个模型。'};
  }

  async test(config: ProviderConfiguration): Promise<ModelConnectionResult> {
    const listed = await this.list(config);
    const available = listed.models.includes(config.model);
    return {reachable: true, modelAvailable: available, models: listed.models,
      message: available ? '连接成功，模型列表包含所选模型。尚未测试实际生成与 JSON 输出。' : '连接成功，但列表未包含该模型名称。部分服务不列出全部模型，请核对名称。'};
  }
}
