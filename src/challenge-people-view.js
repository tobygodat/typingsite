// Draws Challenge's people list (src/challenge-people.js) into #people-list: each row its name, its quiet line, the
// pair's tally and one action. A row that stays keeps its element, so only a person who arrives eases in, and keyboard
// focus stays on the same action, or on the action now in its place when its row has gone.
import { lineParts, tallyLabel } from './challenge-people.js';
import { speedFigure } from './units.js';

// What each state offers: [action, label, accessible name] for its one action, and the quiet one beside it.
const ACTIONS = {
  invited: (row) => [['join', 'Join', `Join ${row.name}’s race`], ['dismiss', 'Dismiss', `Dismiss ${row.name}’s invitation`]],
  ghost: (row) => [['ghost', 'Race the ghost', `Race ${row.name}’s ghost`]],
  friend: (row) => [['race', 'Race', `Race ${row.name}`]],
  link: () => [['link', 'Copy a race link', 'Copy a race link']],
};

// The record each action acts on, as data attributes the race controls' busy state already reads.
const TARGETS = {
  join: (row) => ({ acceptInvite: row.inviteId }),
  dismiss: (row) => ({ dismissInvite: row.inviteId }),
  ghost: (row) => ({ raceGhost: row.challengeId }),
  race: (row) => ({ raceFriend: row.friendId }),
  link: () => ({ raceLink: '' }),
};

function lineNode(row, now) {
  const line = document.createElement('p');
  line.className = 'people-line';

  if (row.kind === 'link') line.textContent = 'anyone with the link joins';
  else line.append(...lineParts(row.line, now).map((part) => (typeof part === 'string' ? part : speedFigure(part.wpm, { bare: part.bare }))));

  return line;
}

function build(row, now) {
  const item = document.createElement('li');
  item.className = 'people-row';
  item.dataset.key = row.key;
  item.dataset.state = row.state;
  const who = document.createElement('div');
  who.className = 'people-who';
  const name = document.createElement('p');
  name.className = 'people-name';
  name.textContent = row.name;
  who.append(name, lineNode(row, now));
  const side = document.createElement('div');
  side.className = 'people-side';

  if (row.tally) {
    const tally = document.createElement('p');
    tally.className = 'people-tally num';
    const figures = document.createElement('span');
    figures.setAttribute('aria-hidden', 'true');
    figures.textContent = `${row.tally.mine}–${row.tally.theirs}`;
    const spoken = document.createElement('span');
    spoken.className = 'sr-only';
    spoken.textContent = tallyLabel(row.tally);
    tally.append(figures, spoken);
    side.append(tally);
  }

  const actions = document.createElement('div');
  actions.className = 'people-actions';

  for (const [index, [action, label, spoken]] of ACTIONS[row.kind || row.state](row).entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'btn btn-secondary people-action' : 'btn btn-ghost people-quiet';
    button.dataset.peopleAction = action;
    button.dataset.peopleKey = row.key;
    Object.assign(button.dataset, TARGETS[action](row));
    button.textContent = label;

    if (spoken !== label) button.setAttribute('aria-label', spoken);
    actions.append(button);
  }

  side.append(actions);
  item.append(who, side);

  return item;
}

// Two rows draw the same when everything they show is the same; `now` only moves the line's age.
const look = (row, now) => JSON.stringify([row.name, row.state, row.kind, row.tally, row.inviteId, row.challengeId, row.friendId,
  lineParts(row.line, now).map((part) => (typeof part === 'string' ? part : [part.wpm, part.bare]))]);

export function drawPeople(list, rows, { now = Date.now(), fallback = null, decorate = () => {} } = {}) {
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const buttons = () => [...list.querySelectorAll('button')];
  const focusAt = focused ? buttons().indexOf(focused) : -1;
  const focusId = focused && `${focused.dataset.peopleKey}|${focused.dataset.peopleAction}`;
  const focusVisible = focused?.matches(':focus-visible');
  const kept = new Map([...list.children].map((item) => [item.dataset.key, item]));

  const items = rows.map((row) => {
    const signature = look(row, now);
    const old = kept.get(row.key);

    if (old && old.dataset.look === signature) return old;
    const item = build(row, now);
    item.dataset.look = signature;

    // A row redrawn in place doesn't arrive again.
    if (old) item.dataset.settled = 'true';

    return item;
  });

  for (const item of kept.values()) if (!items.includes(item)) item.remove();
  items.forEach((item, index) => {
    if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
  });

  for (const button of buttons()) decorate(button);

  if (!focused || list.contains(document.activeElement)) return;
  const same = buttons().find((button) => `${button.dataset.peopleKey}|${button.dataset.peopleAction}` === focusId);
  const near = buttons()[Math.min(focusAt, buttons().length - 1)];
  (same || near || fallback)?.focus({ preventScroll: true, focusVisible });
}
