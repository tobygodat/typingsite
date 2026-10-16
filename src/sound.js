// Typing sounds: a quiet click for each key and, if chosen, a low tick for a mistyped letter.
// Synthesised with Web Audio, so there are no audio files. Presentational only: the app tells this
// module what a key did after scoring has handled it, and nothing here is ever read back.

export const SOUND_MODES = ['off', 'clicks', 'clicks-errors'];
export const SOUND_LABELS = { off: 'off', clicks: 'clicks', 'clicks-errors': 'clicks + error tick' };
export const DEFAULT_SOUND_MODE = 'off';
export const DEFAULT_SOUND_VOLUME = 50;
// What scoring made of one key: an accepted letter, a mistyped letter, a backspace, or a key refused
// because stop on error is waiting for a correction.
export const KEY_OUTCOME = Object.freeze({ correct: 'correct', wrong: 'wrong', delete: 'delete', blocked: 'blocked' });
const KEY_OUTCOMES = Object.values(KEY_OUTCOME);
// Peak gain at full volume. Both voices are short and sit well below full scale.
const CLICK_PEAK = 0.9;
const TICK_PEAK = 0.3;
// A finished run's context is suspended once the last key's voice (0.1 s at most) has played out.
const REST_AFTER_MS = 250;

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
  return outcome === KEY_OUTCOME.wrong && mode === 'clicks-errors' ? 'tick' : 'click';
}

// One key's outcome from scoring's verdict on each character it typed: an accent commit types two
// ("h). Each change is { correct, blocked }: correct is false for a key scored as a mistake (a wrong
// letter, a refused strict space), and blocked is set for a key that typed nothing. A mistake anywhere
// in the key outranks the rest; a key whose every character was refused is blocked.
export function keyOutcome(changes) {
  if (changes.some((change) => change.correct === false)) return KEY_OUTCOME.wrong;
  return changes.every((change) => change.blocked) ? KEY_OUTCOME.blocked : KEY_OUTCOME.correct;
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

// After the key's letter has painted: building an AudioContext can hold the main thread for tens of
// milliseconds, so it never happens inside input handling.
function afterPaint(callback) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(callback, 0));
  else setTimeout(callback, 0);
}

// settings() returns { mode, volume } at the moment of each key. The context is built after the change
// that makes sound audible (prepare) or, failing that, after the first audible key, which stays silent
// itself; it is never built inside an event. It is suspended while the page is hidden and after a run
// (rest), resumed by the next key, and closed once a key or a settings change (sync) finds sound off
// or at volume 0.
export function createSounds({ settings, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, defer = afterPaint, page = globalThis.document } = {}) {
  let context = null;
  let noise = null;
  let pending = false;
  let failed = false;
  let generation = 0;
  let resting = null;
  // Whether the context should be suspended. Kept here because context.state changes only once the
  // audio thread has acted, and a context still to be built must start suspended too.
  let asleep = false;

  const audible = () => {
    const { mode, volume } = settings();
    return soundFor(mode, volume, 'correct') !== null;
  };

  const request = (method) => {
    try { Promise.resolve(context?.[method]?.()).catch(() => {}); } catch {}
  };

  function build() {
    try {
      if (context || failed || !audible()) return;
      context = new AudioContextClass({ latencyHint: 'interactive' });
      noise = noiseBuffer(context);
      if (asleep) request('suspend');
      else if (context.state !== 'running') request('resume');
    } catch {
      // No audio device, or the browser refused: stay silent until sound is turned off and on again.
      const broken = context;
      context = null;
      noise = null;
      failed = true;
      try { Promise.resolve(broken?.close?.()).catch(() => {}); } catch {}
    }
  }

  function queueBuild() {
    if (pending || failed || typeof AudioContextClass !== 'function') return;
    pending = true;
    const ticket = generation;
    defer(() => {
      if (ticket !== generation) return;
      pending = false;
      build();
    });
  }

  // The context to play through, or null while one is still to be built.
  function ready() {
    if (context?.state === 'closed') { context = null; noise = null; }
    clearTimeout(resting);
    const waking = asleep;
    asleep = false;
    if (!context) {
      queueBuild();
      return null;
    }
    // Resumed without waiting, including a context whose suspend hasn't landed yet.
    if (waking || context.state !== 'running') request('resume');
    return context;
  }

  // Never throws: a sound that can't play must not disturb input handling.
  function play(outcome) {
    try {
      const { mode, volume } = settings();
      const kind = soundFor(mode, volume, outcome);
      if (!kind) {
        sync();
        return null;
      }
      const audio = ready();
      if (!audio) return null;
      if (kind === 'tick') playTick(audio, gainFor(volume));
      else playClick(audio, gainFor(volume), noise);
      return kind;
    } catch {
      return null;
    }
  }

  // The person chose an audible setting: a user gesture, so the context can be built after it and the
  // first typed key already has one to play through.
  function prepare() {
    try {
      if (!context && audible()) queueBuild();
    } catch {}
  }

  function release() {
    const closing = context;
    generation += 1;
    pending = false;
    failed = false;
    context = null;
    noise = null;
    if (!closing) return;
    try { Promise.resolve(closing.close?.()).catch(() => {}); } catch {}
  }

  // Off or volume 0 closes the context, and drops any build still waiting.
  function sync() {
    try {
      if (!audible() && (context || pending || failed)) release();
    } catch {}
  }

  function suspend() {
    clearTimeout(resting);
    asleep = true;
    if (context && context.state !== 'closed') request('suspend');
  }

  // A run ended: suspend once its last key's voice has played out. A context still to be built starts
  // suspended.
  function rest() {
    clearTimeout(resting);
    resting = setTimeout(suspend, REST_AFTER_MS);
  }

  page?.addEventListener?.('visibilitychange', () => { if (page.hidden) suspend(); });

  return { play, prepare, sync, rest, hasContext: () => Boolean(context) };
}
