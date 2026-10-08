// Short original code snippets for code mode. The engine has no line breaks, so each snippet is
// auto-unindented and its lines are joined with a single space, and must still be valid code once
// joined (in Python, only simple statements after a colon). Tokens stay at MAX_CODE_TOKEN
// characters or fewer so they rarely have to break mid-token on a narrow screen.
export const CODE_LANGUAGES = ['js', 'python', 'go', 'rust'];
export const DEFAULT_CODE_LANGUAGE = 'js';
export const MAX_CODE_TOKEN = 24;

export const CODE_SNIPPETS = {
  js: [
    `const total = items.reduce((sum, { price, qty }) => sum + price * qty, 0);`,
    `if (!isAdmin(user)) {
      return res.status(403).json({ error: "forbidden" });
    }`,
    `const byId = new Map(rows.map((row) => [row.id, row]));`,
    `for (let i = 0; i < grid.length; i += 1) {
      grid[i] = grid[i].filter((cell) => cell !== null);
    }`,
    `export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));`,
    `const res = await fetch(\`/runs?n=\${n}\`);
    const { data, error } = await res.json();`,
  ],
  python: [
    `def mean(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0`,
    `counts = {word: text.count(word) for word in set(text.split())}`,
    `with open(path, "r", encoding="utf-8") as handle:
        lines = [line.strip() for line in handle if line]`,
    `if __name__ == "__main__":
        main(sys.argv[1:])`,
    `pairs = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:10]`,
    `while stack:
        seen.add(stack.pop())`,
  ],
  go: [
    `func add(a, b int) int {
        return a + b
    }`,
    `if err != nil {
        return nil, fmt.Errorf("load %s: %w", name, err)
    }`,
    `seen := make(map[string]bool, len(keys))`,
    `for i, v := range values {
        out[i] = v * v
    }`,
    `type Run struct {
        WPM int \`json:"wpm"\`
    }`,
    `ch := make(chan int, 8); go func() { ch <- 42 }()`,
  ],
  rust: [
    `fn max_of(xs: &[i32]) -> Option<i32> {
        xs.iter().copied().max()
    }`,
    `let rows: Vec<&str> = text.lines().collect();`,
    `match cmd.as_str() {
        "quit" => break,
        _ => println!("unknown: {}", cmd),
    }`,
    `let mut map: HashMap<String, u32> = HashMap::new();`,
    `impl Default for Config {
        fn default() -> Self { Self { depth: 3 } }
    }`,
    `let total: u64 = nums.iter().filter(|&&n| n % 2 == 0).sum();`,
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
