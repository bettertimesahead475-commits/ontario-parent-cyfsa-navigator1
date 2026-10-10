// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { FormattedReportText } from "./FormattedReportText";

describe("FormattedReportText", () => {
  it("renders null gracefully when given null or empty content", () => {
    const { container } = render(<FormattedReportText content={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders plain paragraph text without raw markdown artifacts", () => {
    render(<FormattedReportText content="This is a simple evaluation text." />);
    expect(screen.getByText("This is a simple evaluation text.")).toBeDefined();
  });

  it("converts **bold text** into HTML strong elements", () => {
    const { container } = render(
      <FormattedReportText content="This contains **critical evidence** under review." />
    );
    const strongEl = container.querySelector("strong");
    expect(strongEl).not.toBeNull();
    expect(strongEl?.textContent).toBe("critical evidence");
    // Verify that raw asterisks are not in the rendered text
    expect(container.textContent).not.toContain("**");
  });

  it("formats bulleted lines into structured bullet blocks", () => {
    const markdown = "- Obtain disclosure from CAS\n- Request supervisory notes\n- Consult family counsel";
    const { container } = render(<FormattedReportText content={markdown} />);
    const bullets = container.querySelectorAll("span");
    expect(bullets.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Obtain disclosure from CAS");
    expect(container.textContent).toContain("Request supervisory notes");
    expect(container.textContent).not.toContain("- Obtain");
  });

  it("formats numbered lines into structured numbered blocks", () => {
    const markdown = "1. First procedural step\n2. Second statutory deadline";
    const { container } = render(<FormattedReportText content={markdown} />);
    expect(container.textContent).toContain("1.");
    expect(container.textContent).toContain("First procedural step");
    expect(container.textContent).toContain("2.");
    expect(container.textContent).toContain("Second statutory deadline");
  });

  it("splits paragraphs on newline characters cleanly", () => {
    const markdown = "Paragraph one assessment.\n\nParagraph two recommendation.";
    const { container } = render(<FormattedReportText content={markdown} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe("Paragraph one assessment.");
    expect(paragraphs[1].textContent).toBe("Paragraph two recommendation.");
  });

  it("safely sanitizes escaped newlines and quote sequences", () => {
    const escaped = 'First sentence.\\nSecond sentence.\\n\\"Quoted statement\\"';
    const { container } = render(<FormattedReportText content={escaped} />);
    expect(container.textContent).not.toContain("\\n");
    expect(container.textContent).not.toContain('\\"');
    expect(container.textContent).toContain('"Quoted statement"');
  });
});
