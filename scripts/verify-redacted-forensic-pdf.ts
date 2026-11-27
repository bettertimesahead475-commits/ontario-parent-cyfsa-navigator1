// Reproduction evidence for the renderer-level redaction: renders a synthetic, UNREDACTED report with
// redactionEnabled, prints it to PDF with headless Chrome, and checks the PDF's extracted text and metadata.
// Usage: npx tsx scripts/verify-redacted-forensic-pdf.ts <outDir>   (needs google-chrome, pdftotext, pdfinfo)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderForensicReportHtml } from "../src/utils/forensicPdfRenderer";

const out = resolve(process.argv[2] || "evidence-redacted-pdf");
mkdirSync(out, { recursive: true });
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
execFileSync("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--print-to-pdf=${pdfPath}`, "--no-pdf-header-footer", `file://${htmlPath}`], { stdio: "ignore" });
const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"]).toString();
const meta = execFileSync("pdfinfo", [pdfPath]).toString();
writeFileSync(join(out, "redacted-forensic.txt"), text);
writeFileSync(join(out, "redacted-forensic.pdfinfo.txt"), meta);
const leaks = SECRETS.filter((s) => text.includes(s) || meta.includes(s) || html.includes(s));
console.log(JSON.stringify({ pdf: pdfPath, pages: /Pages:\s+(\d+)/.exec(meta)?.[1], title: /Title:\s+(.*)/.exec(meta)?.[1] ?? null, notice: text.includes("not guaranteed to be anonymous"), leaks }, null, 2));
if (leaks.length) process.exit(1);
