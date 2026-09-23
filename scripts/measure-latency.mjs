import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const profile = await mkdtemp(path.join(tmpdir(), 'stilltype-latency-'));
const serverPort = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const browser = spawn(process.env.CHROMIUM || 'chromium', [
  ...(process.env.HEADLESS === '1' ? ['--headless=new'] : ['--ozone-platform=x11']),
  '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root, env: { ...process.env, PORT: String(serverPort) }, stdio: 'ignore',
});

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.listeners.get(message.method)?.(message.params, message.sessionId);
      }
    });
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, listener) { this.listeners.set(method, listener); }
  close() { this.socket.close(); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, limitMs = 10000) {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch { /* startup */ }
    await sleep(50);
  }
  throw new Error('Timed out waiting for browser/server');
}

let cdp;
try {
  const port = await waitFor(async () => Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${serverPort}`)).ok);
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new Cdp(info.webSocketDebuggerUrl);
  await cdp.open();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const targetId = targetInfos.find((target) => target.type === 'page')?.targetId;
  if (!targetId) throw new Error('No browser page target');
  await cdp.send('Target.activateTarget', { targetId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
  await waitFor(() => evaluate("document.readyState === 'complete' && document.querySelectorAll('#text-display .char').length > 100"));
  await send('Page.bringToFront');
  const scenario = process.env.SCENARIO === 'race' ? 'race' : 'practice';
  const inputId = scenario === 'race' ? 'race-input' : 'typing-input';
  const displayId = scenario === 'race' ? 'race-text-display' : 'text-display';
  const accessibleId = scenario === 'race' ? 'race-accessible-passage' : 'accessible-passage';
  const wrapSelector = scenario === 'race' ? '.race-typing-wrap' : '#typing-wrap';
  if (scenario === 'race') {
    await evaluate(`(() => {
      document.querySelector('[data-nav="compete"]').click();
      document.querySelector('#player-one-name').value = 'Ada';
      document.querySelector('#player-two-name').value = 'Lin';
      document.querySelector('#compete-setup').requestSubmit();
    })()`);
    await waitFor(() => evaluate("!document.querySelector('#race-stage').hidden && document.querySelectorAll('#race-text-display .char').length > 50"));
  }
  const duration = Number(process.env.DURATION || 30);
  if (scenario === 'practice' && duration !== 30) {
    await evaluate(`document.querySelector('[data-length="${duration}"]').click()`);
    await waitFor(() => evaluate(`document.querySelector('[data-length="${duration}"]').getAttribute('aria-pressed') === 'true'`));
  }
  if (process.env.BENCH_CSS) {
    await evaluate(`(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(process.env.BENCH_CSS)}; document.head.append(style); })()`);
  }
  await evaluate(`(async () => {
    await document.fonts.ready;
    document.querySelector('#${inputId}').focus();
    window.__latency = { records: [], events: [], keydowns: 0, blurs: 0 };
    window.addEventListener('blur', () => { window.__latency.blurs += 1; });
    let current = null;
    document.addEventListener('keydown', (event) => {
      if (event.target.id !== '${inputId}') return;
      window.__latency.keydowns += 1;
      if (event.key.length !== 1) return;
      current = { key: event.key, eventTime: event.timeStamp, keydown: performance.now() };
      window.__latency.records.push(current);
    }, true);
    document.addEventListener('beforeinput', () => {
      if (current) current.beforeInput = performance.now();
    }, true);
    document.addEventListener('beforeinput', () => {
      if (current) current.afterInput = performance.now();
    });
    new MutationObserver(() => {
      if (!current || current.mutation) return;
      const record = current;
      record.mutation = performance.now();
      requestAnimationFrame(() => {
        record.frame = performance.now();
        setTimeout(() => { record.afterFrame = performance.now(); }, 0);
      });
    }).observe(document.querySelector('#${displayId}'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'keydown' || entry.name === 'beforeinput') {
            window.__latency.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd });
          }
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    }
    return true;
  })()`);
  const count = Number(process.env.KEYS || 240);
  const delay = Number(process.env.KEY_DELAY_MS || 50);
  const correctionAt = Number(process.env.CORRECTION_AT || -1);
  const target = await evaluate(`document.querySelector('#${accessibleId}').textContent.slice(0, ${count})`);
  const key = async (char) => {
    const keyCode = char === ' ' ? 32 : char.toUpperCase().charCodeAt(0);
    const code = char === ' ' ? 'Space' : `Key${char.toUpperCase()}`;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, code, text: char, unmodifiedText: char, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };
  let correctionVerified = false;
  for (let index = 0; index < target.length; index += 1) {
    const char = target[index];
    if (index === correctionAt) {
      const wrong = char === 'z' ? 'q' : 'z';
      await key(wrong);
      correctionVerified = await evaluate(`(() => { const node = document.querySelector('#${displayId} .char.wrong'); return !!node && getComputedStyle(node).textDecorationLine.includes('underline'); })()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      if (!correctionVerified) throw new Error('Wrong character lacked visible underline');
    }
    await key(char);
    await sleep(delay);
  }
  await sleep(250);
  const result = await evaluate(`(() => {
    const input = document.querySelector('#${inputId}');
    const current = document.querySelector('#${displayId} .char.current');
    const wrap = document.querySelector('${wrapSelector}').getBoundingClientRect();
    const rect = current?.getBoundingClientRect();
    return { data: window.__latency, typed: input.value, browser: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      visible: document.visibilityState, focused: document.hasFocus(), mountedChars: document.querySelectorAll('#${displayId} .char').length,
      spacerHeight: document.querySelector('#${displayId} .passage-spacer')?.getBoundingClientRect().height || 0,
      wrapHeight: Math.round(wrap.height), currentWithinWrap: rect ? [Math.round(rect.top - wrap.top), Math.round(rect.bottom - wrap.top)] : null,
    };
  })()`);
  if (result.typed !== target) throw new Error(`Typing diverged at ${result.typed.length}/${target.length}`);
  if (result.visible !== 'visible') throw new Error('Benchmark tab was hidden; paint measurements are invalid');
  if (!result.focused || result.data.blurs) throw new Error(`Benchmark lost focus ${result.data.blurs} times; paint measurements are invalid`);
  if (!process.env.ALLOW_UNBOUNDED && result.mountedChars > 1200) throw new Error(`Passage DOM grew beyond bound: ${result.mountedChars} characters`);
  if (!result.currentWithinWrap || result.currentWithinWrap[0] < -20 || result.currentWithinWrap[1] > result.wrapHeight + 20) {
    throw new Error(`Current character left typing viewport: ${result.currentWithinWrap}`);
  }
  if (process.env.SCREENSHOT) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.SCREENSHOT, Buffer.from(data, 'base64'));
  }
  const summary = (field, offset, records = result.data.records.slice(20)) => {
    const values = records.map((r) => r[field] - r[offset]).filter(Number.isFinite).sort((a, b) => a - b);
    const at = (p) => Number(values[Math.ceil(p * values.length) - 1]?.toFixed(2));
    return { samples: values.length, median: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
  };
  console.log(JSON.stringify({
    browser: result.browser, viewport: result.viewport, dpr: result.dpr, visible: result.visible, focused: result.focused,
    scenario, durationSeconds: scenario === 'practice' ? duration : null, keys: target.length, intervalMs: delay, correctionVerified,
    mountedChars: result.mountedChars, spacerHeight: result.spacerHeight, currentWithinWrap: result.currentWithinWrap,
    observed: { records: result.data.records.length, mutations: result.data.records.filter((item) => item.mutation).length, frames: result.data.records.filter((item) => item.frame).length },
    keydownToMutation: summary('mutation', 'keydown'),
    eventToMutation: summary('mutation', 'eventTime'),
    beforeInputProcessing: summary('afterInput', 'beforeInput'),
    keydownToFrame: summary('frame', 'keydown'),
    eventToFrame: summary('frame', 'eventTime'),
    keydownToAfterFrame: summary('afterFrame', 'keydown'),
    eventToAfterFrame: summary('afterFrame', 'eventTime'),
    tailEventToAfterFrame: summary('afterFrame', 'eventTime', result.data.records.slice(-200)),
    slowFrameKeys: result.data.records.flatMap((record, index) => record.frame - record.eventTime > 50 ? [index] : []).slice(0, 30),
    eventTimingToNextPaint: (() => {
      const durations = result.data.events.filter((item) => item.name === 'keydown').map((item) => item.duration).sort((a, b) => a - b);
      const total = result.data.keydowns;
      const upperBound = [...Array(Math.max(0, total - durations.length)).fill(16), ...durations].sort((a, b) => a - b);
      return { keydowns: total, reportedAtOrAbove16Ms: durations.length, p95UpperBoundMs: upperBound[Math.ceil(total * 0.95) - 1] ?? null, maxReportedMs: durations.at(-1) ?? null };
    })(),
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  browser.kill();
  server.kill();
  await sleep(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
