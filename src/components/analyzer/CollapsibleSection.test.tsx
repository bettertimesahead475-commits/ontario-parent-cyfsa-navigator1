/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleSection } from "./CollapsibleSection";

describe("CollapsibleSection", () => {
  it("starts collapsed, shows the count, and keeps findings in the DOM", () => {
    render(
      <CollapsibleSection title="Missing Elements" count={2}>
        <ul><li>No source named for the statement</li><li>No dated log entry</li></ul>
      </CollapsibleSection>
    );
    const toggle = screen.getByRole("button", { name: /Missing Elements/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2");
    expect(screen.getByText("No source named for the statement")).toBeTruthy();
    expect(screen.getByText("No source named for the statement").closest("[hidden]")).not.toBeNull();
  });

  it("expands and collapses on click and reports the state to assistive tech", () => {
    render(<CollapsibleSection title="Ask Your Lawyer" count={1}><p>Is the hearsay admissible?</p></CollapsibleSection>);
    const toggle = screen.getByRole("button", { name: /Ask Your Lawyer/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Is the hearsay admissible?").closest("[hidden]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
