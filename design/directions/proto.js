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
    const sections = [...document.querySelectorAll('section[data-state]')];
    const asked = query.get('state') || 'full';
    const want = sections.some((s) => s.dataset.state === asked) ? asked : 'full';
    const empty = want === 'empty';
    document.body.dataset.guest = String(empty);
    document.body.dataset.view = want;
    document.body.dataset.fontSize = '28';
    document.querySelector('.account')?.setAttribute('data-state', empty ? 'guest' : 'member');
    for (const section of sections) section.hidden = section.dataset.state !== want;

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

    // T6: draw the reach between two keys as a line from one key's centre to the other's.
    const drawReach = () => {
      for (const board of document.querySelectorAll('[data-reach]')) {
        if (board.closest('[hidden]')) continue;
        const [from, to] = board.dataset.reach.split('');
        const a = board.querySelector(`[data-key="${from}"]`);
        const b = board.querySelector(`[data-key="${to}"]`);
        const svg = board.querySelector('.reach-line');
        if (!a || !b || !svg) continue;
        const box = board.getBoundingClientRect();
        const c = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]; };
        // Run edge to edge, so the line never crosses the letters on the two keys.
        const [ax, ay] = c(a);
        const [bx, by] = c(b);
        const len = Math.hypot(bx - ax, by - ay);
        const inset = a.getBoundingClientRect().height * 0.62;
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const [x1, y1, x2, y2] = [ax + ux * inset, ay + uy * inset, bx - ux * inset, by - uy * inset];
        svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
        // Bow the line to one side, so a reach up one finger's column clears the key between.
        const bow = a.getBoundingClientRect().width * 0.7;
        const [mx, my] = [(x1 + x2) / 2 + uy * bow, (y1 + y2) / 2 - ux * bow];
        svg.innerHTML = `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}"/>`;
      }
    };

    const layout = () => { placePill(); drawReach(); };
    layout();
    document.fonts?.ready.then(layout);
    addEventListener('resize', layout);
  });
})();
