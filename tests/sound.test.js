import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SOUND_MODE,
  DEFAULT_SOUND_VOLUME,
  SOUND_MODES,
  createSounds,
  gainFor,
  normalizeSoundMode,
  normalizeSoundVolume,
  soundFor,
} from '../src/sound.js';

// A Web Audio stand-in that records what was built and started.
function fakeAudio({ state = 'running', failOn = null } = {}) {
  const log = { created: 0, closed: 0, resumed: 0, started: [], gains: [], options: [], contexts: [] };
  const param = () => ({ value: 0, setValueAtTime(v) { log.gains.push(v); }, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect(target) { return target; }, ...extra });
  class FakeContext {
    constructor(options) {
      if (failOn === 'construct') throw new Error('no audio device');
      log.created += 1;
      log.options.push(options);
      log.contexts.push(this);
      this.state = state;
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = node();
    }
    resume() { log.resumed += 1; this.state = 'running'; return Promise.resolve(); }
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
  sounds.release();
  later.flush();
  assert.equal(log.created, 0);
  // Volume dropping to 0 before the build also leaves nothing behind.
  settings.mode = 'clicks';
  sounds.play('correct');
  settings.volume = 0;
  later.flush();
  assert.equal(log.created, 0);
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

test('release closes the context, and the next audible key asks for a new one', () => {
  const { log, FakeContext } = fakeAudio();
  const later = deferQueue();
  const settings = { mode: 'clicks', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext, defer: later.defer });
  sounds.release();
  assert.equal(log.closed, 0, 'nothing to close before the first key');
  sounds.play('correct');
  later.flush();
  assert.equal(sounds.hasContext(), true);
  sounds.release();
  assert.equal(log.closed, 1);
  assert.equal(sounds.hasContext(), false);
  assert.equal(sounds.play('correct'), null);
  later.flush();
  assert.equal(log.created, 2);
  assert.equal(sounds.play('correct'), 'click');
});

test('a suspended context is resumed without waiting, and a closed one is replaced', () => {
  const { log, FakeContext } = fakeAudio({ state: 'suspended' });
  const later = deferQueue();
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext, defer: later.defer });
  sounds.play('correct');
  later.flush();
  assert.equal(log.resumed, 1, 'resumed as soon as it is built');
  log.contexts[0].state = 'suspended';
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.resumed, 2);
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

test('missing or failing audio never throws into input handling', () => {
  const settings = () => ({ mode: 'clicks-errors', volume: 50 });
  const later = deferQueue();
  assert.equal(createSounds({ settings, AudioContextClass: undefined, defer: later.defer }).play('correct'), null);
  assert.equal(later.size, 0, 'no Web Audio: nothing is queued');

  const refused = fakeAudio({ failOn: 'construct' });
  const silent = createSounds({ settings, AudioContextClass: refused.FakeContext, defer: later.defer });
  assert.equal(silent.play('correct'), null);
  assert.doesNotThrow(() => later.flush());
  assert.equal(silent.play('correct'), null);
  assert.equal(later.size, 0, 'a refused context is not retried on every key');
  silent.release();
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
