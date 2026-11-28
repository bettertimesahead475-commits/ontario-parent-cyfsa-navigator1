import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildCases, makeRouter, origin } from './mocks.mjs';

const root = join(homedir(), 'qa-artifacts', 'upload');
const fixtureDir = process.env.CYFSA_QA_FIXTURES || join(homedir(), 'qa-fixtures');
const email = process.env.CYFSA_TEST_GOOGLE_EMAIL;
const password = process.env.CYFSA_TEST_GOOGLE_PASSWORD;
const otpSeed = process.env._2FA_CYFSA_TEST_GOOGLE;
if (!email || !password || !otpSeed) {
  console.log('SKIP: dedicated synthetic Google QA credentials are not available; browser not launched.');
  process.exit(0);
}
const require = process.env.CYFSA_PLAYWRIGHT_ROOT
  ? createRequire(join(process.env.CYFSA_PLAYWRIGHT_ROOT, 'package.json'))
  : createRequire(import.meta.url);
const { chromium } = require('playwright');
const cases = buildCases(fixtureDir);
const output = join(root, new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true, mode: 0o700 });
const requests = [];
const router = makeRouter(cases, entry => {
  requests.push(entry);
  appendFileSync(join(output, 'requests.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
});
const context = await chromium.launchPersistentContext(join(root, 'profile'), {
  ...(process.env.CYFSA_CHROME ? { executablePath: process.env.CYFSA_CHROME } : { channel: 'chrome' }),
  headless: process.env.CYFSA_QA_HEADLESS === '1',
  serviceWorkers: 'block',
  viewport: { width: 1440, height: 900 },
});
await context.route('**/*', router.dispatch);
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(12_000);
const collector = [];
const input = page.locator('input[type=file][multiple][accept^=".txt,.pdf,.docx"]');
const uploadPanel = page.getByText('Click to select multiple casework files or audio logs', { exact: true });
const reportCard = page.locator('#report-overview-card');
const folder = page.getByRole('button', { name: /^CAS Correspondence\b/ });
const row = name => page.locator('[id^="file-item-"]').filter({ has: page.getByText(name, { exact: true }) });
const retry = page.getByRole('button', { name: 'Retry Analysis', exact: true }).first();
const count = (action, cursor) => requests.slice(cursor).filter(r => r.action === action);
const archive = page.getByTitle('Archive this brief in the Saved Briefs tab');
const reportTitle = item => 'Synthetic QA report: ' + item.name;
const waitReport = name => reportCard.getByText(name, { exact: true }).first().waitFor();
const screenshot = label => page.screenshot({ path: join(output, label + '.png'), animations: 'disabled' });

function totp(seed) {
  if (seed.startsWith('otpauth://')) seed = new URL(seed).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = seed.toUpperCase().replace(/[\s=]/g, '');
  if (!/^[A-Z2-7]{16,}$/.test(normalized)) throw new Error('Invalid dedicated Google QA TOTP format.');
  const bits = [...normalized].map(ch => alphabet.indexOf(ch).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 0xf) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function activeEmail() {
  return page.evaluate(async () => {
    const authKey = key => key?.startsWith('firebase:authUser:');
    for (const { name } of await indexedDB.databases()) {
      if (name !== 'firebaseLocalStorageDb') continue;
      const values = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); return resolve([]); }
          const req = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
          req.onsuccess = () => { db.close(); resolve(req.result); };
          req.onerror = () => { db.close(); reject(req.error); };
        };
      });
      const user = values.find(entry => authKey(entry.fbase_key));
      if (user) return user.value?.email ?? null;
    }
    const key = Object.keys(localStorage).find(authKey);
    return key ? JSON.parse(localStorage.getItem(key))?.email ?? null : null;
  });
}

async function signedIn() {
  await page.goto(origin + '/document-analyzer', { waitUntil: 'domcontentloaded' });
  const google = page.getByRole('button', { name: 'Sign in with Google', exact: true });
  await google.or(uploadPanel).first().waitFor();
  if (await google.isVisible()) {
    try {
      const [popup] = await Promise.all([page.waitForEvent('popup'), google.click()]);
      const identifier = popup.locator('input[type=email]');
      await identifier.waitFor();
      assert.equal(new URL(popup.url()).origin, 'https://accounts.google.com');
      await identifier.fill(email);
      await popup.locator('#identifierNext').click();
      const pass = popup.locator('input[type=password]');
      await pass.waitFor();
      assert.equal(new URL(popup.url()).origin, 'https://accounts.google.com');
      await pass.fill(password);
      await popup.locator('#passwordNext').click();
      if (await popup.locator('#totpPin').waitFor({ timeout: 10_000 }).then(() => true, () => false)) {
        assert.equal(new URL(popup.url()).origin, 'https://accounts.google.com');
        if (Date.now() % 30_000 > 26_000) await new Promise(r => setTimeout(r, 4100));
        await popup.locator('#totpPin').fill(totp(otpSeed));
        await popup.locator('#totpNext').click();
      }
      await uploadPanel.waitFor({ timeout: 20_000 });
    } catch {
      throw new Error('Dedicated Google sign-in did not complete through the supported email/password/TOTP path; stopped before uploads.');
    }
  }
  if ((await activeEmail())?.toLowerCase() !== email.toLowerCase()) {
    throw new Error('The browser session is not verified as the dedicated synthetic Google account; stopped before uploads.');
  }
}

async function selectFolderRow(item) {
  if (!(await row(item.name).isVisible())) await folder.click();
  await row(item.name).waitFor();
  await row(item.name).click();
}

async function remove(item) {
  const target = row(item.name);
  if (!(await target.isVisible())) await folder.click();
  await target.hover();
  await target.getByTitle('Remove from organizer').click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await target.waitFor({ state: 'detached' });
}

async function run(name, fn) {
  try {
    await fn();
    collector.push({ name, status: 'pass' });
    console.log('PASS (mocked): ' + name);
  } catch (error) {
    collector.push({ name, status: 'fail', error: error.message });
    console.log('FAIL: ' + name);
    await screenshot('fail-' + name.replace(/[^a-z0-9]+/gi, '-')).catch(() => {});
  }
}

async function upload(...items) {
  await input.setInputFiles(items.map(item => join(fixtureDir, item.name)));
}

function auditAnalyze(cursor, items, expectedCount = items.length) {
  const calls = count('analyze', cursor);
  assert.equal(calls.length, expectedCount, 'unexpected number of analyzer POSTs');
  for (const call of calls) {
    assert.equal(call.payload.hasUnexpectedFileData, false);
    assert.equal(call.payload.mode, 'fast');
  }
  for (const item of items) assert.ok(calls.some(call =>
    call.payload.matchedFixtures.includes(item.name) && call.payload.textContent === item.text));
}

try {
  await signedIn();
  if (await page.locator('[id^="file-item-"]').count() || await page.evaluate(() => {
    return Object.keys(localStorage).some(key => key.startsWith('OPA_DOC_ANALYZER_PROGRESS_') &&
      (JSON.parse(localStorage.getItem(key))?.organizedFiles ?? []).length);
  })) {
    throw new Error('This run requires an empty synthetic cabinet; existing files were not touched.');
  }

  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    await run(label + ' upload panel', async () => {
      await page.setViewportSize({ width, height });
      await uploadPanel.scrollIntoViewIfNeeded();
      const box = await uploadPanel.boundingBox();
      assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await screenshot('upload-' + label);
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const item of cases) {
    const cursor = requests.length;
    router.select(item.name, [item]);
    await run(item.name, async () => {
      await upload(item);
      await row(item.name).waitFor();
      if (item.error) {
        await retry.waitFor({ timeout: 15_000 });
        assert.equal(count('analyze', cursor).length, 0, 'invalid upload reached analyzer, rejected only by safe QA mock');
        await page.getByText(item.error, { exact: false }).first().waitFor();
      } else {
        await waitReport(reportTitle(item));
        await retry.waitFor({ state: 'hidden' });
        auditAnalyze(cursor, [item]);
      }
      const extract = count('extract', cursor);
      assert.equal(extract.length, item.kind === 'plain' ? 0 : 1);
      for (const call of extract) assert.equal(call.payload.fixtureVerified, true);
    });
    if (item !== cases[0] && await row(item.name).count()) await remove(item);
    if (item === cases[0]) {
      router.select('cabinet reopen', []);
      await run('cabinet persists, reopens, archives and deletes without rerun', async () => {
        const from = requests.length;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await folder.waitFor();
        await folder.click();
        assert.equal(await folder.locator('..').locator('[id^="file-item-"]').count(), 1);
        await selectFolderRow(item);
        await waitReport(reportTitle(item));
        page.once('dialog', dialog => dialog.accept());
        await archive.click();
        await page.getByRole('button', { name: /^Saved Briefs/ }).click();
        const brief = page.getByText('Synthetic QA brief: no real case facts or legal findings.', { exact: true });
        await brief.waitFor();
        await page.getByPlaceholder('Add your own notes about this brief...').fill('QA note persisted across reload');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await brief.waitFor();
        assert.equal(await page.getByPlaceholder('Add your own notes about this brief...').inputValue(), 'QA note persisted across reload');
        await page.getByTitle('Delete this saved brief').click();
        await page.getByText('No Saved Briefs Yet').waitFor();
        await page.getByRole('button', { name: 'Case Organizer & Audits' }).click();
        await remove(item);
        await folder.click();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await folder.waitFor();
        assert.equal(await row(item.name).count(), 0);
        assert.equal(count('analyze', from).length, 0);
      });
    }
  }

  const pair = cases.slice(0, 2);
  router.select('batch', pair);
  await run('multi-file batch', async () => {
    const from = requests.length;
    await upload(...pair);
    await page.waitForFunction(names => Object.keys(localStorage)
      .filter(key => key.startsWith('OPA_DOC_ANALYZER_PROGRESS_'))
      .some(key => {
        const files = JSON.parse(localStorage.getItem(key))?.organizedFiles ?? [];
        return names.every(name => files.some(file => file.name === name && file.analysisStatus === 'completed'));
      }), pair.map(item => item.name), { timeout: 15_000 });
    for (const item of pair) {
      await selectFolderRow(item);
      await waitReport(reportTitle(item));
    }
    auditAnalyze(from, pair);
    assert.equal(count('extract', from).length, 1);
  });
  for (const item of pair) if (await row(item.name).count()) await remove(item);

  for (const variant of ['500', 'timeout', 'recover']) {
    const item = cases[0];
    router.select(variant, [item], variant);
    await run(variant + ' analysis settles', async () => {
      const from = requests.length;
      await upload(item);
      if (variant === 'recover') await waitReport(reportTitle(item));
      else {
        await page.getByText(variant === '500' ? /Synthetic 500/ : /Synthetic timeout/).first().waitFor({ timeout: 20_000 });
        await retry.waitFor();
      }
      assert.equal(await page.getByText(/Mock review in progress|Mock job running|Waiting on server response/).count(), 0);
      auditAnalyze(from, [item]);
      assert.equal(count('job', from).length, { '500': 0, timeout: 2, recover: 1 }[variant]);
      if (variant !== 'recover') {
        router.select(variant + ' manual retry', [item]);
        const cursor = requests.length;
        await retry.click();
        await waitReport(reportTitle(item));
        auditAnalyze(cursor, [item]);
        assert.equal(count('analyze', cursor)[0].payload.analysisId, count('analyze', from)[0].payload.analysisId);
      }
    });
    if (await row(item.name).count()) await remove(item);
  }
} catch (error) {
  collector.push({ name: 'harness stopped', status: 'fail', error: error.message });
  console.error(error.message);
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify(collector, null, 2) + '\n', { mode: 0o600 });
  await context.close();
  console.log('Artifacts: ' + output);
  if (collector.some(result => result.status === 'fail')) process.exitCode = 1;
}
