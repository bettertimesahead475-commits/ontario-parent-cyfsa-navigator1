/**
 * @vitest-environment jsdom
 */
// While the directory is paused, the page shows the pause notice and no search form or listings.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LawyerDirectoryTab from "./LawyerDirectoryTab";
import { DIRECTORY_PAUSED_MESSAGE } from "../../shared/lawyerDirectoryPolicy";

afterEach(() => cleanup());

describe("lawyer directory page while paused", () => {
  it("shows the pause notice with the Legal Aid Ontario referral line", () => {
    render(<LawyerDirectoryTab />);
    expect(screen.getByRole("status").textContent).toBe(DIRECTORY_PAUSED_MESSAGE);
    expect(DIRECTORY_PAUSED_MESSAGE).toContain("1-800-668-8258");
  });

  it("offers no search form", () => {
    const { container } = render(<LawyerDirectoryTab />);
    expect(container.querySelector("#directory-filters")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });
});
