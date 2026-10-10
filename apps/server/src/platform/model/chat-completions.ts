import { analysisSchema, gameContentSchema, worldContentSchema, type Analysis, type AnalysisResult, type GameContent, type WorldContent } from '@novel-game/contracts';
import type { GenerationProvider, SourceChunk, WorldGenerationOptions } from '../../modules/generation/index.js';
import { AppError } from '../../shared/errors.js';
import { ANALYSIS_SYSTEM, GAME_SYSTEM, compactForGame } from './prompts.js';
import { WORLD_SYSTEM, compactWorldDossier } from './world-prompts.js';

export interface ModelConfig {baseUrl: string; model: string; apiKey: string; timeoutMs: number}
export class ChatCompletionsProvider implements GenerationProvider {
  constructor(private readonly config: ModelConfig) {}
  private async json(system: string, data: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
        headers: {'Content-Type': 'application/json', ...(this.config.apiKey ? {Authorization: `Bearer ${this.config.apiKey}`} : {})},
        body: JSON.stringify({model: this.config.model, response_format: {type: 'json_object'},
          messages: [{role: 'system', content: system}, {role: 'user', content: JSON.stringify(data)}]}),
      });
    } catch {
      signal.throwIfAborted();
      throw new AppError('MODEL_CONNECTION_FAILED', '模型连接失败或超时，请检查服务地址与网络。已保存完成的步骤。', 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${response.status}。请检查凭据、模型名称、额度与 JSON 输出支持。`, 502);
    }
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing response');
      const decoder = new TextDecoder(); let text = ''; let bytes = 0;
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) {await reader.cancel(); throw new Error('response too large');}
        text += decoder.decode(value, {stream: true});
      }
      text += decoder.decode();
      const envelope = JSON.parse(text);
      const content = envelope.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || envelope.choices?.[0]?.finish_reason === 'length') throw new Error('incomplete response');
      return JSON.parse(content);
    } catch {
      signal.throwIfAborted();
      throw new AppError('MODEL_INVALID_RESPONSE', '模型未返回完整且有效的 JSON。请选用支持 JSON 输出的模型后重试。', 502);
    }
  }
  async analyze(chunk: SourceChunk, signal: AbortSignal): Promise<Analysis> {
    return analysisSchema.parse(await this.json(ANALYSIS_SYSTEM, chunk, signal));
  }
  async generate(analysis: AnalysisResult, direction: string, signal: AbortSignal): Promise<GameContent> {
    return gameContentSchema.parse(await this.json(GAME_SYSTEM, {direction, dossier: compactForGame(analysis)}, signal));
  }
  async generateWorld(analysis: AnalysisResult, options: WorldGenerationOptions, signal: AbortSignal): Promise<WorldContent> {
    return worldContentSchema.parse(await this.json(WORLD_SYSTEM, {plan: options, dossier: compactWorldDossier(analysis)}, signal));
  }
}
