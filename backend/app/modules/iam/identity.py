"""ТЗ v19 УК-12: безопасное преобразование id текущего пользователя в FK на users.id.

Причина существования: `get_current_user()` под DEMO_AUTH_BYPASS отдаёт синтетический
`DEMO_USER["id"]` ("00000000-0000-0000-0000-000000000001"), которому НЕТ строки в `users`
(проверено). Раньше это было безопасно — `decided_by`/`executed_by` и т.п. хранились строками
без ограничения целостности. ТЗ v19 вводит настоящие `ForeignKey("users.id")` для «связи с
руководителем» (УК-12/14) — наивная запись current_user["id"] в такое поле уронит INSERT/UPDATE
под демо-обходом аутентификации. Резолвер проверяет существование строки и молча отдаёт None,
если её нет: поле nullable по всей системе именно ради этого случая.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.iam.models import User


async def resolve_user_id(db: AsyncSession, raw_id: str | None) -> uuid.UUID | None:
    """current_user["id"] → uuid.UUID, только если строка реально есть в users. Иначе None —
    вызывающий код обязан трактовать None как «неизвестно», не как ошибку."""
    if not raw_id:
        return None
    try:
        parsed = uuid.UUID(raw_id)
    except ValueError:
        return None
    exists = await db.get(User, parsed)
    return parsed if exists is not None else None
