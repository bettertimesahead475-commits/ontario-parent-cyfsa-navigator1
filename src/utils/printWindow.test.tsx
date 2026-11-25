// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { finishPrintWindow } from "./printWindow";

function fakeWindow(html: string) {
  document.body.innerHTML = html;
  return { document, print: vi.fn(), focus: vi.fn() } as unknown as Window & { print: ReturnType<typeof vi.fn> };
}

describe("print windows without inline scripts (CSP compatible)", () => {
  it("wires [data-print-button] and auto-prints by default", async () => {
    vi.useFakeTimers();
    const w = fakeWindow('<button data-print-button>Print</button>');
    finishPrintWindow(w);
    (document.querySelector("[data-print-button]") as HTMLButtonElement).click();
    expect(w.print).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    expect(w.print).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("prints only on request when autoPrint is false", () => {
    vi.useFakeTimers();
    const w = fakeWindow('<button data-print-button>Print</button>');
    finishPrintWindow(w, { autoPrint: false });
    vi.advanceTimersByTime(2000);
    expect(w.print).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("no export template contains an inline script or inline event handler", async () => {
    const fs = await import("node:fs");
    for (const f of ["src/utils/forensicPdfRenderer.ts", "src/utils/printExport.ts", "src/components/DocumentAnalyzerTab.tsx", "src/components/CYFSAGuideTab.tsx", "src/components/TemplatesTab.tsx"]) {
      const text = fs.readFileSync(f, "utf8");
      expect({ f, scripts: (text.match(/<script>/g) || []).length, handlers: (text.match(/\sonclick="/g) || []).length }).toEqual({ f, scripts: 0, handlers: 0 });
    }
  });
});
