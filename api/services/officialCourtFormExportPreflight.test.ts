import { describe, expect, it } from "vitest";
import { checkOfficialCourtFormExport } from "./officialCourtFormExportPreflight.js";
const ready = { formNumber:"14A", officialTemplate:true, sourceVerified:true, versionCurrent:true, templateHashVerified:true, fieldMapValidated:true, populatedFromExactTemplate:true, userReviewed:true, unresolvedFields:[], affidavitRequiresCommissioner:true, commissioned:true };
describe("official form export preflight", () => {
 it("rejects an educational worksheet masquerading as an official form", () => { expect(checkOfficialCourtFormExport({...ready,officialTemplate:false}).canExportAsOfficial).toBe(false); });
 it("rejects a stale or unverifiable source", () => { expect(checkOfficialCourtFormExport({...ready,versionCurrent:false,sourceVerified:false}).blockers).toHaveLength(2); });
 it("rejects wrong-template population and unresolved fields", () => { expect(checkOfficialCourtFormExport({...ready,populatedFromExactTemplate:false,unresolvedFields:["party name"]}).canExportAsOfficial).toBe(false); });
 it("does not call an unsigned affidavit filing-ready", () => { const result=checkOfficialCourtFormExport({...ready,commissioned:false}); expect(result.canDescribeAsFilingReady).toBe(false); expect(result.warnings.join(" ")).toMatch(/commissioner/); });
 it("only clears preflight when all safeguards are satisfied", () => { expect(checkOfficialCourtFormExport(ready).canDescribeAsFilingReady).toBe(true); });
});
