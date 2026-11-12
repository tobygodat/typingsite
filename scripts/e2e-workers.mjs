// How many Playwright workers a run starts with: the cores nobody is using, at most two thirds of the
// machine, and never fewer than FLOOR. Several agents and the CI runner share one desktop, and a run that
// asks for two thirds of it while others are running makes every run slower and fails tests on timeouts.
// Read once, when the run starts: two runs started in the same second both see an idle machine.
export const FLOOR = 4;
export const SHARE = 0.67;

export function workersFor(cores, load) {
  const ceiling = Math.max(1, Math.round(cores * SHARE));
  const idle = Math.floor(cores - load);

  return Math.min(ceiling, Math.max(Math.min(FLOOR, ceiling), idle));
}
