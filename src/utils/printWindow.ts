/**
 * Finishes a same-origin print window opened with window.open("") and filled with document.write().
 *
 * The printed HTML must not contain inline <script> tags or inline event handlers: the site's Content
 * Security Policy forbids them, and the print dialog would silently stop opening. Instead, this attaches
 * the click handler for any [data-print-button] element and opens the print dialog from the opener page.
 */
export function finishPrintWindow(printWindow: Window, options: { autoPrint?: boolean; delayMs?: number } = {}): void {
  const { autoPrint = true, delayMs = 600 } = options;
  try {
    printWindow.document.querySelectorAll("[data-print-button]").forEach((button) => {
      button.addEventListener("click", () => printWindow.print());
    });
  } catch { /* The window was closed or navigated away. */ }
  if (!autoPrint) return;
  setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch { /* The window was closed before printing. */ }
  }, delayMs);
}
