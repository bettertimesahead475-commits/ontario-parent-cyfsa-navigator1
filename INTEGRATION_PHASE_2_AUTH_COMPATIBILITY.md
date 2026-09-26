# CYFSA Navigator — Integration Phase 2 Authentication & Account Compatibility Summary

> **Status:** APPROVED & COMPLETED  
> **Date:** September 26, 2026  
> **Phase 1 Baseline:** `0f744db81156620a3be5143857c93fdedb73982e`  
> **Integration Branch:** `integration/audited-rebuild-main-site`  
> **Phase 2 Checkpoint Tag:** `integration/phase-2-auth-compatibility-v1`  

---

## 1. Executive Summary

Phase 2 of the CYFSA Navigator integration verifies authentication and account compatibility between the production main site reference (`da332565c0c3d2938cf29536dea6b03b7263681f`) and the audited rebuild baseline.

Both main site and rebuild target the exact same Firebase Authentication project domain (`gen-lang-client-0105737183`). The identity mapping (`Firebase UID -> public.accounts.id -> navigator_matters.owner_id`) is 100% compatible. Existing and new users authenticate seamlessly without UID mismatches, account duplication, or matter isolation failures.

---

## 2. Baseline Verification

1. **Phase 1 Baseline HEAD:** Verified `0f744db81156620a3be5143857c93fdedb73982e` on local and remote `origin/integration/audited-rebuild-main-site`.
2. **Ancestry Verification:** `d13f058024f9d822e384a328af91e8aebc027159` is a direct ancestor of Phase 1 HEAD (`PASS`).

---

## 3. Firebase Identity Domain Comparison

| Property | Main Site (`origin/main`) | Integration Branch (`HEAD`) | Status |
| :--- | :--- | :--- | :--- |
| **Project ID** | `gen-lang-client-0105737183` | `gen-lang-client-0105737183` | **MATCH** |
| **Auth Domain** | `gen-lang-client-0105737183.firebaseapp.com` | `gen-lang-client-0105737183.firebaseapp.com` | **MATCH** |
| **Storage Bucket** | `gen-lang-client-0105737183.firebasestorage.app` | `gen-lang-client-0105737183.firebasestorage.app` | **MATCH** |
| **Messaging Sender ID** | `100892974326` | `100892974326` | **MATCH** |
| **App ID** | `1:100892974326:web:da7a01b142ccceb19060d7` | `1:100892974326:web:da7a01b142ccceb19060d7` | **MATCH** |

**Conclusion:** `SAME FIREBASE IDENTITY DOMAIN`

---

## 4. Client Authentication Flow

1. **Initialization:** `initializeApp(firebaseConfig)` in `src/utils/firebase.ts`.
2. **State Listener:** `onAuthStateChanged(auth, setUser)` in `RequireAuth.tsx`. `user === undefined` avoids unauthenticated flash.
3. **Sign-In Action:** `signInMinimal()` invokes `signInWithPopup(auth, provider)` using GoogleAuthProvider.
4. **Token Generation:** `user.getIdToken()` retrieves JWT bearer token.
5. **API Transport:** `apiFetch()` in `src/utils/api.ts` attaches `Authorization: Bearer <idToken>`.
6. **Storage Isolation:** `getUserKey(key)` in `src/utils/storage.ts` namespaces localStorage keys as `${key}_${uid}` to prevent cross-account data leaking on shared devices.
7. **Logout:** `auth.signOut()` clears Firebase session and resets React state.

---

## 5. Server Authentication & Protected Route Matrix

Identity is derived strictly from the server-verified Firebase ID token via `verifyFirebaseToken()` / `verifyFirebaseIdentity()`. `checkRevoked: true` enforces real-time revocation checks. Client-supplied UIDs, emails, or account IDs are never trusted for authorization.

| HTTP Method | Route Endpoint | Auth Required | Token Verifier | Account Resolver | Recipient / Matter Check |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/account` | Required | `verifyFirebaseToken` | `resolveAccount(uid, email)` | Caller account |
| `POST` | `/api/matters` | Required | `verifyFirebaseToken` | `resolveAccount(uid, email)` | Matter owner |
| `GET` | `/api/matters/:matterId` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Matter owner |
| `POST` | `/api/matters/:matterId/documents` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Matter owner |
| `GET` | `/api/matters/:matterId/evidence` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Owner OR recipient grant |
| `PATCH` | `/api/matters/:matterId/evidence/:id/review` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Owner OR recipient grant |
| `POST` | `/api/professional-invitations` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Matter owner |
| `POST` | `/api/professional-invitations/accept` | Required | `verifyFirebaseIdentity` | `findAccount(uid)` | `emailVerified === true` & recipient email match |
| `POST` | `/api/professional-invitations/revoke` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Matter owner |
| `GET` | `/api/professional-workspace/matters` | Required | `verifyFirebaseToken` | `findAccount(uid)` | Active recipient grants |
| `GET` | `/api/directory/search` | Public | None | None | None |
| `GET` | `/api/official-forms` | Public | None | None | None |

---

## 6. Canonical Account Mapping & Idempotency

- **Database Table:** `public.accounts`
- **Mapping Key:** `firebase_uid` -> `id` (UUID)
- **Constraint:** `UNIQUE(firebase_uid)`
- **Idempotency:** `resolveAccount()` uses `upsert` with `{ onConflict: "firebase_uid", ignoreDuplicates: true }` to prevent duplicate account provisioning under concurrent requests.
- **Account Status:** `status === 'active'` required. Suspended or deleted accounts throw `LifecycleError(403, "ACCOUNT_UNAVAILABLE")`.

---

## 7. Existing & New User Compatibility

- **Existing User P:** `P_UID` maps directly to `P_ACCOUNT` and `P_MATTER` without schema transformation (`CODE-CONTRACT VERIFIED`).
- **New User N:** `N_UID` triggers `resolveAccount()`, provisions a isolated `N_ACCOUNT` record, and creates clean matter state with zero risk of inheriting existing accounts or matters.

---

## 8. Professional Invitation Security & Recipient Verification

- **Token Protection:** Cryptographic invitation token (`#t=...`) is captured from URL fragment at startup (`src/main.tsx`) and immediately scrubbed from location and history via `history.replaceState`.
- **Token Non-Persistence:** Invitation tokens are never stored in `localStorage`, `sessionStorage`, `cookies`, `IndexedDB`, logs, or telemetry.
- **Recipient Binding:** Acceptance endpoint uses `verifyFirebaseIdentity()` to verify that `emailVerified === true` and caller email matches the invited recipient email. Forwarding to another email fails (`403`).

---

## 9. Client Storage Audit

| Storage Key Pattern | Sensitive? | Identity-Bound? | Cleared / Isolated? | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `OPA_USER_PROFILE_${uid}` | No | Yes | Yes | Display name & passport profile |
| `OPA_DOC_ANALYZER_PROGRESS_${uid}` | Yes | Yes | Yes | Local draft analyzer progress |
| `OPA_DEEPSCAN_REPORTS_${uid}` | Yes | Yes | Yes | Offline analysis report cache |
| `OPA_TEMPLATES_PROGRESS_${uid}` | Yes | Yes | Yes | Court workbook draft progress |
| `ps_session_token_${uid}` | Yes | Yes | Yes | Access tier session token |
| `OPA_STATUTE_BOOKMARKS` | No | Shared UI | No | Non-sensitive UI bookmarks |

---

## 10. Automated Test & Regression Results

| Test Suite / Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Focused Auth & Security** | `vitest run api/services/firebaseAdmin*` | **PASS** | 12 files, 42 tests passed |
| **Stage 10 Security** | `vitest run src/utils/` | **PASS** | Telemetry sanitizer & token scrubber passed |
| **Stage 11 Professional** | `vitest run api/services/professional*` | **PASS** | Recipient-bound access & workspace passed |
| **Analyzer Engine** | `vitest run api/services/m2*` | **PASS** | Source provenance & exactQuote passed |
| **TypeScript Compilation** | `npx tsc --noEmit` | **PASS** | 0 errors |
| **Code Linting** | `npm run lint` | **PASS** | 0 ESLint errors |
| **Production Build** | `npm run build` | **PASS** | Completed in 14.61s |
| **Canonical Test Suite** | `npm test -- --run` | **PASS** | **64 test files passed, 247 tests passed (100% pass rate)** |

---

## 11. Environment & Database Safety Verification

- **Database Changes:** `NONE`
- **Migrations Applied:** `NONE`
- **SQL Executed:** `NONE`
- **Production Modified:** `NONE`
- **Production CORS Modified:** `NONE`
- **Preview Status:** `NOT RUN` (Preview authentication requires Preview domain added to Firebase Authorized Domains).

---

## 12. Next Step / Phase 3 Prerequisites

- **Prerequisites Completed:** Phase 2 verified, documented, committed, pushed, and checkpoint tagged (`integration/phase-2-auth-compatibility-v1`).
- **Next Step:** Phase 3 Matter & Document Pipeline Integration.
- **Rule:** DO NOT START PHASE 3 UNTIL AUTHORIZED. DO NOT MODIFY PRODUCTION. DO NOT APPLY MIGRATIONS. DO NOT DEPLOY. DO NOT MERGE TO MAIN. DO NOT CREATE STAGE 12.
