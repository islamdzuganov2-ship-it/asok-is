"""ТЗ v19 УК-36 — «даты как даты»: разбор Proposal.due_date (строка ДД.ММ.ГГГГ, как на фронте
в TaskPlanDashboard.tsx `parseRu`) в Proposal.due_on (нормальный DateTime).

Тот же принцип, что и match_owners_to_users.py: dry-run по умолчанию, отчёт разобрано/не
разобрано ДО записи, `--apply` для фактической записи. due_date НЕ удаляется и не меняется —
due_on дополняет его как источник истины для сортировки/сравнения (пункт 11, 12, 15).

Запуск (внутри контейнера backend):
    python -m app.scripts.backfill_due_dates            # отчёт, без записи
    python -m app.scripts.backfill_due_dates --apply      # отчёт + запись due_on
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.infrastructure.database import AsyncSessionLocal
from app.modules.governance import Proposal
from app.shared.dates import parse_ru_date  # реэкспорт: test_backfill_due_dates.py импортирует отсюда


async def run(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Proposal.id, Proposal.due_date)
                .where(Proposal.due_date.isnot(None), Proposal.due_on.is_(None))
            )
        ).all()

        print(f"Строк с due_date, но без due_on: {len(rows)}")
        parsed_count = 0
        unparseable: set[str] = set()
        to_write: dict = {}
        for row_id, raw in rows:
            dt = parse_ru_date(raw)
            if dt is None:
                unparseable.add(raw)
            else:
                parsed_count += 1
                to_write[row_id] = dt

        print(f"Разобрано: {parsed_count}")
        if unparseable:
            print(f"Не разобрано ({len(unparseable)} уникальных значений):")
            for v in sorted(unparseable):
                print(f"  - {v!r}")

        if apply and to_write:
            for row_id, dt in to_write.items():
                await db.execute(
                    Proposal.__table__.update().where(Proposal.id == row_id).values(due_on=dt)
                )
            await db.commit()
            print("[apply] записано.")
        elif apply:
            print("[apply] нечего записывать.")
        else:
            print("[dry-run] ничего не записано. Запустите с --apply, чтобы применить.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="записать due_on (по умолчанию — только отчёт)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
