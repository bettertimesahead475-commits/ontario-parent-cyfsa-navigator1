/** Conservative output checks. This module handles only document-local evidence;
 * legal authority still requires a separately maintained authoritative source. */
export function normalizeAnalyzerReport(report: any, documentText: string): any {
  const text = documentText.replace(/\s+/g, " ").toLocaleLowerCase();
  const appearsInDocument = (value: unknown) => {
    if (typeof value !== "string" || value.trim().length < 12) return false;
    const phrase = value.replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLocaleLowerCase();
    return text.includes(phrase) || text.includes(phrase.replace(/^"|"$/g, ""));
  };

  if (Array.isArray(report.redFlags)) {
    report.redFlags = report.redFlags.filter((flag: any) => {
      // A purported exact document quotation that cannot be located is unsafe to show.
      return flag && appearsInDocument(flag.phraseDetected);
    }).map((flag: any) => {
      const category = String(flag.category || "");
      if (/authority overreach/i.test(category) && /warrantless|without a warrant/i.test(String(flag.phraseDetected))) {
        flag.category = "Warrantless apprehension — statutory authority review";
      }
      return flag;
    });
  }

  if (Array.isArray(report.proceduralTimelineViolations)) {
    report.proceduralTimelineViolations = report.proceduralTimelineViolations.filter((item: any) => {
      if (!item) return false;
      const rule = String(item.timelineRule || "");
      if (/parentage|300.day/i.test(rule)) return /parentage|paternity|parent status|parenthood|biological parent/i.test(text);
      if (/ombudsman|continuous care/i.test(rule)) return /ombudsman|rights in care|visit in care/i.test(text);
      if (/adjournment|30.day/i.test(rule)) return /adjourn|court date|hearing date/i.test(text);
      if (/place of safety|five.day|apprehension|without warrant/i.test(rule)) return /apprehend|place of safety|remov|taken into care/i.test(text);
      return true;
    }).map((item: any) => {
      if (/five.day|place of safety|post.apprehension/i.test(String(item.timelineRule))) {
        item.timelineRule = "CYFSA s.88 — time in place of safety";
        item.citation = "CYFSA, s.88 (Ontario e-Laws: https://www.ontario.ca/laws/statute/17c14)";
        // We cannot use a reported removal date as proof of a hearing date or breach.
        if (!/court|hearing|return|agreement/i.test(text)) {
          item.evaluation = "Law verified: CYFSA s.88. Compliance not determinable from this document: obtain the date brought to a place of safety and the first court endorsement, return record or temporary agreement.";
        }
      }
      return item;
    });
  }

  const index = report.evidenceStrengthIndex;
  if (index && typeof index === "object" && index.components) {
    const components = Object.values(index.components) as Array<{score?: number; max?: number}>;
    const valid = components.length === 8 && components.every(c => Number.isInteger(c?.score) && Number.isInteger(c?.max) && c.score! >= 0 && c.score! <= c.max!);
    if (valid && components.reduce((n, c) => n + c.max!, 0) === 100) {
      index.score = components.reduce((n, c) => n + c.score!, 0);
      index.scoreStatus = "DESCRIPTIVE_ONLY";
      index.documentationCategory = (report.redFlags?.length || 0) === 0
        ? "No source-checked findings identified"
        : (report.redFlags?.length || 0) < 4
          ? "Some source-checked findings"
          : "Multiple source-checked findings";
      index.method = "The eight component explanations are model assessments. Their numerical ratings are withheld because repeat analyses may differ. The displayed category counts findings with quotations checked against the uploaded text; it does not measure truth, admissibility or legal merit.";
    } else {
      delete report.evidenceStrengthIndex;
    }
  }
  return report;
}
