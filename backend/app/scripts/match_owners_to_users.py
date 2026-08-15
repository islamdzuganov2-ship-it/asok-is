"""ТЗ v19 УК-13 — сопоставление строковых `owner`/`executed_by`/`verified_by` с users.id.

CLAUDE.md требует обязательный отчёт «сопоставлено / не сопоставлено» ДО применения миграции
ответственных. Этот скрипт — тот отчёт: по умолчанию dry-run (только печатает разбор), пишет
в БД только с флагом `--apply`. Ничего не удаляет и не трогает строковые поля — `owner_user_id`
дополняет `owner`, не заменяет (см. docstring в 014_management_contour_foundation.py).

Формат исходных строк в демо/проде — «Роль ФИО» или «Фамилия И.О.», например:
"Риск-менеджер Орлов А.В.", "Сидоров К.М." — не структурированные ФИО, поэтому сопоставление
по фамилии + инициалам, а не точное совпадение строки. Неоднозначное совпадение (два пользователя
с одинаковой фамилией и инициалами) сознательно НЕ сопоставляется — лучше явный список на
ручную проверку, чем тихая ошибка в том, кто на самом деле отвечает за меру.

Запуск (внутри контейнера backend):
    python -m app.scripts.match_owners_to_users              # отчёт, без записи
    python -m app.scripts.match_owners_to_users --apply       # отчёт + запись owner_user_id
"""
from __future__ import annotations

import argparse
import asyncio
import re
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.governance import Proposal
from app.modules.iam import User
from app.modules.nonconformity import Nonconformity
from app.modules.systems import System

# "Риск-менеджер Орлов А.В." / "Орлов А.В." / "Сидоров К.М." — роль (опц.) + Фамилия + И.О.
_NAME_RE = re.compile(
    r"(?:^|\s)(?P<surname>[А-ЯЁ][а-яё]+)\s+(?P<initials>[А-ЯЁ]\.\s?[А-ЯЁ]\.)\s*$"
)
_INITIAL_LETTER_RE = re.compile(r"[А-ЯЁ]\.")


@dataclass(frozen=True)
class ParsedOwner:
    surname: str
    initials: str  # нормализовано "А.В." — без пробела между инициалами


def parse_owner_string(raw: str | None) -> ParsedOwner | None:
    """Извлекает фамилию + инициалы из хвоста строки. None, если хвост не похож на ФИО."""
    if not raw:
        return None
    m = _NAME_RE.search(raw.strip())
    if not m:
        return None
    initials = m.group("initials").replace(" ", "")
    return ParsedOwner(surname=m.group("surname"), initials=initials)


def _user_initials(full_name: str) -> tuple[str, str] | None:
    """Фамилия + инициалы из User.full_name. Два формата в ходу вперемешку (наблюдалось на
    реальных сидах): полностью расписанное «Орлов Андрей Викторович» → «Орлов», «А.В.», и уже
    сокращённое «Петрова А.С.» (одним токеном «А.С.», без пробела внутри) → «Петрова», «А.С.» —
    вторая форма ломает наивное «первая буква каждого токена», поэтому сначала ищем готовые
    инициалы регэкспом и только если их нет — собираем из полных имени/отчества."""
    parts = [p for p in re.split(r"\s+", full_name.strip()) if p]
    if len(parts) < 2:
        return None
    surname, *rest = parts
    rest_joined = " ".join(rest)

    ready = _INITIAL_LETTER_RE.findall(rest_joined)
    if len(ready) >= 2:
        return surname, "".join(ready[:2])

    spelled = "".join(f"{p[0].upper()}." for p in rest if p and p[0].isalpha())
    if len(spelled) < 4:  # меньше двух инициалов — недостаточно для надёжного сопоставления
        return None
    return surname, spelled


@dataclass(frozen=True)
class MatchCandidate:
    id: str
    full_name: str
    username: str


@dataclass
class MatchOutcome:
    matched: MatchCandidate | None = None
    ambiguous: list[MatchCandidate] = field(default_factory=list)  # >1 кандидат — не сопоставляем


def match_user(owner_raw: str | None, users: list[MatchCandidate]) -> MatchOutcome:
    """Сопоставляет строку ответственного со списком пользователей. Чистая функция — без БД,
    тестируется напрямую (backend/tests/test_owner_matching.py)."""
    if not owner_raw:
        return MatchOutcome()

    stripped = owner_raw.strip().lower()
    exact = [u for u in users if u.full_name.strip().lower() == stripped]
    if len(exact) == 1:
        return MatchOutcome(matched=exact[0])
    if len(exact) > 1:
        return MatchOutcome(ambiguous=exact)

    parsed = parse_owner_string(owner_raw)
    if parsed is None:
        return MatchOutcome()

    candidates = []
    for u in users:
        ui = _user_initials(u.full_name)
        if ui is None:
            continue
        surname, initials = ui
        if surname.lower() == parsed.surname.lower() and initials == parsed.initials:
            candidates.append(u)

    if len(candidates) == 1:
        return MatchOutcome(matched=candidates[0])
    if len(candidates) > 1:
        return MatchOutcome(ambiguous=candidates)
    return MatchOutcome()


@dataclass
class FieldReport:
    table: str
    field: str
    total_rows: int = 0
    matched_rows: int = 0
    unmatched_distinct: set[str] = field(default_factory=set)
    ambiguous_distinct: set[str] = field(default_factory=set)


async def _load_users(db) -> list[MatchCandidate]:
    rows = (await db.execute(select(User.id, User.full_name, User.username))).all()
    return [
        MatchCandidate(id=str(r.id), full_name=r.full_name or "", username=r.username)
        for r in rows if r.full_name
    ]


async def _report_field(db, model, id_col, value_col, table: str, field_name: str,
                         users: list[MatchCandidate]) -> tuple[FieldReport, dict[uuid.UUID, uuid.UUID]]:
    """Возвращает отчёт по полю + карту {row_id: matched_user_id} для найденных однозначно."""
    rows = (await db.execute(select(id_col, value_col).where(value_col.isnot(None)))).all()
    rep = FieldReport(table=table, field=field_name, total_rows=len(rows))
    to_write: dict[uuid.UUID, uuid.UUID] = {}
    for row_id, raw in rows:
        outcome = match_user(raw, users)
        if outcome.matched:
            rep.matched_rows += 1
            to_write[row_id] = uuid.UUID(outcome.matched.id)
        elif outcome.ambiguous:
            rep.ambiguous_distinct.add(raw)
        else:
            rep.unmatched_distinct.add(raw)
    return rep, to_write


def _print_report(rep: FieldReport) -> None:
    print(f"\n[{rep.table}.{rep.field}] строк с значением: {rep.total_rows}, "
          f"сопоставлено: {rep.matched_rows}")
    if rep.unmatched_distinct:
        print(f"  не сопоставлено ({len(rep.unmatched_distinct)} уникальных значений):")
        for v in sorted(rep.unmatched_distinct):
            print(f"    - {v!r}")
    if rep.ambiguous_distinct:
        print(f"  НЕОДНОЗНАЧНО ({len(rep.ambiguous_distinct)} уникальных значений, "
              f">1 пользователя подошли — сопоставьте руками):")
        for v in sorted(rep.ambiguous_distinct):
            print(f"    - {v!r}")


async def run(apply: bool) -> list[FieldReport]:
    async with AsyncSessionLocal() as db:
        users = await _load_users(db)
        print(f"Пользователей с заполненным full_name: {len(users)}")

        targets = [
            (Proposal, Proposal.id, Proposal.owner, "proposals", "owner", Proposal.owner_user_id),
            (Proposal, Proposal.id, Proposal.executed_by, "proposals", "executed_by",
             Proposal.executed_by_user_id),
            (Nonconformity, Nonconformity.id, Nonconformity.owner, "nonconformities", "owner",
             Nonconformity.owner_user_id),
            (Nonconformity, Nonconformity.id, Nonconformity.executed_by, "nonconformities",
             "executed_by", Nonconformity.executed_by_user_id),
            (Nonconformity, Nonconformity.id, Nonconformity.verified_by, "nonconformities",
             "verified_by", Nonconformity.verified_by_user_id),
            (System, System.id, System.owner, "systems", "owner", System.owner_user_id),
        ]

        reports: list[FieldReport] = []
        for model, id_col, value_col, table, field_name, target_col in targets:
            rep, to_write = await _report_field(db, model, id_col, value_col, table, field_name, users)
            _print_report(rep)
            reports.append(rep)
            if apply and to_write:
                for row_id, user_id in to_write.items():
                    await db.execute(
                        model.__table__.update()
                        .where(id_col == row_id)
                        .values(**{target_col.key: user_id})
                    )
        if apply:
            await db.commit()
            print("\n[apply] записано.")
        else:
            print("\n[dry-run] ничего не записано. Запустите с --apply, чтобы применить.")
        return reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="записать owner_user_id (по умолчанию — только отчёт)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
