#!/usr/bin/env python3
"""Convert the official MOE idiom XLSX into the bot's versioned JSON seed file."""

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"main": MAIN_NS, "rel": REL_NS}
FOUR_HAN = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{4}$")


def column_index(reference):
    letters = "".join(character for character in reference if character.isalpha())
    value = 0
    for character in letters:
        value = value * 26 + ord(character.upper()) - 64
    return value - 1


def read_shared_strings(archive):
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t"))
        for item in root.findall("main:si", NS)
    ]


def find_sheet_path(archive, sheet_name):
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    targets = {
        relationship.attrib["Id"]: relationship.attrib["Target"]
        for relationship in relationships
    }
    for sheet in workbook.find("main:sheets", NS):
        if sheet.attrib["name"] != sheet_name:
            continue
        target = targets[sheet.attrib[f"{{{REL_NS}}}id"]]
        return target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
    raise ValueError(f"找不到工作表：{sheet_name}")


def cell_value(cell, shared_strings):
    if cell.attrib.get("t") == "inlineStr":
        return "".join(
            node.text or "" for node in cell.findall(".//main:t", NS)
        )
    value = cell.find("main:v", NS)
    if value is None:
        return ""
    if cell.attrib.get("t") == "s":
        return shared_strings[int(value.text)]
    return value.text or ""


def convert(source_path, output_path, source_version):
    with zipfile.ZipFile(source_path) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_path = find_sheet_path(archive, "成語資料")
        sheet = ElementTree.fromstring(archive.read(sheet_path))
        rows = sheet.findall(".//main:sheetData/main:row", NS)

        entries = {}
        for row in rows[1:]:
            values = {
                column_index(cell.attrib["r"]): cell_value(cell, shared_strings)
                for cell in row.findall("main:c", NS)
            }
            idiom = values.get(1, "").strip()
            if not FOUR_HAN.fullmatch(idiom):
                continue
            if idiom in entries:
                raise ValueError(f"詞庫含有重複成語：{idiom}")
            entries[idiom] = {
                "idiom": idiom,
                "pronunciation": values.get(2, "").strip(),
                "category": values.get(21, "").strip(),
            }

    payload = {
        "sourceName": "教育部《成語典》",
        "sourceVersion": source_version,
        "sourceUrl": "https://dict.idioms.moe.edu.tw/",
        "license": "CC BY-ND 3.0 TW",
        "entries": [entries[key] for key in sorted(entries)],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"已輸出 {len(entries)} 筆四字成語：{output_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="教育部《成語典》XLSX")
    parser.add_argument("output", type=Path, help="輸出的 JSON 路徑")
    parser.add_argument("--source-version", required=True, help="教育部資料版本")
    arguments = parser.parse_args()
    convert(arguments.source, arguments.output, arguments.source_version)


if __name__ == "__main__":
    main()
