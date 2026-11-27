"""Turns a split's run records into the rows the starting view is fitted on (ADR 0030).

    uv run extract.py --runs <dir of runs-<split>.jsonl.gz> --split train --rate-pair 0.0340 --rate-key 0.0386 --out train.npz

One row is one unit in one predicted run: participant i, having typed k runs, types run k + 1. The row carries
what the learner would know about the person by then, computed as src/learner.ts computes it (the pooled pair rate
with RATE_TRIES tries at the training rate behind it, decayed by run), so a fitted view is fitted on what it will
be asked. The test split is never read here.
"""

import argparse
import gzip
import json
import math
import re

import numpy as np

RATE_TRIES = 200  # Kr, chosen on validation (ADR 0030, "Validation: the rate alone")
HALF_LIFE_RUNS = 60  # HALF_LIFE_RUNS in src/learner.ts
MIN_PACE_MS = 30  # MIN_PACE_MS in src/learner.ts
PAIR = re.compile(r"^[a-z]{2}$")
LETTERS = "abcdefghijklmnopqrstuvwxyz"
UNITS = [a + b for a in LETTERS for b in LETTERS] + list(LETTERS)
INDEX = {unit: i for i, unit in enumerate(UNITS)}


def logit(p):
    return math.log(p / (1 - p))


def rows_of(path, rate_pair, rate_key, limit):
    decay = 0.5 ** (1 / HALF_LIFE_RUNS)
    person, miss, pace = [], [], []

    with gzip.open(path, "rt") as lines:
        for participant, line in enumerate(lines):
            if participant >= limit:
                break
            pair_n = pair_e = key_n = key_e = 0.0
            log_pace, paced = 0.0, 0

            for k, run in enumerate(json.loads(line)["runs"]):
                state = len(person)
                typical = (pair_e + RATE_TRIES * rate_pair) / (pair_n + RATE_TRIES)
                typical_key = (key_e + RATE_TRIES * rate_key) / (key_n + RATE_TRIES)
                # participant, runs seen, logit of the pooled pair and key rates, the mean log interval so far (nan: none)
                person.append((participant, k, logit(typical), logit(typical_key), log_pace / paced if paced else math.nan))
                run_n = run_e = 0
                in_pairs = {}
                run_ms = None

                for pair, seen, errors, timed, pair_ms, slowdown_ms in run.get("patterns") or []:
                    if not PAIR.match(pair) or seen <= 0:
                        continue
                    errors = min(errors, seen)
                    miss.append((state, INDEX[pair], seen, errors))
                    run_n += seen
                    run_e += errors
                    held = in_pairs.get(pair[1], (0, 0))
                    in_pairs[pair[1]] = (held[0] + seen, held[1] + errors)

                    if timed > 0 and pair_ms is not None and slowdown_ms is not None and pair_ms - slowdown_ms >= MIN_PACE_MS and pair_ms > 0:
                        run_ms = run_ms or pair_ms - slowdown_ms
                        pace.append((state, INDEX[pair], timed, math.log(pair_ms / (pair_ms - slowdown_ms))))

                own_n = own_e = 0

                # A key's own tries are those outside a pair: at the start of a word.
                for key, seen, errors in run.get("keys") or []:
                    if key not in INDEX:
                        continue
                    inside = in_pairs.get(key, (0, 0))
                    n = max(0, seen - inside[0])
                    e = max(0, min(n, min(errors, seen) - inside[1]))

                    if n:
                        miss.append((state, INDEX[key], n, e))
                        own_n += n
                        own_e += e

                pair_n, pair_e = pair_n * decay + run_n, pair_e * decay + run_e
                key_n, key_e = key_n * decay + own_n, key_e * decay + own_e

                if run_ms:
                    log_pace += math.log(run_ms)
                    paced += 1

    return np.array(person, dtype=np.float64), np.array(miss, dtype=np.int32), np.array(pace, dtype=np.float64)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--split", choices=["train", "validation"], required=True)
    parser.add_argument("--rate-pair", type=float, required=True)
    parser.add_argument("--rate-key", type=float, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=10**9)
    args = parser.parse_args()
    person, miss, pace = rows_of(f"{args.runs}/runs-{args.split}.jsonl.gz", args.rate_pair, args.rate_key, args.limit)
    np.savez_compressed(args.out, person=person, miss=miss, pace=pace, rates=np.array([args.rate_pair, args.rate_key]))
    print(f"{args.split}: {int(person[:, 0].max()) + 1} participants, {len(person)} predicted runs, {len(miss)} miss rows, {len(pace)} pace rows")


if __name__ == "__main__":
    main()
