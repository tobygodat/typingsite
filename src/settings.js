const group = (id) => document.getElementById(id);

export function selectSetting(id, value) {
  for (const radio of group(id).querySelectorAll('input[type="radio"]')) radio.checked = radio.value === String(value);
}

export function disableSetting(id, disabled) {
  group(id).disabled = disabled;
}

// Native radio activation includes arrow navigation and a click on an already selected option.
export function onSetting(id, choose) {
  group(id).addEventListener('click', (event) => {
    const radio = event.target;

    if (radio.matches('input[type="radio"]') && !radio.matches(':disabled')) choose(radio.value);
  });
}

export function createSettingsView({ dialog, trigger, fallback, stopRecording }) {
  let category = 'appearance';
  let opener = trigger;
  const content = dialog.querySelector('.settings-content');

  function showCategory(next) {
    category = next;

    for (const button of dialog.querySelectorAll('[data-settings-category]')) {
      if (button.dataset.settingsCategory === category) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }

    for (const panel of dialog.querySelectorAll('.settings-category')) panel.hidden = panel.id !== `settings-${category}`;
    content.scrollTop = 0;
    stopRecording();
  }

  function restoreFocus() {
    if (document.querySelector('dialog[open]')) return;
    const target = opener?.isConnected && opener.checkVisibility({ visibilityProperty: true }) ? opener : fallback;
    target.focus({ preventScroll: true });
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
    restoreFocus();
  }

  function open(next = category, from = document.activeElement) {
    opener = from;
    showCategory(next);

    if (!dialog.open) dialog.showModal();
    dialog.querySelector(`[data-settings-category="${category}"]`).focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => open());
  dialog.querySelector('#settings-close').addEventListener('click', close);
  dialog.querySelector('#settings-done').addEventListener('click', close);
  dialog.querySelector('.settings-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-category]');

    if (button) showCategory(button.dataset.settingsCategory);
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', stopRecording);

  return { open, close };
}
