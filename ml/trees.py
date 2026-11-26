"""S3 (ADR 0030): gradient-boosted trees over S2's features, reported beside S2 and never shipped.

    uv run trees.py --train train.npz --validation validation.npz --frequency frequency.json [--participants 10000]

It shows whether the regression leaves a gap a freer model would close. Its figures are the starting view alone
on the validation participants, as fit.py prints them for S1 and S2, so the three can be read side by side.
"""

import argparse
import json

import lightgbm
import numpy as np

from fit import PAIRS, load, loss_by_band, pace_by_band, pair_features, show
from extract import UNITS

SETTINGS = {"num_leaves": 63, "learning_rate": 0.05, "min_child_weight": 50, "verbose": -1, "seed": 513}
ROUNDS = 300


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--frequency", required=True)
    parser.add_argument("--participants", type=int, default=10000)
    args = parser.parse_args()

    with open(args.frequency) as file:
        frequency = json.load(file)

    rarest = min(frequency["pairs"].values()) / 2
    pair_x = np.array([pair_features(unit, frequency, rarest) for unit in UNITS[:PAIRS]], dtype=np.float32)
    train = load(args.train)
    validation = load(args.validation, train["pace_centre"])

    def miss_rows(data, limit=None):
        keep = data["unit"] < PAIRS

        if limit:
            keep &= data["participant"][data["state"]] < limit

        return np.column_stack([pair_x[data["unit"][keep]], data["g"][data["state"][keep], 1]]), keep

    x, keep = miss_rows(train, args.participants)
    n, e, offset = train["n"][keep], train["e"][keep], train["offset"][keep]
    data = lightgbm.Dataset(np.vstack([x, x]), label=np.concatenate([np.ones(len(x)), np.zeros(len(x))]), weight=np.concatenate([e, n - e]),
                            init_score=np.concatenate([offset, offset]))
    model = lightgbm.train({"objective": "binary", **SETTINGS}, data, ROUNDS)
    x, keep = miss_rows(validation)
    eta = np.array(validation["offset"])
    eta[keep] += model.predict(x, raw_score=True)
    show("pair log loss, S3", loss_by_band(validation, eta, "pair"))

    def pace_rows(data, limit=None):
        keep = np.ones(len(data["pace_unit"]), dtype=bool) if not limit else data["participant"][data["pace_state"]] < limit

        return np.column_stack([pair_x[data["pace_unit"][keep]], data["g"][data["pace_state"][keep], 1]]), keep

    x, keep = pace_rows(train, args.participants)
    model = lightgbm.train({"objective": "regression", **SETTINGS}, lightgbm.Dataset(x, label=train["pace_y"][keep], weight=train["pace_n"][keep]), ROUNDS)
    x, _ = pace_rows(validation)
    show("pace error, S3", pace_by_band(validation, model.predict(x)))


if __name__ == "__main__":
    main()
