// Canonical product version and user-facing notes for this app artifact.
// A branch proposes this version; only a deployment makes it a deployed release.
// See docs/releases.md. Keep private package metadata in sync (tested).
export const release = Object.freeze({
  version: '0.2.0',
  notes: Object.freeze([
    'Include numbers in generated typing tests from Settings → test content.',
    'Choose a pace cursor based on your best, recent average, last run, or a custom WPM.',
    'Install Stilltype and practise offline after an initial online visit. Accounts and online races need a connection.',
    'Open the version in the footer to see what’s new.',
  ]),
});
