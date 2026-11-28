const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { routes, waitHeading } = require('./routes.cjs');

const origin = 'https://cyfsanavigator.com';
const provider = /(^|\.)(anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com)$|-aiplatform\.googleapis\.com$/;
const paid = /^\/api\/(analyze[^/]*|deep-scan|transcribe[^/]*|case-timeline|rag-query|extract-evidence|extract-text|final-case-assessment|matters)(\/|$)/;
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const suites = {
  matrix: require('./matrix.cjs'),
  followup: require('./followup.cjs'),
  stable: require('./stable.cjs'),
  slow: require('./slow.cjs'),
};

function guard(url, method) {
  if (provider.test(url.hostname) || (!readMethods.has(method) && paid.test(url.pathname))) return 'PROHIBITED_ATTEMPT';
  const directorySearch = url.origin === origin && url.pathname === '/api/directory/search' && method === 'POST';
  if (!directorySearch && !readMethods.has(method)) return 'SAFETY_BLOCK_OTHER_WRITE';
  return null;
}

function checkGuards() {
  for (const path of ['/api/analyze', '/api/deep-scan', '/api/transcribe-audio', '/api/extract-text', '/api/final-case-assessment', '/api/matters/qa/documents']) {
    assert.equal(guard(new URL(origin + path), 'POST'), 'PROHIBITED_ATTEMPT');
  }
  for (const host of ['generativelanguage.googleapis.com', 'api.anthropic.com', 'us-central1-aiplatform.googleapis.com']) {
    assert.equal(guard(new URL('https://' + host), 'GET'), 'PROHIBITED_ATTEMPT');
  }
  assert.equal(guard(new URL(origin + '/api/request-access'), 'POST'), 'SAFETY_BLOCK_OTHER_WRITE');
  assert.equal(guard(new URL(origin + '/cdn-cgi/rum'), 'POST'), 'SAFETY_BLOCK_OTHER_WRITE');
  assert.equal(guard(new URL('https://example.com/api/directory/search'), 'POST'), 'SAFETY_BLOCK_OTHER_WRITE');
  assert.equal(guard(new URL(origin + '/api/directory/search'), 'POST'), null);
  assert.equal(guard(new URL(origin + '/analysis-example'), 'GET'), null);
  console.log('Navigation guard checks passed (offline).');
}

const safeUrl = value => {
  const { origin, pathname } = new URL(value);
  return origin + pathname;
};

async function run(names) {
  const requirePlaywright = process.env.CYFSA_PLAYWRIGHT_ROOT
    ? createRequire(join(process.env.CYFSA_PLAYWRIGHT_ROOT, 'package.json'))
    : require;
  const { chromium } = requirePlaywright('playwright');
  const OUT = join(process.env.CYFSA_NAV_ARTIFACTS || join(homedir(), 'qa-artifacts', 'nav'),
    new Date().toISOString().replaceAll(':', '-'));
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({
    ...(process.env.CYFSA_CHROME ? { executablePath: process.env.CYFSA_CHROME } : { channel: 'chrome' }),
    headless: process.env.CYFSA_QA_HEADFUL !== '1',
    args: ['--force-device-scale-factor=1', '--window-size=1600,1100'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const events = [];
    const log = entry => {
      const event = { ...entry, time: new Date().toISOString() };
      events.push(event);
      fs.appendFileSync(join(OUT, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
    };
    await context.route('**/*', route => {
      const request = route.request();
      const type = guard(new URL(request.url()), request.method());
      if (!type) return route.continue();
      log({ type, url: safeUrl(request.url()), method: request.method() });
      return route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      window.__qaLoading = { busySince: null, maxBusyMs: 0, firstHeadingMs: null };
      setInterval(() => {
        const state = window.__qaLoading;
        const now = performance.now();
        const busy = [...document.querySelectorAll('main [aria-busy="true"],main .animate-spin')]
          .some(element => element.getBoundingClientRect().height > 0);
        if (busy) {
          state.busySince ??= now;
          state.maxBusyMs = Math.max(state.maxBusyMs, now - state.busySince);
        } else state.busySince = null;
        if (state.firstHeadingMs === null && document.querySelector('main h1,main h2')) state.firstHeadingMs = now;
      }, 100);
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') log({ type: 'console', page: safeUrl(page.url()) }); });
    page.on('pageerror', () => log({ type: 'pageerror', page: safeUrl(page.url()) }));
    page.on('requestfailed', request => log({ type: 'requestfailed', url: safeUrl(request.url()), error: request.failure()?.errorText }));
    page.on('response', response => {
      if (response.status() >= 400) log({ type: 'http', url: safeUrl(response.url()), status: response.status() });
    });
    const qa = { page, context, fs, OUT, events, routes, waitHeading: waitHeading(page) };
    for (const name of names) {
      const result = await suites[name](qa);
      const failures = name === 'matrix' ? result.errors.length + result.failedChecks.length
        : name === 'followup' ? result.history.filter(item => !item.backOncePassed).length +
          result.duplicateMenu.filter(item => new URL(item.url).pathname !== '/templates' || item.mobileClosed === false).length +
          result.widgets.filter(item => !item.pass).length
        : name === 'stable' ? result.errors.length
        : result.filter(item => item.error || item.navigationError).length;
      console.log(name + ': ' + failures + ' failed checks');
      if (failures) process.exitCode = 1;
    }
    if (events.some(event => event.type === 'PROHIBITED_ATTEMPT')) process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('Artifacts: ' + OUT);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--help') {
  console.log('Usage: node tests/devin/nav/harness.cjs [matrix] [followup] [stable] [slow] | --check-guards');
} else if (args[0] === '--check-guards') {
  checkGuards();
} else if (args.some(name => !Object.hasOwn(suites, name))) {
  console.error('Unknown navigation suite. See --help.');
  process.exitCode = 1;
} else {
  run(args.length ? args : ['matrix', 'followup']).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
