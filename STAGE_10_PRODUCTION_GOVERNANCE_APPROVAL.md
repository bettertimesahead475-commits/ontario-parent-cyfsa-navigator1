# CYFSA Navigator Stage 10 — Production Governance Approval Package

**Document Reference**: `STAGE_10_PRODUCTION_GOVERNANCE_APPROVAL.md`  
**Status**: DRAFT FOR OWNER REVIEW & APPROVAL  
**Authoritative Implementation Freeze**: Tag `audit/stage-10-slice-8-activation-frozen`  
**Frozen SHA**: `d920c99ad549dcb045051c76b61a97be59f65680`  

---

## Executive Summary & Authoritative Technical State

This document constitutes the final human-approval governance package required prior to Production activation of CYFSA Navigator Stage 10 (Recipient-Bound Professional Access Lifecycle).

The technical implementation of Stage 10 has completed all development, integration, independent security audit, and controlled staging activation phases. No technical code blockers remain. Production activation remains blocked solely pending explicit human governance policy choices and owner sign-off.

```
+-----------------------------------------------------------------------------------+
|                        AUTHORITATIVE TECHNICAL STATE                              |
+-----------------------------------------------------------------------------------+
| Stage 10 Implementation:           COMPLETE                                       |
| Final Frozen Tag:                  audit/stage-10-slice-8-activation-frozen       |
| Frozen SHA:                        d920c99ad549dcb045051c76b61a97be59f65680        |
| Independent Security Audit:        PASS                                           |
| Controlled Staging Activation:     PASS                                           |
| Production Privacy Review:         PASS                                           |
| Technical Blocker:                 NONE                                           |
| Governance Blocker:                YES (Pending Owner Sign-Off)                   |
| Production Activation Status:       READY AFTER GOVERNANCE APPROVAL                |
+-----------------------------------------------------------------------------------+
```

---

## A. Purpose

Stage 10 provides recipient-bound professional access to CYFSA Navigator matters, enabling matter owners (e.g., parents) to invite legal professionals to view and collaborate on matter files under strict recipient verification and access controls.

Personal information processed by Stage 10 is used exclusively for:
1. **Recipient Binding**: Cryptographically and logically binding an access invitation to the intended professional's verified identity/account.
2. **Authorization Enforcement**: Validating caller identity against stored recipient criteria before granting matter read access.
3. **Owner Identification**: Displaying to the authorized matter owner the identity (email) of professionals invited to or accessing their matter.
4. **Security & Audit History**: Maintaining an append-only log of all access grants, acceptances, and revocations for security monitoring and fraud prevention.
5. **Event Reconstruction**: Allowing authorized reconstruction of access history and revocation timelines when required for operational or legal integrity.

---

## B. Data Categories & Personal Data Inventory

The Stage 10 data model stores specific personal and identity fields within `professional_access_grants` and `matter_access_events`. The inventory of stored data categories is documented below:

### 1. Recipient Email (`recipient_email`)
* **Purpose**: Invitation binding and owner display for identity verification.
* **Visibility**: Authorized matter owner (via API and UI) and privileged backend database administration.
* **Storage Location**: `professional_access_grants.recipient_email` (text).

### 2. Account Identifiers (`grantor_account_id`, `accepted_account_id`)
* **Purpose**: Enforcing authorization policies, mapping user sessions, and recording security audit history.
* **Visibility**: Internal application services, authorized matter owner, and privileged infrastructure administration.

### 3. Matter & Grant Identifiers (`matter_id`, `grant_id`)
* **Purpose**: Defining access scope boundaries and maintaining relational entity integrity.
* **Visibility**: Application services and authorized users (owner and accepted reviewer).

### 4. Lifecycle Timestamps & Status (`created_at`, `accepted_at`, `revoked_at`, `expires_at`, `status`)
* **Purpose**: Expiry evaluation, acceptance tracking, revocation recording, event sequencing, and audit history.
* **Visibility**: Matter owner, accepted reviewer (own grant status), and application services.

### 5. Token Digest (`token_digest`)
* **Purpose**: Cryptographic verification of invitation tokens presented by users.
* **Visibility**: Application backend database only (stored as a one-way SHA-256 digest). Never exposed via UI or API reports.

### 6. Raw Invitation Token (`raw_token`)
* **Retention**: **NONE**.
* **Technical Behavior**: Raw invitation tokens are passed strictly via URL fragments (`#t=...`). The client-side application immediately scrubs the fragment from browser history using `history.replaceState`. The backend hashes incoming tokens upon receipt and never persists raw tokens in application databases, server logs, or telemetry outputs.

### Data Collection Minimization Statement
Stage 10 does **NOT** require or collect any of the following data categories for professional access:
* Physical address
* Telephone number
* Government-issued identification
* Law Society number or professional registration credentials
* Employer or law firm organizational details
* Payment or financial billing information

---

## C. Access Matrix

The following matrix documents the identity and access information retrievable by each caller role within CYFSA Navigator:

| Caller Role | Identity & Grant Data Retrievable | Scope & Authorization Boundaries |
| :--- | :--- | :--- |
| **Matter Owner** | `recipient_email`, grant status, lifecycle timestamps (`created_at`, `accepted_at`, `revoked_at`), accepted professional account ID, matter audit events | Restricted strictly to matters owned by the authenticated caller via RLS and API authorization gates. |
| **Accepted Reviewer** | Own grant status, own account ID, matter content access | Can retrieve matter files for granted matters. Cannot view other professionals' invitations or recipient emails. |
| **Unaccepted Invited Professional** | Invitation validation status upon presenting secret token | Token presentation yields neutral status response prior to sign-in/acceptance. No access to matter content or owner identity. |
| **Stranger (Unauthenticated / Other User)** | Generic neutral refusal | Zero access to matter data, grant records, recipient email, or invitation status. |
| **Cross-Matter User** | None | Enforced isolation between matters. Access to Matter A confers zero visibility into Matter B. |
| **Suspended User** | Generic neutral account refusal | Access blocked across all endpoints. No identity or matter metadata disclosed. |
| **Service Role / Database Administrator** | All database tables (`professional_access_grants`, `matter_access_events`) | Direct privileged infrastructure administration (bypasses RLS). Requires administrative security controls and DB access logging. |

> [!NOTE]
> Application-level access is governed strictly by Row Level Security (RLS) policies and API authorization layer guards. Privileged infrastructure administration applies only to direct database credentials.

---

## D. Revocation vs. Deletion

It is a fundamental technical fact of Stage 10 that:

> **REVOCATION TERMINATES AUTHORIZATION. REVOCATION IS NOT PERSONAL-DATA DELETION.**

When a matter owner revokes a professional access grant:
1. The grant record status transitions to `REVOKED`.
2. The `revoked_at` timestamp is recorded.
3. Reviewer role membership for the professional account is removed (unless supported by another valid active grant).
4. **The `recipient_email` remains stored on the historical grant row.**
5. **All append-only lifecycle events (`GRANT_CREATED`, `GRANT_ACCEPTED`, `GRANT_REVOKED`, etc.) remain intact in `matter_access_events`.**

Revocation prevents any further access to matter files by the professional, but preserves the historical audit trail showing who was invited, when access was granted, and when access was terminated.

---

## E. Retention Policy — Owner Decisions Required

Automated data purge tooling is not currently implemented in Stage 10. The table below presents the specific retention policy decisions required from the project owner prior to Production activation.

| Record Category | Current Technical Behavior | Recommended Governance Question | Owner-Approved Policy Choice |
| :--- | :--- | :--- | :--- |
| **Active Access Records** | Retained indefinitely while status is `ACCEPTED`. | Shall active professional grants remain open until explicitly revoked by owner or expired? | `[TO BE COMPLETED BY OWNER]` |
| **Pending Invitations** | Retained in `PENDING` status until expiration or revocation. | What retention duration applies to unaccepted pending invitations after expiration? | `[TO BE COMPLETED BY OWNER]` |
| **Expired Invitations** | Retained in `EXPIRED` status indefinitely on database grant table. | Should expired unaccepted invitation rows be purged or anonymized after N days? | `[TO BE COMPLETED BY OWNER]` |
| **Revoked Invitations (Unaccepted)** | Retained in `REVOKED` status indefinitely. | How long should revoked unaccepted invitation records be preserved? | `[TO BE COMPLETED BY OWNER]` |
| **Revoked Accepted Access** | Retained in `REVOKED` status indefinitely for historical audit. | What is the business/legal retention period for historical accepted access records after revocation? | `[TO BE COMPLETED BY OWNER]` |
| **Lifecycle Security & Audit Events** | Retained indefinitely in append-only table `matter_access_events`. | What retention schedule applies to immutable security and access audit logs? | `[TO BE COMPLETED BY OWNER]` |
| **Database Backups** | Retained according to cloud infrastructure backup schedule. | What backup retention window aligns with organizational privacy commitments and disaster recovery requirements? | `[TO BE COMPLETED BY OWNER]` |

> [!WARNING]
> Do not pre-fill statutory retention durations without formal legal/privacy review. The owner must document approved retention timeframes in the fields above.

---

## F. Initial Manual Retention & Data Governance Procedure

Because automated purge tools are not currently implemented, the following manual governance procedure governs interim data handling without violating the frozen database design:

1. **Periodic Retention Review**: The system administrator or privacy delegate shall perform a semi-annual review of historical grant records against established retention policy timeframes.
2. **Privacy & Deletion Request Intake**: Requests for data deletion or erasure shall be logged in an administrative register with requester identity, timestamp, and request scope.
3. **Record Identification**: Administrative tools shall identify all `professional_access_grants` and `matter_access_events` associated with the specified recipient email or account ID.
4. **Record Classification & Hold Check**: Records shall be evaluated to determine whether they are active, historical audit logs, or subject to an active security/legal hold.
5. **Authorized Administrative Assessment**: Prior to any database modification, an authorized privacy review must confirm that proposed actions comply with user commitments and statutory obligations.
6. **Documented Decision Trail**: Every decision to retain, anonymize, or redact data must be formally recorded in the administrative log with justification.
7. **Append-Only Immutability Compliance**: Operations staff must **NEVER** manually execute `DELETE` or `UPDATE` queries against append-only audit tables (`matter_access_events`). Any escalation requiring database redaction must be performed via approved, tested administrative scripts that preserve log chain integrity.

---

## G. Operational Privacy Request Procedure

When a user or invited professional submits a privacy, access, or deletion request regarding professional access data, the following 9-step operational procedure must be executed:

```
[1. Receive Request] ---> [2. Verify Requester Identity] ---> [3. Identify Stage 10 Records]
                                                                      |
[6. Review Legal Hold] <-- [5. Assess Active Access] <--- [4. Determine Relationship]
         |
         v
[7. Document Decision] ---> [8. Perform Authorized Action] ---> [9. Record Completion & Respond]
```

1. **Receive Request**: Log incoming request details (date, contact email, request type).
2. **Verify Identity**: Authenticate the requester's identity (e.g., via verified email challenge or authenticated session).
3. **Identify Stage 10 Records**: Query `professional_access_grants` and `matter_access_events` for matching email or account identifiers.
4. **Determine Relationship**: Verify whether the requester is a matter owner, an invited professional, or an unauthorized third party.
5. **Assess Active Access Implications**: Determine if redacting or deleting data would disrupt active matter authorization or reviewer access.
6. **Review Legal Hold Requirements**: Verify whether target records are subject to an active security investigation, dispute, or legal hold.
7. **Document Decision**: Record the formal decision (grant, partial fulfill with audit retention, or refuse under statutory exemption) in the privacy register.
8. **Perform Authorized Technical Action**: Execute only authorized technical operations (e.g., anonymization of non-audit grant details where permitted). Do not promise absolute deletion where security preservation is mandatory.
9. **Record Completion & Respond**: Send written confirmation to the requester and close the ticket in the administrative register.

---

## H. Security & Legal Hold Exception

Ordinary retention schedules and privacy deletion handling may be suspended when records must be preserved for legal or security reasons.

### Suspension Criteria
Retention purge or deletion procedures shall be immediately suspended for affected records upon notice of:
* Active security incident or unauthorized access investigation.
* Disputed matter access or authorization challenge between parties.
* Active or reasonably anticipated litigation, subpoena, or legal process.
* Regulatory inquiry or statutory compliance audit.
* System integrity or fraud investigation.

> [!IMPORTANT]
> This document does not define legal thresholds for hold invocation. Invoking or releasing a Security/Legal Hold requires formal review and written approval by legal/privacy counsel.

---

## I. Privacy Notice Content (Factual Draft)

The public Privacy Policy for CYFSA Navigator must be updated prior to public Stage 10 activation to accurately reflect professional access processing. Key factual points to include:

* **Professional Email Collection**: Collected from matter owners when initiating an access invitation.
* **Primary Purpose**: Invitation delivery, recipient verification, authorization enforcement, and owner access display.
* **Account Identifiers**: Processed to link authenticated user accounts to granted reviewer roles.
* **Access & Security Logging**: Timestamped lifecycle actions are logged in security audit tables to protect system integrity.
* **Authorized Visibility**: Restricted to the inviting matter owner, the accepted professional, and privileged backend administrators.
* **Token Handling**: Invitation link secrets are processed client-side and never stored in plaintext on application servers.
* **Retention Standard**: Access records and audit logs are retained in accordance with organizational policy and are not automatically deleted upon access revocation.
* **Privacy Contact**: Clear contact information for submitting privacy inquiries and access/deletion requests.

*(Note: Do not claim automatic deletion, specific retention durations, or statutory compliance certifications until formally approved.)*

---

## J. Owner Approval Checklist & Sign-Off

The project owner must review each item below and complete the sign-off fields prior to Stage 10 Production activation.

* [ ] **I have reviewed the Stage 10 personal-data inventory** (§B).
* [ ] **I understand that access revocation does not equal deletion** (§D).
* [ ] **I have reviewed how recipient email is stored** (§B).
* [ ] **I have reviewed the append-only lifecycle event model** (§D).
* [ ] **I have selected/documented the retention policy choices** (§E).
* [ ] **I have established a privacy-request handling process** (§G).
* [ ] **I have reviewed the security/legal-hold exception** (§H).
* [ ] **The public privacy notice has been updated or approved for update before Stage 10 becomes available to real users** (§I).
* [ ] **I understand automated retention tooling is not currently implemented** (§F).
* [ ] **I authorize Stage 10 to proceed to the controlled Production activation gate subject to all technical deployment safeguards.**

---

### Sign-Off Fields

**OWNER / APPROVER**: ____________________________________________________  

**SIGNATURE**: ____________________________________________________  

**DATE**: ____________________________________________________  

**DOCUMENT VERSION**: `1.0-DRAFT`  
