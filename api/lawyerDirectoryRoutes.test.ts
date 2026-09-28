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
registerLawyerDirectoryRoutes(app);

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

describe("Lawyer Directory Route Resilience and Error Sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successful directory search returns HTTP 200 with results", async () => {
    vi.mocked(searchDirectory).mockResolvedValueOnce([{ id: 'prof-1', matchReasons: ['OFFICE_NEARBY'] } as any]);
    const res = await request(app).post('/api/directory/search').send({ locality: 'Sudbury' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'prof-1', matchReasons: ['OFFICE_NEARBY'] }]);
  });

  it("legitimate empty search returns HTTP 200 with []", async () => {
    vi.mocked(searchDirectory).mockResolvedValueOnce([]);
    const res = await request(app).post('/api/directory/search').send({ locality: 'UnknownCity' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("infrastructure failure returns HTTP 503 with controlled sanitized error message", async () => {
    vi.mocked(searchDirectory).mockRejectedValueOnce(new Error("Search failed: TypeError: fetch failed\n    at internal/deps/undici/undici.js:1234\n    at SupabaseClient.from (secret_url_key=123)"));
    const res = await request(app).post('/api/directory/search').send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'DIRECTORY_TEMPORARILY_UNAVAILABLE',
      error: 'The directory is temporarily unavailable. Please try again.'
    });
    // Ensure no stack traces, raw error strings, Supabase credentials or DB details are exposed
    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("fetch failed");
    expect(responseText).not.toContain("secret_url_key");
    expect(responseText).not.toContain("undici");
  });

  it("profile route returns HTTP 503 with controlled error message on infrastructure failure", async () => {
    vi.mocked(getPublicProfile).mockRejectedValueOnce(new Error("Get profile failed: ECONNRESET"));
    const res = await request(app).get('/api/directory/profiles/prof-1');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'DIRECTORY_TEMPORARILY_UNAVAILABLE',
      error: 'The directory is temporarily unavailable. Please try again.'
    });
  });
});
