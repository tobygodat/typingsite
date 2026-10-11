import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYBINDINGS, parseBinding, validateKeybindings, normalizeKeybindings, matchesBinding, ariaShortcuts } from '../src/keybindings.js';

test('binding validation preserves typing and native navigation', () => {
  for (const value of ['a', 'Space', 'Backspace', 'Delete', 'ArrowLeft', 'Shift+A', 'Alt+E', 'Shift+Tab', 'Ctrl+Tab', 'Ctrl+Alt+E', 'Ctrl+R', 'Mod+Shift+T', 'F5', 'F7', 'F10', 'Alt+F4', 'Ctrl+F4', 'Meta+Q', 'Ctrl+Shift+I', 'Ctrl+E', 'Ctrl+Ctrl+E', 'Mod+Meta+E', 'Ctrl+', '__proto__', 'Ctrl+__proto__', 'Ctrl+toString', 'Ctrl+constructor']) {
    assert.ok(parseBinding(value, 'restart').error, value);
  }
  for (const value of ['Ctrl+Shift+E', 'Meta+K', 'Mod+K', 'Alt+Shift+R', 'F2', 'Escape', 'Tab', 'Enter']) {
    assert.equal(parseBinding(value, 'restart').binding, value);
  }
  assert.equal(parseBinding(' control + shift + e ', 'restart').binding, 'Ctrl+Shift+E');
  assert.equal(parseBinding('none', 'commands').binding, '');
  assert.ok(parseBinding('Enter', 'commands').error);
  assert.ok(parseBinding('Tab', 'exitFocus').error);
});

test('conflicts include Mod aliases and allow only contextual Escape sharing', () => {
  assert.deepEqual(validateKeybindings(DEFAULT_KEYBINDINGS).errors, {});
  for (const restart of ['Ctrl+K', 'Meta+K', 'Mod+K']) {
    const { errors } = validateKeybindings({ ...DEFAULT_KEYBINDINGS, restart });
    assert.ok(errors.restart);
    assert.ok(errors.commands);
  }
  assert.ok(validateKeybindings({ ...DEFAULT_KEYBINDINGS, commands: 'Escape' }).errors.commands);
  assert.ok(validateKeybindings({ ...DEFAULT_KEYBINDINGS, restart: 'F2', exitFocus: 'F2' }).errors.exitFocus);
  assert.deepEqual(validateKeybindings({ restart: '', commands: '', exitFocus: '' }).errors, {});
});

test('old and malformed profiles get safe independent defaults', () => {
  assert.equal(normalizeKeybindings(undefined, 'Tab').restart, 'Tab');
  assert.equal(normalizeKeybindings(undefined, '__proto__').restart, 'Escape');
  assert.deepEqual(normalizeKeybindings({ restart: 'a', commands: 12, exitFocus: null }), DEFAULT_KEYBINDINGS);
  assert.deepEqual(normalizeKeybindings({ restart: 'Ctrl+K' }), DEFAULT_KEYBINDINGS);
  assert.equal(normalizeKeybindings({ restart: '' }).restart, '');
  assert.equal(normalizeKeybindings({ restart: 'F2' }, 'Tab').restart, 'F2');
  assert.deepEqual(normalizeKeybindings(Object.create({ restart: 'F2' })), DEFAULT_KEYBINDINGS);
  const fresh = normalizeKeybindings();
  fresh.restart = 'Tab';
  assert.equal(normalizeKeybindings().restart, 'Escape');
});

test('matching requires exact modifiers and ignores composition and AltGr', () => {
  assert.ok(matchesBinding({ key: 'K', ctrlKey: true }, 'Mod+K'));
  assert.ok(matchesBinding({ key: 'k', metaKey: true }, 'Mod+K'));
  assert.ok(matchesBinding({ key: 'E', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+E'));
  for (const extra of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { getModifierState: () => true }]) {
    assert.equal(matchesBinding({ key: 'k', ctrlKey: true, ...extra }, 'Mod+K'), false);
  }
  assert.equal(matchesBinding({ key: 'k', ctrlKey: true }, ''), false);
  assert.equal(ariaShortcuts('Mod+K'), 'Control+K Meta+K');
});
