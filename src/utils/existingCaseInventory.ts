/**
 * Zero-credit, read-only discovery of previously saved analyzer data.
 * Never copies unscoped legacy data into an account or sends it to a server.
 */
import { getUserKey } from "./storage";
export interface ExistingCaseInventory {
  documents: Array<{ id: string; name: string; category: string; hasQuickReview: boolean; hasDeepScan: boolean }>;
  quickReviewCount: number;
  deepScanCount: number;
  legacyDataPresent: boolean;
  warnings: string[];
}
function parseObject(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
  } catch { return null; }
}
export function readExistingCaseInventory(storage: Pick<Storage, "getItem"> = localStorage): ExistingCaseInventory {
  const warnings: string[] = [];
  const key = getUserKey("OPA_DOC_ANALYZER_PROGRESS");
  const deepKey = getUserKey("OPA_DEEPSCAN_REPORTS");
  const legacyDataPresent = !!(storage.getItem("OPA_DOC_ANALYZER_PROGRESS") || storage.getItem("OPA_DEEPSCAN_REPORTS"));
  if (!key || !deepKey) return { documents: [], quickReviewCount: 0, deepScanCount: 0, legacyDataPresent, warnings: ["Sign in to load your own saved case documents."] };
  const progress = parseObject(storage.getItem(key));
  const deep = parseObject(storage.getItem(deepKey));
  if (storage.getItem(key) && !progress) warnings.push("Saved analyzer progress could not be read.");
  const files = Array.isArray(progress?.organizedFiles) ? progress.organizedFiles : [];
  const quick = progress?.quickReviewSnapshots && typeof progress.quickReviewSnapshots === "object" ? progress.quickReviewSnapshots : {};
  const deepReports = { ...(deep || {}), ...((progress?.deepScanReports && typeof progress.deepScanReports === "object") ? progress.deepScanReports : {}) };
  const seen = new Set<string>();
  const documents = files.flatMap((file: any) => {
    if (!file || typeof file !== "object" || typeof file.id !== "string" || seen.has(file.id)) return [];
    seen.add(file.id);
    return [{
      id: file.id,
      name: String(file.name || file.fileName || file.title || "Untitled document"),
      category: String(file.category || "Uncategorized"),
      hasQuickReview: !!(quick[file.id] || file.analysisReport),
      hasDeepScan: !!deepReports[file.id],
    }];
  });
  return {
    documents,
    quickReviewCount: documents.filter(d => d.hasQuickReview).length,
    deepScanCount: documents.filter(d => d.hasDeepScan).length,
    legacyDataPresent,
    warnings,
  };
}
