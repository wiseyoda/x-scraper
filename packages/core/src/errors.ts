export type CoreErrorCode =
  | 'INVALID_FRONTMATTER'
  | 'PATH_TRAVERSAL'
  | 'NOT_FOUND'
  | 'PARSE'
  | 'UNKNOWN';

export class CoreError extends Error {
  public readonly code: CoreErrorCode;
  public override readonly cause: unknown;

  constructor(message: string, code: CoreErrorCode, cause?: unknown) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.cause = cause;
  }
}
