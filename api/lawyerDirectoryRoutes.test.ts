import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerLawyerDirectoryRoutes } from "./lawyerDirectoryRoutes.js";
import { getPublicProfile, searchDirectory, claimProfile } from "./services/lawyerDirectory.js";

vi.mock("./services/lawyerDirectory.js", () => ({
  searchDirectory: vi.fn(),
  getPublicProfile: vi.fn(),
  claimProfile: vi.fn()
}));

vi.mock("./services/firebaseAdmin.js", () => ({
  verifyFirebaseToken: vi.fn()
}));

const app = express();
app.use(express.json());
registerLawyerDirectoryRoutes(app, { publicVisible: true });

describe("Stage 7E API Discovery and Privacy Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("arbitrary Ontario locality can be submitted to search", async () => {
    vi.mocked(searchDirectory).mockResolvedValueOnce([{ id: 'prof-1', matchReasons: ['OFFICE_NEARBY'] } as any]);
    const res = await request(app).post('/api/directory/search').send({ locality: 'Sudbury' });
    expect(res.status).toBe(200);
    expect(searchDirectory).toHaveBeenCalledWith({ locality: 'Sudbury' });
    expect(res.body[0].matchReasons).toContain('OFFICE_NEARBY');
  });

  it("CYFSA filter renders only appropriate listings", async () => {
    vi.mocked(searchDirectory).mockResolvedValueOnce([{ id: 'prof-1', matchReasons: ['CHILD_PROTECTION_PRACTICE'] } as any]);
    const res = await request(app).post('/api/directory/search').send({ requiresCyfsa: true });
    expect(res.status).toBe(200);
    expect(searchDirectory).toHaveBeenCalledWith({ requiresCyfsa: true });
    expect(res.body[0].matchReasons).toContain('CHILD_PROTECTION_PRACTICE');
  });

  it("combined locality + CYFSA works", async () => {
    vi.mocked(searchDirectory).mockResolvedValueOnce([{ id: 'prof-1', matchReasons: ['OFFICE_NEARBY', 'CHILD_PROTECTION_PRACTICE'] } as any]);
    const res = await request(app).post('/api/directory/search').send({ locality: 'Toronto', requiresCyfsa: true });
    expect(res.status).toBe(200);
    expect(searchDirectory).toHaveBeenCalledWith({ locality: 'Toronto', requiresCyfsa: true });
    expect(res.body[0].matchReasons).toContain('OFFICE_NEARBY');
    expect(res.body[0].matchReasons).toContain('CHILD_PROTECTION_PRACTICE');
  });

  it("public profile route returns 404 for profile not found", async () => {
    vi.mocked(getPublicProfile).mockResolvedValueOnce(null);
    const res = await request(app).get('/api/directory/profiles/not-exist');
    expect(res.status).toBe(404);
  });

  it("public route does not expose private email, matter memberships, or reviews", async () => {
    vi.mocked(getPublicProfile).mockResolvedValueOnce({
      id: 'prof-1',
      displayName: 'Jane Doe',
      // The service layer strips the others, but let's just make sure the route doesn't somehow inject them
      publicEmail: 'jane@example.com'
    } as any);
    const res = await request(app).get('/api/directory/profiles/prof-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('prof-1');
    expect(res.body.privateEmail).toBeUndefined();
    expect(res.body.accountId).toBeUndefined();
    expect(res.body.matterMemberships).toBeUndefined();
    expect(res.body.professionalReviews).toBeUndefined();
    expect(res.body.matterIntelligence).toBeUndefined();
  });
});

describe("Directory errors never expose internal configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a configuration failure is a generic, retryable 503 with no internal setup text", async () => {
    vi.mocked(searchDirectory).mockRejectedValueOnce(
      new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured. Set them in Vercel → Project → Settings.")
    );
    const res = await request(app).post("/api/directory/search").send({ city: "London" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DIRECTORY_UNAVAILABLE");
    expect(res.body.retryable).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/SUPABASE|Vercel|Settings|configured/i);
  });

  it("an expected lifecycle failure keeps its customer message and status", async () => {
    const { LifecycleError } = await import("./services/lifecycleErrors.js");
    vi.mocked(searchDirectory).mockRejectedValueOnce(
      new LifecycleError(429, "DIRECTORY_RATE_LIMITED", "Too many searches. Please wait a minute.")
    );
    const res = await request(app).post("/api/directory/search").send({ city: "London" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DIRECTORY_RATE_LIMITED");
    expect(res.body.error).toBe("Too many searches. Please wait a minute.");
  });
});
