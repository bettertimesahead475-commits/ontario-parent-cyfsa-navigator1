// Tests for scanForPayments()'s admin-alerting behavior: a real e-transfer that fails to
// match (no reference number, no amount, or an error during approval) or a payment stuck
// "pending" with no matching email at all must email Chris directly - not just get logged
// somewhere he'd have to go looking. See the comment above sendAdminAlert() in
// gmailAgent.ts for why: a parent could otherwise send real money and never hear back.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGmailApi = vi.hoisted(() => ({
  users: {
    messages: { list: vi.fn(), get: vi.fn(), modify: vi.fn() },
    labels: { list: vi.fn(), create: vi.fn() },
  },
}));

class FakeOAuth2 {
  setCredentials() {}
  generateAuthUrl() {
    return "https://accounts.google.com/fake-auth-url";
  }
  getToken() {
    return Promise.resolve({ tokens: { refresh_token: "fake-refresh-token" } });
  }
}

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: FakeOAuth2 },
    gmail: vi.fn(() => mockGmailApi),
  },
}));

const mockAccess = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  approvePayment: vi.fn(),
  PAYMENT_EMAIL: "donations.ontarioparentassist@gmail.com",
}));
vi.mock("./access.js", () => mockAccess);

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}));

const { scanForPayments } = await import("./gmailAgent.js");

// A minimal fake Supabase query builder covering exactly the chains gmailAgent.ts uses:
// .select().eq().maybeSingle() (existence checks), .select().eq().lt() (awaited directly,
// no maybeSingle - the stale-pending list query), and .insert(row).
function fakeSupabase(tableConfig: Record<string, { maybeSingle?: () => any; list?: () => any; insert?: (row: any) => any }>) {
  return {
    from: (table: string) => {
      const cfg = tableConfig[table] || {};
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        lt: () => builder,
        insert: (row: any) => Promise.resolve(cfg.insert ? cfg.insert(row) : { error: null }),
        maybeSingle: () => Promise.resolve(cfg.maybeSingle ? cfg.maybeSingle() : { data: null, error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve(cfg.list ? cfg.list() : { data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

function gmailMessage(id: string, bodyText: string) {
  return {
    id,
    payload: { body: { data: Buffer.from(bodyText, "utf8").toString("base64url") }, mimeType: "text/plain" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://example.com/callback";
  process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";
  mockGmailApi.users.labels.list.mockResolvedValue({ data: { labels: [{ id: "label-1", name: "CYFSA-Navigator-Processed" }] } });
  mockGmailApi.users.messages.modify.mockResolvedValue({});
  mockSendMail.mockResolvedValue({});
});

describe("scanForPayments - unmatched message alerting", () => {
  it("alerts and records alerted_at when no reference number is found", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "msg-1" }] } });
    mockGmailApi.users.messages.get.mockResolvedValue({ data: gmailMessage("msg-1", "Thanks for your Interac e-transfer of $19.00.") });

    const inserted: any[] = [];
    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        gmail_processed_messages: { maybeSingle: () => ({ data: null }), insert: (row) => (inserted.push(row), { error: null }) },
        payments: { list: () => ({ data: [], error: null }) },
      })
    );

    const result = await scanForPayments();

    expect(result.noMatch).toHaveLength(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toContain("no reference number");
    expect(mockSendMail.mock.calls[0][0].text).toContain("mail.google.com/mail/u/0/#inbox/msg-1");
    expect(inserted[0].outcome).toBe("no_reference_found");
    expect(inserted[0].alerted_at).not.toBeNull();
  });

  it("alerts when a reference is found but no dollar amount can be parsed", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "msg-2" }] } });
    mockGmailApi.users.messages.get.mockResolvedValue({ data: gmailMessage("msg-2", "Re: PS-ABCDE, your transfer has been deposited.") });

    const inserted: any[] = [];
    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        gmail_processed_messages: { maybeSingle: () => ({ data: null }), insert: (row) => (inserted.push(row), { error: null }) },
        payments: { list: () => ({ data: [], error: null }) },
      })
    );

    const result = await scanForPayments();

    expect(result.noMatch[0].reason).toContain("PS-ABCDE");
    expect(mockSendMail.mock.calls[0][0].subject).toContain("PS-ABCDE");
    expect(mockSendMail.mock.calls[0][0].text).toContain("reference PS-ABCDE, no amount");
    expect(inserted[0].matched_reference).toBe("PS-ABCDE");
    expect(inserted[0].alerted_at).not.toBeNull();
  });

  it("alerts with partial matched fragments when approvePayment throws", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "msg-3" }] } });
    mockGmailApi.users.messages.get.mockResolvedValue({ data: gmailMessage("msg-3", "Re: PS-XYZ12, transfer of $49.00 deposited.") });
    mockAccess.approvePayment.mockRejectedValueOnce(new Error("No pending payment found for that reference number."));

    const inserted: any[] = [];
    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        gmail_processed_messages: { maybeSingle: () => ({ data: null }), insert: (row) => (inserted.push(row), { error: null }) },
        payments: { list: () => ({ data: [], error: null }) },
      })
    );

    const result = await scanForPayments();

    expect(result.errors).toHaveLength(1);
    expect(mockSendMail.mock.calls[0][0].subject).toContain("PS-XYZ12");
    expect(mockSendMail.mock.calls[0][0].text).toContain("reference PS-XYZ12, amount $49.00");
    expect(inserted[0].outcome).toContain("No pending payment found");
    expect(inserted[0].alerted_at).not.toBeNull();
  });

  it("does not alert or reprocess a message already recorded in gmail_processed_messages", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "msg-4" }] } });

    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        gmail_processed_messages: { maybeSingle: () => ({ data: { message_id: "msg-4" } }) },
        payments: { list: () => ({ data: [], error: null }) },
      })
    );

    const result = await scanForPayments();

    expect(result.alreadyProcessed).toBe(1);
    expect(mockGmailApi.users.messages.get).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("does not send an alert (but still reports noMatch) when SMTP isn't configured", async () => {
    delete process.env.SMTP_HOST;
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [{ id: "msg-5" }] } });
    mockGmailApi.users.messages.get.mockResolvedValue({ data: gmailMessage("msg-5", "no useful content here") });

    const inserted: any[] = [];
    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        gmail_processed_messages: { maybeSingle: () => ({ data: null }), insert: (row) => (inserted.push(row), { error: null }) },
        payments: { list: () => ({ data: [], error: null }) },
      })
    );

    const result = await scanForPayments();

    expect(result.noMatch).toHaveLength(1);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(inserted[0].alerted_at).toBeNull();
  });
});

describe("scanForPayments - stale pending payment alerting", () => {
  it("alerts on a payment pending longer than the threshold with no matching email", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [] } });

    const staleAlertsInserted: any[] = [];
    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        payments: {
          list: () => ({
            data: [
              {
                reference_number: "PS-STALE",
                amount: 19,
                plan: "Pro",
                notes: "email:parent@example.com",
                submitted_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
              },
            ],
            error: null,
          }),
        },
        stale_payment_alerts: {
          maybeSingle: () => ({ data: null }),
          insert: (row) => (staleAlertsInserted.push(row), { error: null }),
        },
      })
    );

    const result = await scanForPayments();

    expect(result.stalePending).toHaveLength(1);
    expect(result.stalePending[0].referenceNumber).toBe("PS-STALE");
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toContain("PS-STALE");
    expect(mockSendMail.mock.calls[0][0].text).toContain("parent@example.com");
    expect(staleAlertsInserted[0].reference_number).toBe("PS-STALE");
  });

  it("does not re-alert a stale payment that was already alerted", async () => {
    mockGmailApi.users.messages.list.mockResolvedValue({ data: { messages: [] } });

    mockAccess.getSupabase.mockReturnValue(
      fakeSupabase({
        payments: {
          list: () => ({
            data: [
              {
                reference_number: "PS-ALREADY",
                amount: 19,
                plan: "Pro",
                notes: "email:parent@example.com",
                submitted_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
              },
            ],
            error: null,
          }),
        },
        stale_payment_alerts: {
          maybeSingle: () => ({ data: { reference_number: "PS-ALREADY" } }),
        },
      })
    );

    const result = await scanForPayments();

    expect(result.stalePending).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
