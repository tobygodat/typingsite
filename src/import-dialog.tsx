import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { readMonkeytypeSettings } from './monkeytype.js';
import { createStore } from './store.js';

type ParsedImport = ReturnType<typeof readMonkeytypeSettings>;

export type ImportedSettings = Extract<ParsedImport, { preferences: object }>;

interface ImportPorts { beforeOpen(): void; apply(result: ImportedSettings): void; member(): boolean; announce(message: string): void }

interface ImportHost { open(): void; close(): void; focusText(): void; focusReport(): void; clearFile(): void }

interface ImportView { text: string; error: string; result: ImportedSettings | null; summary: string }

export function createSettingsImport() {
  const view = createStore<ImportView>({ text: '', error: '', result: null, summary: '' });
  let host: ImportHost | null = null;
  let ports: ImportPorts | null = null;
  let disposed = false;
  const publish = (next: ImportView) => { if (!disposed) flushSync(() => view.publish(next)); };

  return {
    view,
    configure(next: ImportPorts) { ports = next; },
    attach(next: ImportHost) { host = next;

 return () => { if (host === next) host = null; }; },
    open() { ports?.beforeOpen(); publish({ ...view.getSnapshot(), result: null, error: '' }); host?.clearFile(); host?.open(); host?.focusText(); },
    close() { host?.close(); },
    edit(text: string) { publish({ ...view.getSnapshot(), text, error: '' }); },
    async file(file: File) {
      try { const text = await file.text(); publish({ ...view.getSnapshot(), text, error: '' }); }
      catch { publish({ ...view.getSnapshot(), error: 'That file couldn’t be read. Try pasting its text instead.' }); }

      if (!disposed) host?.focusText();
    },
    submit() {
      const result = readMonkeytypeSettings(view.getSnapshot().text);

      if ('error' in result && result.error) {
        publish({ ...view.getSnapshot(), error: result.error });
        host?.focusText();

        return;
      }

      if (!('preferences' in result)) return;
      ports?.apply(result);
      const count = result.mapped.length;
      publish({ text: '', error: '', result, summary: `${count} ${count === 1 ? 'setting' : 'settings'} brought over. ${ports?.member() ? 'They’re saved to your account and sync to your other devices.' : 'Guest mode keeps them for this visit only; sign in to keep them.'}` });
      host?.focusReport();
      ports?.announce(`${count} Monkeytype ${count === 1 ? 'setting' : 'settings'} imported.`);
    },
    dispose() { disposed = true; },
  };
}

export type SettingsImport = ReturnType<typeof createSettingsImport>;

function ImportRows({ rows }: { rows: readonly (ImportedSettings['mapped'][number] | ImportedSettings['skipped'][number])[] }) {
  return rows.map((row, index) => <li key={index}><span className="import-setting">{row.setting}</span>{'value' in row && row.value !== undefined && <span className="import-value">{row.value}</span>}{'reason' in row && row.reason && <span className="import-reason">{row.reason}</span>}<small className="import-from">monkeytype {row.from}</small></li>);
}

export function ImportDialog({ controller }: { controller: SettingsImport }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const report = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => controller.attach({ open() { dialog.current?.showModal(); }, close() { dialog.current?.close(); }, focusText() { text.current?.focus(); }, focusReport() { report.current?.focus(); }, clearFile() { if (file.current) file.current.value = ''; } }), [controller]);

  return <dialog ref={dialog} id="import-dialog" aria-labelledby="import-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) controller.close(); }}><form id="import-form" className="dialog-content" noValidate hidden={Boolean(view.result)} onSubmit={(event) => { event.preventDefault(); controller.submit(); }}><div><h2 id="import-dialog-title">Import Monkeytype settings</h2><p>In Monkeytype: settings → danger zone → import/export settings → export. Paste it here or choose its file.</p></div><label htmlFor="import-text">Monkeytype settings<textarea ref={text} id="import-text" className="input textarea import-text" rows={6} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder={'{ "mode": "time", "time": 30, … }'} aria-describedby="import-error" value={view.text} onChange={(event) => controller.edit(event.currentTarget.value)}></textarea></label><div className="import-meta"><p id="import-error" className="field-error" role="alert">{view.error}</p><button id="import-choose" className="btn btn-ghost btn-sm" type="button" onClick={() => file.current?.click()}>Choose a file</button><input ref={file} id="import-file" type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(event) => { const file = event.currentTarget.files?.[0];

 if (file) void controller.file(file); }} /></div><div className="dialog-actions"><button id="cancel-import" className="btn btn-ghost" type="button" onClick={() => controller.close()}>Cancel</button><button id="confirm-import" className="btn btn-primary" type="submit" disabled={!view.text.trim()}>Import settings</button></div></form><div id="import-report" className="dialog-content" hidden={!view.result}><div><h2 ref={report} id="import-report-title" tabIndex={-1}>Settings imported</h2><p id="import-summary">{view.summary}</p></div><section className="import-group" aria-labelledby="import-mapped-title"><h3 id="import-mapped-title" className="account-kicker">brought over</h3><ul id="import-mapped" className="import-rows"><ImportRows rows={view.result?.mapped ?? []} /></ul></section><section id="import-skipped-group" className="import-group" aria-labelledby="import-skipped-title" hidden={!view.result?.skipped.length}><h3 id="import-skipped-title" className="account-kicker">left as they were</h3><ul id="import-skipped" className="import-rows"><ImportRows rows={view.result?.skipped ?? []} /></ul></section><div className="dialog-actions"><button id="import-done" className="btn btn-primary" type="button" onClick={() => controller.close()}>Done</button></div></div></dialog>;
}
