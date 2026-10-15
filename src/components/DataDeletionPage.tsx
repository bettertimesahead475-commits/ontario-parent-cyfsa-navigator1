import React from 'react';

const CONTACT_EMAIL = 'chris@cyfsanavigator.com';

export default function DataDeletionPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 text-slate-900" aria-labelledby="data-deletion-title">
      <div className="border-b border-slate-200 pb-6 mb-8">
        <h1 id="data-deletion-title" className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Data Deletion Instructions
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          CYFSA Navigator · How to disconnect Facebook and request deletion of Facebook-connected information. Read together with our{' '}
          <a href="/privacy" className="text-brand-600 underline hover:text-brand-800 font-semibold">Privacy Policy</a>.
        </p>
      </div>

      <div className="space-y-8 text-slate-800 leading-relaxed text-sm md:text-base">
        <section aria-labelledby="scope-heading" className="space-y-3">
          <h2 id="scope-heading" className="text-xl font-bold text-slate-900 border-b pb-2">1. What this covers</h2>
          <p>
            CYFSA Navigator can connect to <strong>CYFSA Navigator's own Facebook Page</strong> so that approved educational posts can be published there. The connection is set up by a CYFSA Navigator administrator. It is not a sign-in feature and does not read the personal Facebook profile, messages, friends list, or photos of parents or other users.
          </p>
          <p>
            Parents and families do not need a Facebook account to use CYFSA Navigator. If you are not an administrator of the Page, there is nothing connected to your Facebook account that you need to remove from our systems.
          </p>
        </section>

        <section aria-labelledby="collected-heading" className="space-y-3">
          <h2 id="collected-heading" className="text-xl font-bold text-slate-900 border-b pb-2">2. Facebook-connected information we hold</h2>
          <p>When the Facebook Page connection is in use, CYFSA Navigator stores or receives:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Page list (temporary):</strong> the names and IDs of Pages the administrator can post to, held encrypted for up to 15 minutes while the administrator chooses one.</li>
            <li><strong>Page access token:</strong> a credential for the chosen Page, stored encrypted on our servers. It is never shown in the browser.</li>
            <li><strong>Connected Page details:</strong> the Page ID, the Page name, and when it was connected.</li>
            <li><strong>Published post records:</strong> the text and link of each approved post, its Facebook post ID, its publication status, and any engagement counts (such as likes, comments, and shares) that Facebook returns for that post.</li>
            <li><strong>Operational records:</strong> connection status, error messages, and activity-log entries (for example, "Connected Page" with the Page name).</li>
          </ul>
          <p>We do not store the administrator's Facebook password, the short-lived sign-in token used during connection, the administrator's personal Facebook profile, or any Facebook messages.</p>
        </section>

        <section aria-labelledby="disconnect-heading" className="space-y-3">
          <h2 id="disconnect-heading" className="text-xl font-bold text-slate-900 border-b pb-2">3. How to disconnect</h2>
          <p><strong>Remove the connection in CYFSA Navigator.</strong> An administrator can open the Marketing Agent, go to Channels, and choose Disconnect Page. This deletes the stored Page access token and the connected Page details. Posts already published on Facebook stay on Facebook.</p>
          <p><strong>Remove the app in Facebook.</strong> Disconnecting in CYFSA Navigator does not by itself withdraw the permissions granted on Facebook. To withdraw them, open your Facebook settings, find the list of apps and integrations, and remove CYFSA Navigator Marketing.</p>
          <p>Doing both is recommended. Removing the app in Facebook stops Facebook from accepting the permissions. Disconnecting in CYFSA Navigator removes what we stored.</p>
        </section>

        <section aria-labelledby="request-heading" className="space-y-3">
          <h2 id="request-heading" className="text-xl font-bold text-slate-900 border-b pb-2">4. How to request deletion</h2>
          <p>To request deletion of Facebook-connected information, email our privacy contact:</p>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm space-y-1">
            <div><strong>Email:</strong> <a className="text-brand-700 underline font-mono" href={`mailto:${CONTACT_EMAIL}?subject=Facebook%20data%20deletion%20request`}>{CONTACT_EMAIL}</a></div>
            <div><strong>Subject line:</strong> Facebook data deletion request</div>
          </div>
          <p>Please include:</p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>your name and the email address you use with CYFSA Navigator, if any;</li>
            <li>the name or ID of the Facebook Page involved; and</li>
            <li>whether you are an administrator of that Page.</li>
          </ul>
          <p>We may ask you to confirm that you are an administrator of the Page before we act on the request. Please do not send your Facebook password.</p>
        </section>

        <section aria-labelledby="after-heading" className="space-y-3">
          <h2 id="after-heading" className="text-xl font-bold text-slate-900 border-b pb-2">5. What happens after a request</h2>
          <ol className="list-decimal pl-6 space-y-2 text-slate-700">
            <li>We confirm receipt and check the request.</li>
            <li>If the Page is still connected, we disconnect it.</li>
            <li>We delete the stored Page access token and the connected Page details.</li>
            <li>We delete the temporary Page list if one is still held.</li>
            <li>We review the published post records and audit logs against the retention reasons in section 6.</li>
            <li>We email you to confirm when the deletion is complete and state anything we kept, and why.</li>
          </ol>
          <p>CYFSA Navigator does not currently have an automatic deletion process for Facebook-connected information. Requests are handled manually by email.</p>
        </section>

        <section aria-labelledby="revoke-heading" className="space-y-3">
          <h2 id="revoke-heading" className="text-xl font-bold text-slate-900 border-b pb-2">6. Revoking Facebook permissions is not the same as deleting our records</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm border border-slate-200 rounded-xl">
              <caption className="sr-only">Comparison of revoking Facebook permissions and deleting CYFSA Navigator records</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Action</th>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">Where it happens</th>
                  <th scope="col" className="p-3 border-b border-slate-200 font-semibold">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="p-3 border-b border-slate-100 font-medium align-top">Revoke permissions</th>
                  <td className="p-3 border-b border-slate-100 align-top">Your Facebook settings</td>
                  <td className="p-3 border-b border-slate-100 align-top">Stops CYFSA Navigator from using the granted permissions. Does not delete anything CYFSA Navigator already stored.</td>
                </tr>
                <tr>
                  <th scope="row" className="p-3 font-medium align-top">Delete our records</th>
                  <td className="p-3 align-top">Our servers, on request by email</td>
                  <td className="p-3 align-top">Deletes the stored Page token and connected Page details, as described in sections 3 and 5. Does not remove posts from Facebook.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="retained-heading" className="space-y-3">
          <h2 id="retained-heading" className="text-xl font-bold text-slate-900 border-b pb-2">7. What we keep, and why</h2>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Published post records</strong> (post text, link, Facebook post ID, and engagement counts) are kept as CYFSA Navigator's record of what it published. Ask us and we will review whether they should be removed from our records.</li>
            <li><strong>Security and audit logs</strong> are kept for platform security and to resolve access disputes, as set out in section 8 of our Privacy Policy.</li>
            <li><strong>Information required by law</strong>, or needed for an active security investigation, dispute, or court order, may be kept for as long as that requirement applies.</li>
          </ul>
          <p>We have not set fixed retention periods for these records, and no automatic purge is currently enabled. Any retention beyond a deletion request is limited to the reasons above.</p>
        </section>

        <section aria-labelledby="limits-heading" className="space-y-3">
          <h2 id="limits-heading" className="text-xl font-bold text-slate-900 border-b pb-2">8. What we cannot delete</h2>
          <p>We cannot delete information that Facebook (Meta) holds on its own platform. To remove a post from Facebook, delete it in Facebook. To remove your account's data from Facebook, use Facebook's own tools and privacy settings.</p>
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
