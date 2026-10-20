#!/usr/bin/env python3
"""Build the dashboard datasets in data/.

HDB resale flats  -> data/hdb-data.js      (window.HDB_DATA, median price in SGD)

  python3 scripts/build_data.py hdb --csv resale.csv [--csv more.csv ...]
      Official HDB resale transactions from data.gov.sg
      ("Resale flat prices based on registration date ...").
      Columns used: month, town, flat_type, resale_price.

Private homes (non-landed) -> data/private-data.js  (window.PRIVATE_DATA, median SGD psf)

  python3 scripts/build_data.py private --ura-json batch1.json [--ura-json batch2.json ...]
      Responses of the URA Data Service API "PMI_Resi_Transaction" (batch 1–4).
      Fields used: project[].transaction[].{contractDate, district, propertyType, price, area}.

  python3 scripts/build_data.py private --csv ura-export.csv
      A CSV export of URA private residential transactions. Columns used
      (matched case-insensitively): "Sale Date", "Postal District", "Property Type",
      and either "Unit Price ($ PSF)" or "Transacted Price ($)" + "Area (SQFT)".

Either market:  --sample
      Generate a deterministic *estimated* dataset that follows the published price
      index (HDB RPI / URA PPI). It is the bundled default so the site works offline;
      replace it with real data using the options above.

All modes share the same aggregation, so the output shape is identical.
"""

import argparse
import csv
import json
import math
import random
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MIN_SAMPLE = 5  # cells with fewer transactions are reported as missing
SQM_TO_SQFT = 10.7639


# ===================================================================== HDB
# id (as spelled in the HDB CSV), English, Chinese, region, tile column, tile row
HDB_AREAS = [
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
HDB = {
    "var": "HDB_DATA",
    "file": "hdb-data.js",
    "areas": HDB_AREAS,
    "types": ["ALL", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE"],
    "type_labels": {"ALL": "全部户型", "3 ROOM": "三房式", "4 ROOM": "四房式", "5 ROOM": "五房式",
                    "EXECUTIVE": "公寓式 (EA)"},
    "regions": ["Central", "North", "North-East", "East", "West"],
    "region_labels": {"Central": "中部", "North": "北部", "North-East": "东北部", "East": "东部", "West": "西部"},
    "meta": {"market": "hdb", "title": "HDB 组屋转售价", "areaLabel": "市镇", "typeLabel": "户型",
             "regionHeading": "五大区域", "unit": "price", "metricLabel": "中位价"},
    "source_real": "data.gov.sg · HDB Resale Flat Prices",
    "source_sample": "估算示例数据（依据 HDB 转售价格指数走势生成）",
    "defaults": ["QUEENSTOWN", "PUNGGOL", "WOODLANDS"],
}


def hdb_csv_rows(paths):
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                yield (r["town"].strip().upper(), int(r["month"][:4]),
                       r["flat_type"].strip().upper(), float(r["resale_price"]))


# Approximate 2024 4-room median resale price (SGD) per town.
HDB_BASE_2024 = {
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
HDB_INDEX = {2015: .690, 2016: .680, 2017: .668, 2018: .660, 2019: .655, 2020: .672,
             2021: .762, 2022: .868, 2023: .915, 2024: 1.0, 2025: 1.045}
HDB_VOLUME = {2015: .70, 2016: .75, 2017: .78, 2018: .80, 2019: .83, 2020: .88,
              2021: 1.18, 2022: 1.08, 2023: .98, 2024: 1.05, 2025: .97}
HDB_TYPE_MIX = {"2 ROOM": (.03, .50), "3 ROOM": (.25, .73), "4 ROOM": (.42, 1.0),
                "5 ROOM": (.23, 1.22), "EXECUTIVE": (.07, 1.40)}
HDB_NO_EXECUTIVE = {"CENTRAL AREA", "MARINE PARADE", "BUKIT TIMAH", "QUEENSTOWN"}
HDB_SIZE = {"TAMPINES": 2.0, "SENGKANG": 2.1, "PUNGGOL": 1.9, "WOODLANDS": 1.9, "JURONG WEST": 2.0,
            "YISHUN": 1.9, "BEDOK": 1.6, "HOUGANG": 1.5, "ANG MO KIO": 1.3, "CHOA CHU KANG": 1.3,
            "BUKIT MERAH": 1.2, "BUKIT BATOK": 1.2, "BUKIT PANJANG": 1.0, "TOA PAYOH": 1.0,
            "PASIR RIS": .9, "KALLANG/WHAMPOA": .9, "SEMBAWANG": .9, "QUEENSTOWN": .8,
            "SERANGOON": .6, "GEYLANG": .6, "CLEMENTI": .6, "JURONG EAST": .5, "BISHAN": .5,
            "MARINE PARADE": .2, "CENTRAL AREA": .2, "BUKIT TIMAH": .1}


def hdb_sample_rows(seed=20260101, per_unit=700):
    rng = random.Random(seed)
    for town, base in HDB_BASE_2024.items():
        tilt = rng.uniform(-0.06, 0.08)  # each town drifts a little against the index
        for year, idx in HDB_INDEX.items():
            level = base * idx * (1 + tilt * (year - 2024) / 10)
            n_total = int(HDB_SIZE[town] * HDB_VOLUME[year] * per_unit * rng.uniform(.9, 1.1))
            for ftype, (share, mult) in HDB_TYPE_MIX.items():
                if ftype == "EXECUTIVE" and town in HDB_NO_EXECUTIVE:
                    continue
                mu = math.log(level * mult)
                for _ in range(int(n_total * share)):
                    yield town, year, ftype, round(math.exp(rng.gauss(mu, 0.11)), -3)


# ================================================================= PRIVATE
PRIVATE_AREAS = [
    ("D25", "Kranji, Woodgrove", "D25 兀兰/克兰芝", "OCR", 2, 0),
    ("D27", "Yishun, Sembawang", "D27 义顺/三巴旺", "OCR", 3, 0),
    ("D28", "Seletar, Yio Chu Kang", "D28 实里达", "OCR", 5, 0),
    ("D24", "Lim Chu Kang, Tengah", "D24 林厝港/登加", "OCR", 0, 1),
    ("D23", "Hillview, Bukit Panjang", "D23 山景/武吉班让", "OCR", 1, 1),
    ("D26", "Upper Thomson, Springleaf", "D26 汤申上段", "OCR", 3, 1),
    ("D20", "Bishan, Ang Mo Kio", "D20 碧山/宏茂桥", "RCR", 4, 1),
    ("D19", "Serangoon Garden, Hougang, Punggol", "D19 实龙岗/后港/榜鹅", "OCR", 5, 1),
    ("D18", "Tampines, Pasir Ris", "D18 淡滨尼/巴西立", "OCR", 6, 1),
    ("D17", "Loyang, Changi", "D17 罗央/樟宜", "OCR", 7, 1),
    ("D22", "Jurong, Boon Lay", "D22 裕廊", "OCR", 0, 2),
    ("D21", "Upper Bukit Timah, Clementi Park", "D21 上武吉知马", "OCR", 1, 2),
    ("D10", "Bukit Timah, Holland, Tanglin", "D10 武吉知马/荷兰村", "CCR", 2, 2),
    ("D11", "Novena, Newton, Thomson", "D11 诺维娜/纽顿", "CCR", 3, 2),
    ("D12", "Balestier, Toa Payoh, Serangoon", "D12 马里士他/大巴窑", "RCR", 4, 2),
    ("D13", "Macpherson, Braddell", "D13 麦波申", "RCR", 5, 2),
    ("D14", "Geylang, Eunos", "D14 芽笼/友诺士", "RCR", 6, 2),
    ("D16", "Bedok, Upper East Coast", "D16 勿洛/东海岸", "OCR", 7, 2),
    ("D05", "Pasir Panjang, Clementi", "D05 巴西班让/金文泰", "RCR", 1, 3),
    ("D03", "Queenstown, Tiong Bahru", "D03 女皇镇/中峇鲁", "RCR", 2, 3),
    ("D09", "Orchard, River Valley", "D09 乌节/里峇峇利", "CCR", 3, 3),
    ("D08", "Little India, Farrer Park", "D08 小印度", "RCR", 4, 3),
    ("D07", "Bugis, Beach Road", "D07 武吉士/美芝路", "RCR", 5, 3),
    ("D15", "Katong, Joo Chiat, Marine Parade", "D15 加东/如切", "RCR", 6, 3),
    ("D04", "Telok Blangah, Harbourfront, Sentosa", "D04 直落布兰雅/圣淘沙", "RCR", 2, 4),
    ("D02", "Tanjong Pagar, Anson", "D02 丹戎巴葛", "CCR", 3, 4),
    ("D01", "Raffles Place, Marina, Cecil", "D01 莱佛士坊/滨海", "CCR", 4, 4),
    ("D06", "City Hall, High Street", "D06 政府大厦", "CCR", 5, 4),
]
PRIVATE = {
    "var": "PRIVATE_DATA",
    "file": "private-data.js",
    "areas": PRIVATE_AREAS,
    "types": ["ALL", "CONDOMINIUM", "APARTMENT", "EXECUTIVE CONDOMINIUM"],
    "type_labels": {"ALL": "全部类型", "CONDOMINIUM": "共管公寓 Condo", "APARTMENT": "公寓 Apartment",
                    "EXECUTIVE CONDOMINIUM": "执行共管公寓 EC"},
    "regions": ["CCR", "RCR", "OCR"],
    "region_labels": {"CCR": "核心中央区 CCR", "RCR": "中央边缘区 RCR", "OCR": "中央以外区 OCR"},
    "meta": {"market": "private", "title": "私宅（非有地）成交呎价", "areaLabel": "邮区", "typeLabel": "类型",
             "regionHeading": "三大市场区域", "unit": "psf", "metricLabel": "中位呎价"},
    "source_real": "URA · Private Residential Transactions",
    "source_sample": "估算示例数据（依据 URA 私宅价格指数走势生成）",
    "defaults": ["D09", "D15", "D19"],
}

URA_TYPES = {  # URA spelling -> our type id
    "CONDOMINIUM": "CONDOMINIUM",
    "APARTMENT": "APARTMENT",
    "EXECUTIVE CONDOMINIUM": "EXECUTIVE CONDOMINIUM",
}


def norm_district(v):
    m = re.search(r"\d+", str(v))
    return f"D{int(m.group()):02d}" if m else None


def contract_year(v):
    """URA dates: 'MMYY' (API), 'Jan-24', 'Jan 2024', '2024-01', '01/01/2024'."""
    v = str(v).strip()
    if re.fullmatch(r"\d{4}", v):  # MMYY from the API
        return 2000 + int(v[2:])
    m = re.search(r"(19|20)\d{2}", v)
    if m:
        return int(m.group())
    m = re.search(r"\d{2}$", v)
    return 2000 + int(m.group()) if m else None


def private_json_rows(paths):
    for p in paths:
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
        for proj in doc.get("Result", doc if isinstance(doc, list) else []):
            for t in proj.get("transaction", []):
                ptype = URA_TYPES.get(str(t.get("propertyType", "")).strip().upper())
                area_sqft = float(t["area"]) * SQM_TO_SQFT
                if not ptype or area_sqft <= 0:
                    continue
                yield norm_district(t.get("district")), contract_year(t["contractDate"]), ptype, \
                    float(t["price"]) / area_sqft


def private_csv_rows(paths):
    def pick(row, *names):
        for k, v in row.items():
            if k and any(n in k.lower() for n in names):
                return v
        return None

    for p in paths:
        with open(p, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                ptype = URA_TYPES.get(str(pick(r, "property type") or "").strip().upper())
                if not ptype:
                    continue
                psf = pick(r, "unit price ($ psf)", "psf")
                if psf:
                    psf = float(str(psf).replace(",", ""))
                else:
                    price = float(str(pick(r, "transacted price", "price")).replace(",", ""))
                    psf = price / float(str(pick(r, "area (sqft)", "sqft")).replace(",", ""))
                yield norm_district(pick(r, "postal district", "district")), \
                    contract_year(pick(r, "sale date", "contract date", "date")), ptype, psf


# Approximate 2024 median psf (SGD) for non-landed condominiums per district.
PRIVATE_BASE_2024 = {
    "D01": 2750, "D02": 2550, "D03": 2350, "D04": 2150, "D05": 1750, "D06": 2650, "D07": 2350,
    "D08": 1950, "D09": 2950, "D10": 2650, "D11": 2450, "D12": 1950, "D13": 2050, "D14": 1850,
    "D15": 2050, "D16": 1550, "D17": 1350, "D18": 1500, "D19": 1650, "D20": 2050, "D21": 1950,
    "D22": 1600, "D23": 1550, "D24": 1500, "D25": 1200, "D26": 1750, "D27": 1450, "D28": 1550,
}
# URA Private Residential Price Index (non-landed), rebased so 2024 = 1.
PRIVATE_INDEX = {2015: .705, 2016: .685, 2017: .690, 2018: .745, 2019: .765, 2020: .785,
                 2021: .865, 2022: .940, 2023: .985, 2024: 1.0, 2025: 1.035}
PRIVATE_VOLUME = {2015: .55, 2016: .65, 2017: .95, 2018: .90, 2019: .80, 2020: .75,
                  2021: 1.25, 2022: .90, 2023: .70, 2024: .85, 2025: 1.0}
PRIVATE_TYPE_MIX = {"CONDOMINIUM": (.58, 1.0), "APARTMENT": (.30, 1.07), "EXECUTIVE CONDOMINIUM": (.12, .72)}
PRIVATE_EC_DISTRICTS = {"D17", "D18", "D19", "D22", "D23", "D24", "D25", "D27", "D28"}
PRIVATE_SIZE = {"D01": .5, "D02": .5, "D03": .9, "D04": .8, "D05": 1.1, "D06": .2, "D07": .5,
                "D08": .6, "D09": 1.2, "D10": 1.3, "D11": .8, "D12": .8, "D13": .6, "D14": 1.0,
                "D15": 1.6, "D16": 1.2, "D17": .5, "D18": 1.3, "D19": 2.0, "D20": .9, "D21": .8,
                "D22": .9, "D23": 1.3, "D24": .3, "D25": .6, "D26": .6, "D27": 1.0, "D28": .7}


def private_sample_rows(seed=20260102, per_unit=520):
    rng = random.Random(seed)
    for dist, base in PRIVATE_BASE_2024.items():
        tilt = rng.uniform(-0.07, 0.07)
        for year, idx in PRIVATE_INDEX.items():
            level = base * idx * (1 + tilt * (year - 2024) / 10)
            n_total = int(PRIVATE_SIZE[dist] * PRIVATE_VOLUME[year] * per_unit * rng.uniform(.85, 1.15))
            for ptype, (share, mult) in PRIVATE_TYPE_MIX.items():
                if ptype == "EXECUTIVE CONDOMINIUM" and dist not in PRIVATE_EC_DISTRICTS:
                    continue
                mu = math.log(level * mult)
                for _ in range(int(n_total * share)):
                    yield dist, year, ptype, round(math.exp(rng.gauss(mu, 0.16)))


# ================================================================ shared
def percentile(sorted_vals, q):
    pos = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def summarise(values):
    if len(values) < MIN_SAMPLE:
        return None
    s = sorted(values)
    return [round(percentile(s, 0.25)), round(percentile(s, 0.5)), round(percentile(s, 0.75)), len(s)]


def aggregate(market, rows, latest_year=None):
    """rows: iterable of (area_id, year, type_id, value)."""
    region_of = {a[0]: a[3] for a in market["areas"]}
    types = market["types"]
    cells = defaultdict(list)  # (key, type, year) -> values
    for area, year, typ, value in rows:
        if area not in region_of or year is None or (latest_year and year > latest_year):
            continue
        for key in (area, region_of[area], "__ALL__"):
            cells[(key, "ALL", year)].append(value)
            if typ in types:
                cells[(key, typ, year)].append(value)

    years = sorted({k[2] for k in cells})

    def series(key):
        return {t: [summarise(cells.get((key, t, y), [])) for y in years] for t in types}

    return {
        "years": years,
        "stats": {a[0]: series(a[0]) for a in market["areas"]},
        "regions": {r: series(r) for r in market["regions"]},
        "national": series("__ALL__"),
    }


def write(market, agg, sample):
    payload = {
        "meta": {**market["meta"], "sample": sample, "generated": date.today().isoformat(),
                 "source": market["source_sample" if sample else "source_real"], "currency": "SGD",
                 "defaults": market["defaults"]},
        "types": market["types"],
        "typeLabels": market["type_labels"],
        "regionLabels": market["region_labels"],
        "areas": [{"id": a[0], "name": a[1], "zh": a[2], "region": a[3], "col": a[4], "row": a[5]}
                  for a in market["areas"]],
        **agg,
    }
    out = DATA_DIR / market["file"]
    out.write_text("// Generated by scripts/build_data.py — do not edit by hand.\n"
                   f"window.{market['var']} = "
                   + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, years {agg['years'][0]}–{agg['years'][-1]})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="market", required=True)

    h = sub.add_parser("hdb", help="HDB resale flats")
    g = h.add_mutually_exclusive_group(required=True)
    g.add_argument("--csv", action="append", help="HDB resale CSV from data.gov.sg (repeatable)")
    g.add_argument("--sample", action="store_true", help="generate the estimated sample dataset")

    p = sub.add_parser("private", help="private non-landed homes")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--ura-json", action="append", help="URA API PMI_Resi_Transaction response (repeatable)")
    g.add_argument("--csv", action="append", help="URA transaction CSV export (repeatable)")
    g.add_argument("--sample", action="store_true", help="generate the estimated sample dataset")

    for s in (h, p):
        s.add_argument("--latest-year", type=int, help="drop transactions after this year")
    args = ap.parse_args()

    if args.market == "hdb":
        market = HDB
        rows = hdb_sample_rows() if args.sample else hdb_csv_rows(args.csv)
    else:
        market = PRIVATE
        if args.sample:
            rows = private_sample_rows()
        elif args.ura_json:
            rows = private_json_rows(args.ura_json)
        else:
            rows = private_csv_rows(args.csv)
    write(market, aggregate(market, rows, args.latest_year), args.sample)


if __name__ == "__main__":
    main()
