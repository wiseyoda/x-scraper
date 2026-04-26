export type { ReadSourceInput, SearchInput } from './handlers.js';
export { getStatus, readSource, searchVault, summarizeHit } from './handlers.js';
export { buildMcpServer } from './server.js';
export type {
  SearchHit,
  ServerContext,
  SourcePayload,
  StatusReport,
  ToolErrorCode,
} from './types.js';
export { ToolError } from './types.js';
