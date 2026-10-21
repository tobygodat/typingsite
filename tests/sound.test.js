import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SOUND_MODE,
  DEFAULT_SOUND_VOLUME,
  KEY_OUTCOME,
  SOUND_MODES,
  createSounds,
  gainFor,
  keyOutcome,
  normalizeSoundMode,
  normalizeSoundVolume,
  soundFor,
} from '../src/sound.js';

// A Web Audio stand-in that records what was built and started. As in a browser, suspend() and resume()
// change state only once the audio thread has acted, on a later task (settle). With autostart, a new
// context reports 'suspended' and starts running by itself on the next task, as Firefox and WebKit do.
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fakeAudio({ state = 'running', failOn = null, autostart = false } = {}) {
  const log = { created: 0, closed: 0, resumed: 0, suspended: 0, started: [], gains: [], ramps: [], options: [], contexts: [] };
  const param = () => ({ value: 0, setValueAtTime(v) { log.gains.push(v); }, exponentialRampToValueAtTime(v) { log.ramps.push(v); } });
  const node = (extra = {}) => ({ connect(target) { return target; }, ...extra });
  class FakeContext {
    constructor(options) {
      if (failOn === 'construct') throw new Error('no audio device');
      log.created += 1;
      log.options.push(options);
      log.contexts.push(this);
      this.state = autostart ? 'suspended' : state;
      if (autostart) this.later('running');
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = node();
    }
    resume() { log.resumed += 1; return this.later('running'); }
    suspend() { log.suspended += 1; return this.later('suspended'); }
    later(state) { return settle().then(() => { if (this.state !== 'closed') this.state = state; }); }
    close() { log.closed += 1; this.state = 'closed'; return Promise.resolve(); }
    createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    createBufferSource() {
      if (failOn === 'play') throw new Error('node limit');
      return node({ buffer: null, start() { log.started.push('click'); }, stop() {} });
    }
    createOscillator() { return node({ type: 'sine', frequency: param(), start() { log.started.push('tick'); }, stop() {} }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: { value: 0 }, Q: { value: 0 } }); }
    createGain() { return node({ gain: param() }); }
  }
  return { log, FakeContext };
}

test('modes and volume normalise, and old profiles without them read as off at the default volume', () => {
  assert.deepEqual(SOUND_MODES, ['off', 'clicks', 'clicks-errors']);
  assert.equal(DEFAULT_SOUND_MODE, 'off');
  assert.equal(normalizeSoundMode(undefined), 'off');
  assert.equal(normalizeSoundMode('loud'), 'off');
  assert.equal(normalizeSoundMode('clicks-errors'), 'clicks-errors');
  assert.equal(normalizeSoundVolume(undefined), DEFAULT_SOUND_VOLUME);
  assert.equal(normalizeSoundVolume(null), DEFAULT_SOUND_VOLUME);
  assert.equal(normalizeSoundVolume('80'), DEFAULT_SOUND_VOLUME);
  assert.equal(normalizeSoundVolume(Number.NaN), DEFAULT_SOUND_VOLUME);
  assert.equal(normalizeSoundVolume(0), 0);
  assert.equal(normalizeSoundVolume(-5), 0);
  assert.equal(normalizeSoundVolume(140), 100);
  assert.equal(normalizeSoundVolume(42.6), 43);
});

test('off and volume 0 are silent; the tick is only for a mistyped letter with the error tick on', () => {
  for (const outcome of ['correct', 'wrong', 'delete', 'blocked']) {
    assert.equal(soundFor('off', 100, outcome), null);
    assert.equal(soundFor('clicks', 0, outcome), null);
    assert.equal(soundFor('clicks-errors', 0, outcome), null);
  }
  assert.equal(soundFor('clicks', 50, 'correct'), 'click');
  assert.equal(soundFor('clicks', 50, 'wrong'), 'click');
  assert.equal(soundFor('clicks', 50, 'delete'), 'click');
  assert.equal(soundFor('clicks-errors', 50, 'correct'), 'click');
  assert.equal(soundFor('clicks-errors', 50, 'wrong'), 'tick');
  assert.equal(soundFor('clicks-errors', 50, 'delete'), 'click');
  // A key refused under stop on error clicks; the tick already marked the letter to fix.
  assert.equal(soundFor('clicks-errors', 50, 'blocked'), 'click');
  // Unknown modes, volumes or outcomes never make a sound.
  assert.equal(soundFor('loud', 50, 'correct'), null);
  assert.equal(soundFor('clicks', Number.NaN, 'correct'), null);
  assert.equal(soundFor('clicks', '50', 'correct'), null);
  assert.equal(soundFor('clicks', 50, 'focus-lost'), null);
});

test('a key ticks if scoring found any mistake in it, and is blocked only if it typed nothing', () => {
  assert.equal(keyOutcome([{ blocked: false, correct: true }]), KEY_OUTCOME.correct);
  assert.equal(keyOutcome([{ blocked: false, correct: false }]), KEY_OUTCOME.wrong);
  // A refused strict space is scored as a wrong key.
  assert.equal(keyOutcome([{ blocked: 'space', correct: false }]), KEY_OUTCOME.wrong);
  assert.equal(keyOutcome([{ blocked: 'unresolved' }]), KEY_OUTCOME.blocked);
  // The space that submits a passage with a wrong last word finishes it: an accepted key.
  assert.equal(keyOutcome([{ blocked: false, submit: true }]), KEY_OUTCOME.correct);
  // "h onto "ah": continue on error scores the mark wrong and the h right; stop on error refuses the h.
  assert.equal(keyOutcome([{ blocked: false, correct: false }, { blocked: false, correct: true }]), KEY_OUTCOME.wrong);
  assert.equal(keyOutcome([{ blocked: false, correct: false }, { blocked: 'unresolved' }]), KEY_OUTCOME.wrong);
  assert.equal(keyOutcome([{ blocked: false, correct: true }, { blocked: false, correct: false }]), KEY_OUTCOME.wrong);
  assert.equal(keyOutcome([{ blocked: false, correct: true }, { blocked: false, correct: true }]), KEY_OUTCOME.correct);
});

test('gain rises with volume, is zero at 0 and full at 100', () => {
  assert.equal(gainFor(0), 0);
  assert.equal(gainFor(100), 1);
  assert.equal(gainFor(50), 0.25);
  const levels = [5, 25, 50, 75, 100].map(gainFor);
  assert.deepEqual([...levels].sort((a, b) => a - b), levels);
});

// Stands in for "after the key has painted": queued callbacks run only when the test flushes them.
function deferQueue() {
  const queue = [];
  return { defer: (callback) => queue.push(callback), flush: () => queue.splice(0).forEach((callback) => callback()), get size() { return queue.length; } };
}

test('the first audible key never builds the context itself; it is built after that key, once', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'off', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  assert.equal(sounds.play('correct'), null);
  assert.equal(later.size, 0, 'off asks for no context');
  settings.mode = 'clicks';
  settings.volume = 0;
  assert.equal(sounds.play('correct'), null);
  assert.equal(later.size, 0, 'volume 0 asks for no context');
  settings.volume = 50;
  // The first audible key and any key before the build stay silent and construct nothing.
  assert.equal(sounds.play('correct'), null);
  assert.equal(sounds.play('wrong'), null);
  assert.equal(log.created, 0, 'nothing is constructed inside input handling');
  assert.equal(later.size, 1, 'one build is queued, however many keys arrive first');
  later.flush();
  assert.equal(log.created, 1);
  assert.deepEqual(log.options, [{ latencyHint: 'interactive' }]);
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(sounds.play('wrong'), 'click');
  settings.mode = 'clicks-errors';
  assert.equal(sounds.play('wrong'), 'tick');
  assert.equal(sounds.play('delete'), 'click');
  assert.equal(sounds.play('blocked'), 'click');
  assert.equal(later.size, 0);
  assert.equal(log.created, 1);
  assert.deepEqual(log.started, ['click', 'click', 'tick', 'click', 'click']);
});

test('turning sound off before the build cancels it', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'clicks', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  settings.mode = 'off';
  sounds.sync();
  later.flush();
  assert.equal(log.created, 0);
  // Volume dropping to 0 before the build also leaves nothing behind.
  settings.mode = 'clicks';
  sounds.play('correct');
  settings.volume = 0;
  later.flush();
  assert.equal(log.created, 0);
});

test('at half volume a click starts at 0.225 and the error tick peaks at 0.1125', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const sounds = createSounds({ settings: () => ({ mode: 'clicks-errors', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  later.flush();
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.gains.at(-1), 0.225);
  log.ramps.length = 0;
  assert.equal(sounds.play('wrong'), 'tick');
  assert.equal(Math.max(...log.ramps.filter((value) => value < 1)), 0.1125);
});

test('louder settings start louder; volume 0 after a sound adds nothing', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'clicks', volume: 100 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  later.flush();
  sounds.play('correct');
  const loud = log.gains.at(-1);
  settings.volume = 25;
  sounds.play('correct');
  const quiet = log.gains.at(-1);
  assert.ok(quiet > 0 && quiet < loud, `${quiet} < ${loud}`);
  settings.volume = 0;
  const before = log.started.length;
  assert.equal(sounds.play('correct'), null);
  assert.equal(log.started.length, before);
});

test('sound off or at volume 0 closes the context, and the next audible key asks for a new one', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'clicks', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  settings.mode = 'off';
  sounds.sync();
  assert.equal(log.closed, 0, 'nothing to close before the first key');
  settings.mode = 'clicks';
  sounds.play('correct');
  later.flush();
  sounds.sync();
  assert.equal(sounds.hasContext(), true, 'an audible setting keeps the context');
  settings.mode = 'off';
  sounds.sync();
  assert.equal(log.closed, 1);
  assert.equal(sounds.hasContext(), false);
  settings.mode = 'clicks';
  assert.equal(sounds.play('correct'), null);
  later.flush();
  assert.equal(log.created, 2);
  assert.equal(sounds.play('correct'), 'click');

  // A key that finds sound off (another tab or device changed it) closes the context too.
  settings.volume = 0;
  assert.equal(sounds.play('correct'), null);
  assert.equal(log.closed, 2);
  assert.equal(sounds.hasContext(), false);
});

test('the context suspends when the page is hidden and after a run, and the next key resumes it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const page = Object.assign(new EventTarget(), { hidden: false });
  let running = false;
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), running: () => running, AudioContextClass: FakeContext, defer: later.defer, page });
  sounds.rest();
  page.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(1000);
  assert.equal(log.suspended, 0, 'no context, nothing to suspend');
  sounds.play('correct');
  later.flush();
  const [context] = log.contexts;

  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(context.state, 'suspended');
  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(context.state, 'suspended', 'showing the page again waits for a key');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(context.state, 'running');

  // A finished run waits for its last key's voice to play out before suspending.
  sounds.rest();
  t.mock.timers.tick(100);
  await settle();
  assert.equal(context.state, 'running');
  t.mock.timers.tick(200);
  await settle();
  assert.equal(context.state, 'suspended');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(context.state, 'running');

  // A key soon after the run ends starts the next run, which keeps the context running.
  sounds.rest();
  sounds.play('correct');
  running = true;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(context.state, 'running');
});

// The context's own state changes only once the audio thread has acted, so a key or a hidden page in
// that window must still be heard as a request for the other state.
test('a key while a suspend is in flight is heard, and hiding while a resume is in flight suspends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const page = Object.assign(new EventTarget(), { hidden: false });
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer, page });
  sounds.play('correct');
  later.flush();
  const [context] = log.contexts;
  sounds.rest();
  t.mock.timers.tick(300);
  assert.equal(context.state, 'running', 'the suspend has not landed yet');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(context.state, 'running', 'the key woke the context, so its click plays now');

  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  page.hidden = false;
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(context.state, 'suspended', 'the resume has not landed yet');
  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(context.state, 'suspended', 'a hidden page stays silent');
});

test('a run that ends before the deferred build leaves the new context suspended until a key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settings = () => ({ mode: 'clicks-errors', volume: 50 });

  // The rest lands first, then the build.
  let audio = fakeAudio();
  let later = deferQueue();
  let sounds = createSounds({ settings, AudioContextClass: audio.FakeContext, defer: later.defer });
  sounds.play('wrong');
  sounds.rest();
  t.mock.timers.tick(300);
  later.flush();
  await settle();
  assert.equal(audio.log.created, 1);
  assert.equal(audio.log.contexts[0].state, 'suspended');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(audio.log.contexts[0].state, 'running');

  // The build lands inside the rest's wait.
  audio = fakeAudio();
  later = deferQueue();
  sounds = createSounds({ settings, AudioContextClass: audio.FakeContext, defer: later.defer });
  sounds.play('wrong');
  sounds.rest();
  later.flush();
  t.mock.timers.tick(300);
  await settle();
  assert.equal(audio.log.contexts[0].state, 'suspended');
});

test('a suspended context is resumed without waiting, and a closed one is replaced', async () => {
  const { log, FakeContext } = fakeAudio({ state: 'suspended' });
  const later = deferQueue();
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  later.flush();
  assert.equal(log.resumed, 1, 'resumed as soon as it is built');
  await settle();
  // The browser suspending it on its own, as an interruption does.
  log.contexts[0].state = 'suspended';
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.resumed, 2);
  await settle();
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.resumed, 2, 'a running context is left alone');
  assert.deepEqual(log.started, ['click', 'click']);

  // The browser closing the context behind the app's back.
  log.contexts[0].state = 'closed';
  assert.equal(sounds.play('correct'), null);
  later.flush();
  assert.equal(log.created, 2);
  assert.equal(sounds.play('correct'), 'click');
});

test('choosing an audible sound builds the context after the change, so the first key is heard', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'off', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  sounds.prepare();
  settings.mode = 'clicks';
  settings.volume = 0;
  sounds.prepare();
  assert.equal(later.size, 0, 'off or volume 0 asks for no context');
  settings.volume = 30;
  sounds.prepare();
  assert.equal(log.created, 0, 'never built inside the change itself');
  later.flush();
  assert.equal(log.created, 1);
  assert.equal(sounds.play('correct'), 'click');
  sounds.prepare();
  assert.equal(later.size, 0);
  assert.equal(log.created, 1, 'one context');
});

test('a context readied before any run rests suspended until the first key', async () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer });
  sounds.prepare();
  later.flush();
  await settle();
  assert.equal(log.contexts[0].state, 'suspended', 'nothing is typing, so the context does not run');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(log.contexts[0].state, 'running');
});

test('a context that starts itself after construction is still suspended until the first key', async () => {
  const { log, FakeContext } = fakeAudio({ autostart: true });
  const later = deferQueue();
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer });
  sounds.prepare();
  later.flush();
  await settle();
  await settle();
  assert.equal(log.contexts[0].state, 'suspended', 'nothing is typing, so the context does not run');
  assert.equal(sounds.play('correct'), 'click');
  await settle();
  assert.equal(log.contexts[0].state, 'running');
});

test('a key outside a run rests the context again, and a key mid-run never does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  let running = false;
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), running: () => running, AudioContextClass: FakeContext, defer: later.defer });
  sounds.prepare();
  later.flush();
  await settle();
  assert.equal(sounds.play('delete'), 'click', 'a backspace before the first letter');
  await settle();
  assert.equal(log.contexts[0].state, 'running');
  t.mock.timers.tick(300);
  await settle();
  assert.equal(log.contexts[0].state, 'suspended', 'no run began, so the context rests');

  // The first letter's sound plays before the run is marked as started, as in a race.
  sounds.play('correct');
  running = true;
  await settle();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(log.contexts[0].state, 'running', 'a pause mid-run keeps the context awake');
});

test('changing the volume mid-run keeps an awake context running', async () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'clicks', volume: 50 };
  const sounds = createSounds({ settings: () => settings, running: () => true, AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  later.flush();
  await settle();
  assert.equal(sounds.play('correct'), 'click');
  settings.volume = 40;
  sounds.prepare();
  settings.volume = 30;
  sounds.prepare();
  await settle();
  assert.equal(log.contexts[0].state, 'running');
  assert.equal(log.suspended, 0);
});

test('missing or failing audio never throws into input handling', () => {
  let mode = 'clicks-errors';
  const settings = () => ({ mode, volume: 50 });
  const later = deferQueue();
  assert.equal(createSounds({ settings, AudioContextClass: undefined, defer: later.defer }).play('correct'), null);
  assert.equal(later.size, 0, 'no Web Audio: nothing is queued');

  const refused = fakeAudio({ failOn: 'construct' });
  const silent = createSounds({ settings, AudioContextClass: refused.FakeContext, defer: later.defer });
  assert.equal(silent.play('correct'), null);
  assert.doesNotThrow(() => later.flush());
  assert.equal(silent.play('correct'), null);
  assert.equal(later.size, 0, 'a refused context is not retried on every key');
  mode = 'off';
  silent.sync();
  mode = 'clicks-errors';
  silent.play('correct');
  assert.equal(later.size, 1, 'turning sound off and on tries again');
  later.flush();

  const failing = createSounds({ settings, AudioContextClass: fakeAudio({ failOn: 'play' }).FakeContext, defer: later.defer });
  failing.play('correct');
  later.flush();
  assert.doesNotThrow(() => failing.play('correct'));
  assert.equal(failing.play('correct'), null);
  assert.doesNotThrow(() => createSounds({ settings: () => { throw new Error('bad'); }, defer: later.defer }).play('correct'));
});
