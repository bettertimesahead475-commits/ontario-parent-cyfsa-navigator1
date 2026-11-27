/**
 * Plain-text transactional email templates (payments and access only). No marketing content: no offers, no
 * newsletter, no tracking pixels or links other than the site itself. Promotional email is a separate system
 * (supabase/migrations/20261005_marketing_agent.sql) and must never use these kinds or the transactional outbox.
 */
export const TRANSACTIONAL_KINDS = [
  'payment_instructions',
  'payment_confirmation',
  'purchase_receipt',
  'access_code',
  'renewal_reminder',
  'refund_confirmation',
] as const;
export type TransactionalKind = (typeof TRANSACTIONAL_KINDS)[number];

export type TemplateData = {
  reference?: string;
  plan?: string;
  amount?: number;
  payTo?: string;
  approvedAt?: string;
  expiresAt?: string;
};

const SITE = 'https://cyfsanavigator.com';
const FOOTER = [
  '',
  '--',
  'CYFSA Navigator',
  `${SITE}`,
  'This is a transactional message about your own order. It is not marketing, so it has no unsubscribe link.',
  'CYFSA Navigator provides legal information, not legal advice.',
];

const money = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)} CAD` : 'Not recorded');
const day = (iso: string | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : 'Not recorded');
const value = (s: string | undefined) => (s && s.trim() ? s.trim() : 'Not recorded');

export function renderTransactionalEmail(kind: TransactionalKind, data: TemplateData, accessCode?: string): { subject: string; text: string } {
  const ref = value(data.reference);
  const plan = value(data.plan);
  let subject: string;
  let body: string[];
  switch (kind) {
    case 'payment_instructions':
      subject = `Payment instructions for order ${ref}`;
      body = [
        `Thank you for your order (${plan}).`,
        '',
        `Amount: ${money(data.amount)}`,
        `Send by Interac e-Transfer to: ${value(data.payTo)}`,
        `Reference: ${ref}`,
        '',
        `Put "${ref}" in the e-Transfer message so your payment can be matched.`,
        'An administrator confirms every payment by hand after the funds arrive. You will get another email when it is confirmed.',
      ];
      break;
    case 'payment_confirmation':
      subject = `Payment received for order ${ref}`;
      body = [
        `We received your payment of ${money(data.amount)} for ${plan} (reference ${ref}).`,
        '',
        `To activate it, sign in at ${SITE}/pricing and choose "Activate now" under Your orders.`,
      ];
      break;
    case 'purchase_receipt':
      subject = `Receipt for order ${ref}`;
      body = [
        'Receipt',
        '',
        `Order reference: ${ref}`,
        `Package: ${plan}`,
        `Amount paid: ${money(data.amount)}`,
        'Payment method: Interac e-Transfer',
        `Payment confirmed: ${day(data.approvedAt)}`,
        '',
        'Keep this email for your records.',
      ];
      break;
    case 'access_code':
      if (!accessCode) throw new Error('access_code email needs the code');
      subject = `Your access code for order ${ref}`;
      body = [
        `Your access code for ${plan} is:`,
        '',
        `    ${accessCode}`,
        '',
        `Enter it at ${SITE}/pricing while signed in to the account that placed the order. It works once and expires on ${day(data.expiresAt)}.`,
        `You can also choose "Activate now" under Your orders on the same page instead of typing the code.`,
        'Do not share this code.',
      ];
      break;
    case 'renewal_reminder':
      subject = `Your ${plan} access ends on ${day(data.expiresAt)}`;
      body = [
        `Your ${plan} access ends on ${day(data.expiresAt)}.`,
        '',
        `If you want to keep it, you can renew at ${SITE}/pricing. Your saved reports stay in your account either way.`,
      ];
      break;
    case 'refund_confirmation':
      subject = `Refund recorded for order ${ref}`;
      body = [
        `A refund of ${money(data.amount)} for ${plan} (reference ${ref}) has been recorded.`,
        '',
        'The funds are returned to you by Interac e-Transfer. Reply to this email if you have a question about it.',
      ];
      break;
  }
  return { subject, text: [...body, ...FOOTER].join('\n') };
}
