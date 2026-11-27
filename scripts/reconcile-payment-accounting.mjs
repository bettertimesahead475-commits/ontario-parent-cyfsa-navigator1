import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const events = new Set(['refund', 'refund-applied', 'confirm-bank', 'dispute', 'reset-settlement']);
const singleton = new Set(['refund', 'refund-applied']);
const namePattern = /^(\d{8}T\d{9}Z)__([A-Za-z0-9-]+)__([A-Za-z0-9-]+)__[A-Za-z0-9-]+\.json$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compact = (iso) => iso.replace(/[-:.]/g, '');
const literal = (value) => `convert_from(decode('${Buffer.from(value).toString('hex')}', 'hex'), 'UTF8')`;
const keyOf = (row) => `${row.payment_id}/${row.event}/${row.idempotency_key}`;
const canonical = (data) => {
  if (Array.isArray(data)) return data.map(canonical);
  if (data !== null && typeof data === 'object') return Object.fromEntries(Object.keys(data).sort().map((key) => [key, canonical(data[key])]));
  return data;
};

export function planPaymentAccountingImport(objects, payments, existing = []) {
  const lookup = new Map();
  for (const { id, reference_number } of payments) {
    if (!uuidPattern.test(id)) throw new Error('Invalid payment UUID in export');
    const ids = lookup.get(reference_number) ?? [];
    ids.push(id);
    lookup.set(reference_number, ids);
  }
  const rows = [];
  const duplicates = [];
  const seen = new Set();
  const byEvent = new Map();
  for (const { name, body } of [...objects].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const match = namePattern.exec(name);
    if (!match) throw new Error('Invalid Storage audit object name');
    const [, at, event, reference] = match;
    if (!events.has(event)) continue;
    if (seen.has(name)) throw new Error('Duplicate audit object in export');
    seen.add(name);
    const when = new Date(body?.at);
    if (!Number.isFinite(when.valueOf()) || compact(when.toISOString()) !== at ||
        body.action !== event || body.target !== reference || typeof body.admin !== 'string' ||
        (body.reason !== null && typeof body.reason !== 'string') ||
        !body.details || typeof body.details !== 'object' || Array.isArray(body.details)) {
      throw new Error('Audit object body does not match its name or format');
    }
    const ids = lookup.get(reference);
    if (ids?.length !== 1) throw new Error('A financial audit object has a missing or ambiguous payment reference');
    const [id] = ids;
    const row = { payment_id: id, reference_number: reference, event, idempotency_key: `storage:${name}`, occurred_at: when.toISOString(), actor: body.admin, reason: body.reason, details: body.details };
    if (singleton.has(event)) {
      const once = `${id}/${event}`;
      const first = byEvent.get(once);
      if (first) {
        if (JSON.stringify(canonical(first.details)) !== JSON.stringify(canonical(row.details))) {
          throw new Error('Conflicting legacy refund audit duplicates require operator reconciliation');
        }
        duplicates.push(name);
        continue;
      }
      byEvent.set(once, row);
    }
    rows.push(row);
  }
  for (const row of rows.filter(({ event }) => event === 'refund-applied')) {
    const refund = byEvent.get(`${row.payment_id}/refund`);
    if (!refund || refund.occurred_at > row.occurred_at) throw new Error('Refund completion without a prior refund record');
  }
  const expected = new Map(rows.map((row) => [keyOf(row), row]));
  const found = new Set();
  for (const row of existing) {
    const key = keyOf(row);
    const plan = expected.get(key);
    if (!plan || found.has(key) || +new Date(row.occurred_at) !== +new Date(plan.occurred_at) ||
        row.actor !== plan.actor || row.reason !== plan.reason ||
        JSON.stringify(canonical(row.details)) !== JSON.stringify(canonical(plan.details))) {
      throw new Error('The exported ledger differs from the import plan');
    }
    found.add(key);
  }
  const incomplete = rows.filter((row) => row.event === 'refund' && !byEvent.has(`${row.payment_id}/refund-applied`)).length;
  return { rows, duplicateObjects: duplicates.length, missingRows: rows.length - found.size, incompleteRefunds: incomplete };
}

export function renderPaymentAccountingImport(rows) {
  const dataset = literal(JSON.stringify(rows));
  return `begin;
lock table public.payments in share mode;
lock table public.payment_accounting_events in access exclusive mode;
create temporary table payment_accounting_import on commit drop as
select * from jsonb_to_recordset(${dataset}::jsonb)
  as i(payment_id uuid, reference_number text, event text, idempotency_key text, occurred_at timestamptz, actor text, reason text, details jsonb);
do $$
begin
  if exists (
    select 1 from (select distinct payment_id, reference_number from payment_accounting_import) i
    where not exists (select 1 from public.payments p where (p.id, p.reference_number) = (i.payment_id, i.reference_number))
       or (select count(*) from public.payments p where p.reference_number = i.reference_number) <> 1
  ) then raise exception 'Payment identifiers no longer match the import plan'; end if;
  if exists (
    select 1 from public.payment_accounting_events e
    where not exists (select 1 from payment_accounting_import i
      where (e.payment_id, e.event, e.idempotency_key, e.occurred_at, e.actor, e.details)
        = (i.payment_id, i.event, i.idempotency_key, i.occurred_at, i.actor, i.details)
        and e.reason is not distinct from i.reason)
  ) then raise exception 'Existing ledger differs from the import plan'; end if;
end
$$;
insert into public.payment_accounting_events (payment_id, event, idempotency_key, occurred_at, actor, reason, details)
select payment_id, event, idempotency_key, occurred_at, actor, reason, details
from payment_accounting_import order by occurred_at, idempotency_key collate "C"
on conflict (payment_id, event, idempotency_key) do nothing;
commit;`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, objects, payments, existing] = process.argv.slice(2);
  try {
    if ((mode !== '--plan' && mode !== '--reconcile') || !objects || !payments ||
        (mode === '--reconcile' ? !existing : !!existing)) {
      throw new Error('Usage: node scripts/reconcile-payment-accounting.mjs --plan audit.json payments.json | --reconcile audit.json payments.json ledger.json');
    }
    const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const result = planPaymentAccountingImport(load(objects), load(payments), existing ? load(existing) : []);
    const { rows, ...summary } = result;
    console.error(JSON.stringify({ expectedRows: rows.length, ...summary }));
    if (mode === '--plan') console.log(renderPaymentAccountingImport(rows));
    else if (summary.missingRows || summary.incompleteRefunds) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid JSON export' : error.message);
    process.exitCode = 1;
  }
}
