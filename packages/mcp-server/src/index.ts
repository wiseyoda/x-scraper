export type {
  ReadSourceInput,
  RelatedToInput,
  SearchIdeasInput,
  SearchInput,
  WhatsNewInput,
} from './handlers.js';
export {
  getStatus,
  readSource,
  relatedTo,
  searchIdeas,
  searchVault,
  summarizeHit,
  whatsNew,
} from './handlers.js';
export { buildMcpServer } from './server.js';
export type {
  SearchHit,
  ServerContext,
  SourcePayload,
  StatusReport,
  ToolErrorCode,
} from './types.js';
export { ToolError } from './types.js';
