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
import { getSupabase, approvePayment, PAYMENT_EMAIL } from "./access.js";

const SENDER_QUERY = 'from:(interac.ca OR payments.interac.ca) newer_than:7d';
const REFERENCE_PATTERN = /\bPS-[A-Z0-9]{5}\b/;
const AMOUNT_PATTERN = /\$\s?([0-9]+(?:\.[0-9]{2})?)/;
const PROCESSED_LABEL_NAME = "CYFSA-Navigator-Processed";

// A payment stuck "pending" this long with no matching Gmail message at all is the other
// failure direction from a noMatch/error: the e-transfer notification never arrived in the
// inbox (or the scan missed it), not that it arrived and failed to match.
const STALE_PENDING_HOURS = 48;

// ---------------------------------------------------------------------------
// Admin alerting: the whole point of surfacing a failure is that Chris doesn't have to go
// looking for it, so a match failure or a stuck payment gets emailed to him directly rather
// than only logged. Reuses the same nodemailer/SMTP setup already used for lawyer-intake
// (api/_server.ts) - if SMTP isn't configured, this just logs and returns false rather than
// throwing, since a missing alert channel should never take down the scan itself.
// ---------------------------------------------------------------------------
async function sendAdminAlert(subject: string, text: string): Promise<boolean> {
  const hasSmtpConfig = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!hasSmtpConfig) {
    console.error("[gmail-agent alert] SMTP not configured - alert NOT sent:", subject);
    return false;
  }
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.ADMIN_ALERT_EMAIL || PAYMENT_EMAIL,
      subject,
      text,
    });
    return true;
  } catch (mailErr) {
    console.error("[gmail-agent alert] email send failed", mailErr);
    return false;
  }
}

function gmailMessageLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

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
  stalePending: { referenceNumber: string; pendingSinceHours: number }[];
}

/**
 * Alerts on `payments` rows stuck "pending" for longer than STALE_PENDING_HOURS with no
 * matching Gmail message ever having arrived at all - the failure direction a per-message
 * noMatch/error can't catch, since there's no message to log against. Dedup'd against
 * `stale_payment_alerts` (keyed on reference_number) so the same stuck payment doesn't
 * re-alert on every cron run.
 */
async function checkStalePendingPayments(db: ReturnType<typeof getSupabase>): Promise<ScanResult["stalePending"]> {
  const alerted: ScanResult["stalePending"] = [];
  const cutoff = new Date(Date.now() - STALE_PENDING_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stalePayments, error } = await db
    .from("payments")
    .select("reference_number, amount, plan, notes, submitted_at")
    .eq("status", "pending")
    .lt("submitted_at", cutoff);
  if (error) {
    console.error("[gmail-agent] failed to query stale pending payments", error);
    return alerted;
  }

  for (const payment of stalePayments || []) {
    const referenceNumber = payment.reference_number;
    if (!referenceNumber) continue;

    const { data: alreadyAlerted } = await db
      .from("stale_payment_alerts")
      .select("reference_number")
      .eq("reference_number", referenceNumber)
      .maybeSingle();
    if (alreadyAlerted) continue;

    const pendingSinceHours = Math.round((Date.now() - new Date(payment.submitted_at).getTime()) / (60 * 60 * 1000));
    const email = (payment.notes || "").replace(/^email:/, "").trim();

    const sent = await sendAdminAlert(
      `[CYFSA Navigator] Payment stuck pending ${pendingSinceHours}h with no matching e-transfer email - ${referenceNumber}`,
      `A payment request has been pending for ${pendingSinceHours} hours (threshold: ${STALE_PENDING_HOURS}h) with no matching Interac e-transfer notification email found in the inbox at all.\n\n` +
        `Reference number: ${referenceNumber}\n` +
        `Plan: ${payment.plan}\n` +
        `Expected amount: $${payment.amount}\n` +
        `Parent email: ${email || "(not recorded)"}\n` +
        `Requested at: ${payment.submitted_at}\n\n` +
        `This usually means the parent's e-transfer notification was never sent, was missed by the scan, or the parent hasn't actually sent the money yet. Check the inbox manually and/or reach out to the parent.`
    );

    if (sent) {
      await db.from("stale_payment_alerts").insert({ reference_number: referenceNumber });
    }
    alerted.push({ referenceNumber, pendingSinceHours });
  }

  return alerted;
}

/** The actual agent run: scans recent Interac emails, matches, and approves. Call this from a cron or an admin-triggered route. */
export async function scanForPayments(): Promise<ScanResult> {
  const gmail = getGmailClient();
  const db = getSupabase();
  const result: ScanResult = { scanned: 0, alreadyProcessed: 0, approved: [], noMatch: [], errors: [], stalePending: [] };

  const { data: listResp } = await gmail.users.messages.list({ userId: "me", q: SENDER_QUERY, maxResults: 50 });
  const messages = listResp.messages || [];
  result.scanned = messages.length;

  const labelId = messages.length > 0 ? await getOrCreateProcessedLabel(gmail) : null;

  for (const msgRef of messages) {
    const messageId = msgRef.id!;
    // Populated as matching progresses, so the catch block below can report whatever partial
    // match was found even if a later step (e.g. approvePayment) is what actually threw.
    let partialReference: string | null = null;
    let partialAmount: string | null = null;
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
      partialReference = refMatch?.[0] || null;
      partialAmount = amountMatch?.[0] || null;

      if (!refMatch) {
        const reason = "No PS-XXXXX reference number found in message body.";
        result.noMatch.push({ messageId, reason });
        const alertSent = await sendAdminAlert(
          `[CYFSA Navigator] Unmatched payment email - no reference number`,
          `An Interac notification email couldn't be matched to a payment request.\n\nReason: ${reason}\nGmail message: ${gmailMessageLink(messageId)}\nMatched fragments: none\n\nA parent may have sent real money with nothing to link it to their account - check the inbox manually.`
        );
        await db.from("gmail_processed_messages").insert({
          message_id: messageId,
          outcome: "no_reference_found",
          alerted_at: alertSent ? new Date().toISOString() : null,
        });
        continue;
      }
      if (!amountMatch) {
        const reason = `Reference ${refMatch[0]} found but no dollar amount could be parsed.`;
        result.noMatch.push({ messageId, reason });
        const alertSent = await sendAdminAlert(
          `[CYFSA Navigator] Unmatched payment email - no amount - ${refMatch[0]}`,
          `An Interac notification email couldn't be matched to a payment request.\n\nReason: ${reason}\nGmail message: ${gmailMessageLink(messageId)}\nMatched fragments: reference ${refMatch[0]}, no amount\n\nA parent may have sent real money with nothing to link it to their account - check the inbox manually.`
        );
        await db.from("gmail_processed_messages").insert({
          message_id: messageId,
          matched_reference: refMatch[0],
          outcome: "no_amount_found",
          alerted_at: alertSent ? new Date().toISOString() : null,
        });
        continue;
      }

      const referenceNumber = refMatch[0];
      const amount = parseFloat(amountMatch[1]);

      const approval = await approvePayment(referenceNumber, amount);
      result.approved.push(approval);

      // approvePayment() already tried to email the code directly to the parent - that's the
      // whole point of the automated path. If it couldn't (SMTP down, no email on file), the
      // payment is still correctly approved and the code still exists, but nobody knows to
      // send it, so this needs the same admin alert as an unmatched message would get.
      if (!approval.emailSent) {
        await sendAdminAlert(
          `[CYFSA Navigator] Payment approved but code email failed to send - ${referenceNumber}`,
          `Payment ${referenceNumber} was matched and approved automatically, and an access code was generated, but the email delivering it to the parent (${approval.email || "no email on file"}) failed to send.\n\nGmail message: ${gmailMessageLink(messageId)}\n\nThe code already exists in access_codes for this reference number - send it to the parent manually.`
        );
      }

      await db.from("gmail_processed_messages").insert({ message_id: messageId, matched_reference: referenceNumber, outcome: "approved" });
      await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds: [labelId!] } });
    } catch (e: any) {
      const errorMessage = e.message || String(e);
      result.errors.push({ messageId, error: errorMessage });
      const alertSent = await sendAdminAlert(
        `[CYFSA Navigator] Payment email processing error${partialReference ? ` - ${partialReference}` : ""}`,
        `An Interac notification email failed to process.\n\nReason: ${errorMessage}\nGmail message: ${gmailMessageLink(messageId)}\nMatched fragments: reference ${partialReference || "none"}, amount ${partialAmount || "none"}\n\nCheck the inbox and the payments table manually - a parent's real money may be involved.`
      );
      // Still mark it processed so a permanently-failing message (e.g. reference
      // number for an already-approved or cancelled payment) doesn't get retried
      // and re-logged as an error on every single future run.
      try {
        await db.from("gmail_processed_messages").insert({
          message_id: messageId,
          matched_reference: partialReference,
          outcome: `error: ${errorMessage}`,
          alerted_at: alertSent ? new Date().toISOString() : null,
        });
      } catch {
        // best-effort - if even this insert fails, the next run will just see it again
      }
    }
  }

  result.stalePending = await checkStalePendingPayments(db);

  return result;
}
