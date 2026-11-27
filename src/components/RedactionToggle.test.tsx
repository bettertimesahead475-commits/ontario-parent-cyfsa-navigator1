/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RedactionToggle from "./RedactionToggle";

afterEach(cleanup);

describe("RedactionToggle accessibility", () => {
  it("exposes a named switch whose checked state follows the setting", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<RedactionToggle enabled={false} onToggle={onToggle} />);
    const sw = screen.getByRole("switch", { name: "Hide names & case numbers" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<RedactionToggle enabled onToggle={onToggle} />);
    expect(screen.getByRole("switch", { name: "Hide names & case numbers" }).getAttribute("aria-checked")).toBe("true");
  });
});
