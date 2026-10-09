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

test('the audio context waits for the first audible key and is made once', () => {
  const { log, FakeContext } = fakeAudio();
  const settings = { mode: 'off', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext });
  assert.equal(sounds.play('correct'), null);
  assert.equal(log.created, 0, 'off makes no context');
  settings.mode = 'clicks';
  assert.equal(log.created, 0, 'choosing a sound alone makes no context');
  settings.volume = 0;
  assert.equal(sounds.play('correct'), null);
  assert.equal(log.created, 0, 'volume 0 makes no context');
  settings.volume = 50;
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(sounds.play('wrong'), 'click');
  settings.mode = 'clicks-errors';
  assert.equal(sounds.play('wrong'), 'tick');
  assert.equal(sounds.play('delete'), 'click');
  assert.equal(log.created, 1);
  assert.deepEqual(log.options, [{ latencyHint: 'interactive' }]);
  assert.deepEqual(log.started, ['click', 'click', 'tick', 'click']);
});

test('louder settings start louder; volume 0 after a sound adds nothing', () => {
  const { log, FakeContext } = fakeAudio();
  const settings = { mode: 'clicks', volume: 100 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext });
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

test('release closes the context, and the next audible key makes a new one', () => {
  const { log, FakeContext } = fakeAudio();
  const settings = { mode: 'clicks', volume: 50 };
  const sounds = createSounds({ settings: () => settings, AudioContextClass: FakeContext });
  sounds.release();
  assert.equal(log.closed, 0, 'nothing to close before the first key');
  sounds.play('correct');
  assert.equal(sounds.hasContext(), true);
  sounds.release();
  assert.equal(log.closed, 1);
  assert.equal(sounds.hasContext(), false);
  sounds.play('correct');
  assert.equal(log.created, 2);
});

test('a suspended context is resumed without waiting, and a closed one is replaced', () => {
  const { log, FakeContext } = fakeAudio({ state: 'suspended' });
  const sounds = createSounds({ settings: () => ({ mode: 'clicks', volume: 50 }), AudioContextClass: FakeContext });
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.resumed, 1);
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.resumed, 1, 'a running context is left alone');
  assert.deepEqual(log.started, ['click', 'click']);

  // The browser closing the context behind the app's back.
  log.contexts[0].state = 'closed';
  assert.equal(sounds.play('correct'), 'click');
  assert.equal(log.created, 2);
});

test('missing or failing audio never throws into input handling', () => {
  const settings = () => ({ mode: 'clicks-errors', volume: 50 });
  assert.equal(createSounds({ settings, AudioContextClass: undefined }).play('correct'), null);
  assert.equal(createSounds({ settings, AudioContextClass: fakeAudio({ failOn: 'construct' }).FakeContext }).play('correct'), null);
  const failing = createSounds({ settings, AudioContextClass: fakeAudio({ failOn: 'play' }).FakeContext });
  assert.doesNotThrow(() => failing.play('correct'));
  assert.equal(failing.play('correct'), null);
  assert.doesNotThrow(() => createSounds({ settings: () => { throw new Error('bad'); } }).play('correct'));
});
