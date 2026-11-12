// Draws Challenge's people list (src/challenge-people.js) into #people-list: each row its name, its quiet line, the
// pair's tally and one action. A row that stays keeps its element, so only a person who arrives eases in, and keyboard
// focus stays on the same action, or moves to a row (never an action in it) when that action has gone.
import { lineParts, tallyLabel } from './challenge-people.js';
import { speedFigure } from './units.js';

// What each state offers: [action, label, accessible name] for its one action, and the quiet one beside it.
// Two people with one name are told apart by the email typed for them, heard as well as seen.
const personName = (row) => (row.detail ? `${row.name} (${row.detail})` : row.name);

const ACTIONS = {
  invited: (row) => [['join', 'Join', `Join ${personName(row)}’s race`], ['dismiss', 'Dismiss', `Dismiss ${personName(row)}’s invitation`]],
  ghost: (row) => [['ghost', 'Race the ghost', `Race ${personName(row)}’s ghost`]],
  friend: (row) => [['race', 'Race', `Race ${personName(row)}`]],
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
  // Focus can be put on the row itself (see drawPeople), though Tab passes over it to its action.
  item.tabIndex = -1;
  item.dataset.key = row.key;
  item.dataset.state = row.state;
  const who = document.createElement('div');
  who.className = 'people-who';
  const name = document.createElement('p');
  name.className = 'people-name';
  name.textContent = row.name;

  if (row.detail) {
    const detail = document.createElement('span');
    detail.className = 'people-detail';
    detail.textContent = ` · ${row.detail}`;
    name.append(detail);
  }

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
const look = (row, now) => JSON.stringify([row.name, row.detail, row.state, row.kind, row.tally, row.inviteId, row.challengeId, row.friendId,
  lineParts(row.line, now).map((part) => (typeof part === 'string' ? part : [part.wpm, part.bare]))]);

// Focus stays on the same action. When that action has gone (a Dismiss, or a row that left or changed what it offers),
// focus moves to a row, not to an action in it: the same person's row if it stays, else the row now in its place,
// else the last row, else `fallback`, which is never an action either. Enter and Space press nothing on a row, so a
// second press of the key that pressed Dismiss (a double tap, or a held key) can't join the next race, race a ghost
// or send an invitation. Tab from the row reaches its action.
export function drawPeople(list, rows, { now = Date.now(), fallback = null, decorate = () => {} } = {}) {
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedRow = focused?.closest('.people-row');
  const rowAt = focusedRow ? [...list.children].indexOf(focusedRow) : -1;
  const focusId = focused?.matches('button') ? `${focused.dataset.peopleKey}|${focused.dataset.peopleAction}` : null;
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

  for (const button of list.querySelectorAll('button')) decorate(button);

  if (!focused || list.contains(document.activeElement)) return;
  const same = focusId && [...list.querySelectorAll('button')].find((button) => `${button.dataset.peopleKey}|${button.dataset.peopleAction}` === focusId);
  const person = items.find((item) => item.dataset.key === focusedRow?.dataset.key);
  // A ring that showed shows again. Otherwise the browser decides, from the last input: Firefox never shows it on a
  // button focused by script, even after a key pressed it, so passing that state on would hide the ring after Enter.
  (same || person || items[Math.min(rowAt, items.length - 1)] || fallback)?.focus({ preventScroll: true, ...(focusVisible && { focusVisible }) });
}
