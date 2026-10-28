/** Shared rule/runtime error. Server adapters map it to HTTP/MCP; the offline package maps it to player copy. */
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message); this.name = 'AppError';
  }
}
