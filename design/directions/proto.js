// Prototype only: ?theme=dark|light and ?state=empty (a brand-new guest), the dock's pill, and
// buttons that show one panel of a set (data-set + data-show).
(() => {
  const query = new URLSearchParams(location.search);
  const theme = query.get('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;

  const placePill = () => {
    const nav = document.querySelector('.dock-nav');
    const on = nav?.querySelector('.is-active');
    if (!on) return;
    nav.style.setProperty('--pill-x', `${on.offsetLeft}px`);
    nav.style.setProperty('--pill-y', `${on.offsetTop}px`);
    nav.style.setProperty('--pill-w', `${on.offsetWidth}px`);
    nav.style.setProperty('--pill-h', `${on.offsetHeight}px`);
    nav.style.setProperty('--pill-o', '1');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const empty = query.get('state') === 'empty';
    document.body.dataset.guest = String(empty);
    document.querySelector('.account')?.setAttribute('data-state', empty ? 'guest' : 'member');
    for (const section of document.querySelectorAll('[data-state]:not(.account)')) {
      section.hidden = (section.dataset.state === 'empty') !== empty;
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-show]');
      if (!button) return;
      const set = button.dataset.set;
      for (const other of document.querySelectorAll(`[data-set="${set}"]`)) {
        const on = other === button;
        other.setAttribute('aria-pressed', String(on));
        other.classList.toggle('is-on', on);
      }
      const panel = document.getElementById(button.dataset.show);
      if (!panel) return;
      for (const sibling of document.querySelectorAll(`[data-panel="${panel.dataset.panel}"]`)) sibling.hidden = sibling !== panel;
    });

    placePill();
    document.fonts?.ready.then(placePill);
    addEventListener('resize', placePill);
  });
})();
