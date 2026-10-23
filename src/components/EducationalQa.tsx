import React, { useId, useState } from "react";
import { answerQuestion, BASIS_LABEL, SUGGESTED_QUESTIONS, type QaAnswer } from "../../shared/educationalQa";

export function EducationalQa({ report }: { report: unknown }) {
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<QaAnswer | null>(null);

  const ask = (q: string) => {
    setQuestion(q);
    setAnswer(answerQuestion(q, report));
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} data-testid="educational-qa" className="mt-6 space-y-3">
      <h2 id={`${inputId}-heading`} className="text-xl font-bold text-slate-900">Ask about this report</h2>
      <p className="text-sm text-slate-700">
        Answers come only from this report, the plain glossary, and the statute text quoted in it. Nothing is saved. This is legal information, not advice.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor={inputId} className="sr-only">Your question</label>
        <input
          id={inputId}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="w-full rounded border border-slate-300 p-2 text-sm"
          placeholder="For example: What is missing from this report?"
        />
        <button type="submit" className="rounded-md border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">
          Ask
        </button>
      </form>
      <div>
        <p className="text-sm font-semibold text-slate-900">Questions you can ask</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => ask(q)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-left text-xs text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        {answer ? (
          <>
            <p className="text-xs font-semibold text-slate-700">{BASIS_LABEL[answer.basis]}</p>
            <p className="mt-2 whitespace-pre-line text-slate-900">{answer.answer}</p>
            {answer.sources.length > 0 && (
              <>
                <p className="mt-2 font-semibold">Where this comes from</p>
                <ul className="list-disc pl-5">
                  {answer.sources.map((s) => (
                    <li key={s} className="break-words">{s}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="text-slate-600">Ask a question or choose one above.</p>
        )}
      </div>
    </section>
  );
}
