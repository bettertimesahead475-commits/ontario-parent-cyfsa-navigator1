const PRINT_RESOURCE_TIMEOUT_MS = 600;

async function waitForPrintResources(printWindow: Window): Promise<void> {
  const doc = printWindow.document;
  const fontLinks = Array.from(doc.querySelectorAll<HTMLLinkElement>("link[data-print-fonts]"));
  const cleanup: (() => void)[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const waitForEvent = (target: EventTarget, ...events: string[]) => new Promise<void>((resolve) => {
    const done = () => resolve();
    for (const event of events) {
      target.addEventListener(event, done, { once: true });
      cleanup.push(() => target.removeEventListener(event, done));
    }
  });
  const ready = async () => {
    await Promise.all([
      ...(doc.readyState === "complete" ? [] : [waitForEvent(printWindow, "load")]),
      ...fontLinks.filter((link) => !link.sheet).map((link) => waitForEvent(link, "load", "error")),
    ]);
    if (doc.fonts) {
      doc.body?.getBoundingClientRect();
      await doc.fonts.ready;
    }
  };
  try {
    const loaded = await Promise.race([
      ready().then(() => true),
      new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), PRINT_RESOURCE_TIMEOUT_MS); }),
    ]);
    if (!loaded) {
      fontLinks.forEach((link) => {
        if (!link.sheet || doc.fonts?.status === "loading") link.remove();
      });
    }
  } finally {
    clearTimeout(timeout);
    cleanup.forEach((removeListener) => removeListener());
  }
}

/**
 * Finishes a same-origin print window opened with window.open("") and filled with document.write().
 *
 * The printed HTML must not contain inline <script> tags or inline event handlers: the site's Content
 * Security Policy forbids them, and the print dialog would silently stop opening. Instead, this attaches
 * the click handler for any [data-print-button] element and opens the print dialog from the opener page.
 */
export function finishPrintWindow(printWindow: Window, options: { autoPrint?: boolean } = {}): void {
  const { autoPrint = true } = options;
  try {
    printWindow.document.querySelectorAll("[data-print-button]").forEach((button) => {
      button.addEventListener("click", () => printWindow.print());
    });
  } catch { /* The window was closed or navigated away. */ }
  if (!autoPrint) return;
  const print = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch { /* The window was closed before printing. */ }
  };
  void waitForPrintResources(printWindow).then(print, print);
}
