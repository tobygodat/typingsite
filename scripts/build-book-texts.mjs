// Builds src/book-texts.js from Project Gutenberg plain-text eBooks.
//
//   node scripts/build-book-texts.mjs <dir>
//
// <dir> holds the eBooks as downloaded from https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt:
// pg11.txt, pg1342.txt, pg1661.txt and pg84.txt. Only the opening sections listed below are kept.
// The words are not edited. Normalisation only makes the text typable on a plain keyboard:
// the Gutenberg header, footer and licence go; so do illustration captions, scene-break asterisks
// and the _underscores_ that mark italics; curly quotes become ' and ", an em dash becomes --,
// accented letters lose their accents (Alice's "Ou est ma chatte?"), and line breaks become single
// spaces. Paragraphs stay separate so pages can end on them; the app joins them with one space.
// Anything else outside printable ASCII stops the build, so a new source can't slip in a character
// the typing engine would mis-score.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCES = [
  {
    id: 'alice', file: 'pg11.txt', gutenberg: 11,
    sections: [
      { heading: /^CHAPTER I\.$/, label: 'Chapter I', titleLine: true },
      { heading: /^CHAPTER II\.$/, label: 'Chapter II', titleLine: true },
    ],
    end: /^CHAPTER III\.$/,
  },
  {
    id: 'pride', file: 'pg1342.txt', gutenberg: 1342,
    sections: [
      // Chapter I's heading closes the frontispiece illustration block.
      { heading: /^Chapter I\.\]$/, label: 'Chapter I' },
      { heading: /^CHAPTER II\.$/, label: 'Chapter II' },
    ],
    end: /^CHAPTER III\.$/,
  },
  {
    id: 'sherlock', file: 'pg1661.txt', gutenberg: 1661,
    after: /^I\. A SCANDAL IN BOHEMIA$/,
    sections: [
      { heading: /^I\.$/, label: 'Part I', title: 'A Scandal in Bohemia' },
      { heading: /^II\.$/, label: 'Part II', title: 'A Scandal in Bohemia' },
    ],
    end: /^III\.$/,
  },
  {
    id: 'frankenstein', file: 'pg84.txt', gutenberg: 84,
    sections: [
      { heading: /^Letter 1$/, label: 'Letter 1' },
      { heading: /^Letter 2$/, label: 'Letter 2' },
    ],
    end: /^Letter 3$/,
  },
];

const REPLACEMENTS = [
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/—/g, '--'],
  [/–/g, '-'],
  [/…/g, '...'],
];

function findLine(lines, pattern, from = 0) {
  const index = lines.findIndex((line, i) => i >= from && pattern.test(line));
  if (index < 0) throw new Error(`No line matches ${pattern} after line ${from + 1}`);
  return index;
}

// Removes [Illustration ...] blocks, which can span lines and nest a [_Copyright ..._] note.
function stripIllustrations(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('[Illustration', i)) {
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === '[') depth += 1;
        else if (text[j] === ']') { depth -= 1; if (depth === 0) break; }
      }
      if (depth !== 0) throw new Error('Unbalanced illustration block');
      i = j + 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// One section's raw lines in, its paragraphs out. Pagination prefers paragraph ends, so they're kept.
export function normalise(raw) {
  let text = stripIllustrations(raw)
    .split('\n')
    .filter((line) => !/^[\s*]+$/.test(line) || !line.includes('*'))
    .join('\n')
    .replace(/_([^_]+)_/g, '$1');
  for (const [pattern, value] of REPLACEMENTS) text = text.replace(pattern, value);
  const paragraphs = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined = paragraphs.join(' ');
  const unsupported = [...new Set(joined.match(/[^\x20-\x7e]/g) || [])];
  if (unsupported.length) throw new Error(`Unsupported characters: ${unsupported.map((c) => `U+${c.codePointAt(0).toString(16)}`).join(' ')}`);
  if (/[_[\]]/.test(joined)) throw new Error('Leftover markup');
  return paragraphs;
}

async function build(dir) {
  const books = {};
  for (const source of SOURCES) {
    const raw = (await readFile(path.join(dir, source.file), 'utf8')).replace(/\r/g, '');
    const all = raw.split('\n');
    const start = findLine(all, /^\*\*\* START OF THE PROJECT GUTENBERG EBOOK /);
    const stop = findLine(all, /^\*\*\* END OF THE PROJECT GUTENBERG EBOOK /, start);
    const lines = all.slice(start + 1, stop);
    let cursor = source.after ? findLine(lines, source.after) + 1 : 0;
    const starts = source.sections.map((section) => (cursor = findLine(lines, section.heading, cursor) + 1) - 1);
    const end = findLine(lines, source.end, cursor);
    books[source.id] = source.sections.map((section, i) => {
      let from = starts[i] + 1;
      let title = section.title || '';
      if (section.titleLine) {
        from = findLine(lines, /\S/, from);
        title = lines[from].trim();
        from += 1;
      }
      const paragraphs = normalise(lines.slice(from, starts[i + 1] ?? end).join('\n'));
      return { label: section.label, title, paragraphs };
    });
  }
  const body = Object.entries(books).map(([id, sections]) => `  ${id}: [\n${sections.map((s) => `    { label: ${JSON.stringify(s.label)}, title: ${JSON.stringify(s.title)},\n      paragraphs: [\n${s.paragraphs.map((p) => `        ${JSON.stringify(p)},`).join('\n')}\n      ] },`).join('\n')}\n  ],`).join('\n');
  const output = `// Generated by scripts/build-book-texts.mjs from Project Gutenberg eBooks #${SOURCES.map((s) => s.gutenberg).join(', #')}
// (public domain in the US). Opening sections only, normalised to printable ASCII. Rerun the
// script rather than editing by hand; src/books.js holds titles, pagination and the text version.
export const BOOK_TEXTS = {
${body}
};
`;
  await writeFile(path.join(process.cwd(), 'src/book-texts.js'), output);
  for (const [id, sections] of Object.entries(books)) {
    console.log(id, sections.map((s) => `${s.label}: ${s.paragraphs.join(' ').split(' ').length} words`).join(', '));
  }
  console.log(`src/book-texts.js: ${Buffer.byteLength(output)} bytes`);
}

// Importing the module (as tests/books.test.js does for normalise) builds nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]) await build(process.argv[2]);
  else {
    console.error('Usage: node scripts/build-book-texts.mjs <dir with pg11.txt, pg1342.txt, pg1661.txt, pg84.txt>');
    process.exitCode = 1;
  }
}
