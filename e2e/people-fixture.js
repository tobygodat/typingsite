import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { appEntry } from './built-assets.js';

// A compiled mount/unmount harness for the real people component; production owns every row and action.
export async function usePeopleFixture(page, rows) {
  const people = fileURLToPath(new URL('../src/challenge-people-view.tsx', import.meta.url));

  const source = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ChallengePeople,createPeopleView} from ${JSON.stringify(people)};
const controller=createPeopleView();
const rows=${JSON.stringify(rows)};
const root=createRoot(document.getElementById('app'));
function Fixture(){return React.createElement(React.Fragment,null,
React.createElement('button',{id:'fixture-clear',onClick:()=>controller.update([])},'Clear list'),
React.createElement('button',{id:'fixture-draw',onClick:()=>controller.update(rows)},'Draw list'),
React.createElement(ChallengePeople,{controller}));}
flushSync(()=>root.render(React.createElement(Fixture)));`;

  const entry = '\0stilltype-people-fixture';

  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    plugins: [{ name: 'stilltype-people-fixture', resolveId(id) { if (id === 'stilltype-people-fixture') return entry; }, load(id) { if (id === entry) return source; } }],
    build: { target: 'es2022', write: false, rolldownOptions: { input: 'stilltype-people-fixture', output: { codeSplitting: false } } },
  });

  const script = result.output.find((file) => file.type === 'chunk' && file.isEntry);

  if (!script) throw new Error('People fixture emitted no entry');
  await page.route(`**${appEntry}`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: script.code }));
}
