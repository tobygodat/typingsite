import { useLayoutEffect, useRef, useState } from 'react';

interface ReleaseHost { open(): void; close(): void }

export function createReleaseDialog() {
  let host: ReleaseHost | null = null;
  let beforeOpen = () => {};

  return { configure(next: () => void) { beforeOpen = next; }, attach(next: ReleaseHost) { host = next;

 return () => { if (host === next) host = null; }; }, open() { beforeOpen(); host?.open(); }, close() { host?.close(); } };
}

export type ReleaseController = ReturnType<typeof createReleaseDialog>;

export function ReleaseDialog({ controller }: { controller?: ReleaseController } = {}) {
  const [local] = useState(createReleaseDialog);
  const release = controller ?? local;
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => release.attach({ open() { dialog.current?.showModal(); }, close() { dialog.current?.close(); document.getElementById('release-trigger')?.focus({ preventScroll: true }); } }), [release]);

  return (
<dialog ref={dialog} onCancel={(event) => { event.preventDefault(); release.close(); }} onClick={(event) => { if (event.target === event.currentTarget) release.close(); }} id="release-dialog" aria-labelledby="release-title">
    <header className="settings-header">
      <h2 id="release-title">v0.5.0</h2>
      <button id="release-close" type="button" aria-label="Close" onClick={() => release.close()}><span>esc</span><span aria-hidden="true">×</span></button>
    </header>
    <ul className="release-notes">
      <li>After 10 rated races your race rating carries a rank, from Whisper through Breeze, Gust, Gale and Tempest to Hurricane, and each rated result shows it on a card.</li>
      <li>Quick match races someone near your rating, or your own best run when nobody is waiting.</li>
      <li>Your race rating moves only on quick matches, never your practice.</li>
      <li>In settings, choose Train’s focus, a drill of 15 to 120 seconds, and whether a retest follows.</li>
      <li>Train estimates from your tests on fresh text which letters and pairs cost most.</li>
      <li>Race a friend live with an invite or a link.</li>
    </ul>
  </dialog>
  );
}
