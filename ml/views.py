"""Writes the starting views scripts/evaluate-start.mjs scores (--views), from the models fit.py wrote.

    uv run views.py --models models.json --rate-pair 0.0340 --rate-key 0.0386 --out views.json NAME=MISS,PACE,Km,Kt ...

MISS and PACE name a model in models.json, or "-" for none. Km and Kt are the tries and intervals a unit's own
evidence must outweigh (missTries and paceTries in StartingView).
"""

import argparse
import json

RATE_TRIES = 200


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True)
    parser.add_argument("--rate-pair", type=float, required=True)
    parser.add_argument("--rate-key", type=float, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("views", nargs="+")
    args = parser.parse_args()

    with open(args.models) as file:
        models = json.load(file)

    views = []

    for spec in args.views:
        name, rest = spec.split("=")
        miss, pace, miss_tries, pace_tries = rest.split(",")
        units = {}

        for model, half in ((miss, "miss"), (pace, "pace")):
            for unit, entry in (models[model].items() if model != "-" else []):
                if half in entry:
                    units.setdefault(unit, {})[half] = entry[half]

        views.append({"name": name, "start": {"rate": {"pair": args.rate_pair, "key": args.rate_key}, "rateTries": RATE_TRIES,
                                              "missTries": int(miss_tries), "paceTries": int(pace_tries), "units": units}})

    with open(args.out, "w") as file:
        json.dump(views, file)


if __name__ == "__main__":
    main()
