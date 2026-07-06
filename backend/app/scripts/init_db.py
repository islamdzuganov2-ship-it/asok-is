"""Ручное создание схемы БД (все таблицы реестра модулей) — вспомогательный инструмент.

В рабочем стеке схема создаётся автоматически на старте backend (`app/main.py` → `create_all`).
Этот скрипт — для ручного пересоздания/проверки схемы: `python -m app.scripts.init_db`.
"""
import asyncio

from app.infrastructure.database import Base, engine, import_models

import_models()  # реестр моделей всех модулей → полная Base.metadata (вкл. iam.AuditLog)


async def init_tables() -> None:
    async with engine.begin() as conn:
        print("🛠 Создаём таблицы в БД...")
        await conn.run_sync(Base.metadata.create_all)
        print("✅ Таблицы успешно созданы!")


if __name__ == "__main__":
    asyncio.run(init_tables())
