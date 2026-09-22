import { metrics, editStats, makePassage } from './typing.js';
const $ = id => document.getElementById(id);
let mode = 'time', duration = 30, count = 25, punctuation = false;
let target = '', typed = '', started = null, ended = false, attempts = 0, mistakes = 0, interval;
let characters = [], elapsed = 0, previousBest = null;
const desktopPointer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
function showBest() { const best = Number(read('stilltype-best')) || 0; $('best').textContent = best ? `Best · ${best} WPM` : 'No completed sessions yet'; $('reset-local').disabled = !best; }
document.documentElement.dataset.theme = 'dark';
showBest();
function options() {
  $('length-settings').hidden = mode === 'quote';
  $('length-label').textContent = mode === 'time' ? 'Duration' : 'Word count';
  document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  const restoreLengthFocus = $('lengths').contains(document.activeElement);
  $('lengths').replaceChildren();
  const values = mode === 'time' ? [15,30,60,120] : mode === 'words' ? [10,25,50,100] : [];
  values.forEach(value => { const b = document.createElement('button'); b.textContent = mode === 'time' ? `${value}s` : value; b.className = (value === (mode === 'time' ? duration : count)) ? 'selected' : ''; b.setAttribute('aria-pressed', String(!!b.className)); b.setAttribute('aria-label', `${value} ${mode === 'time' ? 'seconds' : 'words'}`); b.onclick = event => { if (mode === 'time') duration = value; else count = value; options(); reset(event.detail > 0 && desktopPointer()); }; $('lengths').append(b); });
  if (restoreLengthFocus) $('lengths').querySelector('.selected')?.focus();
  $('punctuation').disabled = mode === 'quote';
  $('punctuation').title = mode === 'quote' ? 'Quotes include their original punctuation' : 'Include punctuation';
}
function renderPassage() {
  $('passage').replaceChildren(); characters = [];
  target.split(' ').forEach((word, i, words) => { const group = document.createElement('span'); group.className = 'word'; for (const letter of word) { const span = document.createElement('span'); span.className = 'char'; span.textContent = letter; group.append(span); characters.push(span); } $('passage').append(group); if (i < words.length - 1) { const span = document.createElement('span'); span.className = 'char'; span.textContent = ' '; $('passage').append(span); characters.push(span); } });
  characters[0].classList.add('current'); $('accessible-passage').textContent = target;
}
function reset(focus = false) {
  clearInterval(interval); started = null; ended = false; typed = ''; attempts = 0; mistakes = 0; elapsed = 0;
  target = makePassage(mode, count, punctuation); $('typing-input').value = ''; $('typing-input').disabled = false;
  $('typing-wrap').hidden = false; $('result').hidden = true; $('status').textContent = 'Ready when you are';
  $('input-help').innerHTML = '<span class="small-cursor">▎</span> Start typing to begin';
  $('session-label').textContent = mode === 'quote' ? 'English · Original passages' : 'English · Common words';
  $('wpm').textContent = '—'; $('accuracy').textContent = '—'; $('progress').style.width = '0%';
  $('remaining').innerHTML = mode === 'time' ? `${duration}<span>s</span>` : `0<span>/ ${mode === 'quote' ? target.split(' ').length : count}</span>`;
  $('remaining-label').textContent = mode === 'time' ? 'remaining' : 'words attempted';
  $('passage').style.transform = ''; renderPassage(); if (focus) $('typing-input').focus({preventScroll:true}); inputHint();
}
function update() {
  elapsed = started === null ? 0 : performance.now() - started;
  if (mode === 'time') elapsed = Math.min(elapsed, duration * 1000);
  const score = metrics(target, typed, attempts, mistakes, elapsed);
  $('wpm').textContent = score.wpm; $('accuracy').innerHTML = `${score.accuracy}<span>%</span>`;
  const doneWords = typed.length === target.length ? target.split(' ').length : (typed.match(/ /g) || []).length;
  $('remaining').innerHTML = mode === 'time' ? `${Math.max(0, Math.ceil(duration - elapsed / 1000))}<span>s</span>` : `${doneWords}<span>/ ${target.split(' ').length}</span>`;
  $('progress').style.width = `${(mode === 'time' ? elapsed / (duration * 1000) : typed.length / target.length) * 100}%`;
  if (!ended && ((mode === 'time' && elapsed >= duration * 1000) || typed.length >= target.length)) finish(score);
  return score;
}
function finish(score) {
  ended = true; clearInterval(interval); $('typing-input').disabled = true; $('typing-wrap').hidden = true; $('result').hidden = false;
  $('status').textContent = 'Complete'; $('input-help').textContent = 'Press Escape or choose Try again.';
  $('result-copy').textContent = `${score.wpm} words per minute · ${score.accuracy}% accuracy`; 
  $('announcement').textContent = $('result-copy').textContent;
  if (score.wpm > Number(read('stilltype-best') || 0)) save('stilltype-best', score.wpm);
  showBest(); $('again').focus();
}
function inputHint() {
  if (ended) return;
  const focused = document.activeElement === $('typing-input');
  $('input-help').textContent = !focused ? (started === null ? 'Click or tap the text to begin' : 'Click the text to continue · timer keeps running') : started === null ? 'Start typing to begin' : 'Backspace to correct · Escape to restart';
}
function blockedPaste(event) { event.preventDefault(); $('input-help').textContent = 'Type the passage yourself; paste is disabled.'; $('announcement').textContent = 'Paste is disabled for typing practice.'; }
$('typing-input').addEventListener('focus', inputHint);
$('typing-input').addEventListener('blur', inputHint);
$('typing-input').addEventListener('beforeinput', e => { if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') blockedPaste(e); else if (e.inputType === 'insertLineBreak') e.preventDefault(); });
$('typing-input').addEventListener('paste', blockedPaste);
$('typing-input').addEventListener('input', e => {
  if (e.isComposing || ended) return;
  if (started !== null && mode === 'time' && performance.now() - started >= duration * 1000) { update(); return; }
  const next = e.target.value.slice(0, target.length).replace(/[\r\n]/g, '');
  if (!next.length && started === null) return;
  if (started === null) { started = performance.now(); interval = setInterval(update, 100); $('status').textContent = 'In your rhythm'; $('input-help').textContent = 'Keep going. One word at a time.'; }
  const change = editStats(typed, next, target); attempts += change.attempts; mistakes += change.mistakes; typed = next; e.target.value = next;
  characters.forEach((char, i) => { char.className = `char${i < typed.length ? typed[i] === target[i] ? ' correct' : ' wrong' : i === typed.length ? ' current' : ''}`; });
  const current = characters[typed.length]; if (current) { const lineHeight = parseFloat(getComputedStyle($('passage')).lineHeight); const line = Math.floor(current.offsetTop / lineHeight); $('passage').style.transform = `translateY(-${Math.max(0, line - 1) * lineHeight}px)`; }
  update(); inputHint();
});
$('typing-input').addEventListener('keydown', e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key) || ((e.ctrlKey || e.metaKey) && e.key === 'a')) e.preventDefault(); });
$('typing-input').addEventListener('click', () => { const input = $('typing-input'); input.setSelectionRange(input.value.length, input.value.length); });
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = event => { mode = b.dataset.mode; options(); reset(event.detail > 0 && desktopPointer()); });
$('punctuation').onclick = event => { punctuation = !punctuation; $('punctuation').setAttribute('aria-pressed', punctuation); reset(event.detail > 0 && desktopPointer()); };
$('restart').onclick = () => reset(true); $('again').onclick = () => reset(true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); reset(true); } document.querySelectorAll('.key').forEach(k => k.classList.toggle('active', k.dataset.key === e.key.toLowerCase())); });
document.addEventListener('keyup', () => document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active')));
window.addEventListener('blur', () => document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active')));
['qwertyuiop','asdfghjkl','zxcvbnm',' '].forEach(row => { const div = document.createElement('div'); div.className = 'key-row'; [...row].forEach(letter => { const key = document.createElement('span'); key.className = `key${letter === ' ' ? ' space' : ''}`; key.dataset.key = letter; key.textContent = letter === ' ' ? 'space' : letter; div.append(key); }); $('keyboard').append(div); });
$('keyboard-toggle').onclick = () => { const visible = $('keyboard').hidden; $('keyboard').hidden = !visible; $('keyboard-toggle').setAttribute('aria-pressed', visible); $('keyboard-label').textContent = `${visible ? 'Hide' : 'Show'} keyboard`; $('keyboard-toggle').title = $('keyboard-label').textContent; };
$('reset-local').onclick = () => { previousBest = read('stilltype-best'); save('stilltype-best', '0'); showBest(); $('best-feedback').textContent = 'Best score cleared.'; $('undo-best').hidden = false; $('undo-best').focus(); };
$('undo-best').onclick = () => { save('stilltype-best', Math.max(Number(previousBest) || 0, Number(read('stilltype-best')) || 0)); previousBest = null; showBest(); $('best-feedback').textContent = 'Best score restored.'; $('undo-best').hidden = true; $('reset-local').focus(); };
options(); reset(desktopPointer());
