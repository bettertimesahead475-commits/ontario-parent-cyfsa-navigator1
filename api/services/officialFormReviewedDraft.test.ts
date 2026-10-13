import { describe, it, expect } from "vitest";
import { createReviewedFormDraft, reviewFormField, getReviewedValuesForPopulation } from "./officialFormReviewedDraft.js";
const sha="a".repeat(64);
describe("official form user review", () => {
 it("rejects unverified template identity", () => expect(() => createReviewedFormDraft("14A","not-a-hash",[])).toThrow());
 it("requires citations for derived evidence", () => expect(() => createReviewedFormDraft("14A",sha,[{fieldKey:"statement",value:"claim",provenance:"MACHINE_SUGGESTED"}])).toThrow());
 it("rejects duplicate field identities", () => expect(() => createReviewedFormDraft("14A",sha,[{fieldKey:"x",value:"a",provenance:"USER_ENTERED"},{fieldKey:"x",value:"b",provenance:"USER_ENTERED"}])).toThrow());
 it("does not export unreviewed or rejected suggestions", () => { const d=createReviewedFormDraft("14A",sha,[{fieldKey:"name",value:"X",provenance:"USER_ENTERED"}]);expect(()=>getReviewedValuesForPopulation(d)).toThrow();expect(()=>getReviewedValuesForPopulation(reviewFormField(d,"name","REJECTED"))).toThrow(); });
 it("only releases accepted reviewed values and marks corrections as user entered", () => { const d=createReviewedFormDraft("14A",sha,[{fieldKey:"name",value:"AI guess",provenance:"MACHINE_SUGGESTED",sourceReference:"document:1"}]);const approved=reviewFormField(d,"name","ACCEPTED","Correct name");expect(approved.fields[0].provenance).toBe("USER_ENTERED");expect(getReviewedValuesForPopulation(approved)).toEqual({name:"Correct name"}); });
});
