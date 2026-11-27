import React, { useEffect, useState } from "react";
import { auth } from "../utils/firebase";
import { decideLegacy, legacyOfferFor, type LegacyOffer } from "../utils/legacySharedData";

/** One-time choice for the first account to sign in: import or discard pre-upgrade shared chat and bookmarks. */
export default function LegacySharedDataPrompt() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [offer, setOffer] = useState<LegacyOffer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => auth.onAuthStateChanged?.((user) => setUid(user?.uid ?? null)), []);
  useEffect(() => {
    setFailed(false);
    setOffer(uid ? legacyOfferFor(uid) : null);
  }, [uid]);

  if (!uid || !offer) return null;
  const decide = (decision: "import" | "discard") => {
    if (decideLegacy(uid, decision)) setOffer(null);
    else setFailed(true);
  };
  const parts = [
    offer.chatMessages ? `${offer.chatMessages} coach chat message${offer.chatMessages === 1 ? "" : "s"}` : "",
    offer.bookmarks ? `${offer.bookmarks} statute bookmark${offer.bookmarks === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="legacy-shared-title" className="fixed bottom-24 left-1/2 z-[70] w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-xl">
      <h2 id="legacy-shared-title" className="font-bold text-slate-900">Data saved on this browser before sign-in</h2>
      <p className="mt-1">
        This browser has {parts.join(" and ") || "older saved items"} from before data was kept per account. Anyone who used this browser could have created them.
        Import them into this account only if they are yours. Either choice is final, and no other account will be offered them.
      </p>
      {failed && <p role="alert" className="mt-2 text-red-700">This browser's storage could not be updated. Nothing was lost; try again.</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => decide("import")} className="rounded-lg bg-brand-600 px-3 py-2 font-bold text-white hover:bg-brand-500">Import into my account</button>
        <button type="button" onClick={() => decide("discard")} className="rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-700 hover:bg-slate-50">Discard them</button>
      </div>
    </div>
  );
}
