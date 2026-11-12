import { createCompose } from './compose-view.js';
import { createSettings } from './settings.js';
import { createPalette } from './palette.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createLearningStore } from './learning-store.js';
import { createPracticeSession } from './practice-session.js';
import { App } from './app.js';
import { attachApplication } from './legacy-application.js';

const container = document.getElementById('app');

if (!container) throw new Error('Missing application root');

const practice = createPracticeSession();
const learning = createLearningStore();
const palette = createPalette();
const settings = createSettings();
const compose = createCompose();
const root = createRoot(container);

flushSync(() => root.render(<StrictMode><App practice={practice} learning={learning} palette={palette} settings={settings} compose={compose} /></StrictMode>));

const lifecycle = await attachApplication(practice, learning, palette, settings, compose);

function pagehide(event: PageTransitionEvent) {
  if (!event.persisted) void lifecycle.dispose();
}

addEventListener('pagehide', pagehide);

if (import.meta.hot) import.meta.hot.dispose(() => {
  removeEventListener('pagehide', pagehide);
  root.unmount();
  void lifecycle.dispose();
});
