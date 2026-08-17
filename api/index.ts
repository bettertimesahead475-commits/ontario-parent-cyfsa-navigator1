// NOTE: the ".js" extension is required, not optional. package.json sets
// "type": "module", so Node runs this as a native ES module on Vercel, and
// native ESM requires explicit file extensions on relative imports. Without
// it, Vercel throws ERR_MODULE_NOT_FOUND at import time and EVERY route —
// including /api/health — dies with FUNCTION_INVOCATION_FAILED. It still
// builds fine locally because esbuild bundles instead of resolving at runtime.
import app from "../server.js";
export default app;
