"""
Разбор сквозного разреза (ТЗ v21, Slice) в query-параметрах.

Фронт (`utils/apiFetch.ts` → `qs()`) сериализует множественные значения как ОДНУ строку через
запятую (`?system_id=a,b`), а не повторяющимися ключами (`?system_id=a&system_id=b`) — общий
для всех эндпоинтов разреза формат, разбирается здесь один раз.
"""
from __future__ import annotations

import uuid


def parse_uuid_list(raw: str | None) -> list[uuid.UUID] | None:
    if not raw:
        return None
    out = []
    for part in raw.split(","):
        part = part.strip()
        if part:
            out.append(uuid.UUID(part))
    return out or None


def parse_str_list(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    out = [p.strip() for p in raw.split(",") if p.strip()]
    return out or None
