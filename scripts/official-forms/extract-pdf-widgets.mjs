#!/usr/bin/env node
// Reads every widget (form field annotation) from the current official PDFs and records the printed text
// nearest to each one: same line to the left, directly above, directly below. Output is descriptive data only;
// it does not decide what any field means. The semantic mapping is made from this record by
// api/services/officialFormPdfSemanticMap.ts.
// Usage: node scripts/official-forms/extract-pdf-widgets.mjs [directory] > compat/pdf-widgets-2026-10-26.json
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../package.json"));
const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "current-manifest.json"), "utf8"));
const dir = process.argv[2] || manifest.uploadDirectory;

const out = { recordedAt: manifest.retrievedAt, forms: {} };
for (const f of manifest.files) {
  const data = new Uint8Array(fs.readFileSync(path.join(dir, f.fileName)));
  const doc = await pdfjs.getDocument({ data, password: "", verbosity: 0 }).promise;
  const widgets = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const texts = (await page.getTextContent()).items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }));
    for (const a of await page.getAnnotations({ intent: "display" })) {
      if (a.subtype !== "Widget") continue;
      const [x1, y1, x2, y2] = a.rect;
      const midY = (y1 + y2) / 2;
      const left = texts
        .filter(t => Math.abs(t.y + t.h / 2 - midY) < 6 && t.x + t.w <= x1 + 2 && x1 - (t.x + t.w) < 260)
        .sort((a, b) => b.x - a.x).slice(0, 3).reverse().map(t => t.s).join(" ");
      const above = texts
        .filter(t => t.y > y2 && t.y - y2 < 28 && t.x < x2 && t.x + t.w > x1)
        .sort((a, b) => a.y - b.y).map(t => t.s).join(" ");
      const below = texts
        .filter(t => t.y < y1 && y1 - t.y < 28 && t.x < x2 && t.x + t.w > x1)
        .sort((a, b) => b.y - a.y).map(t => t.s).join(" ");
      widgets.push({
        name: a.fieldName ?? "",
        page: p,
        type: a.fieldType ?? null,
        rect: a.rect.map(n => Math.round(n)),
        left: left.slice(0, 160),
        above: above.slice(0, 160),
        below: below.slice(0, 160)
      });
    }
  }
  // Parent (non-widget) field nodes appear in the AcroForm but have no widget of their own; their child widgets are listed above.
  const acroFormUniqueNames = Object.keys((await doc.getFieldObjects()) ?? {}).sort();
  out.forms[f.fileName] = { formNumber: f.formNumber, acroFormUniqueNames, widgets };
  await doc.destroy();
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
