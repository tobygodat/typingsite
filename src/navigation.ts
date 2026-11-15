import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { DEFAULT_KEYBINDINGS } from './keybindings.js';
import type { Keybindings } from './keybindings.js';

export type AppView = 'practice' | 'results' | 'train' | 'progress' | 'compete' | 'learn';

export type NavigationPlacement = 'side' | 'top';

interface NavigationView { screen: AppView; keys: Keybindings; mac: boolean; placement: NavigationPlacement }

interface NavigationPorts { go(view: AppView, keep: boolean): void; skip(): void; restart(): void; exitFocus(): void }

export function createNavigation() {
  const view = createStore<NavigationView>({ screen: 'practice', keys: { ...DEFAULT_KEYBINDINGS }, mac: false, placement: 'side' });
  let ports: NavigationPorts | null = null;

  return {
    view,
    configure(next: NavigationPorts) { ports = next; },
    show(screen: AppView) {
      document.body.dataset.view = screen;
      flushSync(() => view.publish({ ...view.getSnapshot(), screen }));
    },
    bindings(keys: Keybindings) { flushSync(() => view.publish({ ...view.getSnapshot(), keys })); },
    // The preference, as html[data-navigation]. CSS decides the layout from it and the width: a side bar from 960px
    // when it is 'side', otherwise a top bar, and a bottom bar on phones. Returns whether it changed.
    placement(placement: NavigationPlacement) {
      document.documentElement.dataset.navigation = placement;

      if (view.getSnapshot().placement === placement) return false;
      flushSync(() => view.publish({ ...view.getSnapshot(), placement }));

      return true;
    },
    platform(mac: boolean) { flushSync(() => view.publish({ ...view.getSnapshot(), mac })); },
    go(screen: AppView) { ports?.go(screen, true); },
    skip() { ports?.skip(); },
    restart() { ports?.restart(); },
    exitFocus() { ports?.exitFocus(); },
  };
}

export type Navigation = ReturnType<typeof createNavigation>;
