"""ТЗ v19 УК-06/УК-07 — двухуровневая свёртка балла (Р-6, docs/ТЗ_19 §0).

Заменяет плоское среднее (`assessment/router.py` до ТЗ v19: `sum(x)/len(x)`, равнозначное для
всех подхарактеристик и всех ИС) на:

    Балл_ИС(s)    = Σ(вес_подхар × X_подхар) / Σ(вес применённых подхар)     — веса ОДНИ для всех ИС
    Балл_портфеля = Σ(вес_критичности(s) × Балл_ИС(s)) / Σ(вес_критичности)  — критичность здесь

Два разных вопроса разведены по двум уровням: «что важно ВНУТРИ системы» (веса подхарактеристик,
файл заказчика, одни для всех ИС) и «какая система важнее ДЛЯ БИЗНЕСА» (критичность, только на
уровне свёртки портфеля). Смешивать их в одну формулу — значит не суметь объяснить, откуда
взялась цифра (нарушает §6 ТЗ: «не показываем число, к которому нельзя задать вопрос почему»).

Знаменатель первой формулы — сумма весов ИЗМЕРЕННЫХ подхарактеристик, не всегда 100: при
`unmeasurable` вес не обнуляет числитель, а просто выпадает из обеих сумм (перенормировка,
решение В-5). Так «два измеримых из трёх» не тянет балл вниз штрафом за недостаток данных.

Чистые функции — без БД, без импорта ORM. Тестируются напрямую (test_scoring.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SubcharScore:
    characteristic: str
    subcharacteristic: str
    weight: float
    x: float | None  # None = unmeasurable/нет данных — не участвует в свёртке


@dataclass
class SystemScoreBreakdown:
    """Результат свёртки одной ИС — самодостаточен для объяснения цифры (пункт 1, УК-01..03)."""
    score: float | None            # 0..100 (проценты) или None, если ни одной измеренной подхар.
    weight_applied: float          # Σ весов измеренных подхарактеристик (знаменатель)
    weight_total: float            # Σ весов ВСЕХ подхарактеристик модели (обычно 100)
    coverage: float                # weight_applied / weight_total — «покрытие измеримостью», 0..1
    contributions: list[dict] = field(default_factory=list)  # по каждой измеренной подхар.: вклад


def weighted_system_score(subchar_scores: list[SubcharScore]) -> SystemScoreBreakdown:
    """Свёртка одной ИС. X ожидается в долях [0,1] или процентах [0,100] — функция не нормирует
    вход, только взвешивает; вызывающий код передаёт единый масштаб (в системе — проценты)."""
    weight_total = sum(s.weight for s in subchar_scores)
    measured = [s for s in subchar_scores if s.x is not None]
    weight_applied = sum(s.weight for s in measured)

    if weight_applied <= 0:
        return SystemScoreBreakdown(
            score=None, weight_applied=0.0, weight_total=weight_total, coverage=0.0,
        )

    numerator = sum(s.weight * s.x for s in measured)
    score = numerator / weight_applied

    contributions = [
        {
            "characteristic": s.characteristic,
            "subcharacteristic": s.subcharacteristic,
            "weight": s.weight,
            "x": s.x,
            # вклад в баллах итоговой шкалы (Σ по всем строкам == score, без остатка) —
            # тот самый ответ на «почему цифра такая», а не абстрактная доля.
            "pointsContribution": round((s.weight * s.x) / weight_applied, 4) if weight_applied else 0.0,
        }
        for s in measured
    ]
    contributions.sort(key=lambda c: c["weight"], reverse=True)

    return SystemScoreBreakdown(
        score=round(score, 4),
        weight_applied=round(weight_applied, 4),
        weight_total=round(weight_total, 4),
        coverage=round(weight_applied / weight_total, 4) if weight_total else 0.0,
        contributions=contributions,
    )


@dataclass
class PortfolioScoreBreakdown:
    score: float | None
    criticality_weight_applied: float
    system_contributions: list[dict] = field(default_factory=list)


def portfolio_score(
    system_scores: dict[str, float],            # system_id/name → Балл_ИС (уже посчитан)
    criticality_by_system: dict[str, str],       # system_id/name → класс критичности
    criticality_weights: dict[str, float],       # класс критичности → числовой вес (В-6а)
    default_weight: float = 1.0,                 # неизвестный класс — не роняем свёртку молча
) -> PortfolioScoreBreakdown:
    """Балл_портфеля — второй уровень свёртки, ТОЛЬКО критичность, веса подхарактеристик сюда
    уже не попадают (они разошлись на первом уровне)."""
    scored = {k: v for k, v in system_scores.items() if v is not None}
    if not scored:
        return PortfolioScoreBreakdown(score=None, criticality_weight_applied=0.0)

    weights = {
        sid: criticality_weights.get(criticality_by_system.get(sid, ""), default_weight)
        for sid in scored
    }
    total_weight = sum(weights.values())
    if total_weight <= 0:
        return PortfolioScoreBreakdown(score=None, criticality_weight_applied=0.0)

    numerator = sum(weights[sid] * scored[sid] for sid in scored)
    score = numerator / total_weight

    contributions = [
        {
            "system": sid,
            "criticality": criticality_by_system.get(sid),
            "score": scored[sid],
            "criticalityWeight": weights[sid],
            # вклад в баллах итоговой шкалы портфеля (Σ по всем ИС == score) — единообразно
            # с weighted_system_score.pointsContribution, а не доля [0,1].
            "pointsContribution": round((weights[sid] * scored[sid]) / total_weight, 4),
        }
        for sid in scored
    ]
    contributions.sort(key=lambda c: c["pointsContribution"], reverse=True)

    return PortfolioScoreBreakdown(
        score=round(score, 4),
        criticality_weight_applied=round(total_weight, 4),
        system_contributions=contributions,
    )


def measure_weight(
    characteristic_weight: float, criticality_weight: float, effort_hours: float | None,
) -> float | None:
    """«Вес меры» (п.13, УК-13): характеристика × критичность ИС × трудоёмкость — эвристика для
    сравнения нагрузки исполнителей («5 сложных» vs «15 лёгких» — считать надо не поштучно), а не
    метрика из ГОСТ. Подхарактеристику взять негде: Proposal хранит только characteristic (см.
    governance/models.py) — попытка сопоставить metric_name с подхарактеристикой была бы хрупким
    сравнением строк без FK (та самая ловушка «Доступность» ×2, quality/weights.py). effort_hours —
    рукой исполнителя (В-41); None (нет оценки) возвращает None, а НЕ 0 — мера без оценки часов не
    должна тихо обнулять свой вес, её считают отдельным счётчиком (см. вызывающий код)."""
    if effort_hours is None:
        return None
    return round(characteristic_weight * criticality_weight * effort_hours, 4)
