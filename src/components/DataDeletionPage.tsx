import React from 'react';

const CONTACT_EMAIL = 'chris@cyfsanavigator.com';
const LAST_REVIEWED = 'October 15, 2026';

export default function DataDeletionPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 text-slate-900" aria-labelledby="data-deletion-title">
      <div className="border-b border-slate-200 pb-6 mb-8">
        <h1 id="data-deletion-title" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Data Deletion Instructions
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          CYFSA Navigator · How to request deletion of information related to Facebook · Last reviewed {LAST_REVIEWED}. Read together with our{' '}
          <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a>.
        </p>
      </div>

      <div className="space-y-8 text-slate-800 leading-relaxed text-sm md:text-base">
        <section aria-labelledby="status-heading" className="space-y-3">
          <h2 id="status-heading" className="text-xl font-bold text-slate-900 border-b pb-2">1. What is live and what is not</h2>
          <p>
            This table shows the status of each Facebook-related feature as of the date above. Items marked "not yet available" are not part of the production site, and nothing in this page should be read as saying they are.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm border border-slate-200 rounded-xl">
              <caption className="sr-only">Status of Facebook-related features on cyfsanavigator.com</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Feature</th>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Connecting a Facebook account or Page through CYFSA Navigator</th>
                  <td className="p-3 border-b border-slate-100 align-top">Not yet available. In development. This page will be updated when it is deployed.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Publishing posts to CYFSA Navigator's Facebook Page</th>
                  <td className="p-3 border-b border-slate-100 align-top">Not active. No Facebook Page is connected to the production site.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Disconnecting a Page inside CYFSA Navigator</th>
                  <td className="p-3 border-b border-slate-100 align-top">Not yet available. It ships with the connection feature.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Requesting deletion of Facebook-related information by email</th>
                  <td className="p-3 border-b border-slate-100 align-top">Available now. Handled by a person (section 4).</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Removing CYFSA Navigator Marketing's permissions in Facebook</th>
                  <td className="p-3 border-b border-slate-100 align-top">Available now, in your own Facebook settings (section 3).</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Automatic deletion of Facebook-related information</th>
                  <td className="p-3 border-b border-slate-100 align-top">Not available. Requests are processed manually.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 font-medium align-top">Automatic withdrawal of Facebook permissions by CYFSA Navigator</th>
                  <td className="p-3 align-top">Not available. CYFSA Navigator does not call Facebook to revoke permissions.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="scope-heading" className="space-y-3">
          <h2 id="scope-heading" className="text-xl font-bold text-slate-900 border-b pb-2">2. Who this applies to</h2>
          <p>
            The Facebook integration is for CYFSA Navigator's own Facebook Page, so that approved educational posts can be published there. It is set up by a CYFSA Navigator administrator. It is not a sign-in feature for parents, and it does not read the personal Facebook profile, messages, friends list, or photos of any parent or user.
          </p>
          <p>Parents and families do not need a Facebook account to use CYFSA Navigator.</p>
        </section>

        <section aria-labelledby="held-heading" className="space-y-3">
          <h2 id="held-heading" className="text-xl font-bold text-slate-900 border-b pb-2">3. What information is related to Facebook</h2>
          <p>
            <strong>Held today:</strong> the production site does not store a Facebook account credential or a connected Page. As of the date above, no Facebook Page is connected.
          </p>
          <p>
            <strong>Planned, when the connection is deployed:</strong> the connection would store, and this page would then describe, the following:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Page list (temporary):</strong> the names and IDs of Pages an administrator can post to, held encrypted while the administrator chooses one.</li>
            <li><strong>Page access token:</strong> a credential for the chosen Page, stored encrypted on our servers. It is never shown in the browser.</li>
            <li><strong>Connected Page details:</strong> the Page ID, the Page name, and when it was connected.</li>
            <li><strong>Published post records:</strong> the text and link of each approved post, its Facebook post ID, its status, and any engagement counts Facebook returns.</li>
            <li><strong>Operational records:</strong> connection status, error messages, and activity-log entries such as "Connected Page" with the Page name.</li>
          </ul>
          <p>
            We do not store the administrator's Facebook password, the short-lived sign-in token used during a connection, the administrator's personal Facebook profile, or Facebook messages.
          </p>
        </section>

        <section aria-labelledby="remove-heading" className="space-y-3">
          <h2 id="remove-heading" className="text-xl font-bold text-slate-900 border-b pb-2">3a. Removing permissions in Facebook</h2>
          <p>
            If you have authorized CYFSA Navigator Marketing in Facebook, you can remove it in your own Facebook settings. Look for the section that lists the apps or business integrations connected to your account, and remove CYFSA Navigator Marketing from that list. Facebook's menu names can change, so use the search in your Facebook settings if you cannot find it.
          </p>
          <p>
            Removing the app in Facebook stops Facebook from accepting those permissions. It does not delete information that CYFSA Navigator has already stored. To request that, follow section 4.
          </p>
        </section>

        <section aria-labelledby="request-heading" className="space-y-3">
          <h2 id="request-heading" className="text-xl font-bold text-slate-900 border-b pb-2">4. How to request deletion</h2>
          <p>To request deletion of Facebook-related information, email our privacy contact:</p>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm space-y-1">
            <div><strong>Email:</strong> <a className="text-brand-700 underline font-mono" href={`mailto:${CONTACT_EMAIL}?subject=Facebook%20data%20deletion%20request`}>{CONTACT_EMAIL}</a></div>
            <div><strong>Subject line:</strong> Facebook data deletion request</div>
          </div>
          <p>Please include:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>your name, and the email address you use with CYFSA Navigator if you have one;</li>
            <li>the name or ID of the Facebook Page involved, if you know it;</li>
            <li>whether you are an administrator of that Page; and</li>
            <li>what you want deleted, if it is more specific than everything related to the Page.</li>
          </ul>
          <p>Do not send your Facebook password.</p>
        </section>

        <section aria-labelledby="review-heading" className="space-y-3">
          <h2 id="review-heading" className="text-xl font-bold text-slate-900 border-b pb-2">5. How your request is reviewed</h2>
          <ol className="list-decimal pl-6 space-y-2 text-slate-700">
            <li><strong>Receipt:</strong> we acknowledge the request by email.</li>
            <li><strong>Verification:</strong> before acting, we check that the requester is an administrator of the Page, or the account holder the information relates to. We may ask you to confirm from the email address on record, or to show that you hold an administrator role on the Page in Facebook. We will not ask for your Facebook password.</li>
            <li><strong>Decision:</strong> we decide what can be deleted under section 6, and what must be kept under section 7.</li>
            <li><strong>Action:</strong> we carry out the deletion. Where the connection is still active, we disconnect it first.</li>
            <li><strong>Confirmation:</strong> we email you to confirm what was deleted and, where we kept anything, what was kept and why.</li>
          </ol>
          <p>
            We do not state a guaranteed response time. Requests are handled by a person, not an automated process.
          </p>
        </section>

        <section aria-labelledby="deletable-heading" className="space-y-3">
          <h2 id="deletable-heading" className="text-xl font-bold text-slate-900 border-b pb-2">6. What can be deleted</h2>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>Any stored Page access token and connected Page details, once the connection feature is deployed.</li>
            <li>Any temporary Page list still held.</li>
            <li>Connection-status records related to the Page, where they are not needed under section 7.</li>
          </ul>
          <p>
            <strong>What we cannot delete:</strong> information held by Facebook (Meta). To remove a post from Facebook, delete it there. To change what Facebook holds about your account, use Facebook's own tools and settings.
          </p>
        </section>

        <section aria-labelledby="revoke-heading" className="space-y-3">
          <h2 id="revoke-heading" className="text-xl font-bold text-slate-900 border-b pb-2">7. Removing permissions is not the same as deleting our records</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm border border-slate-200 rounded-xl">
              <caption className="sr-only">Comparison of removing Facebook permissions and deleting CYFSA Navigator records</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Action</th>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Where it happens</th>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Remove permissions</th>
                  <td className="p-3 border-b border-slate-100 align-top">Your Facebook settings</td>
                  <td className="p-3 border-b border-slate-100 align-top">Stops Facebook from accepting the permissions. Does not delete anything CYFSA Navigator already stored.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 font-medium align-top">Delete our records</th>
                  <td className="p-3 align-top">Our side, on request by email</td>
                  <td className="p-3 align-top">Deletes what section 6 covers. Does not remove posts from Facebook.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="retained-heading" className="space-y-3">
          <h2 id="retained-heading" className="text-xl font-bold text-slate-900 border-b pb-2">8. What we may keep, and why</h2>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Published post records</strong> (post text, link, Facebook post ID, and engagement counts) are CYFSA Navigator's record of what it published. Ask us, and we will review whether they should be removed.</li>
            <li><strong>Security and audit logs</strong> are kept for platform security and to resolve access disputes, as set out in section 8 of our Privacy Policy.</li>
            <li><strong>Information required by law</strong>, or needed for an active security investigation, dispute, or court order, is kept for as long as that requirement applies.</li>
          </ul>
          <p>
            We have not set fixed retention periods, and no automatic purge is enabled. Anything kept after a deletion request is limited to the reasons above, and we tell you what was kept when we confirm.
          </p>
        </section>

        <section aria-labelledby="contact-heading" className="space-y-3">
          <h2 id="contact-heading" className="text-xl font-bold text-slate-900 border-b pb-2">9. Contact</h2>
          <p>
            For questions about this page or about deletion requests, email <a className="text-brand-700 underline font-mono" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. For the full privacy policy, see <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">our Privacy Policy</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
