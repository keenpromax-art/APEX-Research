"""Reusable narrative-quality checks.

These functions are deterministic and used by both report payload QC and PDF QA.
They do not rewrite narrative; they flag material quality defects for review.
"""

from __future__ import annotations

import re

MIN_SENTENCE_WORDS = 3


def _split_sentences(text: str) -> list[str]:
    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text)
        if len(sentence.split()) >= MIN_SENTENCE_WORDS
    ]


def duplicate_sentence_issues(text: str, limit: int = 5) -> list[str]:
    """Return sentences repeated outside legitimate headings or labels."""
    seen: dict[str, int] = {}
    repeats: list[str] = []
    for sentence in _split_sentences(text):
        key = re.sub(r"[^a-z0-9 ]", "", sentence.lower())
        key = re.sub(r"\s+", " ", key).strip()
        if len(key) < 30:
            continue
        seen[key] = seen.get(key, 0) + 1
        if seen[key] == 2:
            repeats.append(sentence)
            if len(repeats) >= limit:
                break
    return repeats


def flatten_narrative_text(narrative: object) -> str:
    """Join narrative strings/lists for duplication and placeholder checks."""
    if isinstance(narrative, str):
        return narrative
    if isinstance(narrative, dict):
        return " ".join(flatten_narrative_text(value) for value in narrative.values())
    if isinstance(narrative, (list, tuple)):
        return " ".join(flatten_narrative_text(value) for value in narrative)
    return str(narrative or "")
