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
const TICK_PEAK = 0.45;
// A key outside a run, and the end of a run, suspend the context once the last key's voice (0.1 s at
// most) has played out.
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
function playClick(context, gain, noise) {
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
function playTick(context, gain) {
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

// settings() returns { mode, volume } at the moment of each key. Every event only says what the
// context should be (want) and reconcile() moves it there:
//   closed  no context: nothing has asked for sound yet, or sound is off or at volume 0;
//   asleep  built and suspended: sound was chosen, the page is hidden, or no key for a while outside a run;
//   awake   built and running: a key was just typed, or a run is in progress.
// The context is built after the change that chooses an audible sound (prepare) or, failing that,
// after the first audible key, which stays silent itself; it is never built inside an event.
export function createSounds({ settings, running = () => false, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, defer = afterPaint, page = globalThis.document } = {}) {
  let want = 'closed';
  let context = null;
  let noise = null;
  // The state last requested of this context, null until a request is made. context.state changes
  // only once the audio thread has acted, so a request still in flight is judged by what was asked, and
  // by context.state too, since a context can change state by itself: a new one may report 'suspended'
  // and start running a moment later, so its state at construction says nothing about where it is going.
  let asked = null;
  let pending = false;
  let failed = false;
  let resting = null;

  const audible = () => {
    const { mode, volume } = settings();
    return soundFor(mode, volume, 'correct') !== null;
  };

  const request = (method) => {
    asked = method === 'resume' ? 'awake' : 'asleep';
    try { Promise.resolve(context[method]()).catch(() => {}); } catch {}
  };

  function release() {
    clearTimeout(resting);
    const closing = context;
    context = null;
    noise = null;
    asked = null;
    failed = false;
    if (!closing) return;
    try { Promise.resolve(closing.close?.()).catch(() => {}); } catch {}
  }

  function reconcile() {
    if (context?.state === 'closed') { context = null; noise = null; }
    if (want === 'closed') release();
    else if (!context) queueBuild();
    else if (want === 'awake' && (asked !== 'awake' || context.state !== 'running')) request('resume');
    else if (want === 'asleep' && (asked !== 'asleep' || context.state === 'running')) request('suspend');
  }

  function build() {
    if (context || failed || want === 'closed' || !audible()) return;
    try {
      context = new AudioContextClass({ latencyHint: 'interactive' });
      noise = noiseBuffer(context);
      asked = null;
    } catch {
      // No audio device, or the browser refused: stay silent until sound is turned off and on again.
      const broken = context;
      context = null;
      noise = null;
      failed = true;
      try { Promise.resolve(broken?.close?.()).catch(() => {}); } catch {}
      return;
    }
    reconcile();
  }

  function queueBuild() {
    if (pending || failed || typeof AudioContextClass !== 'function') return;
    pending = true;
    defer(() => {
      pending = false;
      try { build(); } catch {}
    });
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
      want = 'awake';
      reconcile();
      rest();
      if (!context) return null;
      if (kind === 'tick') playTick(context, gainFor(volume));
      else playClick(context, gainFor(volume), noise);
      return kind;
    } catch {
      return null;
    }
  }

  // The person chose an audible setting. The build runs just after the change, while the page still
  // has the gesture's activation, and the context rests until the first key, which resumes it (and
  // also starts a context the browser built suspended, as WebKit does). A context already built keeps
  // its state, so moving the volume mid-run never delays the next click.
  function prepare() {
    try {
      if (!audible()) return;
      if (want === 'closed') want = 'asleep';
      reconcile();
    } catch {}
  }

  // Off or volume 0 closes the context, and a build still waiting finds nothing to do.
  function sync() {
    try {
      if (audible()) return;
      want = 'closed';
      reconcile();
    } catch {}
  }

  function suspend() {
    clearTimeout(resting);
    if (want === 'closed') return;
    want = 'asleep';
    reconcile();
  }

  // A key was typed or a run ended: suspend once the last voice has played out, unless a run is then in
  // progress. A pause mid-run stays awake; the run's end rests it again.
  function rest() {
    clearTimeout(resting);
    resting = setTimeout(() => {
      try { if (!running()) suspend(); } catch {}
    }, REST_AFTER_MS);
  }

  page?.addEventListener?.('visibilitychange', () => { if (page.hidden) suspend(); });

  return { play, prepare, sync, rest, hasContext: () => Boolean(context) };
}
