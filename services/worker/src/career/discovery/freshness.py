"""Classify original publication age without confusing edits with new postings."""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal


@dataclass(frozen=True)
class Freshness:
    label: Literal['primary', 'expanded', 'old', 'future', 'unknown']
    age: timedelta | None


def classify_freshness(published_at: datetime | None, updated_at: datetime | None,
                       first_seen_at: datetime, now: datetime) -> Freshness:
    if published_at is None:
        return Freshness('unknown', None)
    age = now - published_at
    if age < -timedelta(minutes=5):
        return Freshness('future', age)
    if age <= timedelta(hours=72):
        return Freshness('primary', age)
    if age <= timedelta(days=7):
        return Freshness('expanded', age)
    return Freshness('old', age)
