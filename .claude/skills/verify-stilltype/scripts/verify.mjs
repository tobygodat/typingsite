#!/usr/bin/env node
// Drives the real Stilltype app in system Chromium and keeps the evidence outside /tmp.
// Run with no arguments for usage. Supabase is always faked with e2e/fake-supabase.js.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const git = (...args) => { try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'detached';
const slug = `${path.basename(root)}-${branch}`.replace(/[^A-Za-z0-9._-]/g, '-');
const home = os.homedir();
const stateDir = path.join(process.env.XDG_STATE_HOME || path.join(home, '.local/state'), 'stilltype-verify', slug);
const evidenceRoot = process.env.STILLTYPE_EVIDENCE_DIR || path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'stilltype-verify', slug);
const serverFile = path.join(stateDir, 'server.json');
// One port per checkout, away from npm run dev (5173) and the e2e suite (4173), so worktrees never collide.
const defaultPort = 5200 + [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 600;

const USAGE = `verify.mjs — drive Stilltype in Chromium, evidence under ${evidenceRoot}

  serve [--port N]          start this checkout's server in the background (default port ${defaultPort})
  stop                      stop the server that serve started (never anything else)
  doctor [--url URL]        read-only: node, playwright, chromium, and that the server serves THIS checkout
  shot <flow...> [options]  run flows and save screenshots, ARIA snapshots and run.json
  drive <file.mjs> [opts]   run your own flow: export default async ({ page, shot, note, check, h }) => {}
  list                      recent evidence folders, newest first

flows:   idle  results  more  settings  signin
presets: phone (idle + more at 390 and 320, touch)   light (idle + results, light system theme)   all

options: --width N --height N  --mobile (touch + mobile viewport)  --scheme dark|light (default dark)
         --reduced-motion  --signed-in (sign in through the account dialog first, fake Supabase)
         --seed N|off (default 20261009: same passage every run)  --delay MS (per key, default 100)
         --url URL (drive an already running server; doctor must pass)  --full-page  --out DIR`;

const FLOWS = ['idle', 'results', 'more', 'settings', 'signin'];
const PRESETS = {
  phone: [390, 320].flatMap((width) => ['idle', 'more'].map((flow) => ({ flow, width, height: width === 320 ? 568 : 844, mobile: true }))),
  light: ['idle', 'results'].map((flow) => ({ flow, scheme: 'light' })),
};
PRESETS.all = [...FLOWS.map((flow) => ({ flow })), ...PRESETS.phone, ...PRESETS.light];

function parseArgs(argv) {
  const opts = { _: [] };
  const flags = new Set(['mobile', 'reduced-motion', 'signed-in', 'full-page']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { opts._.push(arg); continue; }
    const key = arg.slice(2);
    if (flags.has(key)) opts[key] = true;
    else if (i + 1 < argv.length) opts[key] = argv[++i];
    else fail(`${arg} needs a value`);
  }
  return opts;
}

function fail(message) { console.error(`verify: ${message}`); process.exit(2); }

const sha = (data) => createHash('sha256').update(data).digest('hex');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A worktree has no node_modules of its own; the main checkout's are the same packages (as desktop-test does).
function loadPlaywright() {
  const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const candidates = [root, commonDir && path.dirname(commonDir)].filter(Boolean);
  for (const dir of candidates) {
    try {
      const require = createRequire(path.join(dir, 'package.json'));
      const entry = require.resolve('@playwright/test');
      const version = readJson(path.join(path.dirname(entry), 'package.json'))?.version;
      return { entry, version, from: dir };
    } catch { /* next */ }
  }
  return null;
}

async function chromiumApi(pw) {
  const playwright = await import(pathToFileURL(pw.entry).href);
  return playwright.chromium ?? playwright.default.chromium;
}

// The first Chromium that runs: $CHROMIUM, the desktop's /usr/bin/chromium, the cloud machines'
// /usr/local/bin/chromium, then Playwright's own download (npx playwright install chromium).
async function findChromium(pw) {
  const candidates = [
    process.env.CHROMIUM && { path: process.env.CHROMIUM, from: 'CHROMIUM' },
    { path: '/usr/bin/chromium', from: 'system' },
    { path: '/usr/local/bin/chromium', from: 'system' },
    pw && { path: (await chromiumApi(pw)).executablePath(), from: 'playwright' },
  ].filter(Boolean);
  const skipped = [];
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate.path, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return { ...candidate, version, skipped };
    } catch { skipped.push(candidate.path); }
  }
  return { skipped };
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// Is `url` serving exactly this checkout's files? The server reads from disk per request, so edits show at once.
async function servesThisCheckout(url) {
  const files = ['index.html', 'src/app.js', 'src/styles.css'];
  const mismatched = [];
  for (const file of files) {
    let body;
    try {
      const response = await fetch(new URL(file === 'index.html' ? '/' : `/${file}`, url), { signal: AbortSignal.timeout(3000) });
      if (!response.ok) { mismatched.push(`${file} (HTTP ${response.status})`); continue; }
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) { return { ok: false, reason: `no answer at ${url} (${error.cause?.code || error.message})` }; }
    if (sha(body) !== sha(fs.readFileSync(path.join(root, file)))) mismatched.push(file);
  }
  return mismatched.length ? { ok: false, reason: `${url} serves different ${mismatched.join(', ')} (another checkout or a stale server)` } : { ok: true };
}

async function startServer(port, { managed }) {
  if (!(await portFree(port))) fail(`port ${port} is taken by something serve did not start; pass --port N`);
  fs.mkdirSync(stateDir, { recursive: true });
  const log = fs.openSync(path.join(stateDir, managed ? 'server.log' : `server-${port}.log`), 'a');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, detached: managed, stdio: ['ignore', log, log] });
  const url = `http://127.0.0.1:${port}/`;
  // Ready means the page and its scripts come back byte-identical to this checkout, not just that a port answers.
  for (let i = 0; i < 50; i++) {
    if ((await servesThisCheckout(url)).ok) break;
    if (child.exitCode !== null) fail(`server exited with ${child.exitCode}; see ${path.join(stateDir, 'server.log')}`);
    await sleep(100);
  }
  const ready = await servesThisCheckout(url);
  if (!ready.ok) { child.kill(); fail(`server never became ready: ${ready.reason}`); }
  if (managed) {
    child.unref();
    fs.writeFileSync(serverFile, JSON.stringify({ pid: child.pid, port, url, root, started: new Date().toISOString() }, null, 2));
  }
  return { url, child };
}

// The managed server, only if it is still our node server.mjs in this checkout.
function managedServer() {
  const state = readJson(serverFile);
  if (!state || !alive(state.pid)) return null;
  try {
    const cmdline = fs.readFileSync(`/proc/${state.pid}/cmdline`, 'utf8');
    const cwd = fs.readlinkSync(`/proc/${state.pid}/cwd`);
    if (!cmdline.includes('server.mjs') || cwd !== root) return null;
  } catch { return null; }
  return state;
}

async function serve(opts) {
  const running = managedServer();
  if (running) { console.log(`already serving ${running.url} (pid ${running.pid})`); return; }
  const { url, child } = await startServer(Number(opts.port || defaultPort), { managed: true });
  console.log(`serving ${root}\n  url  ${url}\n  pid  ${child.pid}\n  log  ${path.join(stateDir, 'server.log')}\nstop with: ${process.argv[1]} stop`);
}

function stop() {
  const running = managedServer();
  if (!running) { fs.rmSync(serverFile, { force: true }); console.log('no managed server running'); return; }
  process.kill(running.pid, 'SIGTERM');
  fs.rmSync(serverFile, { force: true });
  console.log(`stopped pid ${running.pid} (${running.url})`);
}

async function doctor(opts) {
  let ok = true;
  const line = (good, label, detail) => { if (!good) ok = false; console.log(`${good ? 'ok  ' : 'FAIL'}  ${label.padEnd(11)} ${detail}`); };
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 18, 'node', process.version);
  const pw = loadPlaywright();
  line(Boolean(pw), 'playwright', pw ? `@playwright/test ${pw.version} from ${pw.from}` : 'not found here or in the main checkout; run npm ci');
  const browser = await findChromium(pw);
  const skipped = browser.skipped.length ? `; skipped ${browser.skipped.join(', ')}` : '';
  line(Boolean(browser.path), 'chromium', browser.path
    ? `${browser.version} (${browser.path}, from ${browser.from}${skipped})`
    : `none runs (tried ${browser.skipped.join(', ')}); set CHROMIUM or run npx playwright install chromium`);
  const dirty = git('status', '--porcelain') ? ' + uncommitted changes' : '';
  line(true, 'checkout', `${root} @ ${branch} ${git('rev-parse', '--short', 'HEAD')}${dirty}`);
  const running = managedServer();
  const url = opts.url || running?.url;
  if (!url) line(true, 'server', `none running; shot starts a private one, or run serve (port ${defaultPort})`);
  else {
    const check = await servesThisCheckout(url);
    line(check.ok, 'server', check.ok ? `${url} serves this checkout${running && !opts.url ? ` (pid ${running.pid})` : ''}` : check.reason);
  }
  try { fs.mkdirSync(evidenceRoot, { recursive: true }); fs.accessSync(evidenceRoot, fs.constants.W_OK); line(true, 'evidence', evidenceRoot); } catch (error) { line(false, 'evidence', `${evidenceRoot}: ${error.message}`); }
  process.exit(ok ? 0 : 1);
}

// ---- driving --------------------------------------------------------------------------------------

// The same passage every run unless --seed off, so before/after shots line up (as e2e/light-contrast.spec.js does).
const seedScript = (seed) => `(() => { let s = ${seed}; Math.random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();`;

function helpers(page, { delay }) {
  const attr = (selector, name, value, timeout = 10000) => page.waitForFunction(
    ([s, n, v]) => { const el = document.querySelector(s); return el && (v === null ? el.hasAttribute(n) : el.getAttribute(n) === v); },
    [selector, name, value], { timeout });
  const h = {
    attr,
    text: (selector) => page.locator(selector).first().textContent().then((t) => t?.trim() ?? null),
    async openApp(route = '/') {
      await page.goto(route);
      await page.locator('#text-display .char').first().waitFor();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
    },
    passage: () => page.locator('#accessible-passage').textContent(),
    async type(text) { await page.locator('#typing-input').focus(); await page.keyboard.type(text, { delay }); },
    async chooseWords(count = 10) {
      await page.locator('#mode-words').click();
      await page.locator(`#duration-options [data-length="${count}"]`).click();
      await page.waitForFunction((c) => document.querySelector('#condition-line')?.textContent.includes(`${c} words`), count);
    },
    // Code, standard, book, compose, custom and learn to type sit behind "more".
    async chooseMore(id) {
      if ((await page.locator('#mode-more').getAttribute('open')) === null) await page.locator('#mode-more-label').click();
      await page.locator(`#${id}`).click();
    },
    async openView(label) {
      // A run fades the dock and disables its pointer events; a real mouse nudge brings it back.
      await page.mouse.move(5, 5); await page.mouse.move(40, 40);
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label }).click();
    },
    // Settings is a modal <dialog> opened from the dock's sliders button; categories sit in its side nav.
    async openSettings(category) {
      if (!(await page.locator('#settings-dialog').evaluate((dialog) => dialog.open))) {
        await page.mouse.move(5, 5); await page.mouse.move(40, 40);
        await page.locator('#settings-trigger').click();
      }
      await page.locator('#settings-dialog[open]').waitFor();
      if (category) {
        await page.locator(`#settings-dialog [data-settings-category="${category}"]`).click();
        await page.locator(`#settings-${category}`).waitFor();
      }
    },
    async signIn(email, password = 'correct horse battery') {
      await page.locator('#account-trigger').click();
      await page.locator('#account-signin').click();
      await page.locator('#account-email-input').fill(email);
      await page.locator('#account-password').fill(password);
      await Promise.all([page.waitForEvent('load'), page.locator('#account-submit').click()]);
      await attr('#account', 'data-state', 'member');
      await attr('#account', 'data-sync', 'synced');
      await page.locator('#text-display .char').first().waitFor();
    },
    // Lets the line scroll, fades and the run card's graph finish drawing before a shot. The idle caret's
    // breathe is infinite, so only finite animations count, and nothing waits longer than two seconds.
    settle: () => page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).then(() => undefined)).then(() => sleep(250)),
  };
  return h;
}

const FLOW_IMPL = {
  async idle({ h, shot, note }) {
    await h.openApp();
    await h.settle();
    note('conditions', await h.text('#condition-line'));
    await shot('idle');
  },

  async results({ page, h, shot, note, check }) {
    await h.openApp();
    await h.chooseWords(10);
    await shot('ready');
    const text = await h.passage();
    const half = Math.ceil(text.length / 2);
    await h.type(text.slice(0, half));
    check(await page.locator('body').getAttribute('data-running') !== null, 'body[data-running] is set mid-run (chrome fades)');
    await shot('mid-run');
    await h.type(text.slice(half));
    await h.attr('body', 'data-view', 'results');
    await h.settle();
    const result = {};
    for (const key of ['wpm', 'accuracy', 'time', 'consistency', 'standing', 'conditions']) result[key] = await h.text(`#result-${key}`);
    result.counts = await page.locator('#result-accuracy-fact').getAttribute('title');
    note('passage', text);
    note('result', result);
    check(/^\d+$/.test(result.wpm), `result wpm is a number (${result.wpm})`);
    check(result.accuracy === '100', `accuracy is 100 for a clean run (${result.accuracy})`);
    await shot('results');
  },

  async more({ page, h, shot, note, check }) {
    await h.openApp();
    await shot('rail');
    await page.locator('#mode-more-label').click();
    await page.locator('.mode-more-menu').waitFor();
    await h.settle();
    const items = await page.locator('.mode-more-menu button').allTextContents();
    note('menu', items);
    const box = await page.locator('.mode-more-menu').boundingBox();
    const width = page.viewportSize().width;
    check(box.x >= 0 && box.x + box.width <= width, `menu stays on screen (${Math.round(box.x)}..${Math.round(box.x + box.width)} of ${width})`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
    await shot('more-open');
  },

  async settings({ page, h, shot, note, check }) {
    await h.openApp();
    const before = await page.locator('html').getAttribute('data-theme');
    await h.openSettings('appearance');
    await h.settle();
    await shot('settings');
    const target = before === 'light' ? 'dark' : 'light';
    const option = page.locator(`#theme-select input[value="${target}"]`);
    await option.locator('..').click();
    check(await option.isChecked(), `theme radio "${target}" is checked`);
    await h.attr('html', 'data-theme', target);
    await h.settle();
    const after = await page.locator('html').getAttribute('data-theme');
    note('theme', { before, after });
    check(after === target, `theme radio switched html[data-theme] ${before} -> ${after}`);
    await shot(`settings-${target}`);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    check(await page.locator('#settings-trigger').evaluate((el) => el === document.activeElement), 'Escape closes settings and returns focus to the dock button');
    check(await page.locator('html').getAttribute('data-theme') === target, 'the picked theme stays after closing');
  },

  async signin({ page, h, shot, note, check, fake }) {
    await h.openApp();
    check(await page.locator('#account').getAttribute('data-state') === 'guest', 'starts as a guest');
    await shot('guest');
    fake.addUser('verify@stilltype.test');
    await h.signIn('verify@stilltype.test');
    await h.settle();
    const account = { state: await page.locator('#account').getAttribute('data-state'), sync: await page.locator('#account').getAttribute('data-sync') };
    note('account', account);
    check(account.state === 'member' && account.sync === 'synced', `account is member/synced (${account.state}/${account.sync})`);
    // The side effect, not just the badge: the fake backend holds a profile row for this user.
    check(fake.profileFor('verify@stilltype.test') !== null, 'fake Supabase stored a profile row for the user');
    await shot('signed-in');
    await page.locator('#account-trigger').click();
    await h.settle();
    await shot('account-menu');
  },
};

function plan(names, opts) {
  if (!names.length) fail(`name a flow: ${FLOWS.join(', ')}, or a preset: ${Object.keys(PRESETS).join(', ')}`);
  return names.flatMap((name) => {
    if (PRESETS[name]) return PRESETS[name];
    if (FLOW_IMPL[name]) return [{ flow: name }];
    fail(`unknown flow "${name}"`);
  }).map((item) => ({
    width: Number(opts.width || 1280), height: Number(opts.height || 800), mobile: Boolean(opts.mobile), scheme: opts.scheme || 'dark', ...item,
  }));
}

async function run(items, opts, label) {
  const pw = loadPlaywright();
  if (!pw) fail('playwright not found; run npm ci in this checkout (or the main checkout)');
  const chromium = await chromiumApi(pw);
  const browserPath = (await findChromium(pw)).path;
  if (!browserPath) fail('no Chromium runs; set CHROMIUM or run npx playwright install chromium. Run doctor.');
  const { FakeSupabase } = await import(pathToFileURL(path.join(root, 'e2e/fake-supabase.js')).href);

  let url = opts.url;
  let privateServer = null;
  if (url) {
    const check = await servesThisCheckout(url);
    if (!check.ok) fail(`${check.reason}. Run doctor.`);
  } else {
    url = managedServer()?.url;
    if (!url) {
      // A private server lives only as long as this command, even if it fails or is interrupted.
      privateServer = await startServer(await freePort(), { managed: false });
      url = privateServer.url;
      process.on('exit', () => privateServer.child.kill());
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const outDir = path.resolve(opts.out || path.join(evidenceRoot, `${stamp}-${label}`));
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    label, url, root, branch, commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), chromium: browserPath,
    started: new Date().toISOString(), seed: opts.seed || '20261009', runs: [],
  };
  let failed = false;
  const browser = await chromium.launch({ executablePath: browserPath });
  try {
    for (const item of items) {
      const tag = `${item.flow}.${item.width}x${item.height}.${item.scheme}${item.mobile ? '.touch' : ''}`;
      const entry = { ...item, tag, steps: [], notes: {}, checks: [], errors: [], offsite: [] };
      report.runs.push(entry);
      const context = await browser.newContext({
        baseURL: url, viewport: { width: item.width, height: item.height }, isMobile: item.mobile, hasTouch: item.mobile,
        deviceScaleFactor: item.mobile ? 2 : 1, colorScheme: item.scheme, reducedMotion: opts['reduced-motion'] ? 'reduce' : 'no-preference',
        serviceWorkers: 'block',
      });
      // A missing element fails the flow in 15 s instead of hanging the command.
      context.setDefaultTimeout(15000);
      const page = await context.newPage();
      if (opts.seed !== 'off') await page.addInitScript(seedScript(Number(opts.seed || 20261009)));
      const fake = new FakeSupabase();
      await fake.attach(page);
      const origin = new URL(url).origin;
      page.on('pageerror', (error) => entry.errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !/supabase\.co/.test(message.location().url)) entry.errors.push(`console: ${message.text()}`);
      });
      page.on('request', (request) => { if (!request.url().startsWith(origin) && !/supabase\.co/.test(request.url())) entry.offsite.push(request.url()); });
      // 100 ms a key keeps a 10-word run over the 3 s that consistency needs.
      const h = helpers(page, { delay: Number(opts.delay ?? 100) });
      const shot = async (name) => {
        const file = `${tag}.${name}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: Boolean(opts['full-page']) });
        const aria = `${tag}.${name}.aria.yml`;
        fs.writeFileSync(path.join(outDir, aria), await page.locator('body').ariaSnapshot());
        // The ARIA snapshot shows <details> as a bare group, so the account state is recorded here.
        const state = await page.evaluate(() => ({
          view: document.body.dataset.view, theme: document.documentElement.dataset.theme,
          running: document.body.hasAttribute('data-running'), account: document.querySelector('#account')?.dataset.state,
        }));
        entry.steps.push({ name, screenshot: file, aria, ...state, at: new Date().toISOString() });
        console.log(`  ${tag}  ${name}  ${path.join(outDir, file)}`);
      };
      const note = (key, value) => { entry.notes[key] = value; };
      const check = (pass, what) => { entry.checks.push({ pass: Boolean(pass), what }); if (!pass) throw new Error(`check failed: ${what}`); };
      try {
        if (opts['signed-in'] && item.flow !== 'signin') {
          // Through the account dialog, as a person signs in; only the backend is faked.
          await h.openApp();
          fake.addUser('verify@stilltype.test');
          await h.signIn('verify@stilltype.test');
          await shot('signed-in');
        }
        await (item.impl || FLOW_IMPL[item.flow])({ page, h, shot, note, check, fake, url });
        entry.supabase = { requests: fake.requests.length, errors: fake.errors };
        if (entry.errors.length || fake.errors.length) throw new Error(`browser or fake-Supabase errors: ${[...entry.errors, ...fake.errors].join(' | ')}`);
        entry.status = 'passed';
      } catch (error) {
        entry.status = 'failed';
        entry.failure = error.message.split('\n')[0];
        failed = true;
        await page.screenshot({ path: path.join(outDir, `${tag}.failure.png`) }).catch(() => {});
        console.log(`  ${tag}  FAILED: ${entry.failure}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    report.finished = new Date().toISOString();
    report.status = failed ? 'failed' : 'passed';
    fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(report, null, 2));
    fs.rmSync(path.join(evidenceRoot, 'latest'), { force: true });
    if (!opts.out) fs.symlinkSync(outDir, path.join(evidenceRoot, 'latest'));
  }
  console.log(`${failed ? 'FAILED' : 'passed'}  evidence: ${outDir}  (run.json lists every shot, check and error)`);
  process.exit(failed ? 1 : 0);
}

function list() {
  if (!fs.existsSync(evidenceRoot)) { console.log(`no evidence yet under ${evidenceRoot}`); return; }
  const dirs = fs.readdirSync(evidenceRoot).filter((d) => d !== 'latest').sort().reverse().slice(0, 15);
  for (const dir of dirs) console.log(`${readJson(path.join(evidenceRoot, dir, 'run.json'))?.status ?? '?'}\t${path.join(evidenceRoot, dir)}`);
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
switch (command) {
  case 'serve': await serve(opts); break;
  case 'stop': stop(); break;
  case 'doctor': await doctor(opts); break;
  case 'list': list(); break;
  case 'shot': await run(plan(opts._, opts), opts, opts._.join('+')); break;
  case 'drive': {
    const file = opts._[0] || fail('drive needs a flow file');
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    const [item] = plan(['idle'], opts);
    await run([{ ...item, flow: path.basename(file, path.extname(file)), impl: mod.default }], opts, path.basename(file, path.extname(file)));
    break;
  }
  default: console.log(USAGE); process.exit(command ? 2 : 0);
}
