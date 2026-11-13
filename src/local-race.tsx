import { createApplicationLifetime } from './application-lifetime.js';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { createTypingFx } from './motion.js';
import { renderText } from './passage-view.js';
import { completeAttempt, createAttempt, replayAttempt, selectPassage } from './typing.js';
import type { Attempt, Conditions, Replay } from './typing.js';
import type { SealedRun } from './practice-session.js';
import { uid } from './profile.js';
import { markEndFailure } from './practice-run.js';
import { bindingLabel } from './keybindings.js';
import { Copy } from './results-card.js';

interface LocalResult { name: string; attempt: SealedRun }

interface LocalState {
  passage: NonNullable<ReturnType<typeof selectPassage>> | null;
  conditions: Conditions | null; names: [string, string]; player: 0 | 1;
  attempt: Attempt | null; startTime: number | null; results: LocalResult[];
  characters: HTMLElement[]; textView: ReturnType<typeof renderText> | null; notice: string;
}

interface LocalView {
  setup: boolean; stage: boolean; handoff: boolean; leaderboard: boolean; revealing: boolean;
  names: [string, string]; player: string; progress: number; passage: string; handoffName: string;
  winner: string; results: LocalResult[]; help: string; hint: boolean;
}

interface LocalHost { input: HTMLTextAreaElement; display: HTMLElement; wrap: HTMLElement; focusName(): void }

interface LocalPorts {
  conditions(): Conditions; seen(id: string): void; rules(): void; changed(): void; offset(): number;
  clearInput(): void; wire(input: HTMLTextAreaElement): () => void; interrupt(): void;
  restartBinding(): string | null; reducedMotion(): boolean; announce(message: string): void;
}

export function createLocalRace() {
  const state: LocalState = { passage: null, conditions: null, names: ['', ''], player: 0, attempt: null, startTime: null, results: [], characters: [], textView: null, notice: '' };
  const view = createStore<LocalView>({ setup: true, stage: false, handoff: false, leaderboard: false, revealing: false, names: ['', ''], player: 'Player one', progress: 0, passage: '', handoffName: 'player 2', winner: 'Two observed runs', results: [], help: 'esc restarts.', hint: true });
  let host: LocalHost | null = null;
  let ports: LocalPorts | null = null;
  let fx: ReturnType<typeof createTypingFx> | null = null;
  let detachInput: (() => void) | null = null;
  const lifetime = createApplicationLifetime();
  const publish = (next: LocalView) => flushSync(() => view.publish(next));

  function restartHint() {
    const binding = ports?.restartBinding();
    publish({ ...view.getSnapshot(), help: binding ? `${bindingLabel(binding)} restarts.` : 'Restart shortcut is disabled.', hint: true });
  }

  function progress(replay: Replay) {
    if (!state.attempt) throw new Error('No local race attempt');
    publish({ ...view.getSnapshot(), progress: Math.round(replay.typed.length / state.attempt.text.length * 100) });
  }

  function prepare() {
    const passage = state.passage;

    if (!passage || !host || !fx || !ports) throw new Error('Local race is not prepared');
    ports.clearInput();
    state.attempt = createAttempt({ id: uid(), text: passage.text, textId: passage.id, kind: 'race', conditions: { ...state.conditions } });
    state.startTime = null;
    state.notice = '';
    ports.changed();
    publish({ ...view.getSnapshot(), stage: true, player: state.names[state.player], passage: passage.text });
    host.input.value = '';
    host.input.disabled = false;
    state.textView = renderText(host.display, passage.text);
    state.characters = state.textView.characters;
    fx.reset(state.characters);
    progress(replayAttempt(state.attempt));
    restartHint();
    host.input.focus({ preventScroll: true });
  }

  function results() {
    const valid = state.results.filter((result) => result.attempt.status === 'complete');
    const ordered = [...valid].sort((a, b) => b.attempt.summary.score.wpm - a.attempt.summary.score.wpm || b.attempt.summary.score.accuracy - a.attempt.summary.score.accuracy);
    const [first, second] = ordered;
    const tied = ordered.length === 2 && first && second && first.attempt.summary.score.wpm === second.attempt.summary.score.wpm && first.attempt.summary.score.accuracy === second.attempt.summary.score.accuracy;
    const winner = ordered.length !== 2 ? 'A fair result needs two uninterrupted runs.' : tied ? 'It’s a tie.' : `${first?.name} leads.`;

    const ranked = [...state.results].sort((a, b) => {
      if (a.attempt.status !== b.attempt.status) return a.attempt.status === 'complete' ? -1 : 1;

      return b.attempt.summary.score.wpm - a.attempt.summary.score.wpm || b.attempt.summary.score.accuracy - a.attempt.summary.score.accuracy;
    });

    publish({ ...view.getSnapshot(), leaderboard: true, winner, results: ranked });
    ports?.announce('Challenge complete.');
  }

  return {
    state, view, prepare, progress, restartHint,
    get fx() { if (!fx) throw new Error('Local typing host is not attached');

 return fx; },
    configure(next: LocalPorts) { ports = next; detachInput?.(); detachInput = host ? next.wire(host.input) : null; },
    attach(next: LocalHost) {
      detachInput?.();
      fx?.dispose();
      host = next;
      fx = createTypingFx(next.wrap, next.display, { ensureCharacters: (index) => state.textView?.ensureForward(index) });
      detachInput = ports?.wire(next.input) ?? null;

      return () => {
        if (host !== next) return;
        detachInput?.(); detachInput = null;
        fx?.dispose(); fx = null;
        host = null;
      };
    },
    name(player: 0 | 1, name: string) {
      const names: [string, string] = [...view.getSnapshot().names];
      names[player] = name;
      publish({ ...view.getSnapshot(), names });
    },
    start() {
      if (!ports) return;
      const names = view.getSnapshot().names;

      const next: LocalState = { passage: selectPassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', seenIds: [] }), conditions: ports.conditions(),
        names: [names[0].trim() || 'Player one', names[1].trim() || 'Player two'], player: 0, attempt: null, startTime: null, results: [], characters: [], textView: null, notice: '' };

      Object.assign(state, next);

      if (state.passage?.id) ports?.seen(state.passage.id);
      publish({ ...view.getSnapshot(), setup: false, leaderboard: false, handoff: false });
      ports?.rules();
      prepare();
    },
    message(help: string) { publish({ ...view.getSnapshot(), help, hint: false }); },
    finish() {
      const attempt = state.attempt;

      if (!attempt || !host || !ports || !state.passage) throw new Error('No local race to finish');
      markEndFailure(attempt);
      ports.clearInput();
      const valid = !attempt.interrupted && !attempt.unsupportedInput;
      const completed: SealedRun = { ...completeAttempt(attempt, { endedAt: ports.offset() }), status: valid ? 'complete' : 'interrupted' };
      completed.interrupted = attempt.interrupted;

      if (attempt.failed) completed.failed = attempt.failed;
      state.attempt = completed;
      ports.changed();
      state.results.push({ name: state.names[state.player], attempt: completed });
      host.input.disabled = true;
      publish({ ...view.getSnapshot(), stage: false });

      if (state.player === 0) {
        state.player = 1;
        publish({ ...view.getSnapshot(), handoffName: state.names[1], passage: state.passage.text, revealing: false, handoff: true });
        ports.announce(`${state.names[0]} finished. Pass the keyboard to ${state.names[1]}.`);
      } else { ports.rules(); results(); }
    },
    reveal() {
      const reveal = () => { publish({ ...view.getSnapshot(), handoff: false, revealing: false }); prepare(); };

      if (ports?.reducedMotion()) { reveal();

 return; }

      publish({ ...view.getSnapshot(), revealing: true });
      lifetime.timeout(reveal, 200);
    },
    again() { publish({ ...view.getSnapshot(), leaderboard: false, setup: true }); host?.focusName(); },
    interrupt() { ports?.interrupt(); },
    dispose() { lifetime.dispose(); detachInput?.(); detachInput = null; fx?.dispose(); fx = null; host = null; },
  };
}

export type LocalRaceController = ReturnType<typeof createLocalRace>;

export function LocalRace({ controller }: { controller: LocalRaceController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  const display = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const firstName = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (input.current && display.current && wrap.current) return controller.attach({ input: input.current, display: display.current, wrap: wrap.current, focusName() { firstName.current?.focus(); } });
  }, [controller]);

  const progressStyle: CSSProperties & { '--progress': string } = { '--progress': String(view.progress / 100) };

  return <div id="local-challenge">
    <form id="compete-setup" className="challenge-setup" hidden={!view.setup} onSubmit={(event) => { event.preventDefault(); controller.start(); }}>
      <div className="player-field"><label htmlFor="player-one-name">Player 1</label><input ref={firstName} id="player-one-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" value={view.names[0]} onChange={(event) => controller.name(0, event.currentTarget.value)} /></div>
      <div className="player-field"><label htmlFor="player-two-name">Player 2</label><input id="player-two-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" value={view.names[1]} onChange={(event) => controller.name(1, event.currentTarget.value)} /></div><button id="start-local-race" className="btn btn-secondary" type="submit">Start</button>
    </form>
    <div id="race-stage" className="race-stage" hidden={!view.stage}>
      <div className="race-stage-heading"><div><h2><span id="race-player">{view.player}</span>’s turn</h2></div></div>
      <div id="race-progress" className="progress-track" role="progressbar" aria-label="Challenge progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress}><span style={progressStyle}></span></div>
      <div ref={wrap} className="race-typing-wrap"><div ref={display} id="race-text-display" aria-hidden="true"></div><textarea ref={input} id="race-input" aria-label="Challenge typing input" aria-describedby="race-help race-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" onBlur={() => controller.interrupt()}></textarea><span id="race-accessible-passage" className="sr-only">{view.passage}</span></div>
      <p id="race-help">{view.hint ? <span className="key-hint">{view.help}</span> : view.help}</p>
    </div>
    <div id="race-handoff" className={`handoff-panel${view.revealing ? ' is-revealing' : ''}`} hidden={!view.handoff}><div id="handoff-veil" className="handoff-veil" aria-hidden="true">{view.passage}</div><div className="handoff-copy"><h2>Pass the keyboard to <span id="handoff-name">{view.handoffName}</span>.</h2><button id="start-next-player" className="btn btn-primary" type="button" onClick={() => controller.reveal()}>Reveal passage</button></div></div>
    <div id="race-leaderboard" className="race-leaderboard" hidden={!view.leaderboard} aria-live="polite"><div className="race-result-heading"><h2 id="race-winner">{view.winner}</h2><button id="race-again" className="btn btn-secondary" type="button" onClick={() => controller.again()}>Play again</button></div><div id="race-results" className="race-results">{view.results.map(({ name, attempt }, index) => <article key={index} className="race-result-row"><strong>{name}</strong><span className="num">{attempt.status === 'complete' ? <Copy parts={[{ kind: 'speed', wpm: attempt.summary.score.wpm }]} /> : attempt.failed ? `failed · ${attempt.failed}` : 'interrupted'}</span><span className="num">{attempt.summary.score.accuracy}% accuracy</span><span className="num">{(attempt.summary.elapsedMs / 1000).toFixed(1)} s</span></article>)}</div><p>Not counted in your progress.</p></div>
  </div>;
}
