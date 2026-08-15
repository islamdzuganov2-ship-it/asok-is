"""Чистота роутеров и границы доменов (ДЕФ-19, ДЕФ-20).

Требования к ревью от 2026-07-05 (БТ-596): роутер валидирует запрос, создаёт DTO, вызывает
сервис приложения и маппит ответ; весь ORM — в репозиториях/сервисах. Кросс-доменное
взаимодействие — только через фасады, без импорта чужих `models`.

Оба правила были ЗАЯВЛЕНЫ, но ничем не проверялись: `test_architecture.py` сторожит только
легаси-пути, фасады и Dependency Rule для shared/infrastructure. В результате
`assessment/router.py` вырос до 1000+ строк с полусотней обращений к ORM, а `models` чужих
доменов импортировались напрямую в 15 местах.

Эти тесты фиксируют ТЕКУЩИЙ уровень долга и не дают ему расти: списки допущений ниже —
это то, что уже есть, и они могут только сокращаться. Новый роутер с ORM или новый
кросс-доменный импорт упадут сразу.
"""
from __future__ import annotations

import re
from pathlib import Path

MODULES_DIR = Path(__file__).resolve().parents[1] / "app" / "modules"

_ORM_CALL = re.compile(r"\b(?:select|update|delete)\(|\bdb\.execute\b|\bsession\.execute\b")
_CROSS_IMPORT = re.compile(r"^from app\.modules\.([a-z_]+)\.(models|service|schemas)\s+import", re.M)

# ── Долг на 2026-08-15. Значения — ВЕРХНЯЯ ГРАНИЦА обращений к ORM в роутере.
# Уменьшать при рефакторинге; увеличивать нельзя.
ORM_BUDGET: dict[str, int] = {
    "assessment/router.py": 56,
    "assessment/ai_router.py": 19,
    "reporting/router.py": 18,
    "risk/router.py": 8,
    "quality/router.py": 7,
    "systems/router.py": 6,
    "iam/admin_router.py": 5,
    "dataio/router.py": 4,
    "iam/router.py": 2,
    "incidents/router.py": 1,
}

# Кросс-доменные импорты внутренностей, существующие на момент фиксации.
CROSS_IMPORT_BUDGET: dict[str, int] = {
    "assessment/ai_router.py": 1,
    "dataio/importer.py": 2,
    "dataio/router.py": 1,
    "econ/dashboard_service.py": 4,
    "econ/manager_metrics_service.py": 2,
    "econ/weights_service.py": 1,
    "llm/dataset.py": 3,
    "reporting/router.py": 1,
}


def _rel(path: Path) -> str:
    return path.relative_to(MODULES_DIR).as_posix()


def _router_files() -> list[Path]:
    return sorted(p for p in MODULES_DIR.rglob("*router*.py") if "__pycache__" not in p.parts)


def test_no_new_orm_in_routers():
    """Ни один роутер не превышает зафиксированный бюджет обращений к ORM."""
    offenders = []
    for path in _router_files():
        rel = _rel(path)
        count = len(_ORM_CALL.findall(path.read_text(encoding="utf-8")))
        budget = ORM_BUDGET.get(rel, 0)
        if count > budget:
            offenders.append(f"{rel}: {count} обращений к ORM при бюджете {budget}")
    assert not offenders, (
        "Роутер должен вызывать сервис, а не работать с ORM напрямую (БТ-596).\n  "
        + "\n  ".join(offenders)
        + "\nЕсли ORM появился осознанно — вынесите его в service.py, а не поднимайте бюджет."
    )


def test_orm_budget_matches_reality():
    """Бюджет не «протух»: файлы из списка существуют, а числа не завышены.

    Без этой проверки бюджет превратился бы в вечное разрешение: вынесли логику в сервис —
    и старое число молча осталось бы потолком для будущих правок.
    """
    stale = []
    for rel, budget in ORM_BUDGET.items():
        path = MODULES_DIR / rel
        if not path.is_file():
            stale.append(f"{rel}: файла нет — уберите из ORM_BUDGET")
            continue
        count = len(_ORM_CALL.findall(path.read_text(encoding="utf-8")))
        if count < budget:
            stale.append(f"{rel}: фактически {count} при бюджете {budget} — опустите бюджет")
    assert not stale, "Бюджет ORM разошёлся с кодом:\n  " + "\n  ".join(stale)


def test_no_new_cross_domain_internal_imports():
    """Домены обращаются друг к другу через фасады, а не импортом чужих models/service."""
    offenders = []
    for path in sorted(MODULES_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        rel = _rel(path)
        own_module = rel.split("/")[0]
        found = [m for m in _CROSS_IMPORT.findall(path.read_text(encoding="utf-8"))
                 if m[0] != own_module]
        budget = CROSS_IMPORT_BUDGET.get(rel, 0)
        if len(found) > budget:
            names = ", ".join(f"{mod}.{part}" for mod, part in found)
            offenders.append(f"{rel}: {len(found)} импортов при бюджете {budget} ({names})")
    assert not offenders, (
        "Кросс-доменный импорт внутренностей в обход фасада (БТ-595/596).\n  "
        + "\n  ".join(offenders)
        + "\nДобавьте нужное в публичный API домена (__init__.py) и импортируйте оттуда."
    )
