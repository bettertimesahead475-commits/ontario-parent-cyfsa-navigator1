/**
 * Coach chat and statute bookmarks were once saved under keys shared by every account on the browser.
 * The first account that signs in afterwards is offered a one-time import or discard; no other account is
 * ever offered it. A decision is recorded before anything is copied, every copy completes before any
 * legacy key is deleted, and an interrupted decision is finished on the next page load.
 */
export const LEGACY_SHARED_KEYS = ['OPA_COACH_CHAT_MESSAGES', 'OPA_STATUTE_BOOKMARKS'] as const;
export const LEGACY_CLAIM_KEY = 'OPA_LEGACY_SHARED_DATA_CLAIM';
export const ACCOUNT_STORAGE_CHANGED = 'opa-account-storage-changed';

type Decision = 'import' | 'discard';
interface Claim { uid: string; decision?: Decision }
export interface LegacyOffer { chatMessages: number; bookmarks: number }

function list(key: string): Item[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function readClaim(): Claim | null {
  try {
    const claim = JSON.parse(localStorage.getItem(LEGACY_CLAIM_KEY) ?? 'null');
    return claim && typeof claim.uid === 'string' ? claim : null;
  } catch {
    return null;
  }
}
const hasLegacy = () => LEGACY_SHARED_KEYS.some(key => localStorage.getItem(key) !== null);

type Item = { id?: unknown; userNotes?: unknown; courtDate?: unknown };

/** A bookmark in both lists keeps the account copy, adds legacy notes it lacks, and fills a missing court date. */
function combine(account: Item, legacy: Item): Item {
  const mine = typeof account.userNotes === 'string' ? account.userNotes : '';
  const theirs = typeof legacy.userNotes === 'string' ? legacy.userNotes : '';
  const userNotes = theirs && !mine.includes(theirs) ? [mine, theirs].filter(Boolean).join('\n\n') : account.userNotes;
  return { ...account, ...(userNotes !== undefined && { userNotes }), courtDate: account.courtDate || legacy.courtDate };
}

/** Merges by id so a resumed import never duplicates items or notes. */
function merge(account: Item[], legacy: Item[], legacyFirst: boolean): Item[] {
  const byId = new Map(legacy.filter(item => item?.id !== undefined).map(item => [item.id, item]));
  const kept = account.map(item => (item?.id !== undefined && byId.has(item.id) ? combine(item, byId.get(item.id)!) : item));
  const accountIds = new Set(account.map(item => item?.id).filter(id => id !== undefined));
  const added = legacy.filter(item => item?.id === undefined || !accountIds.has(item.id));
  return legacyFirst ? [...added, ...kept] : [...kept, ...added];
}

function finish(uid: string, decision: Decision): boolean {
  try {
    if (decision === 'import') {
      for (const key of LEGACY_SHARED_KEYS) {
        const legacy = list(key);
        if (!legacy?.length) continue;
        const target = `${key}_${uid}`;
        localStorage.setItem(target, JSON.stringify(merge(list(target) ?? [], legacy, key === 'OPA_COACH_CHAT_MESSAGES')));
      }
    }
    for (const key of LEGACY_SHARED_KEYS) localStorage.removeItem(key);
    localStorage.removeItem(LEGACY_CLAIM_KEY);
  } catch {
    return false; // storage full or unavailable: the recorded decision is retried on the next load
  }
  window.dispatchEvent(new CustomEvent(ACCOUNT_STORAGE_CHANGED));
  return true;
}

/** Completes a decision that was recorded but interrupted before the legacy keys were deleted. */
export function resumeLegacyDecision(): void {
  const claim = readClaim();
  if (claim?.decision) finish(claim.uid, claim.decision);
}

/** Counts (never contents) of legacy items to offer this account, or null if it must not be offered. */
export function legacyOfferFor(uid: string): LegacyOffer | null {
  try {
    resumeLegacyDecision();
    if (!hasLegacy()) {
      localStorage.removeItem(LEGACY_CLAIM_KEY);
      return null;
    }
    const claim = readClaim();
    if (claim && claim.uid !== uid) return null;
    if (!claim) localStorage.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ uid }));
    return { chatMessages: list('OPA_COACH_CHAT_MESSAGES')?.length ?? 0, bookmarks: list('OPA_STATUTE_BOOKMARKS')?.length ?? 0 };
  } catch {
    return null;
  }
}

/** Records this account's choice, then imports (copy first) and removes the legacy keys. */
export function decideLegacy(uid: string, decision: Decision): boolean {
  const claim = readClaim();
  if (!claim || claim.uid !== uid) return false;
  try {
    localStorage.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ uid, decision }));
  } catch {
    return false;
  }
  return finish(uid, decision);
}
