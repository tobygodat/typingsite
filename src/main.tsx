import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createApplication } from './application.js';
import { App } from './app.js';
import { attachApplication } from './application-host.js';

const container = document.getElementById('app');

if (!container) throw new Error('Missing application root');

const application = createApplication();
const root = createRoot(container);

flushSync(() => root.render(<StrictMode><App {...application} /></StrictMode>));

const lifecycle = await attachApplication(application);

function pagehide(event: PageTransitionEvent) {
  if (!event.persisted) void lifecycle.dispose();
}

addEventListener('pagehide', pagehide);

if (import.meta.hot) import.meta.hot.dispose(() => {
  removeEventListener('pagehide', pagehide);
  root.unmount();
  void lifecycle.dispose();
});
