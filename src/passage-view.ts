import { wordIndexes, wordsAt } from './word-highlight.js';

interface PassageWords {
  indexes: ReturnType<typeof wordIndexes>;
  elements: HTMLSpanElement[];
  current: number;
  next: number;
}

const passageWords = new WeakMap<HTMLSpanElement[], PassageWords>();

function markWords(characters: HTMLSpanElement[], position: number) {
  const words = passageWords.get(characters);

  if (!words) return;
  const { current, next } = wordsAt(words.indexes, words.elements.length, position);

  if (current !== words.current) {
    words.elements[words.current]?.classList.remove('word-current');
    words.elements[current]?.classList.add('word-current');
    words.current = current;
  }

  if (next !== words.next) {
    words.elements[words.next]?.classList.remove('word-next');
    words.elements[next]?.classList.add('word-next');
    words.next = next;
  }
}

// tape: whether the passage is on one line (tape mode), which changes how passed text is trimmed.
export function renderText(display: HTMLElement, text: string, { tape = () => false }: { tape?: () => boolean } = {}) {
  const words = text.split(' ');
  const characters: HTMLSpanElement[] = [];
  const characterWords: number[] = [];
  const groups: HTMLSpanElement[][] = [];
  let renderedWords = 0;
  let firstRenderedWord = 0;
  let lastTrimPosition = 0;
  let lastPosition = 0;

  words.forEach((word, wordIndex) => {
    const group = document.createElement('span');
    group.className = 'word';
    group.dataset.wordIndex = String(wordIndex);

    for (const letter of word) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = letter;
      group.append(span);
      characters.push(span);
      characterWords.push(wordIndex);
    }

    if (wordIndex < words.length - 1) {
      const space = document.createElement('span');
      space.className = 'char';
      space.textContent = ' ';
      groups.push([group, space]);
      characters.push(space);
      characterWords.push(wordIndex + 1);
    } else groups.push([group]);
  });

  function appendWords(wordCount: number) {
    const fragment = document.createDocumentFragment();
    const end = Math.min(groups.length, renderedWords + wordCount);

    while (renderedWords < end) {
      fragment.append(...groups[renderedWords] ?? []);
      renderedWords += 1;
    }

    display.insertBefore(fragment, display.querySelector('.caret'));
  }

  function ensureForward(position: number) {
    const targetWord = characterWords[Math.min(position + 160, characters.length - 1)] || 0;

    if (targetWord >= renderedWords) appendWords(Math.max(80, targetWord - renderedWords + 1));
  }

  // Puts trimmed words back in place of their spacer.
  function remountTrimmed() {
    if (!firstRenderedWord) return;
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < firstRenderedWord; index += 1) fragment.append(...groups[index] ?? []);
    display.querySelector<HTMLSpanElement>('.passage-spacer')?.remove();
    display.insertBefore(fragment, display.querySelector('.word'));
    firstRenderedWord = 0;
  }

  // Tape mode: words more than two line-widths behind the caret give way to a spacer of the
  // same width, so nothing in view moves.
  function trimTape(current: HTMLSpanElement) {
    const keepLeft = (current.closest<HTMLElement>('.word') || current).offsetLeft - display.clientWidth * 2;

    if (keepLeft <= 0) return;
    const firstKept = [...display.querySelectorAll<HTMLSpanElement>('.word')].find((word) => word.offsetLeft >= keepLeft);

    if (!firstKept || firstKept === display.querySelector('.word')) return;
    const spacer = document.createElement('span');
    spacer.className = 'passage-spacer';
    // The word's exact x, not the rounded offsetLeft; the shared transform cancels out.
    spacer.style.width = `${firstKept.getBoundingClientRect().left - display.getBoundingClientRect().left}px`;

    for (const child of [...display.childNodes]) {
      if (child === firstKept) break;

      if (child instanceof Element && child.matches('.caret, .ghost-caret, .word-glide')) continue;
      child.remove();
    }

    display.insertBefore(spacer, firstKept);
    firstRenderedWord = Number(firstKept.dataset.wordIndex);
  }

  // Tape mode, backspacing: a step back can show up to a line-width behind the caret, so the
  // trimmed words come back before the spacer could show as a blank stretch.
  function nearTapeSpacer(position: number) {
    const spacer = display.querySelector<HTMLSpanElement>('.passage-spacer');
    const at = characters[Math.min(position, characters.length - 1)];

    return Boolean(spacer && at?.isConnected && at.offsetLeft - spacer.offsetWidth < display.clientWidth);
  }

  display.replaceChildren();
  appendWords(100);
  characters[0]?.classList.add('current');
  passageWords.set(characters, { indexes: wordIndexes(text), elements: groups.flatMap((group) => group.slice(0, 1)), current: -1, next: -1 });
  markWords(characters, 0);

  return {
    characters,
    ensureAhead(position: number) {
      const currentWord = characterWords[Math.min(position, characters.length - 1)] || 0;
      const back = position < lastPosition;
      lastPosition = position;

      // A separator before the first mounted word maps to that word, but is
      // itself detached. Remount it when backspacing reaches the boundary.
      if (currentWord < firstRenderedWord || (currentWord === firstRenderedWord && !characters[position]?.isConnected)
        || (back && firstRenderedWord && tape() && nearTapeSpacer(position))) {
        remountTrimmed();
        lastTrimPosition = position;
      }

      ensureForward(position);
    },
    ensureForward,
    // Before switching between three lines and the tape: the spacer only fits the old layout.
    restore() {
      remountTrimmed();
      lastTrimPosition = 0;
    },
    trimBehind(position: number) {
      if (position - lastTrimPosition < 160) return;
      lastTrimPosition = position;
      const current = characters[position];

      if (!current?.isConnected) return;

      if (tape()) {
        trimTape(current);

        return;
      }

      const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 48;
      const currentTop = (current.closest<HTMLElement>('.word') || current).offsetTop;
      const keepTop = currentTop - lineHeight * 3;

      if (keepTop <= 0) return;
      let firstKept = null;

      for (const word of display.querySelectorAll<HTMLSpanElement>('.word')) {
        if (word.offsetLeft <= 1 && word.offsetTop <= keepTop) firstKept = word;
        else if (word.offsetTop > keepTop) break;
      }

      if (!firstKept || firstKept === display.querySelector('.word')) return;
      const height = firstKept.offsetTop;
      const spacer = document.createElement('span');
      spacer.className = 'passage-spacer';
      spacer.style.height = `${height}px`;

      for (const child of [...display.childNodes]) {
        if (child === firstKept) break;

        if (child instanceof Element && child.matches('.caret, .ghost-caret, .word-glide')) continue;
        child.remove();
      }

      display.insertBefore(spacer, firstKept);
      firstRenderedWord = Number(firstKept.dataset.wordIndex);
    },
  };
}

export function updateCharacterStates(characters: HTMLSpanElement[], typed: string, target: string, start = 0) {
  const from = Math.max(0, start - 1);
  const to = Math.min(characters.length, Math.max(typed.length + 2, start + 2));

  for (let index = from; index < to; index += 1) {
    let state = 'char';

    if (index < typed.length) state = typed[index] === target[index] ? 'char correct' : 'char wrong';
    else if (index === typed.length) state = 'char current';

    // Only touch changed characters so settled letters keep their finished animation.
    const character = characters[index];

    if (character && character.className !== state) character.className = state;
  }

  markWords(characters, typed.length);
}

export type PassageView = ReturnType<typeof renderText>;
