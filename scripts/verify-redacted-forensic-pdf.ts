// Reproduction evidence for the renderer-level redaction: renders a synthetic, UNREDACTED report with
// redactionEnabled, prints it to PDF with headless Chrome, and checks the PDF's extracted text and metadata.
// Usage: npx tsx scripts/verify-redacted-forensic-pdf.ts   (writes to <tmpdir>/cyfsa-redacted-forensic-pdf; needs Chrome)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { renderForensicReportHtml } from "../src/utils/forensicPdfRenderer";

// Fixed locations only: no path or binary comes from arguments or PATH lookup.
const out = join(tmpdir(), "cyfsa-redacted-forensic-pdf");
mkdirSync(out, { recursive: true });
const CFT_ROOT = "/opt/.devin/chrome/chrome";
const chromeCandidates = [
  ...(existsSync(CFT_ROOT) ? readdirSync(CFT_ROOT).sort().reverse().map((d) => join(CFT_ROOT, d, "chrome-linux64", "chrome")) : []),
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];
const chrome = chromeCandidates.find((c) => existsSync(c));
if (!chrome) throw new Error("No Chrome binary found in the fixed locations");
const SECRETS = ["Jordan Syntheticparent", "FC-26-00000001-0000", "maternal aunt", "416-555-0100", "Riverside Crescent"];
const report = {
  documentTitle: `Affidavit of ${SECRETS[0]}`,
  documentType: "Affidavit",
  fileSummary: `${SECRETS[0]} (${SECRETS[3]}, 12 ${SECRETS[4]}) says kinship placement with the ${SECRETS[2]} was never assessed.`,
  metadata: { fileNumber: SECRETS[1], applicantName: "Synthetic Society", respondentName: SECRETS[0], hearingDate: "2026-12-01" },
  completenessScore: 70,
  redFlags: [{ id: "rf1", classification: "Procedural", title: `Kinship option for ${SECRETS[2]} not considered`, quote: `${SECRETS[0]} was not told`, legalReference: "CYFSA s. 74" }],
  forensicVerification: { status: "completed", overallAssessment: `${SECRETS[0]} is consistent` },
};
const html = renderForensicReportHtml(report, { redactionEnabled: true, fileName: `${SECRETS[0]}.pdf`, audienceMode: "full" });
const htmlPath = join(out, "redacted-forensic.html");
const pdfPath = join(out, "redacted-forensic.pdf");
writeFileSync(htmlPath, html);
execFileSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", `--print-to-pdf=${pdfPath}`, "--no-pdf-header-footer", `file://${htmlPath}`], { stdio: "ignore", env: { HOME: tmpdir() } });
const parser = new PDFParse({ data: readFileSync(pdfPath) });
const text = (await parser.getText()).text;
const info = await parser.getInfo();
await parser.destroy();
const meta = JSON.stringify({ pages: info.total, info: info.info, metadata: info.metadata ?? null }, null, 2);
writeFileSync(join(out, "redacted-forensic.txt"), text);
writeFileSync(join(out, "redacted-forensic.pdfinfo.json"), meta);
const leaks = SECRETS.filter((s) => text.includes(s) || meta.includes(s) || html.includes(s));
console.log(JSON.stringify({ pdf: pdfPath, pages: info.total, title: (info.info as { Title?: string } | undefined)?.Title ?? null, notice: text.includes("not guaranteed to be anonymous"), leaks }, null, 2));
if (leaks.length) process.exit(1);
