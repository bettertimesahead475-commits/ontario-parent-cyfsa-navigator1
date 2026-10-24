import React, { useEffect, useId, useRef, useState } from "react";
import { apiFetch, safeReadJson } from "../utils/api";

type Fetcher = typeof apiFetch;

interface SourceLocator {
  documentId: string;
  page: number | null;
  paragraph: string | null;
  quote: string | null;
}

interface AllegationView {
  id: string;
  kind: string;
  text: string;
  madeBy: string | null;
  status: string;
  classification: string;
  source: SourceLocator | null;
}

interface OrderView {
  id: string;
  description: string;
  source: SourceLocator | null;
}

interface IssueView {
  code: string;
  blocking: boolean;
  detail: string;
}

interface ParentView {
  proceedingId: string;
  fileNumber: string | null;
  partyId: string;
  partyName: string;
  roles: string[];
  specificAllegations: AllegationView[];
  sharedAllegations: AllegationView[];
  unattributedAllegations: AllegationView[];
  relatedOrders: OrderView[];
  issues: IssueView[];
  otherProceedingIds: string[];
}

interface Pair {
  partyId: string;
  proceedingId: string;
}

interface Options {
  parties: { partyId: string; partyName: string }[];
  proceedings: { proceedingId: string; fileNumber: string | null }[];
  pairs: Pair[];
  selectionRequired: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  UNRESOLVED: "Not yet decided",
  ADMITTED: "Admitted",
  DISPUTED: "Disputed",
  CORROBORATED: "Corroborated",
  UNSUPPORTED: "Not supported so far",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  DIRECT: "Direct evidence",
  DOCUMENTARY: "Document",
  CORROBORATED: "Corroborated",
  HEARSAY: "Second-hand account",
  INFERENCE: "Inference",
  OPINION: "Opinion",
  UNSUPPORTED: "Not supported so far",
  UNCLEAR: "Unclear",
};

const pairKey = (pair: Pair) => `${pair.partyId}|${pair.proceedingId}`;

function caseLabel(proceedingId: string, fileNumber: string | null): string {
  return fileNumber ? `case ${fileNumber}` : `case without a file number (${proceedingId})`;
}

function citationFor(source: SourceLocator | null): string {
  if (!source) return "No citation";
  const parts = [source.paragraph ? `paragraph ${source.paragraph}` : null, source.page ? `page ${source.page}` : null];
  return parts.filter(Boolean).join(", ") || "Location not given";
}

/**
 * Parent and proceeding selection for the analyzer report. Renders nothing unless the client flag is on and the
 * report carries a parent view job. The server decides what is shown. This component never chooses a parent for
 * the user: a view appears only after the user picks a pair and asks for it.
 */
export function ParentAttributionSection({
  report,
  enabled,
  fetcher = apiFetch,
}: {
  report: unknown;
  enabled: boolean;
  fetcher?: Fetcher;
}) {
  const jobId = (report as { parentViewJobId?: unknown } | null)?.parentViewJobId;
  if (!enabled || typeof jobId !== "string" || !jobId) return null;
  return <ParentAttributionPanel jobId={jobId} fetcher={fetcher} />;
}

function ParentAttributionPanel({ jobId, fetcher }: { jobId: string; fetcher: Fetcher }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [choice, setChoice] = useState<string>("");
  const [view, setView] = useState<{ view: ParentView; drafting: { status: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const requestCounter = useRef(0);
  const headingId = useId();
  const groupName = useId();
  const base = `/api/analyze/job/${encodeURIComponent(jobId)}/parent-view`;

  const loadView = async (pair: Pair) => {
    const request = ++requestCounter.current;
    setBusy(true);
    setViewError(null);
    try {
      const response = await fetcher(
        `${base}?proceedingId=${encodeURIComponent(pair.proceedingId)}&partyId=${encodeURIComponent(pair.partyId)}`,
      );
      const data = await safeReadJson(response);
      if (request !== requestCounter.current) return;
      if (!response.ok) {
        setView(null);
        setViewError("This view could not be loaded. Choose the parent and case again.");
        return;
      }
      setView(data);
    } catch {
      if (request === requestCounter.current) {
        setView(null);
        setViewError("This view could not be loaded. Check your connection and try again.");
      }
    } finally {
      if (request === requestCounter.current) setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setOptions(null);
    setView(null);
    setChoice("");
    fetcher(base)
      .then(async response => {
        const data = await safeReadJson(response);
        if (cancelled) return;
        if (response.ok) {
          setOptions(data.options);
          setStatus("ready");
        } else {
          setStatus(data.code === "NO_PARENT_ANALYSIS" || data.code === "FEATURE_NOT_AVAILABLE" ? "unavailable" : "error");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [base, fetcher]);

  // With exactly one possible parent and case there is no choice to make, so its view is shown directly.
  useEffect(() => {
    if (options && !options.selectionRequired && options.pairs.length === 1) {
      void loadView(options.pairs[0]);
    }
    // loadView is recreated each render; the effect should run only when the options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  if (status === "unavailable") return null;

  const selectedPair = options?.pairs.find(pair => pairKey(pair) === choice) ?? null;
  const labelFor = (pair: Pair) => {
    const party = options?.parties.find(p => p.partyId === pair.partyId);
    const proceeding = options?.proceedings.find(p => p.proceedingId === pair.proceedingId);
    return `${party?.partyName ?? "Parent"}, ${caseLabel(pair.proceedingId, proceeding?.fileNumber ?? null)}`;
  };

  return (
    <section aria-labelledby={headingId} className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 id={headingId} className="text-lg font-bold text-slate-900">
        Parent-specific view
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        Where a document names more than one parent or case, choose which one this view is for. Allegations are
        shown only when the document ties them to that parent. Nothing here is a court decision unless the document
        says so.
      </p>

      {status === "loading" && (
        <p role="status" className="mt-3 text-sm text-slate-700">
          Loading the parent choices…
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          The parent view is not available right now. Try again later.
        </p>
      )}

      {status === "ready" && options && options.pairs.length > 1 && (
        <form
          className="mt-3 space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (selectedPair) void loadView(selectedPair);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-900">Which parent and case?</legend>
            {options.pairs.map(pair => {
              const key = pairKey(pair);
              const inputId = `${groupName}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
              return (
                <div key={key} className="flex items-center gap-2">
                  <input
                    id={inputId}
                    type="radio"
                    name={groupName}
                    value={key}
                    checked={choice === key}
                    onChange={() => setChoice(key)}
                    className="h-4 w-4 focus-visible:outline focus-visible:outline-2"
                  />
                  <label htmlFor={inputId} className="text-sm text-slate-900">
                    {labelFor(pair)}
                  </label>
                </div>
              );
            })}
          </fieldset>
          <button
            type="submit"
            disabled={!selectedPair || busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2"
          >
            Show this parent's view
          </button>
        </form>
      )}

      <div aria-live="polite" className="mt-3 text-sm">
        {busy && <p role="status" className="text-slate-700">Loading the view…</p>}
        {viewError && <p role="alert" className="text-red-800">{viewError}</p>}
      </div>

      {view && !busy && <ParentViewBody data={view} />}
    </section>
  );
}

function ParentViewBody({ data }: { data: { view: ParentView; drafting: { status: string } } }) {
  const { view } = data;
  const heading = `${view.partyName}, ${caseLabel(view.proceedingId, view.fileNumber)}`;
  return (
    <div className="mt-4 space-y-5 border-t border-slate-200 pt-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">{heading}</h3>
        {view.roles.length > 0 && <p className="text-sm text-slate-700">Roles in this case: {view.roles.join(", ").toLowerCase().replace(/_/g, " ")}</p>}
      </div>

      <AllegationList title="Allegations about this parent" items={view.specificAllegations} empty="No allegation in the document is tied only to this parent." />
      <AllegationList title="Allegations shared with another party" items={view.sharedAllegations} empty="No shared allegations." />
      <AllegationList title="Not tied to a specific party" items={view.unattributedAllegations} empty="No allegations without a named subject." />

      <section aria-label="Proposed orders">
        <h4 className="text-sm font-semibold text-slate-900">Orders and proposals</h4>
        {view.relatedOrders.length === 0 ? (
          <p className="text-sm text-slate-700">No order or proposal in the document is linked to this parent.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {view.relatedOrders.map(order => (
              <li key={order.id} className="rounded-lg bg-white p-3 text-sm text-slate-900">
                <p>{order.description}</p>
                <p className="mt-1 text-xs text-slate-600">Citation: {citationFor(order.source)}</p>
                {order.source?.quote && <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-700">{order.source.quote}</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.issues.length > 0 && (
        <section aria-label="Items to check">
          <h4 className="text-sm font-semibold text-slate-900">Items to check before relying on this view</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800">
            {view.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                {issue.detail}
                {issue.blocking ? " (blocks drafting for this parent)" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.otherProceedingIds.length > 0 && (
        <p className="text-sm text-slate-700">
          This parent is also named in {view.otherProceedingIds.length} other case(s). Those cases are not merged into
          this view. Choose them above to see their own view.
        </p>
      )}

      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Drafting a Form 33B or a Plan of Care is not available yet.
      </p>
    </div>
  );
}

function AllegationList({ title, items, empty }: { title: string; items: AllegationView[]; empty: string }) {
  return (
    <section aria-label={title}>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-slate-700">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map(item => (
            <li key={item.id} className="rounded-lg bg-white p-3 text-sm text-slate-900">
              <p>{item.text}</p>
              <p className="mt-1 text-xs text-slate-600">
                {item.kind === "FINDING" ? "Court finding, as stated in the document" : "Allegation"} ·{" "}
                {STATUS_LABELS[item.status] ?? "Status unclear"} ·{" "}
                {CLASSIFICATION_LABELS[item.classification] ?? "Unclear"}
              </p>
              {item.madeBy && <p className="text-xs text-slate-600">Made by: {item.madeBy}</p>}
              <p className="text-xs text-slate-600">Citation: {citationFor(item.source)}</p>
              {item.source?.quote && <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-xs text-slate-700">{item.source.quote}</blockquote>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
