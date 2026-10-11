// Command palette: Ctrl/⌘K, fuzzy filter, a highlight that springs between rows.
// Commands come from the app on every keystroke, so their hints always show current state.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function fuzzyScore(text, query) {
  if (!query) return 1;
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(query);
  if (direct === 0) return 100;
  if (direct > 0) return 80 - Math.min(direct, 40) + (haystack[direct - 1] === ' ' ? 10 : 0);
  let score = 0;
  let from = 0;
  let streak = 0;
  for (const char of query) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return 0;
    streak = index === from ? streak + 1 : 0;
    score += 1 + streak * 2 + (index === 0 || haystack[index - 1] === ' ' ? 3 : 0);
    from = index + 1;
  }
  return score;
}

export function createPalette({ dialog, input, list, empty, highlight, trigger, getCommands, onOpen }) {
  let items = [];
  let active = 0;
  let returnFocus = null;

  function filtered(query) {
    const q = query.trim().toLowerCase();
    return getCommands(q)
      .map((command) => ({ command, score: command.secret ? 100 : fuzzyScore(`${command.label} ${command.keywords || ''} ${command.group}`, q) }))
      .filter(({ score, command }) => score > 0 && !command.disabled)
      .sort((a, b) => (q ? b.score - a.score : 0))
      .map(({ command }) => command);
  }

  function render() {
    items = filtered(input.value);
    const query = input.value.trim();
    const nodes = [];
    let group = null;
    items.forEach((command, index) => {
      if (!query && command.group !== group) {
        group = command.group;
        const heading = document.createElement('li');
        heading.className = 'palette-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group;
        nodes.push(heading);
      }
      const option = document.createElement('li');
      option.id = `palette-option-${index}`;
      option.className = `palette-option${command.secret ? ' is-secret' : ''}`;
      option.setAttribute('role', 'option');
      option.dataset.index = String(index);
      const label = document.createElement('span');
      label.className = 'opt-label';
      const mark = document.createElement('span');
      mark.className = 'opt-mark';
      mark.setAttribute('aria-hidden', 'true');
      label.append(mark, document.createTextNode(command.label));
      option.append(label);
      if (command.hint) {
        const hint = document.createElement('span');
        hint.className = `opt-hint${command.on ? ' is-on' : ''}`;
        hint.textContent = command.hint;
        option.append(hint);
      }
      nodes.push(option);
    });
    list.replaceChildren(...nodes);
    empty.hidden = items.length > 0;
    move(0, { instant: true });
  }

  function move(index, { instant = false } = {}) {
    if (!items.length) {
      highlight.style.setProperty('--hl-o', '0');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    active = (index + items.length) % items.length;
    list.querySelectorAll('[role="option"]').forEach((option) => option.setAttribute('aria-selected', String(Number(option.dataset.index) === active)));
    const row = list.querySelector(`#palette-option-${active}`);
    input.setAttribute('aria-activedescendant', row.id);
    if (instant) highlight.style.transition = 'none';
    highlight.style.setProperty('--hl-y', `${row.offsetTop}px`);
    highlight.style.setProperty('--hl-h', `${row.offsetHeight}px`);
    highlight.style.setProperty('--hl-o', '1');
    if (instant) requestAnimationFrame(() => { highlight.style.transition = ''; });
    row.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    onOpen?.();
    input.value = '';
    dialog.showModal();
    render();
    input.focus();
  }

  function close({ restore = true, animate = true } = {}) {
    if (!dialog.open) return;
    const finish = () => {
      dialog.classList.remove('is-closing');
      dialog.close();
      if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
    if (!animate || reducedMotion.matches) { finish(); return; }
    dialog.classList.add('is-closing');
    setTimeout(finish, 150);
  }

  function run(index = active) {
    const command = items[index];
    if (!command) return;
    // Close without the exit animation: the command may need focus outside the modal right away.
    close({ restore: false, animate: false });
    command.run();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(active - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(items.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); run(); }
  });
  list.addEventListener('pointermove', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && Number(option.dataset.index) !== active) move(Number(option.dataset.index));
  });
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) run(Number(option.dataset.index));
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  trigger?.addEventListener('click', open);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      if (!dialog.open && document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (dialog.open) close();
      else open();
    }
  }, true);

  return { open, close, isOpen: () => dialog.open };
}
