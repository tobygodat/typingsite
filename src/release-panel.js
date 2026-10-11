import { release } from './release.js';

export function initReleasePanel() {
  const trigger = document.getElementById('release-trigger');
  const dialog = document.getElementById('release-dialog');
  const close = document.getElementById('release-close');
  document.getElementById('app-version').textContent = `v${release.version}`;
  document.getElementById('release-version').textContent = `Version ${release.version}`;
  trigger.setAttribute('aria-label', `What’s new in Stilltype version ${release.version}`);
  document.getElementById('release-notes').replaceChildren(...release.notes.map((note) => {
    const item = document.createElement('li');
    item.textContent = note;
    return item;
  }));
  trigger.hidden = false;

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    close.focus({ preventScroll: true });
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
  // Native cancel handles Escape. Only gestures wholly outside the panel dismiss it;
  // clicks on padding and drags from the contents must leave it open.
  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  let backdropPress = false;
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.target === dialog && outside(event);
  });
  dialog.addEventListener('pointercancel', () => { backdropPress = false; });
  dialog.addEventListener('click', (event) => {
    if (backdropPress && event.target === dialog && outside(event)) dialog.close();
    backdropPress = false;
  });
}
