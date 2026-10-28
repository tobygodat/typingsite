// Original code snippets for code mode. The engine has no line breaks, so each snippet is
// auto-unindented and its lines are joined with a single space, and must still be valid code once
// joined: no line comments, and statements that end up on one line need a semicolon between them
// (in Go, and in Python, where a colon may only be followed by simple statements). Tokens stay at
// MAX_CODE_TOKEN characters or fewer so they rarely have to break mid-token on a narrow screen.
// A code test is one snippet, so each joins to between MIN_CODE_CHARS and MAX_CODE_CHARS
// characters: 30 to 60 seconds at 100 wpm.
export const CODE_LANGUAGES = ['js', 'python', 'go', 'rust'];
export const DEFAULT_CODE_LANGUAGE = 'js';
export const MAX_CODE_TOKEN = 24;
export const MIN_CODE_CHARS = 250;
export const MAX_CODE_CHARS = 500;

export const CODE_SNIPPETS = {
  js: [
    `export function debounce(fn, wait = 200) {
      let timer = null;
      const debounced = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          fn(...args);
        }, wait);
      };
      debounced.cancel = () => clearTimeout(timer);
      debounced.pending = () => timer !== null;
      return debounced;
    }`,
    `function groupBy(items, keyOf) {
      const groups = new Map();
      for (const item of items) {
        const key = keyOf(item);
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
      }
      return groups;
    }
    const byDay = groupBy(runs, (run) => run.at.slice(0, 10));
    const busiest = [...byDay].sort((a, b) => b[1].length - a[1].length)[0];`,
    `async function fetchJson(url, { retries = 3, delay = 250 } = {}) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
          return await res.json();
        } catch (error) {
          if (attempt >= retries) throw error;
          const wait = delay * 2 ** attempt;
          await new Promise((done) => setTimeout(done, wait));
        }
      }
    }`,
    `class LruCache {
      constructor(limit = 100) {
        this.limit = limit;
        this.map = new Map();
      }
      get(key) {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value);
        return value;
      }
      set(key, value) {
        this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size <= this.limit) return;
        const [oldest] = this.map.keys();
        this.map.delete(oldest);
      }
    }`,
    `export function createEmitter() {
      const handlers = new Map();
      return {
        on(type, handler) {
          const set = handlers.get(type) ?? new Set();
          handlers.set(type, set.add(handler));
          return () => set.delete(handler);
        },
        emit(type, payload) {
          const set = handlers.get(type) ?? [];
          for (const handler of set) handler(payload);
        },
      };
    }`,
    `export function wordsPerMinute(keys, elapsedMs) {
      if (elapsedMs <= 0) return 0;
      const correct = keys.filter((key) => key.ok).length;
      const minutes = elapsedMs / 60000;
      return Math.round(correct / 5 / minutes);
    }
    export function accuracy(keys) {
      if (!keys.length) return 100;
      const wrong = keys.filter((key) => !key.ok).length;
      return Math.round(((keys.length - wrong) / keys.length) * 100);
    }`,
    `const { search } = location;
    const q = new URLSearchParams(search);
    const size = Number(q.get("size") ?? 20);
    const filters = {
      page: Number(q.get("page") ?? 1),
      size: Math.min(size, 100),
      tags: q.getAll("tag")
        .map((tag) => tag.trim())
        .filter(Boolean),
      sort: q.get("sort") === "old" ? "asc" : "desc",
    };
    const tags = filters.tags.join(",");
    const next = new URLSearchParams({ ...filters, tags });
    history.pushState(null, "", \`?\${next}\`);`,
    `function lowerBound(sorted, target, compare = (a, b) => a - b) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compare(sorted[mid], target) < 0) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    const scores = [61, 74, 80, 92, 98];
    const at = lowerBound(scores, 87);
    scores.splice(at, 0, 87);`,
    `list.onclick = (event) => {
      const { target } = event;
      const row = target.closest("li");
      if (!row || !list.contains(row)) return;
      const { id } = row.dataset;
      const item = items.find((entry) => entry.id === id);
      item.done = !item.done;
      row.dataset.done = item.done;
      row.ariaChecked = String(item.done);
      save(items);
    };`,
    `export function formatDuration(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const pad = (n) => String(n).padStart(2, "0");
      const parts = hours ? [hours, pad(minutes)] : [minutes];
      return [...parts, pad(seconds)].join(":");
    }`,
    `const inventory = [
      { sku: "A-100", name: "lamp", stock: 4, price: 32 },
      { sku: "B-220", name: "desk", stock: 0, price: 180 },
      { sku: "C-310", name: "chair", stock: 12, price: 95 },
    ];
    const inStock = inventory.filter(({ stock }) => stock > 0);
    const value = inStock.reduce((sum, { stock, price }) => sum + stock * price, 0);
    const names = inStock.map(({ name }) => name).join(", ");
    console.log(\`\${names}: $\${value}\`);`,
    `export async function mapLimit(items, limit, task) {
      const results = new Array(items.length);
      let next = 0;
      async function worker() {
        while (next < items.length) {
          const index = next++;
          results[index] = await task(items[index], index);
        }
      }
      const count = Math.min(limit, items.length);
      await Promise.all(Array.from({ length: count }, worker));
      return results;
    }`,
    `const storage = window.localStorage;
    export const store = {
      read(key, fallback = null) {
        try {
          const raw = storage.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch {
          return fallback;
        }
      },
      write(key, value) {
        storage.setItem(key, JSON.stringify(value));
      },
    };
    const prefs = store.read("prefs", { theme: "dark" });`,
    `export function deepEqual(a, b) {
      if (Object.is(a, b)) return true;
      if (typeof a !== "object" || typeof b !== "object") return false;
      if (a === null || b === null) return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every((key) => deepEqual(a[key], b[key]));
    }`,
    `function* range(start, end, step = 1) {
      for (let n = start; n < end; n += step) yield n;
    }
    function* take(source, count) {
      if (count <= 0) return;
      for (const value of source) {
        yield value;
        if (--count === 0) return;
      }
    }
    const evens = [...take(range(0, Infinity, 2), 5)];
    const total = evens.reduce((sum, n) => sum + n, 0);`,
    `export function throttle(fn, interval = 100) {
      let last = 0;
      let pending = null;
      return function throttled(...args) {
        const now = performance.now();
        const wait = interval - (now - last);
        clearTimeout(pending);
        if (wait <= 0) {
          last = now;
          fn.apply(this, args);
        } else {
          pending = setTimeout(() => throttled.apply(this, args), wait);
        }
      };
    }`,
    `const form = document.forms.signup;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const { email } = data;
      if (!email.includes("@")) {
        form.dataset.error = "email";
        return;
      }
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      form.hidden = res.ok;
    };`,
    `export class Stack {
      #items = [];
      push(value) {
        this.#items.push(value);
        return this;
      }
      pop() {
        return this.#items.pop();
      }
      peek() {
        return this.#items.at(-1);
      }
      get size() {
        return this.#items.length;
      }
      *[Symbol.iterator]() {
        for (let i = this.size - 1; i >= 0; i -= 1) yield this.#items[i];
      }
    }`,
    `export function parseCsvLine(line) {
      const cells = [];
      let cell = "";
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) {
          cells.push(cell);
          cell = "";
        } else cell += char;
      }
      cells.push(cell);
      return cells.map((value) => value.trim());
    }`,
    `function reducer(state, action) {
      switch (action.type) {
        case "add":
          return { ...state, items: [...state.items, action.item] };
        case "remove":
          return { ...state, items: state.items.filter((i) => i.id !== action.id) };
        case "clear":
          return { ...state, items: [] };
        default:
          return state;
      }
    }`,
    `export function memoize(fn, keyOf = (...args) => args.join("|")) {
      const cache = new Map();
      return (...args) => {
        const key = keyOf(...args);
        if (cache.has(key)) return cache.get(key);
        const value = fn(...args);
        cache.set(key, value);
        return value;
      };
    }
    const distance = memoize((a, b) => levenshtein(a, b));
    const near = words.filter((w) => distance(w, typo) < 2);`,
    `export function pickWeighted(options, random = Math.random) {
      const total = options.reduce((sum, { weight }) => sum + weight, 0);
      let roll = random() * total;
      for (const option of options) {
        roll -= option.weight;
        if (roll < 0) return option.value;
      }
      return options.at(-1)?.value;
    }
    const tip = pickWeighted([
      { value: "rest", weight: 1 },
      { value: "drill", weight: 3 },
    ]);`,
    `export function shuffle(items, random = Math.random) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
    const deck = shuffle(["ace", "king", "queen", "jack", "ten"]);
    const [first, ...rest] = deck;`,
    `const timeout = (ms) => new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timed out")), ms);
    });
    export async function withTimeout(promise, ms = 5000) {
      return Promise.race([promise, timeout(ms)]);
    }
    try {
      const pending = loadUser(id);
      const user = await withTimeout(pending, 2000);
      render(user);
    } catch (error) {
      showError(error);
    }`,
  ],
  python: [
    `def word_counts(path: str, top: int = 10) -> list[tuple[str, int]]:
        assert top > 0, "top must be positive";
        raw = Path(path).read_text();
        words = re.findall(r"[a-z']+", raw.lower());
        counts = Counter(w for w in words if len(w) > 2);
        return counts.most_common(top)`,
    `def describe(values: list[float]) -> dict[str, float]:
        count = len(values) or 1;
        mean = sum(values) / count;
        variance = sum((v - mean) ** 2 for v in values) / count;
        spread = variance ** 0.5;
        return {"mean": round(mean, 2), "spread": round(spread, 2), "count": count}`,
    `env = os.environ;
    config = {
        "host": env.get("HOST", "localhost"),
        "port": int(env.get("PORT", "8080")),
        "debug": env.get("DEBUG") == "1",
        "workers": max(1, (os.cpu_count() or 2) // 2),
        "origins": env.get("ORIGINS", "").split(","),
        "log_level": env.get("LOG_LEVEL", "info").upper(),
    }`,
    `with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle);
        rows = list(reader);
        teams = sorted({row["team"] for row in rows});
        totals = {t: sum(int(r["score"]) for r in rows if r["team"] == t) for t in teams};
        leader = max(teams, key=totals.get, default=None)`,
    `class Settings(NamedTuple):
        theme: str = "dark";
        accent: str = "green";
        font_size: int = 16;
        sound: bool = False;
        volume: float = 0.5;
        layout: str = "qwerty";
        goal_minutes: int = 10;
        languages: tuple[str, ...] = ("en",);
        shortcuts: dict[str, str] | None = None`,
    `import json;
    from pathlib import Path;
    path = Path("runs.json");
    text = path.read_text();
    runs = json.loads(text);
    fast = [run for run in runs if run["wpm"] >= 80];
    by_day = {run["day"]: run["wpm"] for run in fast};
    best_day = max(by_day, key=by_day.get, default="none");
    print(f"{len(fast)} fast runs on {len(by_day)} days, best {best_day}")`,
    `parser = ArgumentParser();
    add = parser.add_argument;
    add("paths", nargs="+", type=Path);
    add("--width", type=int, default=1200);
    add("--quality", type=int, default=85);
    add("--format", choices=["jpeg", "png", "webp"]);
    add("--dry-run", action="store_true");
    args = parser.parse_args()`,
    `logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    );
    log = getLogger("sync");
    log.info("starting with %d workers", workers);
    log.debug("config: %s", config);
    log.warning("retrying %s in %.1fs", url, delay)`,
    `scores = {"ada": 92, "lin": 88, "kai": 95, "noor": 88, "sam": 71};
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]));
    lines = [f"{i}. {name:<5} {wpm:>3} wpm" for i, (name, wpm) in enumerate(ranked, 1)];
    podium = "\\n".join(lines[:3]);
    print(podium)`,
    `class Color(Enum):
        RED = "#e5484d";
        ORANGE = "#f76b15";
        YELLOW = "#ffc53d";
        GREEN = "#30a46c";
        TEAL = "#12a594";
        BLUE = "#0090ff";
        INDIGO = "#3e63dd";
        VIOLET = "#6e56cf";
        PINK = "#d6409f";
        BROWN = "#ad7f58";
        SKY = "#7ce2fe";
        MINT = "#86ead4";
        LIME = "#bdee63";
        GRAY = "#8b8d98"`,
    `root = Path.home() / "projects";
    files = [p for p in root.rglob("*.py") if p.is_file()];
    sizes = {p: p.stat().st_size for p in files};
    largest = sorted(sizes, key=sizes.get, reverse=True)[:5];
    total_kb = sum(sizes.values()) / 1024;
    print(f"{len(files)} files, {total_kb:.0f} KB, largest {largest[0].name}")`,
    `today = date.today();
    weekday = today.weekday();
    monday = today - timedelta(days=weekday);
    week = [monday + timedelta(days=n) for n in range(7)];
    labels = [d.strftime("%a %d %b") for d in week];
    weekend = [d for d in week if d.weekday() >= 5];
    print(f"{labels[0]} to {labels[-1]}, {len(weekend)} days off")`,
    `day_of = itemgetter("day");
    runs.sort(key=day_of);
    by_day = {day: list(group) for day, group in groupby(runs, day_of)};
    best = {day: max(r["wpm"] for r in group) for day, group in by_day.items()};
    recent = sorted(best, reverse=True)[:7];
    average = sum(best[day] for day in recent) / max(len(recent), 1)`,
    `async def fetch_all(session, urls: list[str]) -> list[str]:
        tasks = [fetch(session, url) for url in urls];
        results = await asyncio.gather(*tasks, return_exceptions=True);
        failed = sum(isinstance(r, Exception) for r in results);
        log.info("fetched %d of %d", len(urls) - failed, len(urls));
        return [r for r in results if not isinstance(r, Exception)]`,
    `RULES = {
        "email": r"^[^@ ]+@[^@ ]+$",
        "slug": r"^[a-z0-9-]+$",
        "hex": r"^#[0-9a-fA-F]{6}$",
        "year": r"^(19|20)[0-9]{2}$",
        "time": r"^[0-9]{2}:[0-9]{2}$",
    };
    COMPILED = {name: re.compile(rule) for name, rule in RULES.items()};
    checks = {name: bool(p.match(value)) for name, p in COMPILED.items()}`,
    `before = set(old_text.split());
    after = set(new_text.split());
    added = sorted(after - before);
    removed = sorted(before - after);
    changed = len(added) + len(removed);
    ratio = 1 - changed / max(len(before | after), 1);
    print(f"+{len(added)} -{len(removed)}, {ratio:.0%} kept")`,
    `while queue:
        node = queue.popleft();
        order.append(node);
        nexts = [n for n in graph.get(node, ()) if n not in depth];
        depth.update({n: depth[node] + 1 for n in nexts});
        parent.update({n: node for n in nexts});
        queue.extend(nexts);
        farthest = max(farthest, depth[node])`,
    `def summary(run: dict) -> str:
        minutes = run["ms"] / 60000;
        assert minutes > 0, "empty run";
        wpm = run["chars"] / 5 / minutes;
        acc = 100 * run["correct"] / max(run["chars"], 1);
        iso = run["day"];
        day = date.fromisoformat(iso);
        return f"{day:%a %d %b} {wpm:5.1f} wpm {acc:5.1f}%"`,
    `temps = [12.5, 14.0, 13.2, 16.8, 18.1, 17.4, 15.9];
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    pairs = list(zip(days, temps));
    warmest = max(pairs, key=lambda p: p[1]);
    deltas = [round(b - a, 1) for a, b in zip(temps, temps[1:])];
    rising = sum(d > 0 for d in deltas)`,
    `out = subprocess.run(
        ["git", "log", "--since=1 week", "--no-merges", "--pretty=%an"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout;
    names = out.splitlines();
    authors = Counter(names);
    top = ", ".join(f"{name} ({n})" for name, n in authors.most_common(3))`,
    `OPERATORS = {
        "+": lambda a, b: a + b,
        "-": lambda a, b: a - b,
        "*": lambda a, b: a * b,
        "/": lambda a, b: a / b if b else float("nan"),
        "%": lambda a, b: a % b if b else float("nan"),
        "^": lambda a, b: a ** b,
    };
    results = {op: f(6, 3) for op, f in OPERATORS.items()}`,
    `def slugify(title: str, limit: int = 60) -> str:
        plain = normalize("NFKD", title);
        plain = plain.encode("ascii", "ignore").decode();
        words = re.findall(r"[a-z0-9]+", plain.lower());
        slug = "-".join(words)[:limit];
        return slug.rstrip("-") or "untitled"`,
    `alphabet = string.ascii_letters + string.digits;
    token = "".join(choice(alphabet) for _ in range(32));
    raw = token.encode();
    digest = sha256(raw).hexdigest();
    expires = datetime.now(UTC) + timedelta(hours=1);
    record = {"digest": digest, "expires": expires.isoformat()}`,
    `def strong_password(text: str) -> bool:
        checks = [
            len(text) >= 12,
            any(c.isupper() for c in text),
            any(c.islower() for c in text),
            any(c.isdigit() for c in text),
            not any(c.isspace() for c in text),
            len(set(text)) >= 6,
            text.lower() not in COMMON,
        ];
        return all(checks)`,
    `cents = Decimal("0.01");
    rate = Decimal("0.0825");
    prices = [Decimal(p) for p in ("19.99", "5.25", "12.00")];
    subtotal = sum(prices, Decimal(0));
    tax = (subtotal * rate).quantize(cents);
    total = subtotal + tax;
    print(f"subtotal {subtotal} tax {tax} total {total}")`,
    `grid = [
        [3, 8, 1, 9],
        [4, 2, 7, 5],
        [6, 0, 2, 8],
    ];
    columns = [list(col) for col in zip(*grid)];
    row_sums = [sum(row) for row in grid];
    col_max = [max(col) for col in columns];
    flat = sorted(n for row in grid for n in row);
    median = flat[len(flat) // 2]`,
  ],
  go: [
    `type Counter struct {
        mu sync.Mutex;
        counts map[string]int
    };
    func NewCounter() *Counter {
        return &Counter{counts: map[string]int{}}
    };
    func (c *Counter) Add(key string) {
        c.mu.Lock();
        defer c.mu.Unlock();
        c.counts[key]++
    };
    func (c *Counter) Get(key string) int {
        c.mu.Lock();
        defer c.mu.Unlock();
        return c.counts[key]
    }`,
    `func health(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
            http.Error(w, "method not allowed", 405);
            return
        };
        h := w.Header();
        h.Set("Content-Type", "application/json");
        body := map[string]any{
            "status": "ok",
            "uptime": uptime.String(),
        };
        enc := json.NewEncoder(w);
        enc.Encode(body)
    }`,
    `func readLines(path string) ([]string, error) {
        f, err := os.Open(path);
        if err != nil {
            return nil, err
        };
        defer f.Close();
        var lines []string;
        scanner := bufio.NewScanner(f);
        for scanner.Scan() {
            lines = append(lines, scanner.Text())
        };
        return lines, scanner.Err()
    }`,
    `var ErrNotFound = errors.New("not found");
    type QueryError struct {
        Query string;
        Err error
    };
    func (e *QueryError) Error() string {
        return fmt.Sprintf("query %q: %v", e.Query, e.Err)
    };
    func (e *QueryError) Unwrap() error {
        return e.Err
    };
    func find(id string) error {
        return &QueryError{Query: id, Err: ErrNotFound}
    }`,
    `jobs := make(chan int, len(ids));
    results := make(chan string, len(ids));
    var wg sync.WaitGroup;
    for w := 0; w < 4; w++ {
        wg.Add(1);
        go func() {
            defer wg.Done();
            for id := range jobs {
                results <- fetch(id)
            }
        }()
    };
    for _, id := range ids {
        jobs <- id
    };
    close(jobs);
    wg.Wait();
    close(results)`,
    `ctx, cancel := context.WithTimeout(ctx, 2*time.Second);
    defer cancel();
    done := make(chan *Result, 1);
    go func() {
        done <- lookup(name)
    }();
    select {
    case res := <-done:
        return res, nil;
    case <-ctx.Done():
        return nil, fmt.Errorf("lookup %s: %w", name, ctx.Err())
    }`,
    `func TestClamp(t *testing.T) {
        cases := []struct {
            n, lo, hi, want int
        }{
            {5, 0, 10, 5},
            {-3, 0, 10, 0},
            {42, 0, 10, 10},
        };
        for _, c := range cases {
            if got := Clamp(c.n, c.lo, c.hi); got != c.want {
                t.Errorf("Clamp(%d) = %d, want %d", c.n, got, c.want)
            }
        }
    }`,
    `type Level int;
    const (
        Debug Level = iota;
        Info;
        Warn;
        Error
    );
    func (l Level) String() string {
        switch l {
        case Debug:
            return "debug";
        case Info:
            return "info";
        case Warn:
            return "warn"
        };
        return "error"
    };
    func (l Level) Enabled(floor Level) bool {
        return l >= floor
    }`,
    `runs = slices.DeleteFunc(runs, func(r Run) bool {
        return r.WPM == 0
    });
    slices.SortFunc(runs, func(a, b Run) int {
        if c := cmp.Compare(b.WPM, a.WPM); c != 0 {
            return c
        };
        return a.At.Compare(b.At)
    });
    top := runs[:min(3, len(runs))];
    for i, r := range top {
        fmt.Printf("%d. %s %.1f\\n", i+1, r.Name, r.WPM)
    }`,
    `type Config struct {
        Addr string \`json:"addr"\`;
        Timeout time.Duration \`json:"timeout"\`;
        Debug bool \`json:"debug,omitempty"\`
    };
    func loadConfig(r io.Reader) (Config, error) {
        cfg := Config{Addr: ":8080", Timeout: 5 * time.Second};
        dec := json.NewDecoder(r);
        err := dec.Decode(&cfg);
        return cfg, err
    }`,
    `func titleJoin(words []string, sep string) string {
        var b strings.Builder;
        for i, w := range words {
            if w == "" {
                continue
            };
            if i > 0 {
                b.WriteString(sep)
            };
            first := strings.ToUpper(w[:1]);
            b.WriteString(first);
            b.WriteString(w[1:])
        };
        return b.String()
    }`,
    `func wordFreq(text string) map[string]int {
        freq := make(map[string]int);
        for _, w := range strings.Fields(text) {
            w = strings.Trim(w, ".,;:!?");
            w = strings.ToLower(w);
            if w != "" {
                freq[w]++
            }
        };
        return freq
    };
    func topWord(freq map[string]int) (string, int) {
        best, n := "", 0;
        for w, c := range freq {
            if c > n {
                best, n = w, c
            }
        };
        return best, n
    }`,
    `func Map[T, U any](xs []T, f func(T) U) []U {
        out := make([]U, 0, len(xs));
        for _, x := range xs {
            out = append(out, f(x))
        };
        return out
    };
    func Filter[T any](xs []T, keep func(T) bool) []T {
        var out []T;
        for _, x := range xs {
            if keep(x) {
                out = append(out, x)
            }
        };
        return out
    }`,
    `every := 500 * time.Millisecond;
    ticker := time.NewTicker(every);
    defer ticker.Stop();
    log.Printf("polling every %v", every);
    for {
        select {
        case <-ctx.Done():
            return ctx.Err();
        case t := <-ticker.C:
            if err := poll(t); err != nil {
                log.Printf("poll at %v: %v", t, err)
            }
        }
    }`,
    `type Shape interface {
        Area() float64;
        Perimeter() float64
    };
    type Rect struct{ W, H float64 };
    func (r Rect) Area() float64 { return r.W * r.H };
    func (r Rect) Perimeter() float64 { return 2 * (r.W + r.H) };
    type Circle struct{ R float64 };
    func (c Circle) Area() float64 { return math.Pi * c.R * c.R };
    func (c Circle) Perimeter() float64 { return 2 * math.Pi * c.R }`,
    `func logRequests(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if r.URL.Path == "/healthz" {
                next.ServeHTTP(w, r);
                return
            };
            start := time.Now();
            next.ServeHTTP(w, r);
            log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
        })
    }`,
    `func search(xs []int, target int) int {
        lo, hi := 0, len(xs);
        for lo < hi {
            mid := int(uint(lo+hi) >> 1);
            if xs[mid] < target {
                lo = mid + 1
            } else {
                hi = mid
            }
        };
        if lo < len(xs) && xs[lo] == target {
            return lo
        };
        return -1
    };
    var at = search([]int{1, 3, 5, 7, 9}, 7)`,
    `type Stack[T any] struct {
        items []T
    };
    func (s *Stack[T]) Push(v T) {
        s.items = append(s.items, v)
    };
    func (s *Stack[T]) Pop() (T, bool) {
        var zero T;
        if len(s.items) == 0 {
            return zero, false
        };
        last := len(s.items) - 1;
        v := s.items[last];
        s.items = s.items[:last];
        return v, true
    }`,
    `cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD");
    cmd.Dir = repo;
    out, err := cmd.Output();
    if err != nil {
        return "", fmt.Errorf("rev-parse in %s: %w", repo, err)
    };
    text := string(out);
    sha := strings.TrimSpace(text);
    if len(sha) < 7 {
        return "", errors.New("short sha")
    };
    return sha[:7], nil`,
    `var (
        loadOnce sync.Once;
        names map[string]string;
        loadErr error
    );
    func lookup(key string) (string, error) {
        loadOnce.Do(func() {
            names, loadErr = loadFile("names.json")
        });
        if loadErr != nil {
            return "", loadErr
        };
        name, ok := names[key];
        if !ok {
            return "", fmt.Errorf("no name for %q", key)
        };
        return name, nil
    }`,
    `type Limiter struct {
        mu sync.Mutex;
        last time.Time;
        every time.Duration
    };
    func NewLimiter(every time.Duration) *Limiter {
        return &Limiter{every: every}
    };
    func (l *Limiter) Allow() bool {
        l.mu.Lock();
        defer l.mu.Unlock();
        now := time.Now();
        if now.Sub(l.last) < l.every {
            return false
        };
        l.last = now;
        return true
    }`,
    `type Money struct {
        Cents int64;
        Currency string
    };
    func (m Money) Add(o Money) (Money, error) {
        if m.Currency != o.Currency {
            return Money{}, fmt.Errorf("mixed %s and %s", m.Currency, o.Currency)
        };
        return Money{m.Cents + o.Cents, m.Currency}, nil
    };
    func (m Money) String() string {
        return fmt.Sprintf("%d.%02d %s", m.Cents/100, m.Cents%100, m.Currency)
    }`,
    `func reverse(s string) string {
        r := []rune(s);
        for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
            r[i], r[j] = r[j], r[i]
        };
        return string(r)
    };
    func isPalindrome(s string) bool {
        clean := strings.ReplaceAll(s, " ", "");
        clean = strings.ToLower(clean);
        return clean == reverse(clean)
    }`,
    `var (
        mu sync.Mutex;
        wg sync.WaitGroup;
        sizes = map[string]int64{}
    );
    for _, path := range paths {
        wg.Add(1);
        go func() {
            defer wg.Done();
            info, err := os.Stat(path);
            if err != nil {
                return
            };
            mu.Lock();
            sizes[path] = info.Size();
            mu.Unlock()
        }()
    };
    wg.Wait()`,
  ],
  rust: [
    `#[derive(Debug, Clone, PartialEq)]
    struct Run {
        wpm: f64,
        accuracy: f64,
        words: u32,
    }
    impl fmt::Display for Run {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            let Run { wpm, accuracy, words } = self;
            write!(f, "{wpm:.1} wpm, {accuracy:.0}% over {words} words")
        }
    }`,
    `enum Command {
        Move { x: i32, y: i32 },
        Say(String),
        Quit,
    }
    fn describe(cmd: &Command) -> String {
        match cmd {
            Command::Move { x: 0, y: 0 } => "stay".into(),
            Command::Move { x, y } => format!("move to ({x}, {y})"),
            Command::Say(text) => format!("say {text:?}"),
            Command::Quit => "quit".to_string(),
        }
    }`,
    `fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
        let mut m = HashMap::new();
        for word in text.split_whitespace() {
            let w = word.to_lowercase();
            *m.entry(w).or_insert(0) += 1;
        }
        let mut pairs = Vec::from_iter(m);
        pairs.sort_by_key(|(w, c)| (Reverse(*c), w.clone()));
        pairs.truncate(n);
        pairs
    }`,
    `#[derive(Debug)]
    enum ParseError {
        Empty,
        Bad(ParseIntError),
    }
    impl From<ParseIntError> for ParseError {
        fn from(e: ParseIntError) -> Self {
            ParseError::Bad(e)
        }
    }
    fn parse_sum(line: &str) -> Result<i64, ParseError> {
        if line.trim().is_empty() {
            return Err(ParseError::Empty);
        }
        let mut total = 0;
        for part in line.split(',') {
            let n: i64 = part.trim().parse()?;
            total += n;
        }
        Ok(total)
    }`,
    `struct Fibonacci {
        curr: u64,
        next: u64,
    }
    impl Iterator for Fibonacci {
        type Item = u64;
        fn next(&mut self) -> Option<Self::Item> {
            let (a, b) = (self.curr, self.next);
            self.curr = b;
            self.next = a.checked_add(b)?;
            Some(a)
        }
    }
    let fib = Fibonacci { curr: 0, next: 1 };
    let evens: Vec<u64> = fib.filter(|n| n % 2 == 0).take(5).collect();`,
    `trait Shape {
        fn area(&self) -> f64;
        fn describe(&self) -> String {
            format!("shape with area {:.2}", self.area())
        }
    }
    struct Square(f64);
    struct Circle(f64);
    impl Shape for Square {
        fn area(&self) -> f64 { self.0 * self.0 }
    }
    impl Shape for Circle {
        fn area(&self) -> f64 { PI * self.0 * self.0 }
    }
    fn total_area(shapes: &[Box<dyn Shape>]) -> f64 {
        shapes.iter().map(|s| s.area()).sum()
    }`,
    `fn read_numbers(path: &Path) -> io::Result<Vec<i64>> {
        let file = File::open(path)?;
        let mut numbers = Vec::new();
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line?;
            if let Ok(n) = line.trim().parse() {
                numbers.push(n);
            }
        }
        Ok(numbers)
    }`,
    `fn initials(name: &str) -> String {
        name.split_whitespace()
            .filter_map(|part| part.chars().next())
            .flat_map(|c| c.to_uppercase())
            .collect()
    }
    fn short_name(name: &str) -> Option<String> {
        let mut parts = name.split_whitespace();
        let first = parts.next()?;
        let last = parts.last()?;
        let letter = last.chars().next()?;
        Some(format!("{first} {letter}."))
    }
    assert_eq!(initials("ada king lovelace"), "AKL");`,
    `fn largest<T: PartialOrd + Copy>(items: &[T]) -> Option<T> {
        let mut iter = items.iter().copied();
        let first = iter.next()?;
        Some(iter.fold(first, |best, x| if x > best { x } else { best }))
    }
    fn clamp_all<T: Ord + Copy>(items: &mut [T], lo: T, hi: T) {
        for item in items.iter_mut() {
            *item = (*item).clamp(lo, hi);
        }
    }`,
    `let (tx, rx) = mpsc::channel();
    for id in 0..4u64 {
        let tx = tx.clone();
        thread::spawn(move || {
            let sum: u64 = (id * 1000..(id + 1) * 1000).sum();
            tx.send((id, sum)).unwrap();
        });
    }
    drop(tx);
    let mut totals: Vec<(u64, u64)> = rx.iter().collect();
    totals.sort();`,
    `let count = Arc::new(Mutex::new(0));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let count = Arc::clone(&count);
            thread::spawn(move || {
                for _ in 0..1000 {
                    *count.lock().unwrap() += 1;
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let total = *count.lock().unwrap();
    assert_eq!(total, 8000);`,
    `#[derive(Default)]
    struct Request {
        url: String,
        headers: Vec<(String, String)>,
        timeout: Option<Duration>,
    }
    impl Request {
        fn new(url: &str) -> Self {
            Self { url: url.into(), ..Default::default() }
        }
        fn header(mut self, key: &str, value: &str) -> Self {
            let pair = (key.to_string(), value.to_string());
            self.headers.push(pair);
            self
        }
        fn timeout(mut self, d: Duration) -> Self {
            self.timeout = Some(d);
            self
        }
    }`,
    `struct Words<'a> {
        input: &'a str,
        pos: usize,
    }
    impl<'a> Iterator for Words<'a> {
        type Item = &'a str;
        fn next(&mut self) -> Option<&'a str> {
            let rest = &self.input[self.pos..];
            let rest = rest.trim_start();
            if rest.is_empty() {
                return None;
            }
            let start = self.input.len() - rest.len();
            let len = match rest.find(' ') {
                Some(i) => i,
                None => rest.len(),
            };
            self.pos = start + len;
            Some(&rest[..len])
        }
    }`,
    `let was: HashSet<&str> = old.split(' ').collect();
    let now: HashSet<&str> = new.split(' ').collect();
    let added = &now - &was;
    let removed = &was - &now;
    let kept = (&now & &was).len();
    let mut list: Vec<_> = added.iter().collect();
    list.sort();
    println!("+{} -{} ={kept}", added.len(), removed.len());
    println!("new: {list:?}");`,
    `let mut players = vec![("ada", 92), ("lin", 88), ("kai", 95), ("noor", 88)];
    players.sort_by_key(|p| (Reverse(p.1), p.0));
    let podium: Vec<String> = players
        .iter()
        .take(3)
        .enumerate()
        .map(|(i, (name, score))| format!("{}. {name} {score}", i + 1))
        .collect();`,
    `fn make_scaler(factor: f64) -> impl Fn(f64) -> f64 {
        move |x| x * factor
    }
    fn compose<A, B, C>(
        f: impl Fn(A) -> B,
        g: impl Fn(B) -> C,
    ) -> impl Fn(A) -> C {
        move |x| g(f(x))
    }
    let to_cm = make_scaler(2.54);
    let double = make_scaler(2.0);
    let both = compose(to_cm, double);
    assert_eq!(both(1.0), 5.08);`,
    `fn summarize(scores: &[u32]) -> String {
        match scores {
            [] => "no runs yet".to_string(),
            [only] => format!("one run at {only} wpm"),
            [first, .., last] if last > first => {
                format!("up from {first} to {last} wpm")
            }
            [first, .., last] => format!("{first} then {last} wpm"),
        }
    }`,
    `fn caesar(text: &str, shift: u8) -> String {
        let rotate = |c: char, base: u8| {
            ((c as u8 - base + shift) % 26 + base) as char
        };
        text.chars()
            .map(|c| match c {
                'a'..='z' => rotate(c, b'a'),
                'A'..='Z' => rotate(c, b'A'),
                _ => c,
            })
            .collect()
    }
    assert_eq!(caesar("Hal", 1), "Ibm");`,
    `fn find(sorted: &[i32], target: i32) -> Option<usize> {
        let (mut lo, mut hi) = (0, sorted.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            match sorted[mid].cmp(&target) {
                Ordering::Less => lo = mid + 1,
                Ordering::Greater => hi = mid,
                Ordering::Equal => return Some(mid),
            }
        }
        None
    }`,
    `#[derive(Debug, PartialEq)]
    struct Rgb(u8, u8, u8);
    impl FromStr for Rgb {
        type Err = String;
        fn from_str(s: &str) -> Result<Self, Self::Err> {
            let Some(hex) = s.strip_prefix('#') else {
                return Err("no #".into());
            };
            if hex.len() != 6 {
                return Err(format!("bad length: {s}"));
            }
            let part = |i: usize| {
                let pair = &hex[i..i + 2];
                u8::from_str_radix(pair, 16).map_err(|e| e.to_string())
            };
            Ok(Rgb(part(0)?, part(2)?, part(4)?))
        }
    }`,
    `let mut tasks = vec![
        Task { id: 3, done: false, title: "write tests" },
        Task { id: 1, done: true, title: "fix login" },
        Task { id: 2, done: false, title: "update docs" },
    ];
    tasks.retain(|t| !t.done);
    tasks.sort_by_key(|t| t.id);
    let titles: Vec<&str> = tasks.iter().map(|t| t.title).collect();
    println!("{} open: {}", titles.len(), titles.join(", "));`,
    `enum Tree {
        Leaf(i32),
        Node(Box<Tree>, Box<Tree>),
    }
    impl Tree {
        fn sum(&self) -> i32 {
            match self {
                Tree::Leaf(v) => *v,
                Tree::Node(l, r) => l.sum() + r.sum(),
            }
        }
        fn depth(&self) -> usize {
            match self {
                Tree::Leaf(_) => 1,
                Tree::Node(l, r) => 1 + max(l.depth(), r.depth()),
            }
        }
    }`,
    `let start = Instant::now();
    let mut primes: Vec<u32> = Vec::new();
    for n in 2..10_000u32 {
        let known = primes.iter();
        let limit = n.isqrt();
        if known.take_while(|&&p| p <= limit).all(|&p| n % p != 0) {
            primes.push(n);
        }
    }
    let elapsed = start.elapsed();
    println!("{} primes in {elapsed:.2?}", primes.len());`,
    `const MAX_RETRIES: u32 = 5;
    #[derive(Debug, Clone)]
    struct Config {
        host: String,
        port: u16,
        retries: u32,
        verbose: bool,
    }
    impl Default for Config {
        fn default() -> Self {
            Self {
                host: "127.0.0.1".to_string(),
                port: 8080,
                retries: MAX_RETRIES,
                verbose: false,
            }
        }
    }
    let config = Config { verbose: true, ..Config::default() };`,
  ],
};

// Strip each line's leading indentation and join the lines with one space.
export function unindent(snippet) {
  return snippet.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
}

function textId(text) {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);

  return (hash >>> 0).toString(36);
}

export function codePassage(language = DEFAULT_CODE_LANGUAGE, { seenIds = [], random = Math.random } = {}) {
  const lang = CODE_LANGUAGES.includes(language) ? language : DEFAULT_CODE_LANGUAGE;
  const seen = new Set(seenIds);

  const all = CODE_SNIPPETS[lang].map((snippet) => {
    const text = unindent(snippet);

    return { id: `code-${lang}-${textId(text)}`, text };
  });

  const fresh = all.filter((item) => !seen.has(item.id));
  const pool = fresh.length ? fresh : all;
  const item = pool[Math.floor(random() * pool.length)];

  return { ...item, textVersion: `${item.id}@1`, difficulty: 'code', language: lang, fresh: fresh.length > 0, exhausted: fresh.length === 0 };
}
