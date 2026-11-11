# Challenge: the people you race

Challenge has no visible heading. Quick match sits on top with its rating line and the page's one filled
button, Find a race. Under it, one row per person you race: the name, one quiet line saying the newest thing
between you (an invitation and its age, a ghost waiting and its time left, a finished ghost race), the pair's
tally when the service has one, and one action. Quiet links at the foot open Add a friend, Copy a race link,
Race setup, the daily passage and One keyboard, each with Back to the list. A guest sees quick match, Sign in
to keep friends, the daily passage and One keyboard.

## Sub-features

- `people-rows`: one `.people-row` per person, `data-state` `invited` (Join, Dismiss), `ghost` (Race the ghost) or `friend` (Race); invitations first, then ghosts, each soonest to lapse first, then the newest thing between you.
- `people-tally`: `.people-tally` reads "3–4" and is heard as "3 wins, 4 losses", only for a friend saved from a race once the pair has raced.
- `people-arrive`: an invitation arriving while the page is open adds its row without a reload, keeping focus.
- `people-empty`: a signed-in list with nobody on it has one row, "A friend · anyone with the link joins", with Copy a race link.
- `people-guest`: a guest has no rows, "Sign in to be matched." under Quick match, and "Sign in to keep friends" at the foot.
- `people-views`: Add a friend, Race setup, Daily passage and One keyboard each replace the list, focus their heading, and Back returns to the list and to the link.
- `people-race`: Race on a friend opens the room and invites them with the race setup in one press.

## How to get to it (user POV)

- Dock → challenge (guest, or signed in through the account dialog).
- Signed in: the rows come from the friend list, invitations and ghost races; a second account invites or sends a ghost.
- Foot links under the list; Back at the top of each view.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- The fake Supabase holds the records; the flows seed them as the service would (`fake.races.addFriend`,
  `fake.races.invite`, `fake.races.tallies`, `fake.challenges.seed`).

- **Full list.** Run `$V drive .claude/skills/verify-stilltype/flows/challenge-people.mjs` (`--scheme light`,
  `--width 390 --height 844 --mobile`, `--width 320 --height 568 --mobile` for the others). `list.png` shows
  six rows: Priya's invitation, Maya's ghost, Sam won, Lena lost, Jonas with a tally only, Theo with his email.
  `forced-colors.png`, `invitation-arrived.png` (Ola's row added), `race-setup.png` and `raced-sam.png`
  (the room, "The challenge is waiting in Sam Achebe’s inbox.") follow. `run.json` notes every row's text.
- **Other states.** Run `$V drive .claude/skills/verify-stilltype/flows/challenge-people-states.mjs`:
  `guest.png`, `empty.png`, `quick-searching.png`, `add-friend.png`, `one-friend.png`, the daily and
  One keyboard views, `race-link-room.png` and `guest-joined.png` after a guest joins by the link.
- **Race setup.** `$V drive .claude/skills/verify-stilltype/flows/challenge-options.mjs`.

## Gotchas

- The rows need the people links (`public.race_people`) for tallies and to merge an invitation into its
  friend's row; with `fake.peopleMissing = true` the page behaves as before that migration.
- Seeded ghost speeds round to whole wpm from the trace's key steps, so match numbers loosely.
- The inbox polls every 10 s; wait up to 15 s for an invitation to arrive.
