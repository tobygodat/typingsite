import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GAUGE_SEGMENTS, rankLabel, rankOf, ratingGauge, ratingLine } from './quick-match.js';
import type { Rating } from './quick-match.js';
import type { QuickMatchController } from './quick-match-view.js';

export interface RankPillModel { rank: string | null; rating: number; lit: number; note: string; line: string }

// The corner's reading of the signed-in racer's own race rating (docs/adr/0016-race-rank.md). Nothing for a guest
// or before a rated race: 1500 with no races is where everyone starts, not a standing.
export function rankPill(mine: Rating | null): RankPillModel | null {
  const gauge = ratingGauge(mine);

  if (!mine || !gauge || mine.races < 1) return null;

  return { rank: rankLabel(rankOf(mine)) || null, rating: mine.rating, lit: gauge.lit, note: gauge.note, line: ratingLine(mine) };
}

export function RankPill({ controller, onChallenge }: { controller: QuickMatchController; onChallenge(): void }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const model = rankPill(view.mine);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ranked = model !== null;
  const shown = open && ranked;

  // A pill that goes (a sign-out here or in another tab) comes back closed.
  useEffect(() => { if (!ranked) setOpen(false); }, [ranked]);

  useEffect(() => {
    if (!shown) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false); };

    // On the window, ahead of every other Escape handler: after a click WebKit leaves focus on the page, not the pill.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape, true);

    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', escape, true);
    };
  }, [shown]);

  if (!model) return null;

  return <div ref={root} className="rank" onBlur={(event) => {
    // Focus leaving for the passage, or anywhere else, puts the card away; a press outside does it for the pointer.
    if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} id="rank-pill" className="corner-trigger rank-pill" type="button" aria-expanded={shown} aria-controls="rank-popover" aria-label={`Race rank: ${model.line}`} onClick={() => setOpen(!open)}>
      <svg className="rank-ring" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="rank-ring-track" cx="10" cy="10" r="7" />
        <circle className="rank-ring-fill" cx="10" cy="10" r="7" pathLength={GAUGE_SEGMENTS} strokeDasharray={`${model.lit} ${GAUGE_SEGMENTS}`} />
      </svg>
      {model.rank && <span className="rank-pill-name" aria-hidden="true">{model.rank}</span>}
      <span className="rank-pill-rating num" aria-hidden="true">{model.rating}</span>
    </button>
    {shown && <div id="rank-popover" className="corner-popover rank-popover" role="group" aria-label="Race rank">
      <p className="rank-popover-head"><strong>{model.rank ?? 'Provisional'}</strong><span className="num">{model.rating}</span></p>
      <div className="gauge" aria-hidden="true">{Array.from({ length: GAUGE_SEGMENTS }, (_, index) => <i key={index} className={index < model.lit ? 'is-lit' : undefined}></i>)}</div>
      <p className="rank-popover-note">{model.note}</p>
      <p className="sr-only">{model.line}</p>
      <button className="btn btn-secondary btn-sm rank-challenge" type="button" onClick={() => { setOpen(false); onChallenge(); }}>Challenge</button>
    </div>}
  </div>;
}
