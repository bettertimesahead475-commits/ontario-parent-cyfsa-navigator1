// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { finishPrintWindow } from "./printWindow";

function fakeWindow(html: string, { readyState = "complete", fonts }: { readyState?: string; fonts?: Promise<void> } = {}) {
  document.body.innerHTML = html;
  const doc = {
    readyState,
    fonts: fonts && { ready: fonts, status: "loading" },
    body: document.body,
    querySelectorAll: document.querySelectorAll.bind(document),
  };
  return Object.assign(new EventTarget(), { document: doc, print: vi.fn(), focus: vi.fn() }) as unknown as Window & { print: ReturnType<typeof vi.fn> };
}

describe("print windows without inline scripts (CSP compatible)", () => {
  afterEach(() => vi.useRealTimers());

  it("wires [data-print-button] and auto-prints by default", async () => {
    vi.useFakeTimers();
    const w = fakeWindow('<button data-print-button>Print</button>');
    finishPrintWindow(w);
    (document.querySelector("[data-print-button]") as HTMLButtonElement).click();
    expect(w.print).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.print).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for window load and font readiness without waiting out the timeout", async () => {
    vi.useFakeTimers();
    let resolveFonts!: () => void;
    const fonts = new Promise<void>((resolve) => { resolveFonts = resolve; });
    const w = fakeWindow("", { readyState: "loading", fonts });
    finishPrintWindow(w);
    await vi.advanceTimersByTimeAsync(20);
    expect(w.print).not.toHaveBeenCalled();
    w.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(20);
    expect(w.print).not.toHaveBeenCalled();
    resolveFonts();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.print).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops pending export fonts at the deadline and only prints once", async () => {
    vi.useFakeTimers();
    const w = fakeWindow('<link rel="stylesheet" data-print-fonts href="https://example.invalid/fonts.css">', { readyState: "loading" });
    finishPrintWindow(w);
    await vi.advanceTimersByTimeAsync(599);
    expect(w.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector("[data-print-fonts]")).toBeNull();
    expect(w.print).toHaveBeenCalledTimes(1);
    w.dispatchEvent(new Event("load"));
    await vi.runAllTimersAsync();
    expect(w.print).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending font stylesheet even if the document reports complete", async () => {
    vi.useFakeTimers();
    const w = fakeWindow('<link rel="stylesheet" data-print-fonts href="https://example.invalid/fonts.css">');
    finishPrintWindow(w);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.print).not.toHaveBeenCalled();
    document.querySelector("[data-print-fonts]")?.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(w.print).toHaveBeenCalledTimes(1);
  });

  it("prints only on request when autoPrint is false", () => {
    vi.useFakeTimers();
    const w = fakeWindow('<button data-print-button>Print</button>');
    finishPrintWindow(w, { autoPrint: false });
    vi.advanceTimersByTime(2000);
    expect(w.print).not.toHaveBeenCalled();
  });

  it("no export template contains an inline script or inline event handler", async () => {
    const fs = await import("node:fs");
    for (const f of ["src/utils/forensicPdfRenderer.ts", "src/utils/printExport.ts", "src/components/DocumentAnalyzerTab.tsx", "src/components/CYFSAGuideTab.tsx", "src/components/TemplatesTab.tsx"]) {
      const text = fs.readFileSync(f, "utf8");
      expect({ f, scripts: (text.match(/<script>/g) || []).length, handlers: (text.match(/\sonclick="/g) || []).length }).toEqual({ f, scripts: 0, handlers: 0 });
    }
  });

  it("registers font stylesheets for readiness in guide, template and transcript exports", async () => {
    const { readFileSync } = await import("node:fs");
    const guide = readFileSync("src/components/CYFSAGuideTab.tsx", "utf8");
    const templates = readFileSync("src/components/TemplatesTab.tsx", "utf8");
    const analyzer = readFileSync("src/components/DocumentAnalyzerTab.tsx", "utf8");
    const transcriptStart = analyzer.indexOf("<title>Print Certified Transcript");
    const transcript = analyzer.slice(transcriptStart, analyzer.indexOf("</html>", transcriptStart));
    for (const html of [guide, templates, transcript]) {
      expect(html).toContain('<link rel="stylesheet" data-print-fonts href="https://fonts.googleapis.com/');
      expect(html).not.toContain("@import");
    }
  });
});
