export function metrics(target, typed, attempts, mistakes, elapsedMs) {
  const correct = [...typed].reduce((sum, char, i) => sum + (char === target[i] ? 1 : 0), 0);
  return { wpm: elapsedMs > 0 ? Math.round(correct / 5 / (elapsedMs / 60000)) : 0, accuracy: attempts ? Math.round((attempts - mistakes) / attempts * 100) : 100 };
}
export function editStats(previous, next, target) {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  const added = next.slice(prefix);
  return { attempts: added.length, mistakes: [...added].filter((char, i) => char !== target[prefix + i]).length };
}
const bank = 'the a one some this that each all more little quiet day time way work life world place home light water river ocean tree leaf green soft warm clear open new small great kind good still slow steady fresh bright calm begin make find feel keep learn grow move walk read write think know look give take let come see hear share hold turn build bring dream follow listen wonder create explore morning evening air sky sun rain wind path room hand word line story mind moment rhythm space simple nature better over under near through into around between beyond with from for and to in on as you we they it can will may have be is are our your their'.split(' ');
const quotes = [
  'There is a certain kind of quiet that arrives when you stop trying to be somewhere else. The light moves across the room, the world carries on, and for a moment, you have everything you need.',
  'A small path winds between the trees and follows the river home. Nothing here is in a hurry. Even the afternoon light takes its time, resting on each leaf before moving on.',
  'Every new beginning is made of little things. A window opened, a page turned, a word written. Give yourself the time to learn, and let the next small step be enough.'
];
export function makePassage(mode, count, punctuation, random = Math.random) {
  if (mode === 'quote') return quotes[Math.floor(random() * quotes.length)];
  const words = Array.from({length: mode === 'time' ? 600 : count}, () => bank[Math.floor(random() * bank.length)]);
  if (punctuation) words.forEach((word, i) => { if (i % 9 === 0) words[i] = word[0].toUpperCase() + word.slice(1); if (i % 9 === 8) words[i] += '.'; else if (i % 9 === 4) words[i] += ','; });
  return words.join(' ');
}
