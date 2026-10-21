# Accounts

Everyone starts as a guest: default settings, nothing stored, nothing sent. The person button in the top
right offers Create account, Sign in with Google and Sign in with email. Signed in, the button gets a green
dot, an inbox envelope appears beside it, and the menu shows the email, "Saved to your account", Sign out and
Delete my account. Verification always runs against the fake Supabase in `e2e/fake-supabase.js`.

## Sub-features

- `account-guest` shows `#account[data-state=guest]`, the "guest · runs aren't saved" note, and sends no requests.
- `account-signin-email` signs in through `#account-signin` → email and password → `#account-submit`; the page reloads as a member.
- `account-synced` shows `#account[data-sync=synced]` and stores a profile row in the backend.
- `account-menu` opens the member menu with the email, Sign out (`#account-signout`) and Delete my account (`#account-delete`).
- `account-create` creates an account (`#account-create`), with a check-your-email step when confirmation is on.
- `account-google` signs in with Google (PKCE redirect).

## How to get to it (user POV)

- Click the person button in the top right (`#account-trigger`, ARIA "Account, guest mode").
- Ctrl+K → `sign in…`, `create account…`, `continue with Google`; signed in, `sign out` and `delete account…`.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- A fresh context: guest, empty fake Supabase. The flow adds `verify@stilltype.test` /
  `correct horse battery` to the fake before signing in.

- **Guest baseline.** Run `$V shot idle`. `run.json` shows `account: "guest"` on the step,
  `supabase.requests: 0` and `offsite: []`.
- **Sign in with email.** Open the person menu, choose Sign in with email, enter the credentials, submit.
  Run `$V shot signin`. Shots `guest`, `signed-in` (green dot, inbox icon) and `account-menu` (email, "Saved
  to your account"). `run.json` passes "starts as a guest", "account is member/synced" and "fake Supabase
  stored a profile row for the user"; `supabase.requests` is above 0.
- **Any flow signed in.** Add `--signed-in`, e.g. `$V shot more --signed-in`. Each run starts with a
  `signed-in` shot and its steps record `account: "member"`.
- **Create account and Google.** No built-in flow. Use a flow file modelled on `e2e/accounts.spec.js`
  ("sign-up that needs confirmation…" sets `fake.confirmSignups = true`; Google needs `fake.googleEnabled = true`).
  Report these as unverified until such a flow runs.

## Gotchas

- Sign-in reloads the page (`waitForEvent('load')` in `h.signIn`); anything set up before it is gone.
- The fake starts empty in every context: call `fake.addUser(email)` before signing in, or the dialog shows
  the wrong-credentials error.
- The fake mirrors the owner-only row policy and PostgREST's write behaviour, but it is not the real project.
  A pass here says nothing about the deployed Supabase, its migrations or its edge functions.
- Delete my account really deletes in the fake (and the profile row with it); run it last in a flow.
- ARIA snapshots show the account control as a bare `group`; read `account` from the `run.json` steps.
