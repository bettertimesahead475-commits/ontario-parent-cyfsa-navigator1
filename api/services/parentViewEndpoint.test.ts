import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildCaseModelFromExtraction } from "./parentExtraction.js";

process.env.VERCEL = "1";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.GEMINI_API_KEY = "test-gemini-key";

const verifyToken = vi.fn();
const getJob = vi.fn();
const creditCalls = vi.fn();

vi.mock("./firebaseAdmin.js", async (orig) => ({
  ...(await orig<typeof import("./firebaseAdmin.js")>()),
  verifyFirebaseToken: (...args: unknown[]) => verifyToken(...args),
}));
vi.mock("./analyzerStreaming.js", async (orig) => ({
  ...(await orig<typeof import("./analyzerStreaming.js")>()),
  getAnalysisJobDurable: (...args: unknown[]) => getJob(...args),
}));
vi.mock("./creditAccounting.js", async (orig) => {
  const real = await orig<typeof import("./creditAccounting.js")>();
  const spy = (name: string) => (...args: unknown[]) => {
    creditCalls(name, ...args);
    return (real as Record<string, unknown>)[name] && undefined;
  };
  return { ...real, reserveAnalysisCredit: spy("reserveAnalysisCredit"), recordPaidUse: spy("recordPaidUse") };
});

const { default: app } = await import("../_server.js");

const DOC = [
  "Application FC-24-0001. Respondents: Parent A and Parent B.",
  "Paragraph 12. Parent A left the child alone overnight on two occasions.",
  "Paragraph 14. Parent B has offered to care for the child while the matter is decided.",
].join("\n");

function storedModel() {
  const raw = {
    parties: [
      { id: "P-A", displayName: "Parent A", aliases: [] },
      { id: "P-B", displayName: "Parent B", aliases: [] },
    ],
    proceedings: [{ id: "PROC-1", fileNumber: "FC-24-0001", applicationDate: null, childNames: [] }],
    roles: [
      { proceedingId: "PROC-1", partyId: "P-A", role: "RESPONDENT" },
      { proceedingId: "PROC-1", partyId: "P-B", role: "PROPOSED_CAREGIVER" },
    ],
    allegations: [
      {
        id: "ALG-1", proceedingId: "PROC-1", kind: "ALLEGATION", text: "Left the child alone.",
        madeBy: "Applicant", subjectPartyIds: ["P-A"], status: "UNRESOLVED", classification: "HEARSAY",
        quote: "Parent A left the child alone overnight on two occasions.", page: 1, paragraph: "12",
      },
    ],
    orders: [],
  };
  return buildCaseModelFromExtraction(raw, DOC, "job-1").caseModel;
}

const OWNER = "owner-uid";
const OTHER = "other-uid";

function jobFor(uid: string | null, withAnalysis = true) {
  return {
    jobId: "req_1700000000000_abc",
    uid,
    mode: "fast",
    status: "completed",
    report: withAnalysis ? { parentAttribution: { version: 1, caseModel: storedModel(), rejected: [] } } : {},
  };
}

beforeEach(() => {
  verifyToken.mockReset();
  getJob.mockReset();
  creditCalls.mockReset();
  verifyToken.mockImplementation(async (header?: string) => {
    if (header === "Bearer owner") return { uid: OWNER };
    if (header === "Bearer other") return { uid: OTHER };
    return null;
  });
  getJob.mockResolvedValue(jobFor(OWNER));
  process.env.PARENT_ANALYSIS_ENABLED = "true";
});

const url = "/api/analyze/job/req_1700000000000_abc/parent-view";

describe("parent-view endpoint", () => {
  it("is unavailable while the flag is OFF", async () => {
    delete process.env.PARENT_ANALYSIS_ENABLED;
    const res = await request(app).get(url).set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("requires a signed-in account", async () => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
  });

  it("returns the same not-found response for another account's job as for a missing job", async () => {
    const otherUsers = await request(app).get(url).set("Authorization", "Bearer other");
    getJob.mockResolvedValueOnce(null);
    const missing = await request(app).get(url).set("Authorization", "Bearer owner");
    expect(otherUsers.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(otherUsers.body).toEqual(missing.body);
  });

  it("does not serve a job that has no owner", async () => {
    getJob.mockResolvedValueOnce(jobFor(null));
    const res = await request(app).get(url).set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
  });

  it("returns NO_PARENT_ANALYSIS for a report without the verified model", async () => {
    getJob.mockResolvedValueOnce(jobFor(OWNER, false));
    const res = await request(app).get(url).set("Authorization", "Bearer owner");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_PARENT_ANALYSIS");
  });

  it("lists the choices without choosing one for the user", async () => {
    const res = await request(app).get(url).set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.selection).toBeNull();
    expect(res.body.options.selectionRequired).toBe(true);
    expect(res.body.options.pairs).toEqual([
      { partyId: "P-A", proceedingId: "PROC-1" },
      { partyId: "P-B", proceedingId: "PROC-1" },
    ]);
  });

  it("returns the selected parent's view without the stored model", async () => {
    const res = await request(app)
      .get(`${url}?proceedingId=PROC-1&partyId=P-A`)
      .set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.view.specificAllegations.map((a: { id: string }) => a.id)).toEqual(["ALG-1"]);
    expect(res.body.view.specificAllegations[0].source.quote).toBeTruthy();
    expect(res.body.drafting.status).toBe("NOT_ACTIVATED");
    expect(JSON.stringify(res.body)).not.toContain("caseModel");
  });

  it("rejects a parent and proceeding pair that does not exist", async () => {
    const res = await request(app)
      .get(`${url}?proceedingId=PROC-9&partyId=P-A`)
      .set("Authorization", "Bearer owner");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_A_VALID_CHOICE");
  });

  it("never calls a credit function, and never reads the job for another account", async () => {
    await request(app).get(`${url}?proceedingId=PROC-1&partyId=P-A`).set("Authorization", "Bearer owner");
    await request(app).get(`${url}?proceedingId=PROC-1&partyId=P-B`).set("Authorization", "Bearer owner");
    await request(app).get(url).set("Authorization", "Bearer owner");
    expect(creditCalls).not.toHaveBeenCalled();
  });
});
