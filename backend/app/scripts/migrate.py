"""Применение миграций при старте стека (ДЕФ-03, БТ-507).

Проблема, которую закрывает скрипт. В `docker-compose.yml` не было `alembic upgrade head`:
схема создавалась вызовом `Base.metadata.create_all()` в `main.py`, причём ТОЛЬКО под
`if settings.DEMO_MODE`. Следствия:
  · при `DEMO_MODE=false` (продуктив) схема не создавалась вообще — приложение стартовало
    на пустой БД и падало на первом запросе;
  · `create_all` не выполняет ALTER, поэтому изменения колонок из миграций на демо-стенде
    не применялись, и БД расходилась с моделями;
  · 12 миграций (001…012) в рабочем стеке не выполнялись никогда.

Три сценария на старте:
  1. БД пуста → `upgrade head` создаёт схему миграциями.
  2. БД наполнена, но `alembic_version` нет — это ровно текущий стенд, схема пришла из
     `create_all`. Прогонять `upgrade head` нельзя: миграция 001 упадёт на CREATE TABLE
     существующей таблицы. Схема принимается как есть — `stamp head`, дальше история ведётся
     миграциями. Об этом печатается предупреждение: расхождение схемы с моделями, если оно
     накопилось, штампом не лечится и требует ручной сверки.
  3. `alembic_version` есть → обычный `upgrade head`.
"""
from __future__ import annotations

import os
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _sync_url() -> str:
    url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is",
    )
    return url.replace("+asyncpg", "+psycopg2")


def _config() -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    cfg.set_main_option("sqlalchemy.url", _sync_url())
    return cfg


def main() -> int:
    engine = create_engine(_sync_url(), pool_pre_ping=True)
    with engine.connect() as conn:
        tables = set(inspect(conn).get_table_names())

    cfg = _config()
    if "alembic_version" in tables:
        print("[migrate] alembic_version найден → upgrade head", flush=True)
        command.upgrade(cfg, "head")
    elif tables:
        print(
            f"[migrate] В БД {len(tables)} таблиц, но alembic_version отсутствует — схема "
            "создана прежним create_all. Принимаю её как есть: stamp head. "
            "ВНИМАНИЕ: накопленные расхождения схемы с моделями штамп не устраняет — "
            "сверьте вручную (alembic check / autogenerate --sql).",
            flush=True,
        )
        command.stamp(cfg, "head")
    else:
        print("[migrate] Пустая БД → upgrade head", flush=True)
        command.upgrade(cfg, "head")
    print("[migrate] Готово", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
