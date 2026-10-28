// Tape mode: the passage on one line. The tape never follows the caret letter by letter. It
// stays put while the caret travels right, then advances in one step, using the same ~150 ms
// scroll as the three-line passage. Steps land on word starts. A word longer than the line steps
// inside the word instead, still a chunk at a time. Pure geometry, so it can be tested without a
// browser. motion.js applies the result, and scoring never reads it.

// A stepped word lands this far in, so the end of the previous word stays in view. On a narrow
// screen or with large text the lead is measured in glyphs instead (see tapeOffset).
export const TAPE_LEAD = 0.1;

// The tape steps when the caret starts a word past this point, leaving the rest as lookahead.
export const TAPE_REACH = 0.7;

// Backspacing into the left edge steps back so the caret sits mid-line.
export const TAPE_BACK = 0.5;

/**
 * Where the tape should sit, as a scroll offset in px from the start of the line.
 * All positions are in line coordinates: px from the first letter, before any scroll.
 *
 * offset   the current scroll
 * caret    the caret's x
 * word     { left, right } of the word the caret has just entered going forward, or (with realign)
 *          the word it is in; null otherwise
 * width    the visible width of the line
 * margin   how close the caret may come to the right edge, about one glyph
 * fade     the width of the left edge's fade
 * realign  the layout changed (resize, text size, switching to tape): keep the current scroll
 *          if the caret is still comfortably in view, otherwise line its word up again
 */
export function tapeOffset({ offset = 0, caret = 0, word = null, width = 0, margin = 0, fade = 0, realign = false }) {
  if (!(width > 0) || !Number.isFinite(caret)) return 0;
  // In glyphs as well as width, so a narrow screen with large text still works. Backspacing steps
  // back before the letter left of the caret reaches the fade (guard), and a stepped word lands far
  // enough in that the space and the letter before it can be corrected without a step back (lead).
  // Capped so a step back never lands inside the guard, which would step again on every key.
  const lead = Math.min(width * TAPE_BACK, Math.max(width * TAPE_LEAD, fade + margin * 2.5));
  const guard = Math.min(lead / 2, Math.max(width * TAPE_LEAD / 2, fade + margin));
  const reach = width * TAPE_REACH;
  const edge = width - margin;
  let next = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const visible = caret - next;

  if (realign) {
    if (visible > edge || visible < guard) next = (word ? word.left : caret) - lead;
  } else if (word && (word.left - next > reach || word.right - next > edge)) {
    // A new word that starts late or would run off the edge: bring it to the lead in one step.
    next = word.left - lead;
  }

  // A word longer than the line: step inside it, a chunk at a time.
  if (caret - next > edge) next = caret - lead;
  // Backspacing into the left edge: step back.
  else if (caret - next < guard) next = caret - width * TAPE_BACK;

  return Math.max(0, Math.round(next));
}
