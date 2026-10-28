# 0008. Account data cascades from auth.users

Status: Accepted, 2026-10-23.

## Context

Self-serve account deletion must remove everything keyed to the account in one authoritative step.

## Decision

Every foreign key to `auth.users` cascades on delete. The one user id kept as text, the quota key on rooms, is cleared by `race_private.forget_opener`. `supabase/tests/account-deletion.sql` checks both. The `delete-account` Edge Function deletes the user first, and only then does the device sign out and clear its copy.

## Consequences

A new table that references a user cascades, or the deletion test fails.
