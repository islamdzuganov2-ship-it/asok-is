"""
Лист «Балл ИС» в Excel-выгрузке периода (ТЗ v19 п.1, УК-02).

Критерий УК-02: цифра на дашборде CEO, на теплокарте и в Excel-отчёте совпадает. Поэтому лист
считается НЕ своей формулой, а той же свёрткой и теми же активными весами, что дашборды
(`quality.score_points`), с тем же округлением значений до целых процентов.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.quality import canonical_characteristic, map_to_level, score_points
from app.modules.systems import System

HEADERS = ["Показатель / подхарактеристика", "Характеристика", "Вес", "X, %", "Вклад в балл, п."]


async def period_score_rows(db: AsyncSession, period, vals) -> list[list]:
    system = await db.get(System, period.system_id)
    crit = getattr(getattr(system, "criticality_class", None), "value", None)
    points = []
    for v in vals:
        canon = canonical_characteristic(v.metric.characteristic)
        if canon is None:
            continue
        x = None if v.unmeasurable or v.calculated_x is None else round(float(v.calculated_x) * 100)
        points.append((canon, v.metric.subcharacteristic, x))
    b = await score_points(db, crit, points)
    score = round(b.score) if b.score is not None else None
    rows: list[list] = [
        ["Балл ИС, %", None, None, score, None],
        ["Уровень", None, None, map_to_level(score / 100) if score is not None else "нет данных", None],
        ["Покрытие измерением, %", None, None, round(b.coverage * 100, 1), None],
        ["Класс критичности (профиль весов)", None, None, crit or "не задан", None],
        [None, None, None, None, None],
    ]
    rows += [[c["subcharacteristic"], c["characteristic"], round(c["weight"], 4), c["x"],
              round(c["pointsContribution"], 2)] for c in b.contributions]
    return rows
