import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { setShownSpeedUnit, showSpeed, unitText } from './units.js';
import type { SpeedUnit } from './units.js';

export function createDisplayedUnits() {
  const view = createStore<SpeedUnit>('wpm');

  return {
    view,
    select(unit: SpeedUnit) {
      const changed = setShownSpeedUnit(unit);

      if (view.getSnapshot() !== unit) flushSync(() => view.publish(unit));

      if (!changed) return false;
      const nativeSpeed = document.getElementById('live-wpm');

      if (nativeSpeed?.dataset.wpm !== undefined) showSpeed(nativeSpeed, Number(nativeSpeed.dataset.wpm));
      document.querySelectorAll<HTMLElement>('#live-stats .live-stat [data-speed-unit]').forEach((node) => {
        node.textContent = unitText(node.dataset.speedUnit || '{unit}');
      });

      return true;
    },
  };
}
