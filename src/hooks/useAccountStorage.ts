import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { auth } from "../utils/firebase";
import { ACCOUNT_STORAGE_CHANGED } from "../utils/legacySharedData";

function read<T>(baseKey: string, uid: string | null, fallback: () => T): T {
  if (!uid) return fallback();
  try {
    const stored = localStorage.getItem(`${baseKey}_${uid}`);
    return stored ? (JSON.parse(stored) as T) : fallback();
  } catch {
    return fallback();
  }
}

export interface GuestEdits<T> {
  /** No account is signed in: changes are held in memory for this page only. */
  isGuest: boolean;
  /** Something would be lost if the page closed now (guest edits, or guest edits not yet moved). */
  unsaved: boolean;
  /** Edits made while signed out, offered to the account that signed in next. Memory only. */
  pending: T | null;
  clearPending: () => void;
}

/**
 * State persisted under `${baseKey}_${uid}` (the getUserKey format) for the signed-in account.
 * Signed out, the state lives in memory only and is never written to browser storage. Guest edits
 * survive sign-in as `pending`, so the component can offer to move them; nothing is merged silently.
 */
export function useAccountStorage<T>(baseKey: string, fallback: () => T): [T, Dispatch<SetStateAction<T>>, GuestEdits<T>] {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [state, setState] = useState(() => ({ owner: uid, value: read(baseKey, uid, fallback), dirty: false }));
  const [pending, setPending] = useState<{ owner: string; value: T } | null>(null);

  useEffect(() => auth.onAuthStateChanged?.((user) => setUid(user?.uid ?? null)), []);

  useEffect(() => {
    if (state.owner === uid) return;
    if (state.owner === null && state.dirty && uid) {
      setPending({ owner: uid, value: state.value });
    } else if (state.owner !== null && uid === null && pending?.owner === state.owner) {
      // Signed out before deciding: the guest edits are still the guest's, in memory.
      setPending(null);
      setState({ owner: null, value: pending.value, dirty: true });
      return;
    } else if (pending && pending.owner !== uid) {
      setPending(null);
    }
    setState({ owner: uid, value: read(baseKey, uid, fallback), dirty: false });
    // fallback is a factory for the initial value; only the account matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, baseKey, state.owner]);

  useEffect(() => {
    const reload = () => setState({ owner: uid, value: read(baseKey, uid, fallback), dirty: false });
    // Another tab (or the legacy import) changed this account's data: show it instead of overwriting it later.
    const fromOtherTab = (event: StorageEvent) => {
      if (uid && event.key === `${baseKey}_${uid}`) reload();
    };
    window.addEventListener(ACCOUNT_STORAGE_CHANGED, reload);
    window.addEventListener("storage", fromOtherTab);
    return () => {
      window.removeEventListener(ACCOUNT_STORAGE_CHANGED, reload);
      window.removeEventListener("storage", fromOtherTab);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, baseKey]);

  useEffect(() => {
    if (!state.owner || state.owner !== uid) return;
    try {
      localStorage.setItem(`${baseKey}_${state.owner}`, JSON.stringify(state.value));
    } catch (e) {
      console.warn(`Failed to save ${baseKey}:`, e);
    }
  }, [baseKey, state, uid]);

  // Bound to the account that rendered it, so a late update (e.g. a coach reply
  // that arrives after sign-out or an account switch) is dropped, not merged.
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      setState((prev) =>
        prev.owner !== uid
          ? prev
          : {
              owner: prev.owner,
              value: typeof action === "function" ? (action as (p: T) => T)(prev.value) : action,
              dirty: prev.owner === null,
            }
      );
    },
    [uid]
  );
  const clearPending = useCallback(() => setPending(null), []);

  const current = state.owner === uid;
  const offered = uid && pending?.owner === uid ? pending.value : null;
  return [
    current ? state.value : read(baseKey, uid, fallback),
    setValue,
    { isGuest: !uid, unsaved: (!uid && current && state.dirty) || offered !== null, pending: offered, clearPending },
  ];
}
