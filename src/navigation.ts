import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { DEFAULT_KEYBINDINGS } from './keybindings.js';
import type { Keybindings } from './keybindings.js';

export type AppView = 'practice' | 'results' | 'train' | 'progress' | 'compete' | 'learn';

interface NavigationView { screen: AppView; keys: Keybindings; mac: boolean }

interface NavigationPorts { go(view: AppView, keep: boolean): void; skip(): void; restart(): void; exitFocus(): void }

export function createNavigation() {
  const view = createStore<NavigationView>({ screen: 'practice', keys: { ...DEFAULT_KEYBINDINGS }, mac: false });
  let ports: NavigationPorts | null = null;

  return {
    view,
    configure(next: NavigationPorts) { ports = next; },
    show(screen: AppView) {
      document.body.dataset.view = screen;
      flushSync(() => view.publish({ ...view.getSnapshot(), screen }));
    },
    bindings(keys: Keybindings) { flushSync(() => view.publish({ ...view.getSnapshot(), keys })); },
    platform(mac: boolean) { flushSync(() => view.publish({ ...view.getSnapshot(), mac })); },
    go(screen: AppView) { ports?.go(screen, true); },
    skip() { ports?.skip(); },
    restart() { ports?.restart(); },
    exitFocus() { ports?.exitFocus(); },
  };
}

export type Navigation = ReturnType<typeof createNavigation>;
