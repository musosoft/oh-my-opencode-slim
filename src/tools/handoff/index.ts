/**
 * Fork functionality for orchestrator worker sessions.
 *
 * Provides tools and commands for forking current context into child workers.
 */

export {
  createForkCommandManager,
  type ForkCommandManager,
} from './command';
export {
  buildSyntheticFileParts,
  FILE_REGEX,
  parseFileReferences,
} from './files';
export { createForkState, type ForkState } from './state';
export {
  createForkSessionTool,
  createReadSessionTool,
  type OpencodeClient,
} from './tools';
export {
  DEFAULT_READ_LIMIT,
  formatFileContent,
  isBinaryFile,
  MAX_BYTES,
  MAX_LINE_LENGTH,
} from './vendor';
