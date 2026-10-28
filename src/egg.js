// Nothing to see here. ↑ ↑ ↓ ↓ ← → ← → b a

const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export function listenForSequence(onUnlock) {
  let step = 0;
  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (key === SEQUENCE[step]) {
      step += 1;

      if (step === SEQUENCE.length) {
        step = 0;
        // Keep the final "a" out of any passage; the unlock restarts the test anyway.
        event.preventDefault();
        onUnlock();
      }
    } else {
      // A third ↑ still leaves two in a row.
      step = key !== 'ArrowUp' ? 0 : step === 2 ? 2 : 1;
    }
  }, true);
}
