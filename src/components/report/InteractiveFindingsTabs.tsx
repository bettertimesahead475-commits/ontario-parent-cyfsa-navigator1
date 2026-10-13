import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { resolveInteractiveFindings, lawyerQuestionToText } from "../../../shared/legalFindings";
import type {
  CharterFinding,
  EvidenceRef,
  FindingBase,
  FindingSectionKey,
  LawyerQuestion,
  LegalReference,
  MissingElement,
  VerificationItem,
} from "../../../shared/legalFindings";
import { AUTHORITY_STATUS_LABEL, quoteLabel } from "../../utils/findingsExport";

type TabKey = FindingSectionKey;

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: "charter", label: "Charter rights issues", hint: "Possible Charter concerns for a lawyer to assess" },
  { key: "verification", label: "Verification checks", hint: "Claims in the document checked against its own text" },
  { key: "missing", label: "Missing elements", hint: "What is absent from the upload and why it matters" },
  { key: "lawyerQuestions", label: "Ask your lawyer", hint: "Questions tied to this report's findings" },
];

const RESULT_STYLE: Record<string, string> = {
  VERIFIED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  CONTRADICTED: "bg-rose-50 text-rose-800 border-rose-200",
  UNVERIFIED: "bg-amber-50 text-amber-800 border-amber-200",
  INCONCLUSIVE: "bg-slate-100 text-slate-700 border-slate-300",
  NOT_APPLICABLE: "bg-slate-50 text-slate-500 border-slate-200",
};

const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = "bg-slate-100 text-slate-700 border-slate-200", children }) => (
  <span className={`inline-block text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${className}`}>{children}</span>
);

const Field: React.FC<{ label: string; children?: React.ReactNode; show?: boolean }> = ({ label, children, show = true }) =>
  show && children ? (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-800 leading-relaxed">{children}</dd>
    </div>
  ) : null;

const Bullets: React.FC<{ items?: string[] }> = ({ items }) =>
  items && items.length ? (
    <ul className="list-disc pl-4 space-y-0.5">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  ) : null;

export const EvidenceList: React.FC<{ evidence: EvidenceRef[] }> = ({ evidence }) => {
  if (!evidence.length) return <span className="text-slate-500">No source passage was identified for this item.</span>;
  return (
    <ul className="space-y-1.5">
      {evidence.map((e, i) => (
        <li key={i} className="border-l-2 border-slate-300 pl-2">
          {e.quote ? <q className="italic">{e.quote}</q> : null}
          {e.locationInDocument ? (
            <span className="block text-[11px] text-slate-600">
              {[e.sourceDocument, e.locationInDocument].filter(Boolean).join(" - ")}
            </span>
          ) : null}
          <Badge className={e.quote && e.quoteVerified ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}>
            {quoteLabel(e)}
          </Badge>
        </li>
      ))}
    </ul>
  );
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const AuthorityCard: React.FC<{ authority: LegalReference }> = ({ authority: a }) => {
  const [copied, setCopied] = useState(false);
  const statusStyle =
    a.status === "VERIFIED" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : a.status === "CANDIDATE" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-rose-50 text-rose-800 border-rose-200";
  // Only a link that has not been found broken is rendered; a lookup link is a plain publisher landing page.
  const href = a.url && a.urlStatus !== "BROKEN" ? a.url : undefined;
  return (
    <li className="border border-slate-200 rounded-lg p-2.5 bg-white space-y-1" data-testid="authority-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <strong className="text-xs text-slate-900">
          {a.citation}
          {a.pinpoint ? `, ${a.pinpoint}` : ""}
        </strong>
        <Badge className={statusStyle}>{AUTHORITY_STATUS_LABEL[a.status]}</Badge>
      </div>
      <div className="text-[11px] text-slate-600">{a.title}</div>
      {a.statuteText ? <div className="text-[11px] text-slate-700">Wording on record: {a.statuteText}</div> : null}
      {a.generallyCitedFor ? <div className="text-[11px] text-slate-700">Generally cited for: {a.generallyCitedFor}</div> : null}
      {a.howItApplies ? <div className="text-[11px] text-slate-800">How it may apply here (for lawyer review): {a.howItApplies}</div> : null}
      {a.limitation ? <div className="text-[11px] text-amber-800">Limitation: {a.limitation}</div> : null}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
            Open source{a.urlStatus === "VERIFIED" ? " (link checked)" : " (link not yet checked)"}
            <span className="sr-only"> - opens in a new tab</span>
          </a>
        ) : a.urlStatus === "BROKEN" ? (
          <span className="text-rose-700">The link for this authority failed a check and is withheld.</span>
        ) : null}
        {!href && a.lookupUrl ? (
          <a href={a.lookupUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
            {a.lookupLabel || "Look it up"}
            <span className="sr-only"> - opens in a new tab</span>
          </a>
        ) : null}
        {!href && !a.lookupUrl && a.urlStatus === "NONE" ? <span className="text-slate-500">No link available. Search the citation at the official source.</span> : null}
        <button
          type="button"
          className="text-slate-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          onClick={async () => setCopied(await copyText(a.citation))}
        >
          {copied ? "Citation copied" : "Copy citation"}
        </button>
      </div>
    </li>
  );
};

const Common: React.FC<{ f: FindingBase; hideEvidence?: boolean }> = ({ f, hideEvidence }) => (
  <>
    <Field label="Plain-language explanation">{f.plainLanguage}</Field>
    <Field label="Why it matters">{f.whyItMatters}</Field>
    {!hideEvidence ? (
      <Field label="Source evidence">
        <EvidenceList evidence={f.evidence} />
      </Field>
    ) : null}
    <Field label="Authorities" show={f.authorities.length > 0 || !f.legacy}>
      {f.authorities.length ? (
        <ul className="space-y-1.5">
          {f.authorities.map((a, i) => (
            <AuthorityCard key={a.key ?? `${a.citation}-${i}`} authority={a} />
          ))}
        </ul>
      ) : (
        <span className="text-slate-500">No authority is attached to this item.</span>
      )}
    </Field>
    <Field label="Contrary evidence or limits">{f.contraryEvidence}</Field>
    <Field label="Missing information" show={f.missingInformation.length > 0}>
      <Bullets items={f.missingInformation} />
    </Field>
    <Field label="Suggested verification steps" show={f.verificationSteps.length > 0}>
      <Bullets items={f.verificationSteps} />
    </Field>
    <Field label="Questions for counsel" show={f.questionsForCounsel.length > 0}>
      <Bullets items={f.questionsForCounsel} />
    </Field>
  </>
);

/** A disclosure: the body is mounted only while open, so large reports stay light. */
const Disclosure: React.FC<{ id: string; title: React.ReactNode; badges?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({ id, title, badges, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `${id}-body`;
  return (
    <div className="border border-slate-200 rounded-xl bg-white" data-finding-id={id}>
      <h4 className="m-0">
        <button
          type="button"
          id={`${id}-btn`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left p-3 flex items-start gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl min-h-[44px]"
        >
          <span aria-hidden="true" className="mt-0.5 text-slate-500 select-none">{open ? "▾" : "▸"}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold text-slate-900 break-words">{title}</span>
            {badges ? <span className="mt-1 flex flex-wrap gap-1">{badges}</span> : null}
          </span>
        </button>
      </h4>
      {open ? (
        <div id={bodyId} role="region" aria-labelledby={`${id}-btn`} className="px-3 pb-3 pt-1 border-t border-slate-100">
          <dl className="space-y-2.5 mt-2">{children}</dl>
        </div>
      ) : null}
    </div>
  );
};

const CharterItem: React.FC<{ f: CharterFinding; scope: string }> = ({ f, scope }) => (
  <Disclosure
    id={`${scope}-${f.id}`}
    title={`Charter s. ${f.section}: ${f.title.replace(/^Charter s\. ?\d+:\s*/i, "")}`}
    badges={
      <Badge className={f.assessment === "POTENTIAL_CONCERN" ? "bg-purple-50 text-purple-800 border-purple-200" : "bg-slate-100 text-slate-700 border-slate-300"}>
        {f.assessment === "POTENTIAL_CONCERN" ? "Potential concern - not an established violation" : "Insufficient information"}
      </Badge>
    }
  >
    <Field label="State action">{f.stateAction}</Field>
    <Field label="Right affected">{f.affectedRight}</Field>
    <Field label="Legal test">{f.legalTest}</Field>
    <Field label="Outline of the test (orientation only)">{f.testOutline}</Field>
    <Field label="Legal elements the document does not address" show={f.missingLegalElements.length > 0}>
      <Bullets items={f.missingLegalElements} />
    </Field>
    <Field label="Remedies for a lawyer to consider">{f.remediesForCounsel}</Field>
    <Common f={f} />
  </Disclosure>
);

const VerificationItemView: React.FC<{ f: VerificationItem; scope: string }> = ({ f, scope }) => (
  <Disclosure id={`${scope}-${f.id}`} title={f.claim} badges={<Badge className={RESULT_STYLE[f.result]}>{f.result.replace("_", " ")}</Badge>}>
    <Field label="Source document">{f.sourceDocument}</Field>
    <Field label="Supporting passage" show={Boolean(f.supportingPassage)}>
      {f.supportingPassage ? <EvidenceList evidence={[f.supportingPassage]} /> : null}
    </Field>
    <Field label="Contradictory passage" show={Boolean(f.contradictoryPassage)}>
      {f.contradictoryPassage ? <EvidenceList evidence={[f.contradictoryPassage]} /> : null}
    </Field>
    <Field label="Method">{f.method}</Field>
    <Field label="Result note">{f.resultNote}</Field>
    <Field label="Missing evidence">{f.missingEvidence}</Field>
    <Field label="Next action">{f.nextAction}</Field>
    <Common f={f} hideEvidence />
  </Disclosure>
);

const ABSENCE_LABEL: Record<string, string> = {
  NOT_IN_UPLOADED_MATERIALS: "Not in the uploaded materials",
  CONFIRMED_NONEXISTENT: "Document states it does not exist",
  UNKNOWN: "Unknown",
};

const MissingItemView: React.FC<{ f: MissingElement; scope: string }> = ({ f, scope }) => (
  <Disclosure id={`${scope}-${f.id}`} title={f.item} badges={<Badge>{ABSENCE_LABEL[f.absenceStatus] || f.absenceStatus}</Badge>}>
    <Field label="What depends on it">{f.dependsOn}</Field>
    <Field label="Basis">{f.absenceBasis}</Field>
    <Field label="Next steps" show={f.nextSteps.length > 0}>
      <Bullets items={f.nextSteps} />
    </Field>
    <Common f={f} />
  </Disclosure>
);

const QuestionView: React.FC<{ f: LawyerQuestion; scope: string; index: number; linkedTitle?: string }> = ({ f, scope, index, linkedTitle }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Disclosure id={`${scope}-${f.id}`} title={`${index + 1}. ${f.question}`} badges={linkedTitle ? <Badge>Linked: {linkedTitle}</Badge> : <Badge>General</Badge>}>
      <div>
        <button
          type="button"
          className="text-[11px] font-semibold border border-slate-300 rounded px-2 py-1 bg-white hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={async () => setCopied(await copyText(lawyerQuestionToText(f)))}
        >
          {copied ? "Question copied" : "Copy this question"}
        </button>
        <span role="status" aria-live="polite" className="sr-only">{copied ? "Question copied to clipboard" : ""}</span>
      </div>
      <Field label="What the lawyer assesses">{f.whatLawyerAssesses}</Field>
      <Field label="What the uploaded record shows">{f.recordShows}</Field>
      <Field label="Still unknown">{f.stillUnknown}</Field>
      <Field label="Documents to bring" show={f.documentsToBring.length > 0}>
        <Bullets items={f.documentsToBring} />
      </Field>
      <Common f={{ ...f, plainLanguage: "" }} />
    </Disclosure>
  );
};

export interface InteractiveFindingsTabsProps {
  report: Record<string, any>;
  /** Used to keep element ids unique when several reports are mounted (e.g. Quick and Deep Scan). */
  scope?: string;
  onPrintQuestions?: () => void;
  initialTab?: TabKey;
}

export const InteractiveFindingsTabs: React.FC<InteractiveFindingsTabsProps> = ({ report, scope, onPrintQuestions, initialTab = "charter" }) => {
  const reactId = useId().replace(/:/g, "");
  const uid = scope || reactId;
  const findings = useMemo(() => resolveInteractiveFindings(report), [report]);
  const [active, setActive] = useState<TabKey>(initialTab);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const counts: Record<TabKey, number> = {
    charter: findings.charter.length,
    verification: findings.verification.length,
    missing: findings.missing.length,
    lawyerQuestions: findings.lawyerQuestions.length,
  };

  const focusTab = useCallback((key: TabKey) => {
    setActive(key);
    // Focus after the state change so the roving tabindex is already applied.
    requestAnimationFrame(() => tabRefs.current[key]?.focus());
  }, []);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next >= 0) {
      e.preventDefault();
      focusTab(TABS[next].key);
    }
  };

  const status = findings.sectionStatus[active];
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of [...findings.charter, ...findings.verification, ...findings.missing]) m.set(f.id, f.title);
    for (const rf of Array.isArray(report?.redFlags) ? report.redFlags : []) if (rf?.id) m.set(String(rf.id), rf.category || "Red flag");
    return m;
  }, [findings, report]);

  return (
    <section aria-label="Legal findings" className="space-y-3 pt-2 border-t border-gray-100" data-testid="interactive-findings">
      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5" data-testid="authority-limitation">
        <strong>About the legal authorities:</strong> {findings.authoritySummary.limitation}
      </div>

      <div role="tablist" aria-label="Legal findings sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 -mx-1 px-1">
        {TABS.map((t, i) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              role="tab"
              type="button"
              id={`${uid}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${uid}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`shrink-0 min-h-[44px] px-3 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-t ${
                selected ? "border-brand-600 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label} <span className="ml-1 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-full px-1.5 py-0.5">{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Only the active panel is mounted. */}
      <div role="tabpanel" id={`${uid}-panel-${active}`} aria-labelledby={`${uid}-tab-${active}`} tabIndex={0} className="space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">
        <p className="text-[11px] text-slate-500">{TABS.find((t) => t.key === active)!.hint}</p>
        {active === "charter" && <p className="text-[11px] text-purple-900 bg-purple-50 border border-purple-200 rounded p-2">These are potential concerns for a lawyer to assess. Nothing here says that a right was violated.</p>}
        {active === "missing" && <p className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">Material missing from the upload is not proof that it does not exist, or that anyone acted improperly.</p>}
        {status.state !== "GENERATED" && counts[active] > 0 ? (
          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2" data-testid="legacy-note">
            {status.state === "LEGACY" ? "Basic list only. " : ""}{status.reason || "Detailed findings were not generated for this part of the report."}
          </p>
        ) : null}
        {status.state === "UNAVAILABLE" && counts[active] === 0 ? (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">{status.reason}</p>
        ) : null}

        {active === "lawyerQuestions" && counts.lawyerQuestions > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onPrintQuestions}
              className="text-[11px] font-semibold border border-slate-300 rounded px-2.5 py-1.5 bg-white hover:bg-slate-50 min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Print all questions for my lawyer
            </button>
          </div>
        ) : null}

        {counts[active] === 0 && status.state !== "UNAVAILABLE" ? (
          <p className="text-xs text-slate-600 border border-dashed border-slate-300 rounded-lg p-3" data-testid="empty-findings">
            {active === "charter" && "No Charter issue was identified on the facts in this document."}
            {active === "verification" && "No verification checks were produced for this report."}
            {active === "missing" && "No missing elements were identified."}
            {active === "lawyerQuestions" && "No lawyer questions are available for this report."}
          </p>
        ) : null}

        {active === "charter" && findings.charter.map((f) => <CharterItem key={f.id} f={f} scope={uid} />)}
        {active === "verification" && findings.verification.map((f) => <VerificationItemView key={f.id} f={f} scope={uid} />)}
        {active === "missing" && findings.missing.map((f) => <MissingItemView key={f.id} f={f} scope={uid} />)}
        {active === "lawyerQuestions" &&
          findings.lawyerQuestions.map((f, i) => (
            <QuestionView key={f.id} f={f} scope={uid} index={i} linkedTitle={f.linkedFindingId ? titleById.get(f.linkedFindingId) : undefined} />
          ))}
      </div>
    </section>
  );
};

export default InteractiveFindingsTabs;
