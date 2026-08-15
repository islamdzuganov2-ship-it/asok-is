"""Паритет моделей и миграций (ДЕФ-03, БТ-507).

Регресс, который тест закрывает: пока схема создавалась вызовом `Base.metadata.create_all()`
(причём только под DEMO_MODE), миграции отставали от моделей и никто этого не замечал —
`alembic upgrade head` в стеке не выполнялся вовсе. Когда миграции включили, выяснилось,
что на чистой БД они дают 25 таблиц против 30 в моделях: не было `role_permissions`
(матрица RBAC — без неё продуктивная установка с нуля не работает), `audit_log`,
`user_preferences`, `metric_attributes`, `metric_characteristics`.

Проверка статическая: каждое имя таблицы из `Base.metadata` должно встречаться в
`op.create_table(...)` хотя бы одной ревизии. Живой прогон миграций требует БД и делается
отдельно (`python -m app.scripts.migrate` на пустой базе), а этот тест ловит расхождение
на этапе обычного регресса и не зависит от Docker.
"""
from __future__ import annotations

import re
from pathlib import Path

from app.infrastructure.database import Base, import_models

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# Таблицы, которые сознательно не создаются миграциями.
EXCLUDED: set[str] = set()

_CREATE_TABLE = re.compile(r"""op\.create_table\(\s*["']([a-z_0-9]+)["']""")


def _tables_in_migrations() -> set[str]:
    found: set[str] = set()
    for path in VERSIONS_DIR.glob("*.py"):
        found.update(_CREATE_TABLE.findall(path.read_text(encoding="utf-8")))
    return found


def test_every_model_table_is_created_by_a_migration():
    import_models()
    model_tables = set(Base.metadata.tables) - EXCLUDED
    missing = sorted(model_tables - _tables_in_migrations())
    assert not missing, (
        "Таблицы есть в моделях, но их не создаёт ни одна миграция — на чистой БД "
        "(продуктив, CI) их не будет:\n  " + "\n  ".join(missing)
    )


def test_migration_chain_is_linear_and_complete():
    """Ревизии образуют одну цепочку без разрывов и развилок."""
    revisions: dict[str, str | None] = {}
    for path in VERSIONS_DIR.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        rev = re.search(r"^revision\s*=\s*[\"']([^\"']+)[\"']", text, re.M)
        down = re.search(r"^down_revision\s*=\s*(?:[\"']([^\"']+)[\"']|None)", text, re.M)
        assert rev, f"{path.name}: не найден revision"
        revisions[rev.group(1)] = down.group(1) if down and down.group(1) else None

    roots = [r for r, d in revisions.items() if d is None]
    assert len(roots) == 1, f"ожидалась одна корневая ревизия, найдены: {roots}"

    children: dict[str | None, list[str]] = {}
    for rev, down in revisions.items():
        children.setdefault(down, []).append(rev)
    forks = {d: c for d, c in children.items() if len(c) > 1}
    assert not forks, f"развилки в цепочке миграций: {forks}"

    seen, cur = 0, roots[0]
    while cur is not None:
        seen += 1
        nxt = children.get(cur, [])
        cur = nxt[0] if nxt else None
    assert seen == len(revisions), (
        f"цепочка обрывается: пройдено {seen} из {len(revisions)} ревизий"
    )
