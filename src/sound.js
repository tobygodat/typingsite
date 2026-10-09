// Typing sounds: a quiet click for each key and, if chosen, a low tick for a mistyped letter.
// Synthesised with Web Audio, so there are no audio files. Presentational only: the app tells this
// module what a key did after scoring has handled it, and nothing here is ever read back.

export const SOUND_MODES = ['off', 'clicks', 'clicks-errors'];
export const SOUND_LABELS = { off: 'off', clicks: 'clicks', 'clicks-errors': 'clicks + error tick' };
export const DEFAULT_SOUND_MODE = 'off';
export const DEFAULT_SOUND_VOLUME = 50;
// The engine's reading of one key: an accepted letter, a mistyped letter, a backspace, or a letter
// refused because stop on error is waiting for a correction.
const KEY_OUTCOMES = ['correct', 'wrong', 'delete', 'blocked'];
// Peak gain at full volume. Both voices are short and sit well below full scale.
const CLICK_PEAK = 0.9;
const TICK_PEAK = 0.3;

export function normalizeSoundMode(value) {
  return SOUND_MODES.includes(value) ? value : DEFAULT_SOUND_MODE;
}

// Volume is a whole percentage, 0–100. Anything else (missing, text, NaN) falls back to the default.
export function normalizeSoundVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SOUND_VOLUME;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Which sound a key makes, or null for silence. Off and volume 0 are silent. The tick is only for a
// mistyped letter, and only when the error tick is chosen; every other key is a click. A key refused
// under stop on error is a click: the tick already marked the letter that needs fixing.
export function soundFor(mode, volume, outcome) {
  if (!SOUND_MODES.includes(mode) || mode === 'off') return null;
  if (typeof volume !== 'number' || !(volume > 0)) return null;
  if (!KEY_OUTCOMES.includes(outcome)) return null;
  return outcome === 'wrong' && mode === 'clicks-errors' ? 'tick' : 'click';
}

// Loudness follows the square of the slider so the low end stays usable.
export function gainFor(volume) {
  const level = normalizeSoundVolume(volume) / 100;
  return level * level;
}

function noiseBuffer(context) {
  const length = Math.max(1, Math.round(context.sampleRate * 0.04));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A short band-passed noise burst, like a key bottoming out. The band moves a little each time so a
// run of keys doesn't sound machine-made.
export function playClick(context, gain, noise) {
  const at = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noise;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200 + Math.random() * 600;
  band.Q.value = 0.8;
  const amp = context.createGain();
  amp.gain.setValueAtTime(CLICK_PEAK * gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
  source.connect(band);
  band.connect(amp);
  amp.connect(context.destination);
  source.start(at);
  source.stop(at + 0.035);
}

// A soft, falling low tone: different enough from the click to hear without looking.
export function playTick(context, gain) {
  const at = context.currentTime;
  const tone = context.createOscillator();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(330, at);
  tone.frequency.exponentialRampToValueAtTime(220, at + 0.07);
  const amp = context.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(TICK_PEAK * gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  tone.connect(amp);
  amp.connect(context.destination);
  tone.start(at);
  tone.stop(at + 0.1);
}

// settings() returns { mode, volume } at the moment of each key. The AudioContext is created on the
// first key that should make a sound, never before, and closed again by release().
export function createSounds({ settings, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  let context = null;
  let noise = null;

  function ensureContext() {
    // A context the browser closed is replaced; a suspended or interrupted one is resumed without waiting.
    if (context?.state === 'closed') context = null;
    if (!context) {
      if (typeof AudioContextClass !== 'function') return null;
      context = new AudioContextClass({ latencyHint: 'interactive' });
      noise = null;
    }
    if (context.state !== 'running') Promise.resolve(context.resume?.()).catch(() => {});
    return context;
  }

  // Never throws: a sound that can't play must not disturb input handling.
  function play(outcome) {
    try {
      const { mode, volume } = settings();
      const kind = soundFor(mode, volume, outcome);
      if (!kind) return null;
      const audio = ensureContext();
      if (!audio) return null;
      if (kind === 'tick') playTick(audio, gainFor(volume));
      else {
        noise ||= noiseBuffer(audio);
        playClick(audio, gainFor(volume), noise);
      }
      return kind;
    } catch {
      return null;
    }
  }

  function release() {
    const closing = context;
    context = null;
    noise = null;
    if (!closing) return;
    try { Promise.resolve(closing.close?.()).catch(() => {}); } catch {}
  }

  return { play, release, hasContext: () => Boolean(context) };
}
