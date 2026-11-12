import { Cause, Effect, Exit, Fiber, Result, Scope } from 'effect';

export class WorkCancelled extends Error {
  readonly kind = 'cancelled';
}

/** A page owns account lifetimes; each submitted program has its own request scope. */
export class AsyncLifetime {
  private readonly scope: Scope.Closeable;
  private closed = false;

  constructor(parent?: AsyncLifetime) {
    this.scope = parent ? Scope.forkUnsafe(parent.scope) : Scope.makeUnsafe();
  }

  get active(): boolean {
    return !this.closed && this.scope.state._tag !== 'Closed';
  }

  async run<A, E>(program: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
    if (!this.active || signal?.aborted) throw new WorkCancelled('Work was cancelled.');
    const fiber = Effect.runSync(Effect.forkIn(Effect.scoped(program), this.scope));
    const exit = await Effect.runPromiseExit(Effect.ensuring(Fiber.join(fiber), Fiber.interrupt(fiber)), { signal });
    if (!this.active || signal?.aborted) throw new WorkCancelled('Work was cancelled.');
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) throw failure.success;
    throw new WorkCancelled('Work was cancelled.');
  }

  async close(): Promise<void> {
    this.closed = true;
    await Effect.runPromise(Scope.close(this.scope, Exit.void));
  }
}

export const createAsyncPage = (): AsyncLifetime => new AsyncLifetime();

let page = createAsyncPage();
let account: { identity: string; lifetime: AsyncLifetime } | undefined;

export function pageLifetime(): AsyncLifetime {
  return page;
}

/** Call before publishing a different sign-in, including another sign-in to the same user. */
export async function replaceAccountLifetime(identity: string | null): Promise<void> {
  if (identity !== null && account?.identity === identity && account.lifetime.active) return;
  const previous = account;
  account = identity === null ? undefined : { identity, lifetime: new AsyncLifetime(page) };
  await previous?.lifetime.close();
}

export function accountLifetime(): AsyncLifetime {
  return account?.lifetime ?? page;
}

/** Close on page teardown. Starting a new page is explicit, so disposed work cannot revive it. */
export async function disposePageWork(): Promise<void> {
  account = undefined;
  await page.close();
}

export function startPageWork(): void {
  if (!page.active) page = createAsyncPage();
}

export function within<A, E>(program: Effect.Effect<A, E>, milliseconds: number, failure: () => E): Effect.Effect<A, E> {
  return Effect.timeoutOrElse(program, { duration: milliseconds, orElse: () => Effect.fail(failure()) });
}

export function abortable<A, E>(send: (signal: AbortSignal) => PromiseLike<A>, failure: (cause: unknown) => E): Effect.Effect<A, E> {
  return Effect.tryPromise({ try: send, catch: failure });
}
