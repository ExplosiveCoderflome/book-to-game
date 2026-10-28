/**
 * Export package build: replaces `lib/api` so the player file contains NO fetch to a workbench service.
 * Shared components that import it (e.g. the read-only map viewer's editor helpers) never call it in play;
 * if they ever did, they get a typed refusal instead of a network request.
 */
export class RequestError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: unknown) { super(message); }
  get uncertain() { return false; }
}
export async function request<T>(..._args: unknown[]): Promise<T> {
  throw new RequestError('此操作在离线游玩包中不可用。', 'OFFLINE_PACKAGE', 0);
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '行动未成功。进度未推进。';
export function fileBase64(_file: File): Promise<string> { return Promise.reject(new RequestError('此操作在离线游玩包中不可用。', 'OFFLINE_PACKAGE', 0)); }
