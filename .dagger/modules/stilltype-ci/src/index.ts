import { dag, Workspace, Directory, Container, object, func, check } from "@dagger.io/dagger"

/** Stilltype's credential-free CI. All execution uses the selected Dagger engine. */
@object()
export class StilltypeCi {
  source: Directory

  constructor(ws: Workspace) {
    this.source = ws.directory("/", {
      exclude: ["**/node_modules", "**/.git", "**/dist", "**/.dagger", "**/.env", "**/.env.*", "**/.wrangler", "**/test-results", "**/playwright-report", "supabase/.temp", "plans"],
    })
  }

  private installed(): Container {
    return dag.container().from("node:24-bookworm")
      .withWorkdir("/src")
      .withDirectory("/src", this.source)
      .withEnvVariable("CI", "1")
      .withMountedCache("/root/.npm", dag.cacheVolume("stilltype-npm-node24"))
      .withExec(["npm", "ci", "--no-audit", "--no-fund"])
  }

  /** Lint, strict types, unit tests and the production build; never deploys. */
  @func()
  @check()
  async unitBuild(): Promise<void> {
    await this.installed()
      .withExec(["npm", "run", "lint"])
      .withExec(["npm", "run", "typecheck"])
      .withExec(["npm", "test"])
      .withExec(["npm", "run", "build"])
      .sync()
  }

  private browser(engine: string, shard: number, total: number, full: boolean): Container {
    return this.installed()
      .withExec(["npx", "playwright", "install", "--with-deps", engine])
      .withEnvVariable("E2E_BROWSERS", engine)
      .withEnvVariable("E2E_FULL", full ? "1" : "0")
      .withEnvVariable("E2E_PORT", "4173")
      .withExec(["npx", "playwright", "test", `--shard=${shard}/${total}`, `--workers=${engine === "webkit" ? 1 : 2}`, "--reporter=list"])
  }

  @func() @check()
  async chromium1(): Promise<void> { await this.browser("chromium", 1, 6, false).sync() }
  @func() @check()
  async chromium2(): Promise<void> { await this.browser("chromium", 2, 6, false).sync() }
  @func() @check()
  async chromium3(): Promise<void> { await this.browser("chromium", 3, 6, false).sync() }
  @func() @check()
  async chromium4(): Promise<void> { await this.browser("chromium", 4, 6, false).sync() }
  @func() @check()
  async chromium5(): Promise<void> { await this.browser("chromium", 5, 6, false).sync() }
  @func() @check()
  async chromium6(): Promise<void> { await this.browser("chromium", 6, 6, false).sync() }

  /** Selected Firefox input/rendering compatibility cases, not full diagnostics. */
  @func() @check()
  async firefoxCompat(): Promise<void> { await this.browser("firefox", 1, 1, false).sync() }

  /** Selected WebKit cases keep the existing one-worker policy. */
  @func() @check()
  async webkitCompat(): Promise<void> { await this.browser("webkit", 1, 1, false).sync() }

  /** Explicit full-engine diagnostics. Not an automatic check. */
  @func()
  async browserDiagnostic(engine: string, shard = 1, total = 6): Promise<void> {
    if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error("Unknown browser engine")
    if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total || total > 6) throw new Error("Expected 1 <= shard <= total <= 6")
    await this.browser(engine, shard, total, true).sync()
  }
}
