// The Express app MUST live inside api/ — Vercel only packages files under
// this directory into the serverless lambda. When server.ts sat at the repo
// root, Vercel transpiled this file but never shipped server.ts alongside it,
// so every request died with:
//   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/server'
// The ".js" extension is also required: package.json sets "type": "module",
// and native ESM does not do extensionless resolution.
import app from "./_server.js";
export default app;
