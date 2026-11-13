import type { CopyPart } from './practice-session.js';

export type NativeCopy = string | number | boolean | Node | null | undefined | readonly NativeCopy[];

function pieces(value: NativeCopy): (string | number | boolean | Node | null | undefined)[] {
  if (value instanceof Node || value === null || typeof value !== 'object') return [value];

  return value.flatMap(pieces);
}

export function copyParts(value: NativeCopy): CopyPart[] {
  return pieces(value).flatMap<CopyPart>((part) => {
    if (part === null || part === undefined || part === false || part === '') return [];

    if (part instanceof HTMLDataElement && part.dataset.wpm !== undefined) return [{ kind: 'speed', wpm: Number(part.dataset.wpm), bare: 'bare' in part.dataset, signed: 'signed' in part.dataset, whole: 'whole' in part.dataset }];

    return [part instanceof Node ? part.textContent ?? '' : String(part)];
  });
}

export function setParts(node: Element, value: NativeCopy) {
  node.replaceChildren(...pieces(value).filter((part) => part !== '' && part !== null && part !== undefined && part !== false).map((part) => part instanceof Node ? part : String(part)));
}

export const plain = (value: NativeCopy) => pieces(value).map((part) => part instanceof Node ? part.textContent : part).join('');

export function setText(element: HTMLElement, value: string | number) {
  const text = String(value);

  if (element.textContent !== text) element.textContent = text;
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: NativeCopy, className = '') {
  const node = document.createElement(tag);
  setParts(node, text);
  node.className = className;

  return node;
}
