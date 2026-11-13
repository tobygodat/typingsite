import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { appEntry } from './built-assets.js';

let compiled;

export async function useApplicationLifetimeFixture(page) {
  const source = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createApplication} from ${JSON.stringify(fileURLToPath(new URL('../src/application.ts', import.meta.url)))};
import {attachApplication} from ${JSON.stringify(fileURLToPath(new URL('../src/application-host.ts', import.meta.url)))};
import {App} from ${JSON.stringify(fileURLToPath(new URL('../src/app.tsx', import.meta.url)))};
let root;
let lifecycle;
let application;
const controls=document.createElement('div');
const status=document.createElement('output');
status.id='fixture-lifetime-status';
controls.append(status);
const profile=document.createElement('output');profile.id='fixture-profile';controls.append(profile);
function button(id,label,action){
  const button=document.createElement('button');button.id=id;button.textContent=label;
  button.addEventListener('click',action);controls.append(button);
}
button('fixture-dispose','Dispose',async()=>{
  root.unmount();await lifecycle.dispose();status.textContent='disposed';
});
button('fixture-mount','Mount',async()=>{await mount();});
button('fixture-read','Read profile',()=>{profile.textContent=JSON.stringify(application.learning.profile);});
document.body.prepend(controls);
async function mount(){
  status.textContent='mounting';
  application=createApplication();
  root=createRoot(document.getElementById('app'));
  flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(App,application))));
  lifecycle=await attachApplication(application);
  status.textContent='mounted';
}
await mount();`;

  if (!compiled) compiled = build({
    configFile: false, publicDir: false, logLevel: 'error',
    plugins: [{ name: 'application-lifetime-fixture', resolveId(id) { if (id === 'application-lifetime-fixture') return '\0application-lifetime-fixture'; }, load(id) { if (id === '\0application-lifetime-fixture') return source; } }],
    build: { target: 'es2022', write: false, rolldownOptions: { input: 'application-lifetime-fixture', output: { codeSplitting: false } } },
  }).then((result) => {
    const script = result.output.find((file) => file.type === 'chunk' && file.isEntry);

    if (!script) throw new Error('Application lifetime fixture emitted no entry');

    return script.code;
  });

  await page.route(`**${appEntry}`, async (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: await compiled }));
}
