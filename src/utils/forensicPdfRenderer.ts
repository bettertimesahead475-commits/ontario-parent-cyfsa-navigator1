/**
 * Professional Legal Report HTML/PDF Renderer for CYFSA Navigator Forensic Deep Scan.
 *
 * Implements a structured, publication-grade Ontario legal document format
 * with clean typography, page-break controls, tables, verified authorities,
 * and zero raw JSON keys or debug labels.
 */

import { escapeHtml } from "./reportSectionsHtml";
import { VERIFIED_AUTHORITIES_REGISTRY, resolveLegalAuthority } from "../../shared/legalVerificationPipeline";
import { REDACTED_COPY_NOTICE } from "../../shared/exportRedaction";
import { CASE_BRIEF_PART_LABELS, CASE_BRIEF_PART_ORDER, parseCaseBriefPoint } from "../../shared/caseBriefStructure";

const NOT_STATED = "Not stated in the document";

/** The citation exactly as saved in the analysis; the registry form is used only when nothing was saved. */
function citationLabel(saved: unknown, auth: { officialCitation?: string }): string {
  const text = typeof saved === "string" ? saved.trim() : "";
  return text || auth.officialCitation || "No citation provided";
}

export function isScored(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value));
}

export interface PdfRenderOptions {
  fileName?: string;
  redactionEnabled?: boolean;
  audienceMode?: "parent" | "self_rep" | "lawyer" | "full";
}

export function renderForensicReportHtml(report: Record<string, any>, options: PdfRenderOptions = {}): string {
  const isRedacted = Boolean(options.redactionEnabled);
  const displayTitle = isRedacted ? "Confidential Case Document Audit" : (report.documentTitle || options.fileName || "Court Record Audit");
  const displayFile = isRedacted ? "Analysis report" : (options.fileName || report.documentTitle || "Document");
  const docType = report.documentType || NOT_STATED;
  const metadata = report.metadata || {};
  const fileNumber = isRedacted ? "[REDACTED]" : (metadata.fileNumber || NOT_STATED);
  const applicant = isRedacted ? "[REDACTED]" : (metadata.applicantName || NOT_STATED);
  const respondent = isRedacted ? "[REDACTED]" : (metadata.respondentName || NOT_STATED);
  const hearingDate = isRedacted ? "[REDACTED]" : (metadata.hearingDate || NOT_STATED);

  const esi = report.evidenceStrengthIndex || { components: {} };
  const esiScored = isScored(esi.score);
  const esiScore = esiScored ? Number(esi.score) : 0;
  const completenessScored = isScored(report.completenessScore);
  const completenessScore = completenessScored ? Number(report.completenessScore) : 0;
  const verification = report.forensicVerification || null;

  // Collect verified authorities referenced across the report
  const authoritiesMap = new Map<string, typeof VERIFIED_AUTHORITIES_REGISTRY[string]>();
  const addAuthority = (cit: string) => {
    const res = resolveLegalAuthority(cit);
    if (res.entry) {
      authoritiesMap.set(res.entry.citation, res.entry);
    }
  };

  // Seed default core authorities always relevant to CYFSA forensic reviews
  ["74(2)", "81(7)", "88", "94(1)", "FLR_14_18", "CHARTER_7"].forEach(k => {
    if (VERIFIED_AUTHORITIES_REGISTRY[k]) authoritiesMap.set(VERIFIED_AUTHORITIES_REGISTRY[k].citation, VERIFIED_AUTHORITIES_REGISTRY[k]);
  });

  const secondReviewDone = verification?.status === "completed";
  // Coverage is read from the per-finding verdicts, which survive redaction; the overall status may not.
  const secondReviewCoverage = (flags: any[]): string => {
    const checked = flags.filter((rf) => rf?.forensicVerification?.verdict).length;
    if (checked > 0 && checked === flags.length) return "A second review checked each finding against the uploaded text.";
    if (checked > 0) return `A second review gave a verdict on ${checked} of ${flags.length} findings; check the others against the original document.`;
    return "These findings were not second-reviewed; check each quotation against the original document.";
  };
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Forensic Deep Scan — ${escapeHtml(displayTitle)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');

        @page {
          size: letter;
          margin: 16mm 14mm 16mm 14mm;
          @top-left {
            content: "CYFSA Navigator • Forensic Deep Scan";
            font-family: 'Inter', sans-serif;
            font-size: 8px;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          @top-right {
            content: "${escapeHtml(displayFile)}";
            font-family: 'Inter', sans-serif;
            font-size: 8px;
            color: #64748b;
          }
          @bottom-center {
            content: "Page " counter(page) " of " counter(pages);
            font-family: 'Inter', sans-serif;
            font-size: 8.5px;
            color: #64748b;
          }
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #0f172a;
          line-height: 1.55;
          font-size: 11px;
          background: #ffffff;
          margin: 0;
          padding: 0;
        }

        .cover-header {
          border-bottom: 2px solid #0f172a;
          padding-bottom: 14px;
          margin-bottom: 20px;
        }

        .brand-badge {
          display: inline-block;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #1e3a8a;
          background: #dbeafe;
          padding: 3px 8px;
          border-radius: 4px;
          margin-bottom: 8px;
        }

        .report-title {
          font-family: 'Cinzel', serif;
          font-size: 21px;
          font-weight: 700;
          color: #0f172a;
          margin: 4px 0 8px 0;
          letter-spacing: -0.01em;
        }

        .report-subtitle {
          font-family: 'Lora', serif;
          font-size: 12px;
          color: #475569;
          font-style: italic;
          margin: 0 0 12px 0;
        }

        .case-meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px 16px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 16px;
          margin-bottom: 20px;
          font-size: 10px;
        }

        .case-meta-item {
          display: flex;
          flex-direction: column;
        }

        .case-meta-label {
          font-weight: 700;
          text-transform: uppercase;
          font-size: 8.5px;
          color: #64748b;
          letter-spacing: 0.05em;
        }

        .case-meta-value {
          font-weight: 600;
          color: #0f172a;
          margin-top: 1px;
        }

        .section-block {
          margin-bottom: 22px;
          page-break-inside: auto;
        }

        .section-heading {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          border-bottom: 1px solid #cbd5e1;
          padding-bottom: 4px;
          margin: 18px 0 10px 0;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          page-break-after: avoid;
        }

        .prose-text {
          font-size: 10.5px;
          line-height: 1.6;
          color: #334155;
          margin: 0 0 10px 0;
          text-align: justify;
        }

        .disclaimer-box {
          background: #fffbeb;
          border-left: 3px solid #d97706;
          padding: 8px 12px;
          font-size: 9.5px;
          color: #78350f;
          margin-bottom: 18px;
          border-radius: 0 6px 6px 0;
          page-break-inside: avoid;
        }

        .score-card-container {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 16px;
          background: #f8fafc;
          margin-bottom: 16px;
          page-break-inside: avoid;
        }

        .score-hero {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          border-right: 1px solid #e2e8f0;
          padding-right: 12px;
          text-align: center;
        }

        .score-hero-number {
          font-size: 32px;
          font-weight: 800;
          color: ${esiScore >= 70 ? "#059669" : esiScore >= 50 ? "#d97706" : "#dc2626"};
          line-height: 1;
        }

        .score-hero-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          color: #64748b;
          margin-top: 4px;
        }

        .components-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5px;
          margin-top: 8px;
        }

        .components-table th {
          background: #f1f5f9;
          text-align: left;
          padding: 5px 8px;
          font-weight: 700;
          color: #475569;
          border-bottom: 1px solid #cbd5e1;
        }

        .components-table td {
          padding: 5px 8px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: top;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5px;
          margin-top: 8px;
          page-break-inside: auto;
        }

        .data-table th {
          background: #0f172a;
          color: #ffffff;
          font-weight: 600;
          text-align: left;
          padding: 6px 8px;
          font-size: 9px;
          letter-spacing: 0.03em;
        }

        .data-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
          page-break-inside: avoid;
        }

        .data-table tr:nth-child(even) td {
          background: #f8fafc;
        }

        .badge-classification {
          display: inline-block;
          font-size: 8px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .badge-doc { background: #e0e7ff; color: #3730a3; }
        .badge-hearsay { background: #fee2e2; color: #991b1b; }
        .badge-corroborated { background: #dcfce7; color: #166534; }
        .badge-direct { background: #fef3c7; color: #92400e; }
        .badge-unclear { background: #f1f5f9; color: #475569; }

        .finding-card {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          margin-bottom: 14px;
          background: #ffffff;
          page-break-inside: avoid;
          overflow: hidden;
        }

        .finding-header {
          padding: 7px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          font-weight: 700;
          border-bottom: 1px solid #cbd5e1;
        }

        .severity-critical { background: #fee2e2; color: #991b1b; }
        .severity-counsel { background: #fef3c7; color: #92400e; }
        .severity-weight { background: #f1f5f9; color: #334155; }

        .finding-body {
          padding: 10px 14px;
          font-size: 10px;
          line-height: 1.55;
        }

        .quote-box {
          font-family: 'Lora', serif;
          font-size: 10.5px;
          font-style: italic;
          background: #f8fafc;
          border-left: 3px solid #64748b;
          padding: 6px 12px;
          margin: 6px 0 10px 0;
          color: #0f172a;
        }

        .finding-row {
          margin-bottom: 6px;
        }

        .finding-label {
          font-weight: 700;
          color: #475569;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          display: block;
        }

        .finding-value {
          color: #0f172a;
        }

        .review-badge {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 9px;
          margin-top: 6px;
        }

        .status-pill {
          display: inline-block;
          font-size: 8.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .status-pill-concern { background: #fee2e2; color: #991b1b; }
        .status-pill-supported { background: #dcfce7; color: #166534; }
        .status-pill-determinable { background: #f1f5f9; color: #475569; }
        .status-pill-na { background: #f1f5f9; color: #64748b; }

        .checklist-item {
          border-left: 3px solid #cbd5e1;
          padding-left: 10px;
          margin-bottom: 10px;
          page-break-inside: avoid;
        }

        .no-print {
          display: none;
        }

        @media print {
          .no-print-bar { display: none !important; }
        }

        @media screen {
          body {
            max-width: 900px;
            margin: 20px auto;
            padding: 30px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border-radius: 8px;
          }
          .no-print-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1e293b;
            color: #ffffff;
            padding: 12px 18px;
            border-radius: 6px;
            margin-bottom: 24px;
          }
          .print-btn {
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
          }
        }
      </style>
    </head>
    <body>
      <div class="no-print-bar">
        <span>CYFSA Navigator — Professional Legal Audit PDF Suite</span>
        <button class="print-btn" data-print-button>Print / Save as PDF</button>
      </div>

      <!-- 1. COVER PAGE & CASE IDENTIFICATION -->
      <header class="cover-header">
        <span class="brand-badge">Ontario Child Protection • Forensic Evidence Audit</span>
        <h1 class="report-title">Forensic Document Analysis & Admissibility Audit</h1>
        <p class="report-subtitle">${secondReviewDone ? "Automated Evidentiary Assessment with Second Review" : "Automated Evidentiary Assessment"} • Ontario Family Court Preparation Brief</p>

        <div class="case-meta-grid">
          <div class="case-meta-item">
            <span class="case-meta-label">Document Under Review</span>
            <span class="case-meta-value">${escapeHtml(displayTitle)}</span>
          </div>
          <div class="case-meta-item">
            <span class="case-meta-label">Court File Number</span>
            <span class="case-meta-value">${escapeHtml(fileNumber)}</span>
          </div>
          <div class="case-meta-item">
            <span class="case-meta-label">Document Classification</span>
            <span class="case-meta-value">${escapeHtml(docType)}</span>
          </div>
          <div class="case-meta-item">
            <span class="case-meta-label">Proceeding Applicant</span>
            <span class="case-meta-value">${escapeHtml(applicant)}</span>
          </div>
          <div class="case-meta-item">
            <span class="case-meta-label">Respondent Parties</span>
            <span class="case-meta-value">${escapeHtml(respondent)}</span>
          </div>
          <div class="case-meta-item">
            <span class="case-meta-label">Analysis Date</span>
            <span class="case-meta-value">${escapeHtml(report.analysisDate ? String(report.analysisDate) : "Not recorded")}</span>
          </div>
        </div>

        <div class="disclaimer-box">
          <strong>Mandatory Educational Notice:</strong> This audit is produced for legal education, case preparation, and self-represented parent support under the Child, Youth and Family Services Act, 2017 (CYFSA). It does not constitute legal representation or formal legal advice. Please provide this report to a licensed Ontario family law practitioner or Legal Aid Ontario.
        </div>
        ${isRedacted ? `
          <div class="disclaimer-box" style="background:#fef2f2; border-color:#fca5a5; color:#991b1b; margin-top:8px;">
            <strong>${escapeHtml(REDACTED_COPY_NOTICE)}</strong>
          </div>
        ` : ""}
      </header>

      <!-- 2. EXECUTIVE SUMMARY -->
      <section class="section-block">
        <h2 class="section-heading">1. Executive Summary & File Posture</h2>
        <p class="prose-text">${escapeHtml(report.fileSummary || "This forensic scan evaluates the factual assertions, evidentiary classifications, and statutory compliance visible on the face of the filed document.")}</p>
        ${report.findings ? `
          <div class="prose-text" style="margin-top:8px;">${escapeHtml(typeof report.findings === "string" ? report.findings : JSON.stringify(report.findings, null, 2))}</div>
        ` : ""}
        ${verification ? `
          <div class="review-badge">
            <strong>${secondReviewDone ? "✓ " : ""}Second Review:</strong> ${escapeHtml(secondReviewDone ? `Completed. ${verification.checkedFindings ?? 0} findings checked against the uploaded document by a second model.` : "Not completed. The findings were not second-reviewed.")}
            ${verification.overallAssessment ? `<br/><span style="margin-top:2px; display:inline-block;">${escapeHtml(verification.overallAssessment)}</span>` : ""}
          </div>
        ` : ""}
      </section>

      <!-- 3. EVIDENCE STRENGTH INDEX & COMPLETENESS -->
      <section class="section-block">
        <h2 class="section-heading">2. Evidence Strength Index & Completeness Assessment</h2>
        <div class="score-card-container">
          <div class="score-hero">
            <span class="score-hero-number">${esiScored ? esiScore : `<span style="font-size:16px;">Not scored</span>`}</span>
            <span class="score-hero-label">Evidence Strength / 100</span>
            <span style="font-size:8px; color:#64748b; margin-top:4px;">Heuristic Evidentiary Weight</span>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
              <strong style="font-size:10.5px; color:#0f172a;">Information Completeness: ${completenessScored ? `${completenessScore}/100` : "Not scored"}</strong>
              <span style="font-size:8.5px; color:#64748b;">(Evaluates presence of substantive protection records)</span>
            </div>
            <p style="font-size:9.5px; color:#475569; margin:0 0 8px 0; line-height:1.4;">
              The Evidence Strength Index evaluates document reliability on its face across 8 formal dimensions. A lower score reflects procedural omissions or secondhand sourcing; it is not a judicial ruling on admissibility or credibility.
            </p>
            <table class="components-table">
              <thead>
                <tr>
                  <th style="width:28%;">Dimension</th>
                  <th style="width:14%;">Score</th>
                  <th>Evidentiary Assessment</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(esi.components || {}).map(([k, c]: [string, any]) => `
                  <tr>
                    <td><strong>${escapeHtml(k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()))}</strong></td>
                    <td><strong>${isScored(c?.score) ? `${Number(c.score)} / ${c.maxScore || c.max || 15}` : "Not scored"}</strong></td>
                    <td>${escapeHtml(c.explanation || "No explanation was returned.")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="3" style="color:#64748b;">No dimension scores were recorded for this report.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 4. PROCEDURAL CHRONOLOGY -->
      ${Array.isArray(report.chronology) && report.chronology.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">3. Procedural Chronology & Event Attribution</h2>
          <p class="prose-text">Chronological sequence of events deposed to or exhibited in the document, classified by evidentiary quality:</p>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:16%;">Date / Time</th>
                <th>Documented Event (Attributed)</th>
                <th style="width:14%;">Classification</th>
                <th style="width:18%;">Location in Record</th>
              </tr>
            </thead>
            <tbody>
              ${report.chronology.map((c: any) => {
                const cls = (c.evidenceClassification || "UNCLEAR").toUpperCase();
                let badgeClass = "badge-unclear";
                if (cls.includes("DOC")) badgeClass = "badge-doc";
                else if (cls.includes("HEARSAY")) badgeClass = "badge-hearsay";
                else if (cls.includes("CORROBORAT")) badgeClass = "badge-corroborated";
                else if (cls.includes("DIRECT")) badgeClass = "badge-direct";
                return `
                  <tr>
                    <td><strong>${escapeHtml(c.date || "Undated")}</strong></td>
                    <td>${escapeHtml(c.event || "")}</td>
                    <td><span class="badge-classification ${badgeClass}">${escapeHtml(cls)}</span></td>
                    <td><span style="color:#64748b;">${escapeHtml(c.locationInDocument || NOT_STATED)}</span></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </section>
      ` : ""}

      <!-- 5. KEY FORENSIC FINDINGS & RED FLAGS -->
      ${Array.isArray(report.redFlags) && report.redFlags.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">4. Key Forensic Findings & Evidence Audit Flags</h2>
          <p class="prose-text">Specific passages exhibiting procedural irregularities, unsworn hearsay, or potential statutory overreach. ${secondReviewCoverage(report.redFlags)}</p>
          ${report.redFlags.map((rf: any, idx: number) => {
            const sev = (rf.severity || "Affects Evidentiary Weight").toLowerCase();
            let sevClass = "severity-weight";
            if (sev.includes("critical")) sevClass = "severity-critical";
            else if (sev.includes("counsel") || sev.includes("warning")) sevClass = "severity-counsel";

            const cit = rf.legalReference || "";
            addAuthority(cit);
            const auth = resolveLegalAuthority(cit);

            return `
              <div class="finding-card">
                <div class="finding-header ${sevClass}">
                  <span>Finding ${idx + 1} • ${escapeHtml(rf.category || "Evidentiary Finding")} [${escapeHtml(rf.severity || "Review Required")}]</span>
                  <span>${escapeHtml(rf.locationInDocument || NOT_STATED)}</span>
                </div>
                <div class="finding-body">
                  <div class="quote-box">
                    "${escapeHtml(rf.phraseDetected || "")}"
                  </div>
                  <div class="finding-row">
                    <span class="finding-label">Evidentiary Significance:</span>
                    <span class="finding-value">${escapeHtml(rf.explanation || "")}</span>
                  </div>
                  ${rf.verifyRequirement ? `
                    <div class="finding-row">
                      <span class="finding-label">Verification Requirement (Disclosure Request):</span>
                      <span class="finding-value">${escapeHtml(rf.verifyRequirement)}</span>
                    </div>
                  ` : ""}
                  <div class="finding-row">
                    <span class="finding-label">Applicable Legal Authority:</span>
                    <span class="finding-value">
                      <strong>${escapeHtml(citationLabel(cit, auth))}</strong>
                      ${auth.sourceUrl ? ` — <a href="${auth.sourceUrl}" target="_blank" style="color:#1d4ed8; text-decoration:underline;">Ontario e-Laws Provision</a>` : ""}
                      ${auth.warningText ? `<br/><span style="color:#b45309; font-size:8.5px;">${escapeHtml(auth.warningText)}</span>` : ""}
                    </span>
                  </div>
                  ${rf.parentActionStep ? `
                    <div class="finding-row" style="background:#f0fdf4; padding:6px 10px; border-radius:4px; margin-top:6px;">
                      <span class="finding-label" style="color:#166534;">Recommended Counsel Action:</span>
                      <span class="finding-value" style="color:#14532d;">${escapeHtml(rf.parentActionStep)}</span>
                    </div>
                  ` : ""}
                  ${rf.forensicVerification ? `
                    <div class="review-badge" style="margin-top:6px;">
                      <strong>Second Review Verdict: ${escapeHtml(rf.forensicVerification.verdict)}</strong>
                      ${rf.forensicVerification.note ? ` — ${escapeHtml(rf.forensicVerification.note)}` : ""}
                    </div>
                  ` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </section>
      ` : ""}

      <!-- 6. STATUTORY THRESHOLDS & TIMELINE ANALYSIS -->
      <section class="section-block">
        <h2 class="section-heading">5. CYFSA Statutory Thresholds & Procedural Timelines</h2>
        
        <h3 style="font-size:11px; font-weight:700; color:#1e293b; margin:10px 0 6px 0;">A. Protection & Authority Checkpoints</h3>
        ${Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis.map((t: any, idx: number) => {
          const isMet = (t.isMet || "Inconclusive");
          let pill = "status-pill-determinable";
          if (isMet.toLowerCase().includes("met") && !isMet.toLowerCase().includes("not")) pill = "status-pill-supported";
          else if (isMet.toLowerCase().includes("not met") || isMet.toLowerCase().includes("concern")) pill = "status-pill-concern";
          else if (isMet.toLowerCase().includes("applicable")) pill = "status-pill-na";

          addAuthority(t.primarySourceLaw);
          const auth = resolveLegalAuthority(t.primarySourceLaw);

          return `
            <div class="checklist-item">
              <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <strong>${idx + 1}. ${escapeHtml(t.thresholdChecked)}</strong>
                <span class="status-pill ${pill}">${escapeHtml(isMet)}</span>
              </div>
              <p style="margin:4px 0; color:#334155;">${escapeHtml(t.reasoning || "")}</p>
              <div style="font-size:8.5px; color:#64748b;">
                Statutory Reference: <strong>${escapeHtml(citationLabel(t.primarySourceLaw, auth))}</strong>
                ${auth.sourceUrl ? ` (<a href="${auth.sourceUrl}" target="_blank" style="color:#2563eb;">e-Laws Text</a>)` : ""}
              </div>
              ${t.forensicVerification ? `
                <div style="font-size:8.5px; color:#065f46; margin-top:2px;">
                  <em>Verification Verdict: ${escapeHtml(t.forensicVerification.verdict)} — ${escapeHtml(t.forensicVerification.note || "")}</em>
                </div>
              ` : ""}
            </div>
          `;
        }).join("") || `<p class="prose-text" style="color:#64748b;">Not assessed in this report.</p>` : `<p class="prose-text" style="color:#64748b;">Not assessed in this report.</p>`}

        <h3 style="font-size:11px; font-weight:700; color:#1e293b; margin:14px 0 6px 0;">B. Procedural Timelines & Statutory Protections</h3>
        ${Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations.map((p: any, idx: number) => {
          addAuthority(p.citation);
          const auth = resolveLegalAuthority(p.citation);
          return `
            <div class="checklist-item">
              <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <strong>${idx + 1}. ${escapeHtml(p.timelineRule || "Procedural Timeline Rule")}</strong>
                <span style="font-size:8.5px; color:#64748b;">Location: ${escapeHtml(p.locationInDocument || NOT_STATED)}</span>
              </div>
              ${p.documentAssertion && !p.documentAssertion.includes("Not explicitly") ? `
                <div style="font-size:9.5px; font-style:italic; color:#475569; margin:2px 0;">"${escapeHtml(p.documentAssertion)}"</div>
              ` : ""}
              <p style="margin:3px 0; color:#334155;">${escapeHtml(p.evaluation || "")}</p>
              <div style="font-size:8.5px; color:#64748b;">
                Authority: <strong>${escapeHtml(citationLabel(p.citation, auth))}</strong>
                ${auth.sourceUrl ? ` (<a href="${auth.sourceUrl}" target="_blank" style="color:#2563eb;">Official Source</a>)` : ""}
              </div>
            </div>
          `;
        }).join("") || `<p class="prose-text" style="color:#64748b;">Not assessed in this report.</p>` : `<p class="prose-text" style="color:#64748b;">Not assessed in this report.</p>`}
      </section>

      <!-- 7. CONTRADICTIONS & DISCREPANCIES -->
      ${Array.isArray(report.contradictions) && report.contradictions.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">6. Internal Contradictions & Documentary Inconsistencies</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:40%;">Inconsistency Identified</th>
                <th style="width:25%;">Locations in Record</th>
                <th>Evidentiary Significance & Counsel Action</th>
              </tr>
            </thead>
            <tbody>
              ${report.contradictions.map((cd: any) => `
                <tr>
                  <td><strong>${escapeHtml(cd.description || "")}</strong></td>
                  <td>${Array.isArray(cd.locations) ? cd.locations.map(escapeHtml).join("<br/>") : escapeHtml(cd.locations || "")}</td>
                  <td>${escapeHtml(cd.significance || NOT_STATED)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </section>
      ` : ""}

      <!-- 8. TARGETED DISCLOSURE & MISSING EVIDENCE -->
      ${Array.isArray(report.whatIsMissing) && report.whatIsMissing.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">7. Missing Evidence & Targeted Disclosure Checklist</h2>
          <p class="prose-text">Records referenced or implied by this document that are absent from the submitted filing. Counsel should formally request these items under Rule 19:</p>
          <ol style="padding-left:18px; margin:0; font-size:10px; line-height:1.6; color:#1e293b;">
            ${report.whatIsMissing.map((m: string) => `<li style="margin-bottom:6px;">${escapeHtml(m)}</li>`).join("")}
          </ol>
        </section>
      ` : ""}

      <!-- 9. QUESTIONS FOR COUNSEL -->
      ${Array.isArray(report.whatToAskALawyer) && report.whatToAskALawyer.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">8. Questions for Legal Counsel</h2>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${report.whatToAskALawyer.map((q: string, idx: number) => `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px;">
                <strong style="color:#1e3a8a; font-size:10px;">Q${idx + 1}: ${escapeHtml(q)}</strong>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}

      <!-- ITEMS TO VERIFY -->
      ${Array.isArray(report.whatToVerify) && report.whatToVerify.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">8. Items to Verify</h2>
          <ol style="padding-left:18px; margin:0; font-size:10px; line-height:1.6; color:#1e293b;">
            ${report.whatToVerify.map((v: string) => `<li style="margin-bottom:6px;">${escapeHtml(v)}</li>`).join("")}
          </ol>
        </section>
      ` : ""}

      <!-- 10. LAWYER CASE BRIEF -->
      ${Array.isArray(report.lawyerCaseBrief) && report.lawyerCaseBrief.length > 0 ? `
        <section class="section-block">
          <h2 class="section-heading">9. Lawyer Case Brief — Litigation Points</h2>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${report.lawyerCaseBrief.map((b: string, idx: number) => {
              const point = parseCaseBriefPoint(b);
              const body = point.structured
                ? CASE_BRIEF_PART_ORDER.filter((k) => k !== "issue" && point.parts[k]).map((k) => `
                  <div style="margin-top:5px;">
                    <span style="display:block; font-size:7.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#475569;">${escapeHtml(CASE_BRIEF_PART_LABELS[k])}</span>
                    <span style="display:block; font-size:10px; color:#0f172a;">${escapeHtml(point.parts[k] as string)}</span>
                  </div>`).join("")
                : `<span style="font-size:10px; color:#0f172a;">${escapeHtml(point.text)}</span>`;
              return `
              <div style="border-left:3px solid #1e3a8a; padding:6px 12px; background:#f8fafc; page-break-inside:avoid;">
                <strong style="font-size:10.5px; color:#1e3a8a;">${idx + 1}. ${escapeHtml(point.structured && point.parts.issue ? point.parts.issue : "Brief point")}</strong>
                ${body}
              </div>`;
            }).join("")}
          </div>
        </section>
      ` : ""}

      <!-- 11. REFERENCE LIST OF LEGAL AUTHORITIES -->
      <section class="section-block">
        <h2 class="section-heading">10. Reference List of Legal Authorities</h2>
        <p class="prose-text">Reference list: core CYFSA provisions commonly relevant to child-protection reviews, plus provisions cited in this report that match the app's authority registry. Inclusion here does not mean the provision applies to this case. Check the current text on Ontario e-Laws before relying on it.</p>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:22%;">Citation</th>
              <th style="width:30%;">Official Heading</th>
              <th>Statutory Summary & Authoritative Link</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(authoritiesMap.values()).map(a => `
              <tr>
                <td><strong>${escapeHtml(a.citation)}</strong></td>
                <td>${escapeHtml(a.heading)}</td>
                <td>
                  ${escapeHtml(a.legalTestSummary)}<br/>
                  <a href="${a.sourceUrl}" target="_blank" style="color:#2563eb; font-size:8.5px; text-decoration:underline;">${a.sourceUrl}</a>
                  <span style="color:#64748b; font-size:8px; display:block;">${escapeHtml(a.consolidationPeriod)}</span>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>

      <!-- 11. AGENCY COMPLIANCE & EVIDENCE MATRIX -->
      ${report.complianceMatrix && report.complianceMatrix.items?.length > 0 ? `
      <section class="section-block">
        <h2 class="section-heading">11. Agency Compliance & Evidence Matrix</h2>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px; margin-bottom:12px; font-size:9px; color:#334155;">
          <strong>Non-Prejudgment Standard:</strong> ${escapeHtml(report.complianceMatrix.neutralityAndMethodologyDisclaimer || report.complianceMatrix.missingRecordsWarning || "Absence of a documented action in uploaded records does not prove the agency breached its duty. Other internal files, unfiled disclosures, or supervisory notes may exist.")}
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:20%;">Mandate / Citation</th>
              <th style="width:16%;">Compliance Status</th>
              <th style="width:34%;">Documented Action / Excerpts</th>
              <th style="width:30%;">Courtroom Evidentiary Framing</th>
            </tr>
          </thead>
          <tbody>
            ${report.complianceMatrix.items.map((item: any) => `
              <tr>
                <td>
                  <strong>${escapeHtml(item.authority?.exactSectionOrStandard || item.authority?.legalCitation || "")}</strong><br/>
                  <span style="font-size:8.5px; color:#475569;">${escapeHtml(item.title || item.obligation?.requiredAction || "")}</span>
                </td>
                <td>
                  <span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:8.5px; font-weight:700; ${
                    item.assessment?.complianceStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE" ? "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;" :
                    item.assessment?.complianceStatus === "POTENTIAL_NONCOMPLIANCE" ? "background:#fff1f2; color:#9f1239; border:1px solid #fecdd3;" :
                    item.assessment?.complianceStatus === "PARTIAL_COMPLIANCE" ? "background:#fffbeb; color:#92400e; border:1px solid #fde68a;" :
                    "background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;"
                  }">
                    ${escapeHtml(item.assessment?.complianceStatus?.replace(/_/g, " ") || "")}
                  </span>
                </td>
                <td style="font-size:8.5px;">
                  ${escapeHtml(item.evidence?.exactExcerpt || "Not documented in record.")}
                  ${item.evidence?.corroboratingEvidence?.length ? `<div style="font-style:italic; color:#64748b; margin-top:4px;">\"${escapeHtml(item.evidence.corroboratingEvidence[0])}\"</div>` : ""}
                </td>
                <td style="font-size:8.5px; color:#1e293b;">
                  ${escapeHtml(item.presentation?.courtroomMode?.evidentialGapOrInconsistency || "Not stated.")}
                  ${item.presentation?.courtroomMode?.targetedDisclosureOrClarificationRequest?.length ? `<div style="color:#475569; margin-top:4px;"><strong>Request:</strong> ${escapeHtml(item.presentation.courtroomMode.targetedDisclosureOrClarificationRequest[0])}</div>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
      ` : ""}

      <!-- 12. METHODOLOGY & AUDIT TRAIL -->
      <footer style="margin-top:30px; padding-top:14px; border-top:1px solid #cbd5e1; font-size:8.5px; color:#64748b; line-height:1.4;">
        <p><strong>Method:</strong> Automated AI review of the uploaded document. ${secondReviewDone ? "A second model checked the findings against the uploaded text." : "The second review was not completed for this report."} Check every quotation and page reference against the original document, and confirm statute text on Ontario e-Laws before relying on it.</p>
        <p>CYFSA Navigator • Ontario Child Welfare File Organizer & Case Assistant • Confidential Legal Preparation Document</p>
      </footer>
    </body>
    </html>
  `;
  let sectionNumber = 0;
  return html.replace(/(<h2 class="section-heading">)\d+\. /g, (_match, open) => `${open}${++sectionNumber}. `);
}
