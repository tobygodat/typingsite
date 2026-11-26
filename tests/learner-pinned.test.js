import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BASELINE_POLICY, FOCUSES, LEARNER_VARIANTS, fitLearner, keyboardOf, learnerEvidence, recommendFor } from '../src/learner.js';
import { SKILLS, makeTypist, seeded, typeRun } from '../scripts/evaluate-learner.mjs';

// Written against master before learner-let-go@2 existed (ADR 0016): what every earlier policy computes on fixed
// histories, loops included, must never change. A digest of each output, with fractions at 10 significant
// digits, so any change to any figure past that fails. Math.log, Math.exp and ** can differ in the last bit
// between an arm64 and an x64 machine (up to 2e-15 relative on these histories), and the pins must hold on
// both. A new pin is checked on both, for example with an x64 Node under Rosetta on an Apple Silicon Mac.
const tenDigits = (_, value) => (typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(10)) : value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value, tenDigits)).digest('hex').slice(0, 16);

function history(seed, count) {
  const random = seeded(seed);
  const typist = makeTypist(random, seed % 2 ? 'mechanics' : 'drifting', SKILLS[seed % 3], seed);
  const typed = Array.from({ length: count }, (_, r) => typeRun(typist, random, r, `pin${seed}-${r}`));
  const runs = typed.map((item) => item.run);
  const traces = typed.slice(-24).map((item) => item.trace);
  const conditions = runs[0].conditions;

  // Loops on the typist's planted pairs, one before its newest runs and one that points at a run no longer kept.
  const loops = typist.planted.slice(0, 2).map((planted, i) => ({ id: `loop${seed}-${i}`, at: runs[count - 8 + i].at, beforeAttemptId: runs[count - 9 + i].id,
    afterAttemptId: i ? 'gone' : runs[count - 8 + i].id, target: planted.pair, recommendationKind: 'targeted', policy: 'learner-decay-timing@1', focus: 'balanced',
    targetBasis: planted.stratum === 'slow' ? 'slow' : 'errors', conditions, comparison: { state: 'improved' } }));

  return { runs, traces, loops, conditions, now: Date.parse(runs.at(-1).at) + 3_600_000 };
}

const PINNED_POLICIES = ['learner@1', 'learner-decay@1', 'learner-timing@1', 'learner-decay-timing@1', 'learner-own-cost@2'];

const PINNED = {
  "3 learner@1 balanced": "f961cc7f259f19f3 17d6000ad605b0bd",
  "3 learner@1 accuracy": "20c9ee03b3d2dd1f bc7c0cc099345c7f",
  "3 learner@1 speed": "1cb2425945bc9c33 01c05c8b9d3e9ac4",
  "3 learner-decay@1 balanced": "95a6961e24c9fdb9 6f7770e9626e9ea4",
  "3 learner-decay@1 accuracy": "7f345bde67458a6b 9bd9f1d2d94589cf",
  "3 learner-decay@1 speed": "9663dc5da435d817 0f586a3b9c7de42f",
  "3 learner-timing@1 balanced": "75e0c4bd42f63c96 cb5e46d6273d5452",
  "3 learner-timing@1 accuracy": "8f28534c244312f1 3aac49a15cc379ff",
  "3 learner-timing@1 speed": "997820685bb0b54e ce81482d1154368d",
  "3 learner-decay-timing@1 balanced": "3fb1648e58fd3f64 8e9d42fc9e44c39c",
  "3 learner-decay-timing@1 accuracy": "49647e06ddd0d30c cd2df31445618d1d",
  "3 learner-decay-timing@1 speed": "15c28ad419cc62e0 41ec3b3e5110fd03",
  "3 learner-own-cost@2 balanced": "e307e81d915ca832 c18cc05c21f022fc",
  "3 learner-own-cost@2 accuracy": "3256908e7992ebe2 e1031e634f662d18",
  "3 learner-own-cost@2 speed": "0f9ded4217836600 1f61ef5d7fff04a9",
  "3 counting@1 balanced": "6ccef2ce84c3b095 -",
  "3 counting@1 accuracy": "6ccef2ce84c3b095 -",
  "3 counting@1 speed": "6ccef2ce84c3b095 -",
  "4 learner@1 balanced": "7f3c4a6261c620e6 e8f3ac3c053ff9fd",
  "4 learner@1 accuracy": "259bf8dd0610440e e60cb6924535f3ea",
  "4 learner@1 speed": "1cb2425945bc9c33 27cf587950045fab",
  "4 learner-decay@1 balanced": "84881397da1b0961 4d79b67098ca8f2c",
  "4 learner-decay@1 accuracy": "4c33266f0cdacfae 626fbd0da89fb4d2",
  "4 learner-decay@1 speed": "9663dc5da435d817 a5699eb619392b4d",
  "4 learner-timing@1 balanced": "17871f0349452ab9 7a1916d62699d4c6",
  "4 learner-timing@1 accuracy": "5ce7e85345ff0b0a cc276740d5cf3da6",
  "4 learner-timing@1 speed": "7a101f48ffb147df 355b03ef279ef240",
  "4 learner-decay-timing@1 balanced": "1f7885ef5dbf68b1 9af5d0e8f9ee181e",
  "4 learner-decay-timing@1 accuracy": "e2debabba4a68e9d 9aeec36a1aa4d885",
  "4 learner-decay-timing@1 speed": "44c5092a36a0da64 c46d6264ba7429ff",
  "4 learner-own-cost@2 balanced": "9cebc1643f58bedd ed1e9616dd6c3650",
  "4 learner-own-cost@2 accuracy": "35882eabb1465046 cb6bba9171fbfc94",
  "4 learner-own-cost@2 speed": "9f267e2b45b64ddd 3d403926eae0d6f8",
  "4 counting@1 balanced": "11a7066f45b291a2 -",
  "4 counting@1 accuracy": "11a7066f45b291a2 -",
  "4 counting@1 speed": "11a7066f45b291a2 -",
  "7 learner@1 balanced": "83f6f22e9e328a85 4a713a1c08beec54",
  "7 learner@1 accuracy": "fcea7547cc94564a be5c382115537d1a",
  "7 learner@1 speed": "1cb2425945bc9c33 dca94f24e8ab8bc6",
  "7 learner-decay@1 balanced": "b313f7adfed567bd c6b6044648d4855d",
  "7 learner-decay@1 accuracy": "e5c8137c04c20777 de2fa1b957b47e4d",
  "7 learner-decay@1 speed": "9663dc5da435d817 dd199b21cdeacc85",
  "7 learner-timing@1 balanced": "0e34922ee6cf0e6c ee3020acb07e73b9",
  "7 learner-timing@1 accuracy": "5b6f046712413d26 9b033db695b644fa",
  "7 learner-timing@1 speed": "f9ce2dc26146369f e9f6bb39dde7783c",
  "7 learner-decay-timing@1 balanced": "f135c441506e52bd 6983d46501191622",
  "7 learner-decay-timing@1 accuracy": "3a014fd6762328da eb1e111a0870a4a3",
  "7 learner-decay-timing@1 speed": "4e3ca5afa3fe8da4 c9796aad95eddd03",
  "7 learner-own-cost@2 balanced": "e4965b70c79ff046 3e3e98b388626626",
  "7 learner-own-cost@2 accuracy": "9e7b1eeaa92d80e9 9908d0fdb458d2cf",
  "7 learner-own-cost@2 speed": "8b903446cd0b0474 e474eebf95ce1c37",
  "7 counting@1 balanced": "d1f0cdf202e93b78 -",
  "7 counting@1 accuracy": "d1f0cdf202e93b78 -",
  "7 counting@1 speed": "d1f0cdf202e93b78 -",
};

test('every policy before learner-let-go@2 computes exactly what it computed on master, loops or none', () => {
  const seen = {};

  for (const seed of [3, 4, 7]) {
    const { runs, traces, loops, conditions, now } = history(seed, 30);
    const evidence = learnerEvidence(runs, keyboardOf(conditions));

    for (const policy of [...PINNED_POLICIES, BASELINE_POLICY]) {
      for (const focus of FOCUSES) {
        const key = `${seed} ${policy} ${focus}`;
        const recommendation = recommendFor(policy, { runs, loops, traces, source: conditions, now, focus });
        const model = policy === BASELINE_POLICY ? null : fitLearner(evidence, now, LEARNER_VARIANTS[policy], focus);
        seen[key] = `${digest(recommendation)} ${model ? digest(model) : '-'}`;
      }
    }
  }

  assert.deepEqual(seen, PINNED);
});

test('a policy that does not let go never reads a stored loop, so a malformed one cannot break it', () => {
  const { runs, traces, loops, conditions, now } = history(3, 30);
  const malformed = [...loops, { id: 'no-conditions', at: runs.at(-1).at, target: 'th', conditions: null }, { id: 'no-date', target: 'he' }];

  for (const policy of PINNED_POLICIES) {
    for (const focus of FOCUSES) {
      const clean = recommendFor(policy, { runs, loops: [], traces, source: conditions, now, focus });

      assert.deepEqual(recommendFor(policy, { runs, loops: malformed, traces, source: conditions, now, focus }), clean, `${policy} ${focus}`);
      assert.deepEqual(recommendFor(policy, { runs, loops: null, traces, source: conditions, now, focus }), clean, `${policy} ${focus} without loops`);
    }
  }
});
