/**
 * CYFSA Navigator — Headless Serverless DOM Polyfills for pdfjs-dist / pdf-parse
 *
 * Ensures DOMMatrix, ImageData, and Path2D exist on globalThis in headless
 * Linux/Node.js serverless functions (e.g. Vercel, AWS Lambda) prior to
 * evaluating pdfjs-dist.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    m11 = 1;
    m12 = 0;
    m13 = 0;
    m14 = 0;
    m21 = 0;
    m22 = 1;
    m23 = 0;
    m24 = 0;
    m31 = 0;
    m32 = 0;
    m33 = 1;
    m34 = 0;
    m41 = 0;
    m42 = 0;
    m43 = 0;
    m44 = 1;
    is2D = true;
    isIdentity = true;
  };
}

if (typeof (globalThis as any).ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    width = 0;
    height = 0;
    data = new Uint8ClampedArray(0);
  };
}

if (typeof (globalThis as any).Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {};
}

/**
 * Resolves once PDF.js is loaded and pointed at its worker module. Callers must await it before parsing.
 *
 * Two defects are fixed here. First, the old code set workerSrc to "", which PDF.js treats as unset: every full-layout
 * parse then failed with "No GlobalWorkerOptions.workerSrc specified" and fell back to the degraded path. Second, the
 * assignment ran asynchronously after the first parse could already have started. The worker file is pdf.worker.mjs
 * from the same package; vercel.json includes it in the function bundle so it is present at runtime.
 */
const WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.mjs";
function pdfWorkerUrl(): string | null {
  // Resolve from this module's location (ESM: Node and vitest). In the CommonJS bundle (npm start, esbuild output)
  // import.meta.url is unavailable, so resolve from the project root instead. Either way the worker is the same file.
  const bases = [import.meta.url, pathToFileURL(join(process.cwd(), "package.json")).href];
  for (const base of bases) {
    if (!base) continue;
    try {
      return pathToFileURL(createRequire(base).resolve(WORKER_SPECIFIER)).href;
    } catch {
      // try the next base
    }
  }
  return null;
}
export const pdfJsReady: Promise<void> = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjsLib: any) => {
  if (!pdfjsLib?.GlobalWorkerOptions) {
    throw new Error("PDF.js did not expose GlobalWorkerOptions; PDF text extraction is unavailable.");
  }
  const workerUrl = pdfWorkerUrl();
  if (!workerUrl) {
    throw new Error("The PDF.js worker file could not be located; full-layout PDF extraction is unavailable.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
});
// Awaiters still receive the rejection. This only stops an import-time unhandled-rejection warning when nobody has awaited yet.
pdfJsReady.catch(() => undefined);
