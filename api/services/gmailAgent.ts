// ---------------------------------------------------------------------------
// Automates the manual step in access.ts's approvePayment(): instead of Chris
// checking his own inbox and running the admin-approve call by hand for every
// e-transfer, this watches donations.ontarioparentassist@gmail.com (HIS OWN
// inbox - not a parent's) for Interac Autodeposit notifications, matches the
// reference number in the message body against a pending `payments` row, and
// approves it automatically.
//
// This reads Chris's own Gmail via a one-time OAuth grant he does himself in
// a browser (see the auth-url/callback routes in _server.ts) - it never asks
// for or touches a parent's Google account, so it doesn't reopen the Drive/
// Gmail/Photos removal decision from earlier. It is read-only on Gmail
// (gmail.readonly scope) except for applying a label to mark a message
// processed, so nothing is ever deleted or sent from his inbox.
//
// IMPORTANT CAVEAT, worth reading before trusting this in production: Interac
// Autodeposit notification emails vary by financial institution in whether
// the sender's memo/message text is echoed into the notification body at
// all. The SENDER_QUERY and MEMO_PATTERN below are a reasonable starting
// guess, not verified against Chris's real inbox (no real e-transfer has
// been sent through this app yet, per the 9-views/0-requests funnel data).
// The first time a real payment comes in, check server logs / the
// gmail_processed_messages table to confirm it actually matched - if the
// bank doesn't echo the memo, this needs a fallback matching strategy
// (e.g., matching sender name/amount against the pending payments table
// instead of the reference number).
// ---------------------------------------------------------------------------

import { google } from "googleapis";
import { getSupabase, approvePayment } from "./access.js";

const SENDER_QUERY = 'from:(interac.ca OR payments.interac.ca) newer_than:7d';
const REFERENCE_PATTERN = /\bPS-[A-Z0-9]{5}\b/;
const AMOUNT_PATTERN = /\$\s?([0-9]+(?:\.[0-9]{2})?)/;
const PROCESSED_LABEL_NAME = "CYFSA-Navigator-Processed";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw Object.assign(
      new Error(
        "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI are not configured. Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console, enable the Gmail API, and set these three in Vercel."
      ),
      { statusCode: 503 }
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Step 1 of one-time setup: the URL Chris visits in a real browser to grant Gmail read access to his own inbox. */
export function getGmailAuthUrl(): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // forces a refresh_token even on repeat authorization
    scope: ["https://www.googleapis.com/auth/gmail.modify"], // .modify (not just .readonly) so we can label processed messages
  });
}

/** Step 2 of one-time setup: exchanges the code Google redirects back with for a refresh token. */
export async function exchangeGmailAuthCode(code: string): Promise<string> {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. This usually means the account already granted access before without revoking it - go to https://myaccount.google.com/permissions, remove CYFSA Navigator's access, and try the auth URL again."
    );
  }
  return tokens.refresh_token;
}

function getGmailClient() {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!refreshToken) {
    throw Object.assign(
      new Error("GMAIL_REFRESH_TOKEN is not configured. Run the one-time /api/admin/gmail-auth-url flow first."),
      { statusCode: 503 }
    );
  }
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function decodeBody(payload: any): string {
  let text = "";
  const walk = (part: any) => {
    if (!part) return;
    if (part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")) {
      text += Buffer.from(part.body.data, "base64url").toString("utf8") + "\n";
    }
    if (part.parts) part.parts.forEach(walk);
  };
  walk(payload);
  return text;
}

async function getOrCreateProcessedLabel(gmail: ReturnType<typeof google.gmail>): Promise<string> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === PROCESSED_LABEL_NAME);
  if (existing?.id) return existing.id;
  const { data: created } = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name: PROCESSED_LABEL_NAME, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return created.id!;
}

export interface ScanResult {
  scanned: number;
  alreadyProcessed: number;
  approved: { referenceNumber: string; email: string; tier: string; code: string }[];
  noMatch: { messageId: string; reason: string }[];
  errors: { messageId: string; error: string }[];
}

/** The actual agent run: scans recent Interac emails, matches, and approves. Call this from a cron or an admin-triggered route. */
export async function scanForPayments(): Promise<ScanResult> {
  const gmail = getGmailClient();
  const db = getSupabase();
  const result: ScanResult = { scanned: 0, alreadyProcessed: 0, approved: [], noMatch: [], errors: [] };

  const { data: listResp } = await gmail.users.messages.list({ userId: "me", q: SENDER_QUERY, maxResults: 50 });
  const messages = listResp.messages || [];
  result.scanned = messages.length;
  if (messages.length === 0) return result;

  const labelId = await getOrCreateProcessedLabel(gmail);

  for (const msgRef of messages) {
    const messageId = msgRef.id!;
    try {
      const { data: already } = await db.from("gmail_processed_messages").select("message_id").eq("message_id", messageId).maybeSingle();
      if (already) {
        result.alreadyProcessed++;
        continue;
      }

      const { data: full } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      const bodyText = decodeBody(full.payload);

      const refMatch = bodyText.match(REFERENCE_PATTERN);
      const amountMatch = bodyText.match(AMOUNT_PATTERN);

      if (!refMatch) {
        result.noMatch.push({ messageId, reason: "No PS-XXXXX reference number found in message body." });
        await db.from("gmail_processed_messages").insert({ message_id: messageId, outcome: "no_reference_found" });
        continue;
      }
      if (!amountMatch) {
        result.noMatch.push({ messageId, reason: `Reference ${refMatch[0]} found but no dollar amount could be parsed.` });
        await db.from("gmail_processed_messages").insert({ message_id: messageId, matched_reference: refMatch[0], outcome: "no_amount_found" });
        continue;
      }

      const referenceNumber = refMatch[0];
      const amount = parseFloat(amountMatch[1]);

      const approval = await approvePayment(referenceNumber, amount);
      result.approved.push(approval);

      await db.from("gmail_processed_messages").insert({ message_id: messageId, matched_reference: referenceNumber, outcome: "approved" });
      await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds: [labelId] } });
    } catch (e: any) {
      result.errors.push({ messageId, error: e.message || String(e) });
      // Still mark it processed so a permanently-failing message (e.g. reference
      // number for an already-approved or cancelled payment) doesn't get retried
      // and re-logged as an error on every single future run.
      try {
        await db.from("gmail_processed_messages").insert({ message_id: messageId, outcome: `error: ${e.message || e}` });
      } catch {
        // best-effort - if even this insert fails, the next run will just see it again
      }
    }
  }

  return result;
}
