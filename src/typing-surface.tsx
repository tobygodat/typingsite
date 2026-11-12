import { useLayoutEffect, useRef } from 'react';
import type { PracticeSession } from './practice-session.js';

export function TypingSurface({ practice }: { practice: PracticeSession }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = input.current;

    if (field) return practice.attachPrimary(field);
  }, [practice]);

  return <div id="typing-wrap" className="typing-wrap">
    <div id="text-display" aria-hidden="true"></div>
    <textarea ref={input} id="typing-input" aria-label="Typing input" aria-describedby="input-help accessible-passage condition-line" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off"></textarea>
    <span id="accessible-passage" className="sr-only"></span>
  </div>;
}
