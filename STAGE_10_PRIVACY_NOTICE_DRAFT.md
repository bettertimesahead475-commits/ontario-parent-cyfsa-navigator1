# CYFSA Navigator — Professional Access Privacy Notice Section (DRAFT)

**Document Reference**: `STAGE_10_PRIVACY_NOTICE_DRAFT.md`  
**Status**: DRAFT FOR PUBLIC PRIVACY POLICY INTEGRATION  
**Target Integration**: CYFSA Navigator Public Privacy Policy  

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
* **Data Retention**: Revoking access terminates active permissions, but **does not automatically erase** historical invitation records, recipient email entries, or security audit logs from our system. These historical records are retained in our database under established organizational retention schedules to preserve audit trails and demonstrate who was granted access in the past.

---

### 7. Retention Schedules & Privacy Requests
Professional access data and security audit logs are retained in accordance with our organizational data retention policy. Automated background deletion of historical access logs is not currently enabled.

If you have questions regarding our data retention schedules or wish to submit a privacy inquiry regarding your professional access data, you may contact our Privacy Administrator:

* **Email**: `privacy@cyfsa-navigator.example.org` *(or designated project privacy contact)*
* **Response Time**: Inquiries will be acknowledged within standard administrative timeframes.

---

### 8. Security & Legal Preservation
In the event of an active security investigation, access dispute, court order, or legal requirement, relevant professional access records and security audit logs may be preserved beyond standard retention schedules.
