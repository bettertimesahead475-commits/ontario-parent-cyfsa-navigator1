import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  /** Number of findings in the section. Shown beside the title so collapsed content is still counted. */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Disclosure panel for analyzer findings. Collapsed panels keep their content in the DOM (hidden
 * attribute), so nothing is removed from the report and screen readers still get the full list
 * once it is expanded.
 */
export function CollapsibleSection({ title, count, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <h5>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(current => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-display text-xs font-bold uppercase tracking-wider text-slate-800 hover:bg-slate-50 cursor-pointer"
        >
          <span className="flex items-center gap-2">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-slate-600">
                {count}
              </span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </h5>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
