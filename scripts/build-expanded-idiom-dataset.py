#!/usr/bin/env python3
"""Merge the MOE idiom dictionary with reliable entries from its editorial database."""

import argparse
import csv
import json
import re
from pathlib import Path


FOUR_HAN = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{4}$")


def load_core(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload.get("entries"), list):
        raise ValueError("正文成語資料格式錯誤")
    return {entry["idiom"]: entry for entry in payload["entries"]}


def load_editorial(path, minimum_frequency):
    entries = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.reader(source)
        next(rows, None)  # 報表標題
        next(rows, None)  # 欄位名稱
        for row in rows:
            if len(row) < 4:
                continue
            idiom = row[1].strip()
            try:
                frequency = int(row[3])
            except ValueError:
                continue
            if frequency < minimum_frequency or not FOUR_HAN.fullmatch(idiom):
                continue
            current = entries.get(idiom)
            if current is None or frequency > current["frequency"]:
                entries[idiom] = {
                    "idiom": idiom,
                    "pronunciation": "",
                    "category": f"編輯總資料庫（頻次 {frequency}）",
                    "frequency": frequency,
                }
    return entries


def build(core_path, editorial_path, output_path, source_version, minimum_frequency):
    entries = load_core(core_path)
    core_count = len(entries)
    editorial_entries = load_editorial(editorial_path, minimum_frequency)
    for idiom, entry in editorial_entries.items():
        entries.setdefault(idiom, entry)

    payload = {
        "sourceName": "教育部《成語典》正文＋編輯總資料庫",
        "sourceVersion": source_version,
        "sourceUrl": "https://dict.idioms.moe.edu.tw/",
        "license": "CC BY-ND 3.0 TW",
        "selection": {
            "length": 4,
            "characters": "Han",
            "editorialMinimumFrequency": minimum_frequency,
            "coreEntryCount": core_count,
            "entryCount": len(entries),
        },
        "entries": [entries[key] for key in sorted(entries)],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"已輸出 {len(entries)} 筆四字成語，其中新增 {len(entries) - core_count} 筆："
        f"{output_path}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("core", type=Path, help="教育部《成語典》正文 JSON")
    parser.add_argument("editorial", type=Path, help="編輯總資料庫 CSV")
    parser.add_argument("output", type=Path, help="輸出的 JSON 路徑")
    parser.add_argument("--source-version", required=True, help="合併資料版本")
    parser.add_argument("--minimum-frequency", type=int, default=4)
    arguments = parser.parse_args()
    if arguments.minimum_frequency < 1:
        parser.error("--minimum-frequency 必須大於 0")
    build(
        arguments.core,
        arguments.editorial,
        arguments.output,
        arguments.source_version,
        arguments.minimum_frequency,
    )


if __name__ == "__main__":
    main()
