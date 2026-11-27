import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { auth } from "../utils/firebase";

export { SHARED_LEGACY_ACCOUNT_KEYS } from "../utils/firebase";

function read<T>(baseKey: string, uid: string | null, fallback: () => T): T {
  if (!uid) return fallback();
  try {
    const stored = localStorage.getItem(`${baseKey}_${uid}`);
    return stored ? (JSON.parse(stored) as T) : fallback();
  } catch {
    return fallback();
  }
}

/**
 * State persisted under `${baseKey}_${uid}` (the getUserKey format) for the signed-in account.
 * Signed out, the state lives in memory only. When the account changes, the state is reloaded from
 * the new account's key, so one account's data is never shown to or saved under another.
 */
export function useAccountStorage<T>(baseKey: string, fallback: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [state, setState] = useState(() => ({ owner: uid, value: read(baseKey, uid, fallback) }));

  useEffect(() => auth.onAuthStateChanged?.((user) => setUid(user?.uid ?? null)), []);

  useEffect(() => {
    if (state.owner !== uid) setState({ owner: uid, value: read(baseKey, uid, fallback) });
    // fallback is a factory for the initial value; only the account matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, baseKey, state.owner]);

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
              value:
                typeof action === "function"
                  ? (action as (p: T) => T)(prev.value)
                  : action,
            }
      );
    },
    [uid]
  );

  return [state.owner === uid ? state.value : read(baseKey, uid, fallback), setValue];
}
