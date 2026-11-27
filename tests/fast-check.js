// fast-check for the property tests (tests/*-properties.test.js), with a fixed seed so every run checks
// the same inputs and a failure reproduces as printed. FC_SEED=<n> bun run test explores other inputs.
import fc from 'fast-check';

fc.configureGlobal({ seed: Number(process.env.FC_SEED) || 522, numRuns: 200, baseSize: 'large' });

export default fc;
