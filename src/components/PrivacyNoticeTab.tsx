import React from 'react';

export default function PrivacyNoticeTab() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 text-slate-900" aria-labelledby="privacy-page-title">
      <div className="border-b border-slate-200 pb-6 mb-8">
        <h1 id="privacy-page-title" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Privacy Policy & Professional Access Notice
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Governance Version: <code className="bg-slate-100 px-2 py-0.5 rounded text-slate-800 font-mono">v1.0</code> · Effective Date: Stage 10 Production Activation
        </p>
      </div>

      <div className="space-y-8 text-slate-800 leading-relaxed text-sm md:text-base">
        {/* Overview */}
        <section aria-labelledby="overview-heading" className="space-y-3">
          <h2 id="overview-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            1. Overview of Professional Access & Data Protection
          </h2>
          <p>
            CYFSA Navigator provides a Professional Access feature that allows matter owners (such as parents or authorized account holders) to securely share specific case files and evidence review tools with invited legal professionals and reviewers. This policy describes how we collect, use, store, and protect personal information processed in connection with professional access invitations and workspace access.
          </p>
        </section>

        {/* Info We Collect */}
        <section aria-labelledby="collect-heading" className="space-y-3">
          <h2 id="collect-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            2. Information We Collect for Professional Access
          </h2>
          <p>
            When a matter owner creates a professional access invitation or when a professional accepts access to a case matter, we process the following categories of information:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>Invited Professional Email Address:</strong> The email address specified by the matter owner when creating an invitation.
            </li>
            <li>
              <strong>Account Identifiers:</strong> Platform user account identifiers for the inviting matter owner and the accepting professional user.
            </li>
            <li>
              <strong>Access Status & Lifecycle Timestamps:</strong> Information tracking the status of an invitation (such as pending, accepted, expired, or revoked) along with exact date and time timestamps (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">created_at</code>, <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">accepted_at</code>, <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">revoked_at</code>, <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">expires_at</code>).
            </li>
            <li>
              <strong>Security & Audit Logs:</strong> Immutable technical event records capturing access lifecycle actions to ensure platform security, prevent unauthorized access, and preserve system integrity.
            </li>
          </ul>

          <div role="note" className="p-4 bg-brand-50 border-l-4 border-brand-600 rounded-r-xl text-brand-950 text-xs md:text-sm font-medium mt-4">
            <strong>Data Minimization Notice:</strong> Requesting or accepting professional access does <em>not</em> require you to provide a physical address, telephone number, government identification, Law Society credential number, employer details, or payment/billing information.
          </div>
        </section>

        {/* Invitation Token Security */}
        <section aria-labelledby="token-heading" className="space-y-3">
          <h2 id="token-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            3. Invitation Token Security & Protection
          </h2>
          <p>To deliver access invitations securely:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>No Plaintext Secret Storage:</strong> Unique invitation link secrets are passed strictly via temporary browser link fragments (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">#t=...</code>). These secret tokens are <strong>never stored in plaintext</strong> within our databases, application logs, or web telemetry.
            </li>
            <li>
              <strong>Cryptographic Hashing:</strong> Our servers generate and store only a one-way cryptographic hash (SHA-256 digest) of the token. This digest is used solely to verify incoming invitation links when presented by an invited user.
            </li>
          </ul>
        </section>

        {/* How We Use Data */}
        <section aria-labelledby="use-heading" className="space-y-3">
          <h2 id="use-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            4. How We Use Professional Access Data
          </h2>
          <p>We process professional access information strictly for the following purposes:</p>
          <ol className="list-decimal pl-6 space-y-2 text-slate-700">
            <li><strong>Recipient Binding:</strong> Ensuring that an invitation link can only be accepted by an account matching the intended professional recipient's email address.</li>
            <li><strong>Access Authorization:</strong> Verifying caller credentials before granting permission to view case files or matter evidence tools.</li>
            <li><strong>Owner Transparency:</strong> Allowing the matter owner to review which professionals have active or historical access to their matter files.</li>
            <li><strong>Security & Audit Integrity:</strong> Maintaining a verifiable log of authorization changes to detect unauthorized access attempts and resolve access disputes.</li>
          </ol>
        </section>

        {/* Sharing & Visibility */}
        <section aria-labelledby="sharing-heading" className="space-y-3">
          <h2 id="sharing-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            5. Information Sharing and Visibility
          </h2>
          <p>Professional access records are strictly isolated by matter boundaries:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Inviting Matter Owner:</strong> Can view the recipient email addresses, invitation statuses, timestamps, and access audit events for matters they own.</li>
            <li><strong>Invited Professional:</strong> Can view the matter files to which they have been granted active access. Invited professionals cannot view other professionals invited to the matter or access unrelated case matters.</li>
            <li><strong>Third Parties:</strong> We do not sell, rent, or trade professional access email addresses or identity data to third parties.</li>
            <li><strong>System Administration:</strong> Privileged database administrators may access underlying records strictly for database maintenance, infrastructure security, and system troubleshooting.</li>
          </ul>
        </section>

        {/* Revocation vs Retention */}
        <section aria-labelledby="retention-heading" className="space-y-3">
          <h2 id="retention-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            6. Access Revocation vs. Data Retention
          </h2>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Access Revocation:</strong> A matter owner may revoke a professional's access at any time. Revocation immediately terminates the professional's permission to view or access the case matter.</li>
            <li><strong>Interim Data Retention Model:</strong> Revoking access terminates active permissions, but <strong>does not automatically erase</strong> historical invitation records, recipient email entries, or security audit logs from our system. Under our interim launch retention model, historical access and security records are retained to preserve audit trails and demonstrate access history.</li>
          </ul>
        </section>

        {/* Contact & Governance */}
        <section aria-labelledby="contact-heading" className="space-y-3">
          <h2 id="contact-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            7. Retention Policy, Governance & Privacy Requests
          </h2>
          <p>
            Professional-access records and security audit logs are retained under our current Stage 10 retention practices during initial platform operation. Automated background purge tools are not currently enabled. This retention model is subject to ongoing privacy governance and post-launch review.
          </p>
          <p>
            If you have questions regarding our retention practices or wish to submit a privacy inquiry or deletion request regarding your professional access data, you may contact our Privacy Administrator:
          </p>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm space-y-1">
            <div><strong>Privacy Responsible Person:</strong> Chris Pelkie</div>
            <div><strong>Email:</strong> <code className="text-brand-700 font-mono">privacy@cyfsa-navigator.example.org</code></div>
            <div><strong>Handling Procedure:</strong> Privacy requests are evaluated under our documented administrative request procedure, distinguishing active authorization from immutable security audit records.</div>
          </div>
        </section>

        {/* Security & Legal Preservation */}
        <section aria-labelledby="legal-heading" className="space-y-3">
          <h2 id="legal-heading" className="text-xl font-bold text-slate-900 border-b pb-2">
            8. Security & Legal Preservation
          </h2>
          <p>
            In the event of an active security investigation, access dispute, court order, or legal requirement, relevant professional access records and security audit logs may be preserved beyond standard retention schedules.
          </p>
        </section>
      </div>
    </main>
  );
}
