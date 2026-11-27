import { finishPrintWindow } from "./printWindow";
import { escapeHtml } from "./reportSectionsHtml";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared branded print/PDF export, factored out so every page that needs a "Print as PDF"
 * button reuses the same letterhead and styling instead of each page copy-pasting its own
 * <style> block (which is how CYFSAGuideTab.tsx's original printGuide() was written, and
 * which would have meant six near-identical copies of the same CSS to maintain). Opens a new
 * window with print-ready HTML; the person then uses the browser's own "Save as PDF"
 * destination in the print dialog — this produces a real PDF without needing a server-side
 * PDF library.
 */

const LETTERHEAD_STYLES = `
  body { font-family: 'Inter', sans-serif; color: #1e293b; margin: 40px; line-height: 1.6; background-color: #fff; }
  .no-print-btn { background-color: #1e3a8a; color: white; border: none; padding: 10px 18px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-bottom: 25px; }
  @media print { .no-print-btn { display: none !important; } body { margin: 20px; } }
  .header-container { border-bottom: 3px double #1e3a8a; padding-bottom: 16px; margin-bottom: 30px; }
  .platform-label { font-size: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.1em; color: #4f46e5; }
  .title-main { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: #0f172a; margin: 5px 0 10px 0; }
  .meta-bar { display: flex; gap: 15px; font-size: 11px; color: #64748b; font-weight: 500; margin-bottom: 10px; }
  .section-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; background-color: #fff; page-break-inside: avoid; }
  .section-title { font-size: 15px; font-weight: 800; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
  .body-text { font-size: 13.5px; color: #334155; }
  .body-text ul, .body-text ol { margin: 8px 0; padding-left: 20px; }
  .body-text li { margin-bottom: 6px; }
  .watch-item { border: 1px solid #fde68a; background-color: #fffbeb; padding: 16px; border-radius: 8px; margin-bottom: 12px; page-break-inside: avoid; }
  .watch-title { font-weight: 700; font-size: 13.5px; color: #92400e; display: block; margin-bottom: 4px; }
  .watch-desc { font-size: 12.5px; color: #78350f; line-height: 1.5; }
  .legal-disclaimer { background-color: #fafaf9; border: 1px solid #e7e5e4; padding: 16px; border-radius: 8px; font-size: 11px; color: #57534e; margin-top: 40px; line-height: 1.5; text-align: justify; page-break-inside: avoid; }
  /* After the base rules so it wins: long cards may break across pages instead of leaving a title-only page. */
  @media print {
    .section-card { break-inside: auto; page-break-inside: auto; }
    .section-title { break-after: avoid; page-break-after: avoid; }
    .legal-disclaimer { break-before: avoid; page-break-before: avoid; }
  }
`;

/**
 * Guide copy (src/data.ts) marks emphasis with **bold** and sometimes starts a line with an emoji. Escapes the text,
 * turns the markup into <strong> and drops the emoji, so a printed guide shows neither literal asterisks nor glyphs
 * that PDF text extraction and screen readers cannot read.
 */
export function guideTextHtml(text: string): string {
  return escapeHtml(text)
    .replace(/[\p{Extended_Pictographic}\u2713\u2714\u2717\u2718]\uFE0F?\s*/gu, "")
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*\*/g, "");
}

export function printBrandedDocument(title: string, bodyHtml: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to save/print this as a PDF.");
    return;
  }

  const htmlContent = `
    <html>
      <head>
        <title>${title} - CYFSA Navigator</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;family=Playfair+Display:ital,wght@0,700;1,700&amp;display=swap" />
        <style>${LETTERHEAD_STYLES}</style>
      </head>
      <body>
        <button class="no-print-btn" data-print-button>Print / Save as PDF</button>
        <div class="header-container">
          <span class="platform-label">CYFSA Navigator</span>
          <div class="title-main">${title}</div>
          <div class="meta-bar">Educational material — not legal advice. Generated ${new Date().toLocaleDateString("en-CA")}.</div>
        </div>
        ${bodyHtml}
        <div class="legal-disclaimer">
          This document is provided for general educational purposes only and does not constitute legal advice.
          Every case is fact-specific — consult a lawyer or Legal Aid Ontario about your own circumstances.
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
  finishPrintWindow(printWindow, { autoPrint: false }); // This export has always printed only on request.
}
