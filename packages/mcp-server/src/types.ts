/**
 * Shared types for the MCP tools layer.
 *
 * The handlers are pure functions over a `ServerContext` so we can unit
 * test the actual tool logic without instantiating an MCP server.
 */

import type { JobQueue } from '@x-scraper/queue';
import type { VaultStore } from '@x-scraper/vault';

export interface ServerContext {
  vault: VaultStore;
  queue: JobQueue;
}

export interface SearchHit {
  id: string;
  type: string;
  relativePath: string;
  /** Last modified time as ISO string. */
  mtime: string;
}

export interface SourcePayload {
  id: string;
  type: string;
  url: string | null;
  body: string;
}

export interface StatusReport {
  pending: number;
  running: number;
  done: number;
  failed: number;
  dead: number;
  dlqCount: number;
}

export type ToolErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL';

export class ToolError extends Error {
  public readonly code: ToolErrorCode;

  constructor(message: string, code: ToolErrorCode) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}
