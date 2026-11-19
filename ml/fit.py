"""Fits the starting view's models on the training participants' rows (ADR 0026) and writes them as the JSON
src/learner.ts reads (StartingView.units).

    uv run fit.py --train train.npz --validation validation.npz --frequency frequency.json --out models.json

S1 is a table: one number per unit for misses and one for pace. S2 is a regression over what the keyboard says
about a unit, times what the learner knows about the person. Both come out as coefficients per unit over the
person, [1, how far the log odds of their pooled miss rate sit from the training rate], so the app does no more
than a dot product. What this prints is a guide for choosing what to score: every judged number comes from
scripts/evaluate-start.mjs running the app's own learner.
"""

import argparse
import json

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit

from extract import LETTERS, UNITS

PAIRS = 26 * 26
ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
# The finger that types each column of the three letter rows, left little finger (0) to right little finger (7).
FINGER_OF_COLUMN = [0, 1, 2, 3, 3, 4, 4, 5, 6, 7]
BANDS = [("0", 0, 0), ("1-2", 1, 2), ("3-5", 3, 5), ("6-9", 6, 9), ("10-14", 10, 14)]
DECIMALS = 4


def place(letter):
    row = next(r for r, keys in enumerate(ROWS) if letter in keys)
    column = ROWS[row].index(letter)

    return row, column, FINGER_OF_COLUMN[column]


def one_hot(value, size):
    return [1.0 if i == value else 0.0 for i in range(size)]


def key_features(letter, frequency):
    row, column, finger = place(letter)

    return [1.0, *one_hot(finger, 8), *one_hot(row, 3), *one_hot(column, 10), np.log(frequency["keys"][letter])]


def pair_features(pair, frequency, rarest):
    (row1, column1, finger1), (row2, column2, finger2) = place(pair[0]), place(pair[1])
    left1, left2 = finger1 < 4, finger2 < 4

    return [1.0, *one_hot(finger1, 8), *one_hot(finger2, 8), *one_hot(row1, 3), *one_hot(row2, 3), *one_hot(column1, 10), *one_hot(column2, 10),
            float(pair[0] == pair[1]), float(finger1 == finger2 and pair[0] != pair[1]), float(left1 == left2), *one_hot(abs(row1 - row2), 3),
            *one_hot(2 * left1 + left2, 4), np.log(frequency["pairs"].get(pair, rarest)), np.log(frequency["keys"][pair[0]]), np.log(frequency["keys"][pair[1]])]


def load(path, pace_centre=None):
    data = np.load(path)
    person, miss, pace, rates = data["person"], data["miss"], data["pace"], data["rates"]
    centre = np.nanmedian(person[:, 4]) if pace_centre is None else pace_centre
    is_pair = miss[:, 1] < PAIRS

    return {"k": person[:, 1].astype(int), "participant": person[:, 0].astype(int),
            # the person as the learner reads them: [1, pooled miss rate against the training rate, pace against the training median]
            "g": np.column_stack([np.ones(len(person)), person[:, 2] - logit(rates[0]), np.nan_to_num(person[:, 4] - centre)]),
            "offset": np.where(is_pair, person[miss[:, 0], 2], person[miss[:, 0], 3]),
            "state": miss[:, 0], "unit": miss[:, 1], "n": miss[:, 2].astype(float), "e": miss[:, 3].astype(float),
            "pace_state": pace[:, 0].astype(int), "pace_unit": pace[:, 1].astype(int), "pace_n": pace[:, 2], "pace_y": pace[:, 3], "pace_centre": centre}


def loss_by_band(data, eta, kind):
    """Mean over participants of each one's log loss in a band, as the harness reads it, for pairs or keys."""
    keep = (data["unit"] < PAIRS) == (kind == "pair")
    p = np.clip(expit(eta[keep]), 1e-6, 1 - 1e-6)
    n, e, state = data["n"][keep], data["e"][keep], data["state"][keep]
    loss = -(e * np.log(p) + (n - e) * np.log(1 - p))
    people = data["participant"].max() + 1
    out = []

    for _, low, high in BANDS:
        inside = (data["k"][state] >= low) & (data["k"][state] <= high)
        who = data["participant"][state[inside]]
        total = np.bincount(who, loss[inside], people)
        tries = np.bincount(who, n[inside], people)
        out.append(float(np.mean(total[tries > 0] / tries[tries > 0])))

    return out


def pace_by_band(data, predicted):
    error = data["pace_n"] * np.abs(predicted - data["pace_y"])
    people = data["participant"].max() + 1
    out = []

    for _, low, high in BANDS:
        inside = (data["k"][data["pace_state"]] >= low) & (data["k"][data["pace_state"]] <= high)
        who = data["participant"][data["pace_state"][inside]]
        total = np.bincount(who, error[inside], people)
        timed = np.bincount(who, data["pace_n"][inside], people)
        out.append(float(np.mean(total[timed > 0] / timed[timed > 0])))

    return out


def table_miss(data, shrink):
    """S1: each unit's log odds of a miss against what the participants' own rates expect, pulled toward none."""
    count = len(UNITS)
    tries = np.bincount(data["unit"], data["n"], count)
    missed = np.bincount(data["unit"], data["e"], count)
    expected = np.bincount(data["unit"], data["n"] * expit(data["offset"]), count)
    seen = tries > 0
    a = np.zeros(count)
    typical = expected[seen] / tries[seen]
    a[seen] = logit((missed[seen] + shrink * typical) / (tries[seen] + shrink)) - logit(typical)

    return np.column_stack([a, np.zeros(count)])


def table_pace(data, shrink):
    count = len(UNITS)
    timed = np.bincount(data["pace_unit"], data["pace_n"], count)
    total = np.bincount(data["pace_unit"], data["pace_n"] * data["pace_y"], count)

    return np.column_stack([total / (timed + shrink), np.zeros(count)])


def regression_miss(data, features, units, people, penalty):
    """S2: an L2-regularized logistic regression with the person's own pooled rate as the offset. Returns each
    unit's coefficients over the first `people` person terms."""
    keep = np.isin(data["unit"], units)
    local = np.searchsorted(units, data["unit"][keep])
    g = data["g"][data["state"][keep], :people]
    n, e, offset = data["n"][keep], data["e"][keep], data["offset"][keep]
    total = n.sum()
    shape = (features.shape[1], people)

    def objective(flat):
        weights = flat.reshape(shape)
        by_unit = features @ weights
        p = np.clip(expit(offset + np.einsum("ij,ij->i", by_unit[local], g)), 1e-9, 1 - 1e-9)
        residual = n * p - e
        gathered = np.column_stack([np.bincount(local, residual * g[:, j], len(units)) for j in range(people)])
        value = -(e * np.log(p) + (n - e) * np.log(1 - p)).sum() / total + 0.5 * penalty * (flat ** 2).sum()

        return value, (features.T @ gathered / total + penalty * weights).ravel()

    result = minimize(objective, np.zeros(shape[0] * shape[1]), jac=True, method="L-BFGS-B", options={"maxiter": 300})

    return features @ result.x.reshape(shape)


def regression_pace(data, features, people, penalty):
    """S2: a ridge regression of a pair's log slowdown, weighted by its timed tries."""
    g = data["g"][data["pace_state"], :people]
    unit, n, y = data["pace_unit"], data["pace_n"], data["pace_y"]
    width = features.shape[1]
    gram = np.zeros((width * people, width * people))
    moment = np.zeros(width * people)

    for i in range(people):
        by_unit = np.bincount(unit, n * y * g[:, i], PAIRS)
        moment[i::people] = features.T @ by_unit

        for j in range(people):
            weight = np.bincount(unit, n * g[:, i] * g[:, j], PAIRS)
            gram[i::people, j::people] = features.T @ (features * weight[:, None])

    total = n.sum()
    beta = np.linalg.solve(gram / total + penalty * np.eye(len(gram)), moment / total)

    return features @ beta.reshape(width, people)


def eta_of(data, miss):
    return data["offset"] + np.einsum("ij,ij->i", miss[data["unit"]], data["g"][data["state"], :miss.shape[1]])


def pace_of(data, pace):
    return np.einsum("ij,ij->i", pace[data["pace_unit"]], data["g"][data["pace_state"], :pace.shape[1]])


def units_json(miss, pace):
    units = {}

    for index, unit in enumerate(UNITS):
        entry = {}

        if np.any(np.round(miss[index], DECIMALS)):
            entry["miss"] = [round(float(c), DECIMALS) for c in miss[index]]

        if index < PAIRS and np.any(np.round(pace[index], DECIMALS)):
            entry["pace"] = [round(float(c), DECIMALS) for c in pace[index]]

        if entry:
            units[unit] = entry

    return units


def show(name, figures):
    print(f"{name:<34}" + "  ".join(f"{value:.5f}" for value in figures), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--frequency", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--people", type=int, default=2, help="person terms: 2 is [1, miss rate], 3 adds pace (not read by the app)")
    args = parser.parse_args()

    with open(args.frequency) as file:
        frequency = json.load(file)

    rarest = min(frequency["pairs"].values()) / 2
    pair_x = np.array([pair_features(unit, frequency, rarest) for unit in UNITS[:PAIRS]])
    key_x = np.array([key_features(letter, frequency) for letter in LETTERS])
    train = load(args.train)
    validation = load(args.validation, train["pace_centre"])
    pair_units, key_units = np.arange(PAIRS), np.arange(PAIRS, len(UNITS))
    nothing = np.zeros((len(UNITS), 1))
    models = {}

    print("validation, the starting view alone (no evidence of the person's own on the unit), by runs seen: " + ", ".join(name for name, _, _ in BANDS))
    show("pair log loss, rate alone", loss_by_band(validation, eta_of(validation, nothing), "pair"))
    show("key log loss, rate alone", loss_by_band(validation, eta_of(validation, nothing), "key"))
    show("pace error, none", pace_by_band(validation, pace_of(validation, nothing[:PAIRS])))

    for shrink in [20, 100, 500, 2000]:
        miss = table_miss(train, shrink)
        models[f"S1-m{shrink}"] = {"miss": miss}
        show(f"pair log loss, S1 shrink {shrink}", loss_by_band(validation, eta_of(validation, miss), "pair"))
        show(f"key log loss, S1 shrink {shrink}", loss_by_band(validation, eta_of(validation, miss), "key"))

    for shrink in [5, 20, 100, 500]:
        pace = table_pace(train, shrink)
        models[f"S1-p{shrink}"] = {"pace": pace}
        show(f"pace error, S1 shrink {shrink}", pace_by_band(validation, pace_of(validation, pace)))

    for penalty in [1e-6, 1e-5, 1e-4, 1e-3]:
        miss = np.zeros((len(UNITS), args.people))
        miss[:PAIRS] = regression_miss(train, pair_x, pair_units, args.people, penalty)
        miss[PAIRS:] = regression_miss(train, key_x, key_units, args.people, penalty)
        pace = np.zeros((len(UNITS), args.people))
        pace[:PAIRS] = regression_pace(train, pair_x, args.people, penalty)
        models[f"S2-l{penalty:g}"] = {"miss": miss, "pace": pace}
        show(f"pair log loss, S2 penalty {penalty:g}", loss_by_band(validation, eta_of(validation, miss), "pair"))
        show(f"key log loss, S2 penalty {penalty:g}", loss_by_band(validation, eta_of(validation, miss), "key"))
        show(f"pace error, S2 penalty {penalty:g}", pace_by_band(validation, pace_of(validation, pace)))

    empty = np.zeros((len(UNITS), 2))

    with open(args.out, "w") as file:
        json.dump({name: units_json(model.get("miss", empty), model.get("pace", empty)) for name, model in models.items()}, file)


if __name__ == "__main__":
    main()
