# CYFSA Navigator — Professional Access Privacy Notice Section

**Document Reference**: `STAGE_10_PRIVACY_NOTICE_DRAFT.md`  
**Status**: APPROVED INTERIM DRAFT FOR PUBLIC PRIVACY POLICY INTEGRATION  
**Target Integration**: CYFSA Navigator Public Privacy Policy  
**Governance Version**: `v1.0`  
**Privacy Responsible Person**: Chris Pelkie  
**Effective Date**: Effective upon controlled Stage 10 Production activation  

---

## Proposed Privacy Policy Language: Professional Access & Case Collaboration

### 1. Overview of Professional Access
CYFSA Navigator provides a Professional Access feature that allows matter owners (such as parents or authorized account holders) to securely share specific case files and evidence review tools with invited legal professionals and reviewers. This section describes how we collect, use, store, and protect personal information processed in connection with professional access invitations and workspace access.

---

### 2. Information We Collect for Professional Access
When a matter owner creates a professional access invitation or when a professional accepts access to a case matter, we process the following categories of information:

* **Invited Professional Email Address**: The email address specified by the matter owner when creating an invitation.
* **Account Identifiers**: Platform user account identifiers for the inviting matter owner and the accepting professional user.
* **Access Status & Lifecycle Timestamps**: Information tracking the status of an invitation (such as pending, accepted, expired, or revoked) along with the exact date and time of lifecycle events (`created_at`, `accepted_at`, `revoked_at`, `expires_at`).
* **Security & Audit Logs**: Immutable technical event records capturing access lifecycle actions (such as invitation creation, acceptance attempts, and access revocations) to ensure platform security, prevent unauthorized access, and preserve system integrity.

> **Data Minimization Notice**: Requesting or accepting professional access does *not* require you to provide a physical address, telephone number, government identification, Law Society credential number, employer details, or payment/billing information.

---

### 3. Invitation Token Security & Protection
To deliver access invitations securely:
* **No Plaintext Secret Storage**: Unique invitation link secrets are passed strictly via temporary browser link fragments (`#t=...`). These secret tokens are **never stored in plaintext** within our databases, application logs, or web telemetry.
* **Cryptographic Hashing**: Our servers generate and store only a one-way cryptographic hash (SHA-256 digest) of the token. This digest is used solely to verify incoming invitation links when presented by an invited user.

---

### 4. How We Use Professional Access Data
We process professional access information strictly for the following purposes:
1. **Recipient Binding**: Ensuring that an invitation link can only be accepted by an account matching the intended professional recipient's email address.
2. **Access Authorization**: Verifying caller credentials before granting permission to view case files or matter evidence tools.
3. **Owner Transparency**: Allowing the matter owner to review which professionals have active or historical access to their matter files.
4. **Security & Audit Integrity**: Maintaining a verifiable log of authorization changes to detect unauthorized access attempts and resolve access disputes.

---

### 5. Information Sharing and Visibility
Professional access records are strictly isolated by matter boundaries:
* **Inviting Matter Owner**: Can view the recipient email addresses, invitation statuses, timestamps, and access audit events for matters they own.
* **Invited Professional**: Can view the matter files to which they have been granted active access. Invited professionals cannot view other professionals invited to the matter or access unrelated case matters.
* **Third Parties**: We do not sell, rent, or trade professional access email addresses or identity data to third parties.
* **System Administration**: Privileged database administrators may access underlying records strictly for database maintenance, infrastructure security, and system troubleshooting.

---

### 6. Access Revocation vs. Data Retention
* **Access Revocation**: A matter owner may revoke a professional's access at any time. Revocation immediately terminates the professional's permission to view or access the case matter.
* **Interim Data Retention Model**: Revoking access terminates active permissions, but **does not automatically erase** historical invitation records, recipient email entries, or security audit logs from our system. Under our interim launch retention model, historical access and security records are retained to preserve audit trails and demonstrate access history.

---

### 7. Retention Policy, Governance & Privacy Requests
Professional-access records and security audit logs are retained under our current Stage 10 retention practices during initial platform operation. Automated background purge tools are not currently enabled. This retention model is subject to ongoing privacy governance and post-launch review.

If you have questions regarding our retention practices or wish to submit a privacy inquiry or deletion request regarding your professional access data, you may contact our Privacy Administrator:

* **Privacy Responsible Person**: Chris Pelkie
* **Email**: `privacy@cyfsa-navigator.example.org` *(or designated project privacy contact)*
* **Handling Procedure**: Privacy requests are evaluated under our documented administrative request procedure, distinguishing active authorization from immutable security audit records.

---

### 8. Security & Legal Preservation
In the event of an active security investigation, access dispute, court order, or legal requirement, relevant professional access records and security audit logs may be preserved beyond standard retention schedules.
