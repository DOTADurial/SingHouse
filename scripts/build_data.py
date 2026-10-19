#!/usr/bin/env python3
"""Build data/hdb-data.js for the dashboard.

Two modes:

  python3 scripts/build_data.py --csv path/to/resale.csv [--csv more.csv ...]
      Aggregate the official HDB resale flat transactions published on
      data.gov.sg ("Resale flat prices based on registration date ...").
      Columns used: month, town, flat_type, resale_price.

  python3 scripts/build_data.py --sample
      Generate a deterministic *estimated* dataset that follows the public
      HDB Resale Price Index trend. Used as the bundled default so the site
      works offline; replace it with real data via --csv.

Both modes go through the same aggregation, so the output shape is identical.
"""

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "hdb-data.js"

# id (as spelled in the HDB CSV), English, Chinese, region, tile column, tile row
TOWNS = [
    ("WOODLANDS", "Woodlands", "兀兰", "North", 2, 0),
    ("SEMBAWANG", "Sembawang", "三巴旺", "North", 3, 0),
    ("YISHUN", "Yishun", "义顺", "North", 4, 0),
    ("CHOA CHU KANG", "Choa Chu Kang", "蔡厝港", "West", 1, 1),
    ("BUKIT PANJANG", "Bukit Panjang", "武吉班让", "West", 2, 1),
    ("ANG MO KIO", "Ang Mo Kio", "宏茂桥", "North-East", 4, 1),
    ("SENGKANG", "Sengkang", "盛港", "North-East", 5, 1),
    ("PUNGGOL", "Punggol", "榜鹅", "North-East", 6, 1),
    ("PASIR RIS", "Pasir Ris", "巴西立", "East", 7, 1),
    ("JURONG WEST", "Jurong West", "裕廊西", "West", 0, 2),
    ("BUKIT BATOK", "Bukit Batok", "武吉巴督", "West", 1, 2),
    ("BUKIT TIMAH", "Bukit Timah", "武吉知马", "Central", 2, 2),
    ("BISHAN", "Bishan", "碧山", "Central", 3, 2),
    ("SERANGOON", "Serangoon", "实龙岗", "North-East", 4, 2),
    ("HOUGANG", "Hougang", "后港", "North-East", 5, 2),
    ("TAMPINES", "Tampines", "淡滨尼", "East", 6, 2),
    ("JURONG EAST", "Jurong East", "裕廊东", "West", 1, 3),
    ("CLEMENTI", "Clementi", "金文泰", "West", 2, 3),
    ("TOA PAYOH", "Toa Payoh", "大巴窑", "Central", 3, 3),
    ("KALLANG/WHAMPOA", "Kallang/Whampoa", "加冷/黄埔", "Central", 4, 3),
    ("GEYLANG", "Geylang", "芽笼", "Central", 5, 3),
    ("BEDOK", "Bedok", "勿洛", "East", 6, 3),
    ("QUEENSTOWN", "Queenstown", "女皇镇", "Central", 2, 4),
    ("BUKIT MERAH", "Bukit Merah", "红山", "Central", 3, 4),
    ("CENTRAL AREA", "Central Area", "中区", "Central", 4, 4),
    ("MARINE PARADE", "Marine Parade", "马林百列", "Central", 5, 4),
]
TOWN_IDS = {t[0] for t in TOWNS}
TOWN_REGION = {t[0]: t[3] for t in TOWNS}
REGIONS = ["Central", "North", "North-East", "East", "West"]

TYPES = ["ALL", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE"]
MIN_SAMPLE = 5  # cells with fewer transactions are reported as missing


def percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    pos = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def summarise(prices):
    if len(prices) < MIN_SAMPLE:
        return None
    s = sorted(prices)
    return [round(percentile(s, 0.25)), round(percentile(s, 0.5)), round(percentile(s, 0.75)), len(s)]


def aggregate(rows):
    """rows: iterable of (town, year, flat_type, price)."""
    cells = defaultdict(list)  # (town, type, year) -> prices
    for town, year, ftype, price in rows:
        if town not in TOWN_IDS:
            continue
        for key in (town, TOWN_REGION[town], "__SG__"):
            cells[(key, "ALL", year)].append(price)
            if ftype in TYPES:
                cells[(key, ftype, year)].append(price)

    years = sorted({k[2] for k in cells})

    def series(town, ftype):
        return [summarise(cells.get((town, ftype, y), [])) for y in years]

    stats = {t[0]: {ft: series(t[0], ft) for ft in TYPES} for t in TOWNS}
    regions = {r: {ft: series(r, ft) for ft in TYPES} for r in REGIONS}
    national = {ft: series("__SG__", ft) for ft in TYPES}
    return years, stats, regions, national


def read_csv_rows(paths, latest_year):
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                year = int(r["month"][:4])
                if latest_year and year > latest_year:
                    continue
                yield r["town"].strip().upper(), year, r["flat_type"].strip().upper(), float(r["resale_price"])


# ---------------------------------------------------------------- sample mode
# Approximate 2024 4-room median resale price (SGD) per town.
BASE_4R_2024 = {
    "ANG MO KIO": 615000, "BEDOK": 565000, "BISHAN": 760000, "BUKIT BATOK": 565000,
    "BUKIT MERAH": 820000, "BUKIT PANJANG": 575000, "BUKIT TIMAH": 860000,
    "CENTRAL AREA": 1010000, "CHOA CHU KANG": 555000, "CLEMENTI": 745000,
    "GEYLANG": 640000, "HOUGANG": 590000, "JURONG EAST": 560000, "JURONG WEST": 520000,
    "KALLANG/WHAMPOA": 780000, "MARINE PARADE": 705000, "PASIR RIS": 605000,
    "PUNGGOL": 630000, "QUEENSTOWN": 885000, "SEMBAWANG": 560000, "SENGKANG": 620000,
    "SERANGOON": 625000, "TAMPINES": 600000, "TOA PAYOH": 760000, "WOODLANDS": 520000,
    "YISHUN": 525000,
}
# HDB Resale Price Index, rebased so 2024 = 1.
INDEX = {2015: .690, 2016: .680, 2017: .668, 2018: .660, 2019: .655, 2020: .672,
         2021: .762, 2022: .868, 2023: .915, 2024: 1.0, 2025: 1.045}
VOLUME = {2015: .70, 2016: .75, 2017: .78, 2018: .80, 2019: .83, 2020: .88,
          2021: 1.18, 2022: 1.08, 2023: .98, 2024: 1.05, 2025: .97}
TYPE_MIX = {"2 ROOM": (.03, .50), "3 ROOM": (.25, .73), "4 ROOM": (.42, 1.0),
            "5 ROOM": (.23, 1.22), "EXECUTIVE": (.07, 1.40)}
NO_EXECUTIVE = {"CENTRAL AREA", "MARINE PARADE", "BUKIT TIMAH", "QUEENSTOWN"}
BIG = {"TAMPINES": 2.0, "SENGKANG": 2.1, "PUNGGOL": 1.9, "WOODLANDS": 1.9, "JURONG WEST": 2.0,
       "YISHUN": 1.9, "BEDOK": 1.6, "HOUGANG": 1.5, "ANG MO KIO": 1.3, "CHOA CHU KANG": 1.3,
       "BUKIT MERAH": 1.2, "BUKIT BATOK": 1.2, "BUKIT PANJANG": 1.0, "TOA PAYOH": 1.0,
       "PASIR RIS": .9, "KALLANG/WHAMPOA": .9, "SEMBAWANG": .9, "QUEENSTOWN": .8,
       "SERANGOON": .6, "GEYLANG": .6, "CLEMENTI": .6, "JURONG EAST": .5, "BISHAN": .5,
       "MARINE PARADE": .2, "CENTRAL AREA": .2, "BUKIT TIMAH": .1}


def sample_rows(seed=20260101, per_unit=700):
    rng = random.Random(seed)
    for town, base in BASE_4R_2024.items():
        # Each town drifts a little against the national index.
        tilt = rng.uniform(-0.06, 0.08)
        for year, idx in INDEX.items():
            level = base * idx * (1 + tilt * (year - 2024) / 10)
            n_total = int(BIG[town] * VOLUME[year] * per_unit * rng.uniform(.9, 1.1))
            for ftype, (share, mult) in TYPE_MIX.items():
                if ftype == "EXECUTIVE" and town in NO_EXECUTIVE:
                    continue
                n = max(0, int(n_total * share))
                mu = math.log(level * mult)
                for _ in range(n):
                    yield town, year, ftype, round(math.exp(rng.gauss(mu, 0.11)), -3)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--csv", action="append", help="HDB resale CSV from data.gov.sg (repeatable)")
    g.add_argument("--sample", action="store_true", help="generate the estimated sample dataset")
    ap.add_argument("--latest-year", type=int, help="drop transactions after this year")
    args = ap.parse_args()

    if args.sample:
        rows, source, sample = sample_rows(), "估算示例数据（依据 HDB 转售价格指数走势生成）", True
    else:
        rows = read_csv_rows(args.csv, args.latest_year)
        source, sample = "data.gov.sg · HDB Resale Flat Prices", False

    years, stats, regions, national = aggregate(rows)
    payload = {
        "meta": {"source": source, "sample": sample, "generated": date.today().isoformat(),
                 "currency": "SGD"},
        "years": years,
        "types": TYPES,
        "towns": [{"id": t[0], "name": t[1], "zh": t[2], "region": t[3], "col": t[4], "row": t[5]}
                  for t in TOWNS],
        "stats": stats,
        "regions": regions,
        "national": national,
    }
    OUT.write_text("// Generated by scripts/build_data.py — do not edit by hand.\n"
                   "window.HDB_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, years {years[0]}–{years[-1]})")


if __name__ == "__main__":
    main()
