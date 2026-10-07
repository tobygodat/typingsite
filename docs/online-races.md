# Private online races

Implemented 30 September 2026 using the existing Supabase project and static native JavaScript app.

## Player flow

Open Challenge and sign in to host. Enter a race name and either an existing account email or leave the email blank for a guest link. Account invitations appear in the recipient’s Challenge inbox, refreshed every ten seconds while open; no email is sent. The response does not reveal whether an email belongs to an account. Guest links admit one opponent without requiring a Supabase anonymous-auth session.

Both players ready up. The server schedules a shared five-second countdown and a race lasting up to sixty seconds. Completing the passage correctly can finish a player early. Progress is exchanged about every 650 ms, outside the local keystroke/render path. The server computes matching retained characters, elapsed race time and WPM; accuracy uses bounded insertion/error counters. Results remain friendly and unranked: browser data cannot establish that a human typed it.

The invitation expires fifteen minutes after room creation. Leaving cancels an active room for both players. A disconnected player’s seat remains held; the client retries automatically. Reload restores the last server-acknowledged text and counters. A ten-second final-packet grace period keeps elapsed time capped at sixty seconds and allows delayed results to arrive. A player who does not return is finalized from their last acknowledged progress. A new race requires a new room.

One keyboard retains the original local challenge. Online races do not add attempts, personal bests or learning comparisons. Revealed quote IDs do enter seen-text tracking so they cannot later masquerade as fresh retests.

## Friends, rematches and the inbox (7 October 2026)

- **Friends.** Each signed-in host keeps a private friend list on the race service (`race_private.friends`). Inviting an account by email saves that email to the list by default ("save to friends"). After a race against another account, "Add <name> to friends" saves them without ever revealing their email or account id; the row only says "raced before". The host who invited someone by email is not offered this, since they already have them by email. Challenge on a friend row creates an account invitation exactly as typing the email would, with the same non-revealing reply. Lists are capped at 100 and are not mutual: adding someone tells them nothing.
- **Race again.** Any finished, cancelled or expired race with two players offers Race again. The first player to ask opens a new room with the same host, seats, names and settings and a fresh passage of the same length and difficulty; the second player's Race again (shown as Join rematch) joins that room. Accounts keep their seat by account and a guest keeps the same seat capability, so nobody re-enters an email or a link. Both players still press Ready. A closed room is watched every three seconds while it is open, so a rematch request reaches a guest without an inbox.
- **Toast and inbox.** Signed-in players get an envelope next to the account button. Invitations are polled every ten seconds on every screen (paused while the tab is hidden or a run is in progress). A new invitation or rematch request shows a toast at the top right that leaves after 18 seconds, held while hovered or focused; a toast that arrives mid-run waits until the run ends. The inbox lists invitations and rematch requests (with Join), an opponent arriving while you are on another screen (with Open) and race results (with Race again). Open only works while that race is still live in this tab, and Race again lapses 23 hours after the room's expiry, before the service deletes the room; lapsed entries stay listed as closed. Entries are kept per user on this device only (`stilltype-inbox-v1:<user id>`, newest 30) and removed on sign-out. Guests see rematch toasts but keep no inbox.

The migration is `supabase/migrations/20261007031500_race_friends_rematch.sql`; `supabase/tests/race-friends-rematch.sql` covers friend privacy, friend invites, rematch seats and guest rematches. Both SQL test files pass against the two migrations on PostgreSQL 16 with a minimal `auth` / `extensions` stub. Apply the migration before shipping the frontend: until then friends and Race again report that they are being set up.

## Storage and access

- `src/multiplayer.js` calls `public.race_action` using the existing browser publishable key and a member token when signed in. It refreshes sessions and maintains progress sequence numbers across reloads.
- `race_private.rooms` and `race_private.players` enable RLS and grant browsers no table privileges. An explicitly granted invoker RPC calls a private definer function that checks account membership or an independent guest-seat capability on every operation. Transitions lock the room row; hosting quotas serialize by account.
- Account lookups stay inside the database. Snapshots omit account IDs, emails, capability hashes and the other player’s typed text/counters. Both players can see names, readiness, progress and scores.
- A guest invitation and the joined guest’s seat use different random 256-bit capabilities. Only hashes are stored in the database. Invitation capabilities live in URL fragments; joined-seat credentials and the host’s link are retained only in the current tab’s sessionStorage, along with any pending invite needed through sign-in redirects. Solo guest history is still not persisted.
- Room data includes current typed text, counters and scores. Creating a room opportunistically removes rooms whose expiration was more than a day ago; there is no scheduled deletion guarantee while the app is idle.

The migration is `supabase/migrations/20260930085227_online_races.sql`, applied to project `bicbyljexprkaedakofa` (`typingsite`) as remote migration `20260930085736`. No new runtime dependency or WebSocket server is required. The static frontend build uses the existing hosting workflow; this change does not publish a frontend deployment.

## Verification

The build and all four Node test files pass. The 48 Chromium scenarios pass across the full regression run and the final targeted rerun of the updated reduced-motion assertion. Desktop dark and 320 px light lobby screenshots were visually reviewed.

`npm test` covers existing scoring/accounts plus transport payloads, fragment parsing, capabilities and reconnect sequencing. `e2e/multiplayer.spec.js` drives independent browser contexts against shared in-memory Supabase state: full race/results, account inbox, host/guest reload, mid-race progress restoration, cancellation, occupied links, expiration, offline recovery and 320 px layouts in both themes. The fake is for browser orchestration, not proof of database security.

`supabase/tests/online-races.sql` was separately executed against the deployed database. It creates temporary test users inside a transaction and rolls everything back. Assertions cover host authorization, unauthorized readers, guest capability isolation, pre-start rejection, impossible counters, incomplete early finishes, server scoring, stale updates, account invite isolation and cancellation. Catalog checks confirmed both private tables have RLS and no browser read/write privileges.

The Supabase security advisor reports informational [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for these intentionally inaccessible private tables. An existing project-level [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is unchanged.

Browser verification uses Chromium. Real cross-region latency, physical mobile keyboards and full anti-cheat remain unmeasured. Public matchmaking, ratings and email delivery are outside this feature.
