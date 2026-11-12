import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BASELINE_POLICY, FOCUSES, LEARNER_VARIANTS, fitLearner, keyboardOf, learnerEvidence, recommendFor } from '../src/learner.js';
import { SKILLS, makeTypist, seeded, typeRun } from '../scripts/evaluate-learner.mjs';

// Written against master before learner-let-go@2 existed (ADR 0016): what every earlier policy computes on fixed
// histories, loops included, must never change. A digest of each output, so any change to any figure fails.
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

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
  "3 learner@1 balanced": "d6bf667c419e6f7d 51fbe78c15db623c",
  "3 learner@1 accuracy": "03e127a1caeb14b7 ff7da2082eebc4f6",
  "3 learner@1 speed": "1cb2425945bc9c33 0b4097ed1bf87cc6",
  "3 learner-decay@1 balanced": "4c7ded414b48487e 0da32869c935444a",
  "3 learner-decay@1 accuracy": "38fd960af9a6d5c6 e11092b395aac19a",
  "3 learner-decay@1 speed": "9663dc5da435d817 5eaecd691791fb80",
  "3 learner-timing@1 balanced": "d8e5c725314d0e5d 2e119d2038e2d9ba",
  "3 learner-timing@1 accuracy": "4389ca5f8a8edb7f 79b90b2df91d916e",
  "3 learner-timing@1 speed": "a88b236b06216786 4164eef94e27ba21",
  "3 learner-decay-timing@1 balanced": "3264398ddd659f9a ff668f5b7e41a897",
  "3 learner-decay-timing@1 accuracy": "cc3751bc1da29d0f 794b860aac084a6c",
  "3 learner-decay-timing@1 speed": "1bcebcd5d4dcea6d e23ff34e5278f3c4",
  "3 learner-own-cost@2 balanced": "7faf1b16692238e1 1dc334613c929119",
  "3 learner-own-cost@2 accuracy": "e4ee94a71d2c96d7 822bbf7c833317b2",
  "3 learner-own-cost@2 speed": "31f1d446a91d407d 8ddf24c8b2bb1110",
  "3 counting@1 balanced": "e558d8744b6604bb -",
  "3 counting@1 accuracy": "e558d8744b6604bb -",
  "3 counting@1 speed": "e558d8744b6604bb -",
  "4 learner@1 balanced": "5b4c88504d3f8bf1 16f0bc87fb6f0e13",
  "4 learner@1 accuracy": "b5153cbd8c00d532 612a743f107a632e",
  "4 learner@1 speed": "1cb2425945bc9c33 35dba59b5c6b3a7b",
  "4 learner-decay@1 balanced": "8d2a1c03ba109965 778b288981e1f21a",
  "4 learner-decay@1 accuracy": "cb96070f056760d0 45e5062affbb3899",
  "4 learner-decay@1 speed": "9663dc5da435d817 3b06baa0542fe440",
  "4 learner-timing@1 balanced": "f1669f7b4f2e7397 c19854d82151f029",
  "4 learner-timing@1 accuracy": "cb4775e2dad45e8e 9004c45680e5386f",
  "4 learner-timing@1 speed": "8b154ec6716c73db 79d92261ad7d5f49",
  "4 learner-decay-timing@1 balanced": "acf95100d7f5aeba 29dfe609b783fcd1",
  "4 learner-decay-timing@1 accuracy": "13df051ea9e7435b 0c028186c061c0b1",
  "4 learner-decay-timing@1 speed": "123bbc535b1032fd e5a33d899ed599c8",
  "4 learner-own-cost@2 balanced": "7c99c1bcea31a190 a4f62428495f01b5",
  "4 learner-own-cost@2 accuracy": "1c3056fd043d8a8c b81e1f8d52bba040",
  "4 learner-own-cost@2 speed": "97139dfc29cef080 0c4a57b5fcefdd5c",
  "4 counting@1 balanced": "59e0aa4e4d55f932 -",
  "4 counting@1 accuracy": "59e0aa4e4d55f932 -",
  "4 counting@1 speed": "59e0aa4e4d55f932 -",
  "7 learner@1 balanced": "1605500c4e0e24ae 4f2e4a7a759d9666",
  "7 learner@1 accuracy": "1384829c3c0c67e7 a69ecb5ae0d13937",
  "7 learner@1 speed": "1cb2425945bc9c33 3dde5cf8975b3a33",
  "7 learner-decay@1 balanced": "6a41659fb440d347 54eca46e8d7a1483",
  "7 learner-decay@1 accuracy": "276d04b5034403e9 8afb2cb8bf08fa2d",
  "7 learner-decay@1 speed": "9663dc5da435d817 eaf56dd67fda70f1",
  "7 learner-timing@1 balanced": "3418239932e24f56 4b55a38ab6d04d67",
  "7 learner-timing@1 accuracy": "6262802173544bc0 30fa83f7e0c40bef",
  "7 learner-timing@1 speed": "3f79ad092ed7da6c 18b15f3807b9ec28",
  "7 learner-decay-timing@1 balanced": "0a1bc7a734705fed d97cbc484b3d0ff9",
  "7 learner-decay-timing@1 accuracy": "045c3f61cb97d201 54857acd252e777e",
  "7 learner-decay-timing@1 speed": "c067b749898a47a1 32508f10f1c36128",
  "7 learner-own-cost@2 balanced": "03d31d43786bf3bb 426f18d706ac3840",
  "7 learner-own-cost@2 accuracy": "0c184b6973f57f59 9d26bfa468164245",
  "7 learner-own-cost@2 speed": "d1d6c42a44913953 4339c229dcf87fe6",
  "7 counting@1 balanced": "97071df321194ec3 -",
  "7 counting@1 accuracy": "97071df321194ec3 -",
  "7 counting@1 speed": "97071df321194ec3 -",
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
