import type { BuildingImageProvider, BuildingImageRequest, BuildingImageResult } from '@novel-game/contracts';

export type OpenAiCompatImageConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  size?: '256x256' | '512x512' | '1024x1024';
};

/**
 * OpenAI-compatible `POST /images/generations` adapter.
 * Plug any vendor that speaks this shape (xkrelay, OpenAI, local SD wrappers).
 * Throws on non-OK so a composite provider can fall back to SVG.
 */
export class OpenAiCompatBuildingImageProvider implements BuildingImageProvider {
  readonly id = 'openai-images';
  constructor(private readonly config: OpenAiCompatImageConfig) {}

  async generate(req: BuildingImageRequest): Promise<BuildingImageResult> {
    const size = this.config.size ?? pickSize(req.width, req.height);
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/images/generations`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 90_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: req.prompt.slice(0, 2000),
          n: 1,
          size,
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`images/generations ${response.status}: ${raw.slice(0, 240)}`);
      }
      const json = JSON.parse(raw) as {
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };
      const item = json.data?.[0];
      if (!item) throw new Error('images/generations 返回空 data');
      let bytes: Uint8Array;
      let mime: BuildingImageResult['mimeType'] = 'image/png';
      if (item.b64_json) {
        bytes = Uint8Array.from(Buffer.from(item.b64_json, 'base64'));
      } else if (item.url) {
        const img = await fetch(item.url, { signal: controller.signal });
        if (!img.ok) throw new Error(`下载生成图失败 ${img.status}`);
        const buf = new Uint8Array(await img.arrayBuffer());
        bytes = buf;
        const ct = img.headers.get('content-type') ?? '';
        if (ct.includes('webp')) mime = 'image/webp';
        else if (ct.includes('jpeg')) mime = 'image/jpeg';
      } else {
        throw new Error('images/generations 无 b64_json / url');
      }
      return {
        mimeType: mime,
        data: bytes,
        provider: `${this.id}:${this.config.model}`,
        revisedPrompt: item.revised_prompt ?? req.prompt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickSize(w: number, h: number): '256x256' | '512x512' | '1024x1024' {
  const m = Math.max(w || 512, h || 512);
  if (m <= 256) return '256x256';
  if (m <= 512) return '512x512';
  return '1024x1024';
}
