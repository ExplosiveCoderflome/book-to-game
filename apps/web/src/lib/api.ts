import type { ApiError } from '@novel-game/contracts';

export class RequestError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: unknown) { super(message); }
  get uncertain() { return this.status === 0 || this.status >= 500; }
}

export async function request<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
  } catch {
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

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';

export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取这个文件，请重新选择。'));
    reader.readAsDataURL(file);
  });
}
