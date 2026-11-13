import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { accountLifetime } from './async-runtime.js';
import { sameSignIn } from './account.js';
import { challengeTextId, challengeOutcome, encodeTrace, finishChallenge, leadVerb, outcomeRule, resultText, sameScore, scoreTrace, traceTrouble } from './ghost-race.js';
import type { ChallengeScore, CompactTrace, ghostPoints, challengeConditions } from './ghost-race.js';
import type { AccountSession } from './account-session.js';
import type { InboxController } from './inbox.js';
import type { PracticeSession } from './practice-session.js';
import type { Conditions } from './typing.js';
import type { SealedRun } from './practice-session.js';
import { createStore } from './store.js';
import { Copy } from './results-card.js';

type GhostState = 'ready' | 'interrupted' | 'other-input' | 'own' | 'sending' | 'unreplayable' | 'unsendable' | 'failed' | 'sent' | 'kept';

interface GhostRun {
  name: string; passage: string; conditions: NonNullable<ReturnType<typeof challengeConditions>>; duration: number | null;
  points: ReturnType<typeof ghostPoints>; sender: ChallengeScore; result: ChallengeScore | null; run: SealedRun | null;
  state: GhostState; trace?: CompactTrace | null; error?: { message: string; status?: number };
}

export type GhostRace = GhostRun & ({ own: true; id: null } | { own?: false; id: string });

interface ResultView {
  visible: boolean; heading: string; rows: { name: string; score: ChallengeScore }[]; rule: string; status: string; action: 'Race again' | 'Send again' | null;
}

interface GhostResultPorts { announce(message: string): void; repeat(): void }

const CONDITION_KEYS = ['mode', 'duration', 'count', 'punctuation', 'numbers', 'quoteLength', 'difficulty', 'wordList',
  'correctionPolicy', 'language', 'corpus', 'metricVersion'] as const;

const RACE_AGAIN: readonly GhostState[] = ['interrupted', 'unsendable', 'unreplayable', 'other-input', 'own'];
const inputOf = (value: { inputClass?: unknown }) => value.inputClass === 'touch' ? 'touch' : 'physical-keyboard';

export function createGhostResult(accounts: AccountSession, practice: PracticeSession, inbox: InboxController) {
  const view = createStore<ResultView>({ visible: false, heading: 'Ghost race', rows: [], rule: '', status: '', action: null });
  let race: GhostRace | null = null;
  let ports: GhostResultPorts | null = null;
  let disposed = false;
  const publish = (patch: Partial<ResultView>) => { if (!disposed) flushSync(() => view.publish({ ...view.getSnapshot(), ...patch })); };
  const say = () => { const current = view.getSnapshot(); ports?.announce(`${current.heading} ${current.status}`); };

  function render() {
    const ghost = race;

    if (!ghost?.run) { publish({ visible: false });

      return; }

    const mine = ghost.result || (ghost.trace ? scoreTrace(ghost.trace, ghost.passage, { relaxed: ghost.run.conditions.correctionPolicy === 'relaxed' }) : null);
    const match = { duration: ghost.duration, sender: ghost.sender, result: mine };
    const leader = mine ? challengeOutcome(match) : null;
    const kept = ghost.own ? 'compared' : 'sent';
    let heading: string;

    if (ghost.state === 'interrupted') heading = ghost.own ? 'Interrupted.' : 'Interrupted, so not sent.';
    else if (ghost.state === 'other-input') heading = `A different kind of input, so not ${kept}.`;
    else if (ghost.state === 'unreplayable') heading = `A character a ghost race can’t replay, so not ${kept}.`;
    else if (!mine) heading = ghost.own ? 'Too long to replay.' : 'Too long to send.';
    else if (leader === 'tie') heading = 'A tie.';
    else {
      if (leader !== 'sender' && leader !== 'recipient') throw new Error('Two ghost scores require a leader or tie');
      heading = `${leader === 'recipient' ? 'You' : ghost.name} ${leadVerb({ ...match, result: mine }, leader)}.`;
    }

    const rows = [...(mine ? [{ name: 'You', score: mine }] : []), { name: ghost.name, score: ghost.sender }];

    if (leader === 'sender') rows.reverse();

    const retry = ghost.state === 'failed' && (!ghost.error?.status || ghost.error.status >= 500);

    const status: Partial<Record<GhostState, string>> = {
      sending: `Sending your run to ${ghost.name}…`, sent: `Sent to ${ghost.name}.`,
      kept: 'Your first finish stands, so this run wasn’t sent.', failed: `Not sent. ${ghost.error?.message || ''}`,
      unsendable: 'Race again with fewer corrections.', unreplayable: 'Race again without emoji.',
      'other-input': `Race again on ${inputOf(ghost.conditions) === 'touch' ? 'touch input' : 'a physical keyboard'} to ${ghost.own ? 'compare' : 'send a run'}.`,
      own: 'The ghost was your own recording.',
    };

    const again = RACE_AGAIN.includes(ghost.state);

    publish({ visible: true, heading, rows, rule: outcomeRule(ghost), status: status[ghost.state] || '', action: again ? 'Race again' : retry ? 'Send again' : null });
  }

  async function submit() {
    const ghost = race;
    const session = accounts.session;

    if (disposed || !ghost?.trace || !ghost.run || ghost.own || !session) return;
    const owner = accountLifetime();
    const { run, trace } = ghost;
    ghost.state = 'sending';
    render();
    let reply: Awaited<ReturnType<typeof finishChallenge>> | null = null;
    let failure: GhostRun['error'] | null = null;

    try {
      reply = await finishChallenge(session, ghost.id, trace);

      if (disposed || accountLifetime() !== owner || !sameSignIn(accounts.session, session)) return;
      const id = `challenge:${ghost.id}`;
      inbox.notify({ id, kind: 'challenge-result', challengeId: ghost.id, closed: false, until: null, completedAt: reply.completedAt, text: resultText(reply) });
      inbox.deliver(id);
    } catch (error) {
      failure = { message: error instanceof Error ? error.message : String(error) };

      if (error instanceof Error && 'status' in error && typeof error.status === 'number') failure.status = error.status;
    }

    if (disposed || accountLifetime() !== owner || !sameSignIn(accounts.session, session) || race !== ghost || ghost.run !== run || practice.shownResult !== run) return;

    if (failure) { ghost.state = 'failed'; ghost.error = failure; }
    else {
      if (!reply) throw new Error('A ghost finish requires its reply');
      const local = scoreTrace(trace, ghost.passage, { relaxed: run.conditions.correctionPolicy === 'relaxed' });
      ghost.result = reply.result;
      ghost.sender = reply.sender || ghost.sender;
      ghost.state = sameScore(reply.result, local) ? 'sent' : 'kept';
    }

    render();

    if (document.body.dataset.view === 'results') say();
  }

  function finish(completed: SealedRun, valid: boolean) {
    if (disposed) return;

    if (!race) throw new Error('A ghost finish requires its race');
    const sameInput = inputOf(completed.conditions) === inputOf(race.conditions);
    race.run = completed;
    race.trace = valid && sameInput ? encodeTrace(completed) : null;
    race.state = !valid ? 'interrupted' : !sameInput ? 'other-input' : race.own && race.trace ? 'own' : race.trace ? 'sending'
      : traceTrouble(completed) === 'character' ? 'unreplayable' : 'unsendable';
    render();

    if (race.trace && !race.own) void submit();
    else say();
  }

  return {
    view, finish,
    conditions(): Conditions {
      if (!race) throw new TypeError('A ghost passage requires its race');
      const source = race.conditions;

      return { ...Object.fromEntries(CONDITION_KEYS.flatMap((key) => key in source ? [[key, source[key]]] : [])), inputClass: 'physical-keyboard' };
    },
    passage(seenIds: readonly string[]) {
      if (!race) throw new TypeError('A ghost passage requires its race');
      const id = challengeTextId(race.passage, race.conditions);

      return { id, text: race.passage, fresh: !seenIds.includes(id) };
    },
    get race() { return race; },
    set race(next: GhostRace | null) { race = next; },
    configure(next: GhostResultPorts) { ports = next; },
    show(visible: boolean) { publish({ visible }); },
    action() {
      if (disposed) return;

      if (race?.state === 'failed') void submit();
      else if (race && RACE_AGAIN.includes(race.state)) { race.run = null; ports?.repeat(); }
    },
    dispose() { disposed = true; },
  };
}

export function GhostResult({ controller }: { controller: ReturnType<typeof createGhostResult> }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <article id="ghost-result" className="comparison-panel ghost-result" aria-labelledby="ghost-result-heading" hidden={!view.visible}><h2 id="ghost-result-heading">{view.heading}</h2><div id="ghost-result-rows" className="race-results">{view.rows.map(({ name, score }, index) => <article className="race-result-row" key={index}><strong>{name}</strong><span className="num"><Copy parts={[{ kind: 'speed', wpm: score.wpm }]} /></span><span className="num">{score.accuracy}% accuracy</span><span className="num">{(score.elapsedMs / 1000).toFixed(1)} s</span></article>)}</div><p id="ghost-result-rule" className="ghost-result-rule">{view.rule}</p><p id="ghost-result-status">{view.status}</p><button id="ghost-result-action" className="btn btn-secondary" type="button" hidden={view.action === null} onClick={() => controller.action()}>{view.action || 'Send again'}</button></article>;
}
