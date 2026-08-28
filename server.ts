/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dev entrypoint only. The real Express app lives at api/_server.ts because
 * Vercel only deploys files inside api/ into the serverless function.
 * `npm run dev` / `npm start` run this file, which simply loads that app
 * (and, when not on Vercel, starts the local listener + Vite middleware).
 */
import app from "./api/_server.js";
export default app;
