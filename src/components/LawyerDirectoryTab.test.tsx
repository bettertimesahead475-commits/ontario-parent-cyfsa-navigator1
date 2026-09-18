/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import LawyerDirectoryTab from "./LawyerDirectoryTab";
import PublicProfileTab from "./PublicProfileTab";

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useRoute: vi.fn(() => [true, { id: 'prof-1' }])
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Stage 7E UI Tests - LawyerDirectoryTab", () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  it("directory route renders properly and interacts with form", async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            id: "prof-1",
            displayName: "John Smith",
            professionalType: "Lawyer",
            lifecycleState: "VERIFIED_LAWYER",
            matchReasons: ["CHILD_PROTECTION_PRACTICE"]
          }]
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => []
      });
    });

    render(<LawyerDirectoryTab />);
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    
    expect(screen.getByText("Ontario Child Welfare Lawyer Directory")).toBeTruthy();
    
    const input = screen.getByPlaceholderText("e.g. Toronto, Sudbury, Kenora...");
    fireEvent.change(input, { target: { value: "Toronto" } });
    
    const submit = screen.getByText("Search Directory");
    fireEvent.click(submit);
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith("/api/directory/search", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          locality: "Toronto",
          requiresCyfsa: false,
          isVirtual: false,
          isOntarioWide: false
        })
      }));
    });
    
    await screen.findByText("John Smith");
  });

  it("handles directory error state safely", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    render(<LawyerDirectoryTab />);
    
    await waitFor(() => {
      expect(screen.getByText("Failed to search directory.")).toBeTruthy();
    });
    expect(screen.queryByText("John Smith")).toBeNull();
  });
});

describe("Stage 7E UI Tests - PublicProfileTab", () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders profile-not-found state for 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404
    });

    render(<PublicProfileTab />);
    
    await waitFor(() => {
      expect(screen.getByText("Profile Not Found")).toBeTruthy();
    });
    expect(screen.getByText("Return to Directory")).toBeTruthy();
  });

  it("renders safe link and filters unsafe links", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "prof-2",
        displayName: "Jane Doe",
        publicWebsite: "javascript:alert(1)"
      })
    });

    render(<PublicProfileTab />);
    
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    expect(screen.queryByText("javascript:alert(1)")).toBeNull();
  });
  
  it("renders safe https link properly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "prof-3",
        displayName: "Jane Doe",
        publicWebsite: "https://example.com"
      })
    });

    render(<PublicProfileTab />);
    
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const link = screen.getByText("https://example.com").closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
