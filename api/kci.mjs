import { createKciHandler } from '../server/kci.mjs';
export default { fetch: createKciHandler(process.env) };
