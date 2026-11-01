import { createClaudeHandler } from '../server/claude.mjs';
export default { fetch: createClaudeHandler(process.env) };
