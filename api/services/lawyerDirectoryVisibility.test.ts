// While the public directory is paused, the public routes return no listing and the service is never asked for one.
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./lawyerDirectory.js", () => ({
  searchDirectory: vi.fn(async () => [{ id: "listing-1" }]),
  getPublicProfile: vi.fn(async () => ({ id: "listing-1" })),
  claimProfile: vi.fn(),
}));
vi.mock("./firebaseAdmin.js", () => ({ verifyFirebaseToken: vi.fn() }));

const { registerLawyerDirectoryRoutes } = await import("../lawyerDirectoryRoutes.js");
const { searchDirectory, getPublicProfile } = await import("./lawyerDirectory.js");
const { PUBLIC_DIRECTORY_VISIBLE } = await import("../../shared/lawyerDirectoryPolicy.js");

const app = express();
app.use(express.json());
registerLawyerDirectoryRoutes(app);

describe("public lawyer directory visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the directory is paused: the policy switch is off", () => {
    expect(PUBLIC_DIRECTORY_VISIBLE).toBe(false);
  });

  it("search returns no listings and does not query the directory", async () => {
    const res = await request(app).post("/api/directory/search").send({ locality: "London" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(searchDirectory).not.toHaveBeenCalled();
  });

  it("a profile lookup is not found and does not query the directory", async () => {
    const res = await request(app).get("/api/directory/profiles/listing-1");
    expect(res.status).toBe(404);
    expect(getPublicProfile).not.toHaveBeenCalled();
  });
});
