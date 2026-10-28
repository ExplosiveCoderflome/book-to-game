import type { ApiError } from '@novel-game/contracts';

export class RequestError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: unknown) { super(message); }
  get uncertain() { return this.status === 0 || this.status >= 500; }
}

export async function request<T>(token: string, path: string, method = 'GET', body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // If caller passed a signal (e.g. long image gen), honor it alone — do not clamp to 30s.
    const signal = options?.signal ?? AbortSignal.timeout(30_000);
    response = await fetch(`/api${path}`, {
      method, headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal,
    });
  } catch (err) {
    if (options?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new RequestError('操作已取消。', 'REQUEST_ABORTED', 0);
    }
    throw new RequestError('无法确认请求结果。请检查本地服务，再重试同一操作。', 'NETWORK_UNCERTAIN', 0);
  }
  const data = await response.json().catch(() => null) as T | ApiError | null;
  if (!response.ok) {
    const error = (data as ApiError | null)?.error;
    throw new RequestError(error?.message ?? `请求失败（${response.status}）`, error?.code ?? 'HTTP_ERROR', response.status, error?.details);
  }
  if (data === null) throw new RequestError('服务返回了无法读取的结果，请刷新确认状态。', 'NETWORK_UNCERTAIN', 0);
  return data as T;
}

const commonErrors: Record<string, string> = {
  REQUEST_ABORTED: '操作已取消。',
  UNAUTHORIZED: '受保护接口访问码无效，请检查 MCP 连接配置。',
  FORBIDDEN_ORIGIN: '当前请求没有访问权限。',
  MODEL_NOT_CONFIGURED: '尚未配置模型服务，请在模型设置中保存配置。',
  DRAFT_VERSION_CONFLICT: '草稿已更新，请重新载入后编辑。',
  MODEL_SETTINGS_CONFLICT: '模型配置已更新，请重新载入后编辑。',
  SESSION_TURN_CONFLICT: '存档已经更新，请重新读取后行动。',
  REQUEST_ID_CONFLICT: '同一请求 ID 不能用于不同的行动。',
  IDEMPOTENCY_CONFLICT: '同一请求 ID 不能用于不同的输入。',
  SOURCE_NOT_FOUND: '小说来源不存在。',
  DRAFT_NOT_FOUND: '草稿不存在。',
  SESSION_NOT_FOUND: '存档不存在。',
  JOB_NOT_FOUND: '任务不存在。',
  CHOICE_LOCKED: '当前变量条件未满足，此选项不可用。',
  UNKNOWN_CHOICE: '当前场景没有此选项。',
  INVALID_ACTION: '此行动当前不可用。',
  SESSION_ENDED: '本次游戏已经结束。',
  MODEL_KEY_ORIGIN_CHANGED: '服务地址已变更，请为新服务重新填写或清除 API Key。',
  INVALID_MODEL_ENDPOINT: '模型服务地址无效，请检查 HTTP(S) 基础地址。',
  INVALID_SOURCE: '原作文件无效，请检查文件内容和格式。',
  INVALID_ENCODING: '文件编码无效，请选择匹配的编码。',
  UNSUPPORTED_FORMAT: '暂不支持这种文件格式。',
  SOURCE_TOO_LARGE: '小说文件超过大小限制。',
  INVALID_GAME: '分支草稿未通过校验。',
  INVALID_WORLD: '世界草稿未通过校验。',
  GAME_REVISION_NOT_FOUND: '已发布游戏版本不存在。',
  WORLD_REVISION_NOT_FOUND: '已发布世界版本不存在。',
  JOB_STATE_CONFLICT: '任务当前状态不允许这个操作。',
  CHECKPOINT_CONFLICT: '任务断点发生冲突，请重试。',
  INVALID_CHAPTER_SCOPE: '改编章节范围无效。',
  GENERATION_LIMIT: '本次分析内容超过限制，请分卷导入。',
  OPEN_PROVIDER_UNAVAILABLE: '当前模型服务不支持开放世界生成。',
  WORLD_SCOPE_MISMATCH: '世界草稿的章节范围与本次选择不一致。',
  ACTION_BLOCKED: '当前条件不允许此行动。',
};
export const errorMessage = (error: unknown) => error instanceof RequestError && Object.hasOwn(commonErrors, error.code)
  ? commonErrors[error.code] : error instanceof Error ? error.message : '操作未完成，请重试。';

export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取这个文件，请重新选择。'));
    reader.readAsDataURL(file);
  });
}
