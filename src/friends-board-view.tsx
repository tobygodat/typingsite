import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { bestsOrder, dailyOrder, practiceTime, weekOrder } from './friends-board.js';
import type { BoardRow, FriendsBoardController } from './friends-board.js';
import { Copy } from './results-card.js';
import { unitText } from './units.js';

function BoardItem({ entry, value, unit, detail }: { entry: BoardRow; value: ReactNode; unit?: ReactNode; detail: string }) {
  return <li className="board-row" data-self={entry.self ? 'true' : undefined}>
    <span className="board-name">{entry.self ? 'You' : entry.name || 'Friend'}</span>{' '}
    <span className="board-value"><strong className="num">{value}</strong>{unit && <>{' '}<span className="board-unit">{unit}</span></>}</span>{' '}
    <span className="board-detail num">{detail}</span>
  </li>;
}

function speed(wpm: number) { return <Copy parts={[{ kind: 'speed', wpm, bare: true }]} />; }

function unit() { return <span data-speed-unit="">{unitText('{unit}')}</span>; }

function rowKey(entry: BoardRow, index: number) { return entry.self ? 'self' : entry.id ?? `${entry.name ?? 'Friend'}:${index}`; }

export function FriendsBoard({ controller }: { controller: FriendsBoardController }) {
  const view = useSyncExternalStore(controller.subscribeView, controller.getSnapshot, controller.getSnapshot);
  const rows = view.rows ?? [];
  const bests = view.picked ? bestsOrder(view.bestsRows, view.picked) : [];

  return <section id="friends-board" className="friends-board" aria-labelledby="friends-board-heading">
    <div className="online-section-heading">
      <h2 id="friends-board-heading" tabIndex={-1}>Friends board</h2>
      <button id="refresh-friends-board" className="btn btn-ghost btn-sm" type="button" hidden={!view.signedIn} aria-disabled={view.loading ? 'true' : undefined} onClick={() => { if (!view.loading) void controller.refresh({ manual: true }); }}>Refresh</button>
    </div>
    <div id="friends-board-guest" className="friends-board-guest" hidden={view.signedIn}>
      <button id="friends-board-signin" className="btn btn-secondary" type="button" onClick={() => controller.signIn()}>Sign in</button>
    </div>
    <div id="friends-board-share" className="friends-board-share" hidden={!view.signedIn}>
      <label className="compact-switch" htmlFor="share-board"><input id="share-board" className="switch" type="checkbox" checked={view.switchedOn} onChange={(event) => { void controller.setShare(event.currentTarget.checked); }} /><span>share on friends board</span></label>
      <p id="friends-board-off" className="friends-board-off" hidden={!view.off}>Share to see friends’ rows. Only friends who added you back see yours.</p>
    </div>
    <p id="friends-board-status" className="online-copy" role="status">{view.status}</p>
    <div id="friends-board-lists" className="friends-board-lists" hidden={view.rows === null}>
      <section className="board-column" aria-labelledby="board-daily-heading">
        <h3 id="board-daily-heading">Today’s daily</h3><p id="board-daily-meta" className="condition-copy">{view.date}</p>
        <ol id="board-daily" className="board-list" role="list">{dailyOrder(rows).map((entry, index) => entry.daily
          ? <BoardItem key={rowKey(entry, index)} entry={entry} value={speed(entry.daily.wpm)} unit={unit()} detail={`${entry.daily.accuracy}% accuracy · ${entry.daily.attempts === 1 ? '1 attempt' : `best of ${entry.daily.attempts}`}`} />
          : <BoardItem key={rowKey(entry, index)} entry={entry} value="—" detail={entry.otherVersion ? 'another version of the daily · not compared' : 'no completed attempt yet'} />)}</ol>
      </section>
      <section className="board-column" aria-labelledby="board-week-heading">
        <h3 id="board-week-heading">This week’s practice</h3>
        <ol id="board-week" className="board-list" role="list">{weekOrder(rows).map((entry, index) => {
          const time = entry.week ? practiceTime(entry.week.seconds) : null;

          return <BoardItem key={rowKey(entry, index)} entry={entry} value={time?.value ?? '—'} unit={time?.unit} detail={entry.week ? `${entry.week.runs} run${entry.week.runs === 1 ? '' : 's'}` : 'nothing yet this week'} />;
        })}</ol>
      </section>
      <section className="board-column board-bests" aria-labelledby="board-bests-heading">
        <h3 id="board-bests-heading">Bests</h3>
        <div id="board-shape-field" className="filter-field board-shape" hidden={!view.shapes.length}>
          <select id="board-shape" className="input select" aria-label="Test conditions" value={view.picked ?? ''} onChange={(event) => controller.pick(event.currentTarget.value)}>{view.shapes.map((shape, index) => <option key={shape.key} value={shape.key}>{view.shapeLabels[index]}</option>)}</select>
        </div>
        <p id="board-bests-meta" className="condition-copy" hidden={!view.shapeDescription}>{view.shapeDescription}</p>
        <ol id="board-bests" className="board-list" role="list" hidden={!view.shapes.length}>{bests.map((entry, index) => entry.best
          ? <BoardItem key={rowKey(entry, index)} entry={entry} value={speed(entry.best.wpm)} unit={unit()} detail={`${entry.best.accuracy}% accuracy · ${entry.best.date}`} />
          : <BoardItem key={rowKey(entry, index)} entry={entry} value="—" detail={entry.otherVersion ? 'another version of this shape · not compared' : 'no best on this shape yet'} />)}</ol>
        <p id="board-bests-none" className="friends-board-note" hidden={view.shapes.length > 0}>No bests yet.</p>
      </section>
    </div>
    <div id="friends-board-empty" className="friends-board-empty" hidden={view.rows === null || rows.some((entry) => !entry.self)}>
      <p>Nobody else yet. Friends appear once you’ve added each other.</p>
      <button id="friends-board-online" className="btn btn-secondary btn-sm" type="button" onClick={() => controller.openOnline()}>Add a friend</button>
    </div>
  </section>;
}
