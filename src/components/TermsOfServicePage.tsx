import React from 'react';

// Draft status. While true, the page shows a review notice listing decisions the owner must make.
// Set to false only after the owner has resolved every item in OPEN_DECISIONS and approved publication.
const IS_DRAFT = true;

const CONTACT_EMAIL = 'chris@cyfsanavigator.com';

const OPEN_DECISIONS = [
  'Operator identity: confirm the legal name and business form (sole proprietor or incorporated company). The repository names Chris Pelkie as the privacy contact but does not record a registered business name.',
  'Effective date: set when the owner approves publication.',
  'Refund eligibility and timing for one-time and monthly payments.',
  'Liability cap: the proposed amount and whether to keep it.',
  'Monthly Case Access: whether a monthly period ends at its expiry date. The code has no automatic renewal or recurring charge.',
  'Account termination: notice period and appeal process.',
  'Document and analysis retention: the code has no automated deletion for uploads or analysis job records. Set retention periods and confirm how deletion requests are carried out.',
  'Legal review: have an Ontario lawyer review the unauthorized-practice-of-law boundary, child-information handling, and the Terms before publication.',
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="text-xl font-bold text-slate-900 border-b pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function TermsOfServicePage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 text-slate-900" aria-labelledby="terms-page-title">
      <div className="border-b border-slate-200 pb-6 mb-8">
        <h1 id="terms-page-title" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          CYFSA Navigator · Effective date: <span data-owner-decision="effective-date">[to be set on owner approval]</span>. Read together with our{' '}
          <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a> and{' '}
          <a href="/data-deletion" className="text-brand-600 underline hover:text-brand-800 font-semibold">Data Deletion Instructions</a>.
        </p>
      </div>

      {IS_DRAFT && (
        <div role="note" className="mb-8 p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-xl text-amber-950 text-xs md:text-sm space-y-2">
          <p className="font-bold">Draft for owner review. These Terms are not yet in effect.</p>
          <p>Open decisions to resolve before publication:</p>
          <ol className="list-decimal pl-5 space-y-1">
            {OPEN_DECISIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="space-y-8 text-slate-800 leading-relaxed text-sm md:text-base">
        <Section id="about" title="1. Who we are and what these Terms cover">
          <p>
            These Terms of Service (the "Terms") govern your use of CYFSA Navigator at cyfsanavigator.com (the "Platform"). CYFSA Navigator is operated by Chris Pelkie from Ontario, Canada. In these Terms, "we", "us", and "our" mean the operator of the Platform, and "you" means the person using it.
          </p>
          <p>
            By creating an account, uploading a document, or purchasing access, you agree to these Terms. If you do not agree, do not use the Platform.
          </p>
        </Section>

        <Section id="purpose" title="2. What CYFSA Navigator is for">
          <p>
            CYFSA Navigator provides educational information, document organization, and AI-assisted document analysis about Ontario's child-protection system, including the Child, Youth and Family Services Act, 2017 (CYFSA). It is built to help parents and families understand their rights, organize their documents, and prepare questions and materials for discussions with qualified professionals such as lawyers, Legal Aid Ontario, duty counsel, and child-protection workers.
          </p>
          <p>
            The Platform helps you understand information and prepare. It does not make decisions for you, and it does not replace advice from a qualified professional about your own situation.
          </p>
        </Section>

        <Section id="disclaimer" title="3. Legal information disclaimer">
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>We are not a law firm.</strong> CYFSA Navigator is not a law firm, a licensed paralegal, or a legal aid clinic, and our staff and tools do not provide legal representation.</li>
            <li><strong>AI analysis is not legal advice.</strong> Quick Document Reviews, Forensic In-Depth Analyses, chat responses, timelines, and other generated content are informational only.</li>
            <li><strong>No lawyer-client relationship.</strong> Using the Platform, sending us a question, or reading its content does not create a lawyer-client relationship with us or with anyone who works with us.</li>
            <li><strong>AI can be wrong.</strong> Generated results may contain errors, omissions, misread documents, or statements that are not supported by the source material.</li>
            <li><strong>Verify and get advice.</strong> Check legal information against official sources, such as e-Laws (ontario.ca/laws) and the Ontario Court of Justice, and seek advice from a licensed Ontario lawyer when appropriate. Legal Aid Ontario and duty counsel may also be able to help.</li>
            <li><strong>You remain responsible.</strong> You are responsible for court deadlines, filing requirements, service rules, and every decision you make about your family and your case.</li>
          </ul>
          <p>
            These disclaimers describe how the Platform is intended to be used. They do not remove or reduce any legal or regulatory obligation we have, and they do not limit rights you have under Ontario or Canadian law.
          </p>
        </Section>

        <Section id="ai" title="4. AI document analysis">
          <p>
            <strong>Quick Document Review</strong> reads an uploaded document and produces an on-screen summary: a timeline of events, a comparison of what the document says against what it alleges, references to CYFSA sections, and possible gaps or red flags. It is designed to help you find things to check and questions to ask.
          </p>
          <p>
            <strong>Forensic In-Depth Analysis</strong> is a deeper, multi-pass review of the same kind of material, with cross-referencing across documents, evidence classification, and suggested questions to take to a lawyer. It is available on some paid plans.
          </p>
          <p><strong>Limits of AI results.</strong> You must check every generated result yourself before relying on it. In particular:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>check every quotation, date, and citation against the original document;</li>
            <li>check each evidence classification (for example, whether something is recorded as fact, as an allegation, or as a conclusion) against the source;</li>
            <li>check each statutory reference against the official text of the law;</li>
            <li>do not treat a conclusion as established unless the source documents support it.</li>
          </ul>
          <p>
            We work to reduce errors, but we do not promise that results are complete, accurate, or free of bias. Results can change between runs, and a result can be wrong even when it looks confident.
          </p>
          <p><strong>How uploaded documents are handled.</strong> Based on how the Platform currently works:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>when you upload a document, our server extracts its text. Text-based PDFs and text files are read directly. Scanned pages and images are read using optical character recognition (OCR) provided by Google (Gemini models);</li>
            <li>the extracted text is sent to Anthropic's Claude models to produce the analysis. Quick Reviews use Claude Sonnet and Forensic In-Depth Analyses use Claude Opus;</li>
            <li>if you use voice features, your audio is sent to Google (Gemini models) to be transcribed;</li>
            <li>analysis results are saved in private storage so that you can view them. Results are also held in memory for a limited time while they are being prepared.</li>
          </ul>
          <p>
            We do not currently delete uploaded documents or saved analysis records automatically. Please see our <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a> for how we handle personal information, and our <a href="/data-deletion" className="text-brand-600 underline hover:text-brand-800 font-semibold">Data Deletion Instructions</a> to request deletion. We cannot promise that any document or result is kept confidential or permanently deleted, and third-party providers have their own terms and retention practices.
          </p>
        </Section>

        <Section id="accounts" title="5. Accounts and responsibilities">
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Registration and security.</strong> You sign in with a Google account. You must keep that account secure, must not share your access codes or sign-in, and are responsible for activity under your account. Tell us promptly if you believe someone else has accessed it.</li>
            <li><strong>Accurate information.</strong> Provide accurate information when you register, pay, or request access.</li>
            <li><strong>Authorized use of documents.</strong> Only upload documents you are entitled to share with us. This includes documents that you have a right to hold, or that a court, a lawyer, or another authorized person has given you.</li>
            <li><strong>Protecting children and others.</strong> Your documents may contain information about children, family members, and other people. Use that information only as needed for your own matter. Do not publish it, share it with people who have no need for it, or upload it to the Platform for any purpose other than your own matter.</li>
            <li><strong>Professional collaboration.</strong> If you invite a professional to view part of your matter, you are responsible for choosing that person and for deciding what to share. You can revoke that access, although revoking access does not automatically erase historical records (see our <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a>).</li>
          </ul>
          <p><strong>Prohibited use.</strong> You must not:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>use the Platform for any unlawful purpose, or to harass, threaten, or defame anyone;</li>
            <li>upload material you have no right to share, or malware;</li>
            <li>try to access another person's account, documents, or analysis, or to get around sign-in, access codes, payment checks, or usage limits;</li>
            <li>share, resell, or transfer access codes or paid access;</li>
            <li>copy, scrape, reverse engineer, or overload the Platform, or interfere with its operation or security;</li>
            <li>present AI output as official legal advice, as a court document, or as the work of a lawyer, without review and verification;</li>
            <li>use the Platform to impersonate any person or organization.</li>
          </ul>
          <p>
            <strong>Suspension and termination.</strong> We may suspend or end your access if you breach these Terms, if we reasonably believe it is needed to protect the Platform, other users, or security, or if the law requires it. Where practical, we will tell you the reason and give you a chance to respond. The notice period and appeal process are subject to owner decision (see the review notice). Nothing in this section limits rights you have under applicable law.
          </p>
        </Section>

        <Section id="payments" title="6. Free use, paid access, and payments">
          <p>
            <strong>Free use.</strong> You can use the free educational content on the Platform without paying. Each account includes one free Quick Document Review and one free evidence extraction. Free use does not require a payment card.
          </p>
          <p><strong>Paid access.</strong> Paid access is sold in these forms:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Document Analyzer Basic</strong> ($19.99 CAD, one-time): up to three Quick Document Reviews. Does not include the Case Workspace.</li>
            <li><strong>Document Analyzer Premium</strong> ($49.99 CAD, one-time): includes up to five Forensic In-Depth Analyses, subject to the limits shown at purchase.</li>
            <li><strong>Individual / Family CYFSA Case Access</strong> ($149 CAD per month): full platform access for one family, with up to five Forensic In-Depth Analyses per monthly billing cycle.</li>
            <li><strong>Sponsored Case Access</strong> (Community 5, Community 10, Community 25, and Regional / Enterprise): arranged separately with the sponsoring organization, under terms agreed with that organization.</li>
          </ul>
          <p>
            Prices are shown in Canadian dollars at the time of purchase. We may change prices for future purchases, but not for access you have already paid for.
          </p>
          <p>
            <strong>How to pay.</strong> The Platform accepts payment by Interac e-Transfer only. You send the transfer to our payment address and include the reference number shown on the checkout page in the message or memo. The Platform does not collect or store card numbers or banking passwords.
          </p>
          <p>
            <strong>How access is granted.</strong> After we confirm your transfer, we issue a single-use access code. Our Gmail-based detection tool may flag a possible match for review, but it does not grant access on its own. Access is granted only after a person on our team approves the payment. Confirmation can take time, depending on your bank's processing.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>An access code expires 14 days after it is issued if it is not activated.</li>
            <li>An access code is activated by signing in with the same email address that was used for the payment.</li>
            <li>Paid access is stored as a session with an expiry date. The Basic and Premium packages are one-time purchases, and their session expiry is subject to owner confirmation.</li>
          </ul>
          <p>
            <strong>Recurring access.</strong> Monthly Case Access does not renew automatically, and we do not charge a card or any stored payment method on a schedule. Each monthly period requires a new payment. How a monthly period ends is subject to owner decision (see the review notice).
          </p>
          <p>
            <strong>Refunds.</strong> <span data-owner-decision="refunds">[Refund eligibility and timing are pending owner approval. This section must be completed before publication.]</span>
          </p>
          <p>
            <strong>Payment disputes.</strong> If a payment is disputed, we may suspend the related access while the dispute is reviewed. Please contact us first at {CONTACT_EMAIL} so we can try to resolve it.
          </p>
        </Section>

        <Section id="privacy" title="7. Privacy and data protection">
          <p>
            Our <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a> explains what personal information we collect, how we use it, who we share it with, and how we handle professional access. Our <a href="/data-deletion" className="text-brand-600 underline hover:text-brand-800 font-semibold">Data Deletion Instructions</a> explain how to ask us to delete information. These Terms are read together with those pages. If there is any inconsistency about how personal information is handled, the Privacy Policy controls.
          </p>
          <p>
            You can also contact us at {CONTACT_EMAIL} about privacy questions. Applicable privacy laws may give you additional rights, and we will respond to requests as those laws require.
          </p>
        </Section>

        <Section id="facebook" title="8. Facebook and marketing features">
          <p>
            CYFSA Navigator has a Marketing Agent that our team uses to plan and publish educational posts for our own social channels. Marketing features are for the operator's own channels only. They do not access the personal Facebook accounts of parents or other users, and you do not need a Facebook account to use the Platform.
          </p>
          <p>
            <strong>Current status.</strong> As of the date of these Terms, no Facebook Page is connected to the production site, and the Platform does not publish to Facebook. Facebook Page connection and publishing features are in development. They are not live, and the Platform does not yet use Facebook OAuth or Facebook publishing permissions in production. This section will be updated when those features are deployed. Our <a href="/data-deletion" className="text-brand-600 underline hover:text-brand-800 font-semibold">Data Deletion Instructions</a> describe the current status in more detail.
          </p>
        </Section>

        <Section id="ip" title="9. Intellectual property">
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Our platform.</strong> CYFSA Navigator, including its software, design, original explanations, guides, templates, and branding, is owned by us or used with permission. You may use the Platform for your own matter, and you may print or save content for your own use, as long as you keep any notices of ownership.</li>
            <li><strong>Your documents.</strong> You keep ownership of the documents and information you upload. You give us a limited, non-exclusive permission to store, process, and display them only to provide the features you use, to keep the service secure, and to meet legal obligations.</li>
            <li><strong>Legislation and government forms.</strong> We do not claim ownership of Ontario legislation, court forms, government publications, or other official materials. We refer to them for educational purposes. Check the official versions before you rely on them.</li>
            <li><strong>Third-party materials.</strong> Third-party providers, such as Anthropic, Google, and Firebase, keep their own rights and terms for the services we use.</li>
            <li><strong>Restrictions.</strong> You may not sell, sublicense, or commercially redistribute our platform content or AI outputs without our written permission.</li>
          </ul>
        </Section>

        <Section id="availability" title="10. Availability, third-party services, and limits of liability">
          <p>
            We aim to keep the Platform available and secure, but we do not guarantee uninterrupted or error-free service. We may suspend or change features for maintenance, security, or other reasons. Where we can, we will give you notice of significant changes.
          </p>
          <p>
            The Platform relies on third-party services, including Google sign-in, Firebase, Supabase, Anthropic, Google's Gemini models, Vercel, and Interac e-Transfer through your bank. Those services can fail or change, and we are not responsible for their availability or conduct beyond what the law requires.
          </p>
          <p>
            AI tools have the limits described in section 4. Outputs can be inaccurate or incomplete, and the Platform can be unavailable at critical times. Do not rely on the Platform as your only source of information about a deadline or a court process.
          </p>
          <p>
            <strong>Limits of liability.</strong> To the extent permitted by law, we are not liable for indirect, incidental, or consequential losses, or for losses caused by your reliance on AI output without verification. <span data-owner-decision="liability-cap">[Proposed, pending owner approval: our total liability to you is limited to the amount you paid us in the 12 months before the claim.]</span>
          </p>
          <p>
            Nothing in these Terms excludes or limits any liability that cannot be excluded or limited under Ontario or Canadian law, including liability for fraud, or any right you have under consumer protection law that cannot be waived.
          </p>
        </Section>

        <Section id="law" title="11. Governing law and disputes">
          <p>
            These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply in Ontario. Subject to any mandatory law that gives you the right to bring a claim where you live, the courts of Ontario have jurisdiction over disputes arising from these Terms or the Platform.
          </p>
        </Section>

        <Section id="changes" title="12. Changes to these Terms">
          <p>
            We may update these Terms from time to time. We will change the effective date at the top of this page when we do. For material changes, we will give notice on the Platform. If you continue to use the Platform after a change takes effect, you accept the updated Terms. If you do not agree, stop using the Platform.
          </p>
        </Section>

        <Section id="contact" title="13. Contact">
          <p>
            For questions about these Terms, privacy requests, or payment issues, email <a className="text-brand-700 underline font-mono" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </Section>
      </div>
    </main>
  );
}
