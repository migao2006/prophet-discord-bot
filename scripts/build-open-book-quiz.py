#!/usr/bin/env python3
"""Build a compact Discord-safe quiz dataset from 開卷有益 CAP questions."""

import argparse
import json
import re
from pathlib import Path


WHITESPACE = re.compile(r"\s+")
UNSUPPORTED = re.compile(r"\\(?:frac|dfrac|sqrt|begin|left|right|overline|triangle)|https?://")
MISSING_CONTEXT = re.compile(r"(?:根據|依據)(?:上文|選文)|閱讀下列")
SUBJECTS = {"國文", "數學", "社會", "自然", "英語"}


def clean(value):
    return WHITESPACE.sub(" ", str(value or "")).strip()


def is_eligible(question):
    if question.get("type") != "單選" or question.get("parse") != "ok":
        return False
    if question.get("answer_status") != "official":
        return False
    if question.get("needs_figure") or question.get("figure"):
        return False
    if question.get("render") in {"image", "table"} or question.get("table"):
        return False
    if question.get("passage") or question.get("group_id"):
        return False
    options = question.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return False
    if question.get("answer") not in "ABCD":
        return False
    subject = clean(question.get("subject"))
    if subject not in SUBJECTS:
        return False
    text = clean(question.get("stem")) + "".join(clean(option) for option in options)
    if not text or len(text) > 1800 or UNSUPPORTED.search(text) or MISSING_CONTEXT.search(text):
        return False
    return all(clean(option) for option in options)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-version", required=True)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    questions = []
    seen = set()
    for item in source.get("questions", []):
        if not is_eligible(item) or item["qid"] in seen:
            continue
        seen.add(item["qid"])
        questions.append({
            "sourceId": item["qid"],
            "year": int(item["year"]),
            "subject": clean(item["subject"]),
            "number": str(item["no"]),
            "question": clean(item["stem"]),
            "options": [clean(option) for option in item["options"]],
            "answerIndex": "ABCD".index(item["answer"]),
        })

    if not questions:
        raise SystemExit("No eligible questions were found")
    counts = {subject: 0 for subject in sorted(SUBJECTS)}
    for question in questions:
        counts[question["subject"]] += 1
    if any(count == 0 for count in counts.values()):
        raise SystemExit(f"A subject has no eligible questions: {counts}")

    dataset = {
        "sourceName": "開卷有益－國中教育會考",
        "sourceVersion": args.source_version,
        "sourceUrl": "https://github.com/5219rayhsu/open-book-is-good-platform",
        "license": "Official examination questions; Taiwan Copyright Act Article 9",
        "counts": counts,
        "questions": questions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(dataset, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(questions)} questions to {args.output}")


if __name__ == "__main__":
    main()
