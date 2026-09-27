"""
Снятие объёма с роли аналитика (BL-007 RE-19, §6.2 ТЗ контура) — сервис рычагов 2–4 и норматива.

Диагноз — перегруз объёмом, а не конфликт полномочий: роль не делится, работа снимается.
  • рычаг 2 — глубина по классу ИС (quality.depth): полная / профильная / скрининг;
  • рычаг 3 — self-service чек-лист владельца ИС: владелец собирает артефакты сам, аналитик
    проверяет случайную выборку, а не всё;
  • рычаг 4 — дельта-переоценка: значения прошлого периода переносятся, аналитик меняет только
    то, что изменилось (перенос помечен carried_over, правка флаг снимает);
  • норматив человеко-часов на оценку по глубине — продуктовая метрика: факт (часы при
    завершении) против норматива из EconConfig `assessment_norm_hours`.
Рычаги 1 (сдвиг проверок типа E в A/B/C, RE-21) и 5 (движки экономики) — в других модулях.
"""
from __future__ import annotations

import random
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment.models import AssessmentPeriod, AssessmentValue, OwnerChecklistItem
from app.modules.quality import (
    DEPTH_FULL,
    DEPTH_LABELS,
    DEPTHS,
    MetricCatalog,
    required_pairs,
    required_set,
)
from app.modules.systems import System
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

STATUS_COMPLETE = "COMPLETE"
DEFAULT_NORM_HOURS = {"FULL": 40, "PROFILE": 16, "SCREENING": 6}
DEFAULT_SAMPLE_SHARE = 0.2

CHECK_PENDING = "PENDING"
CHECK_SUBMITTED = "SUBMITTED"
CHECK_VERIFIED = "VERIFIED"
CHECK_REJECTED = "REJECTED"
CHECK_NOT_SAMPLED = "NOT_SAMPLED"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def depth_of(period: AssessmentPeriod) -> str:
    return period.depth or DEPTH_FULL


async def _period_or_404(db: AsyncSession, period_id: uuid.UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise NotFoundError("Период оценки не найден")
    return period


# ── Рычаг 2: глубина периода ──

async def depth_info(db: AsyncSession, period_id: uuid.UUID) -> dict:
    period = await _period_or_404(db, period_id)
    system = await db.get(System, period.system_id)
    depth = depth_of(period)
    pairs = required_pairs(depth)
    return {
        "periodId": str(period.id),
        "systemName": system.name if system else None,
        "criticality": system.criticality_class.value if system else None,
        "depth": depth,
        "depthLabel": DEPTH_LABELS[depth],
        "requiredCount": len(pairs),
        "totalCount": len(required_pairs(DEPTH_FULL)),
        "required": [{"characteristic": c, "subcharacteristic": s} for c, s in pairs],
    }


async def set_depth(db: AsyncSession, period_id: uuid.UUID, depth: str) -> dict:
    """Ручное переопределение глубины (например, Business-ИС под проверкой регулятора → полная)."""
    if depth not in DEPTHS:
        raise ValidationError(f"Глубина: {', '.join(DEPTHS)}")
    period = await _period_or_404(db, period_id)
    if period.status == STATUS_COMPLETE:
        raise ConflictError("Оценка завершена — глубину меняют до завершения")
    period.depth = depth
    await db.commit()
    return await depth_info(db, period_id)


# ── Рычаг 4: дельта-переоценка ──

async def carry_over(db: AsyncSession, period_id: uuid.UUID, source_id: uuid.UUID | None) -> dict:
    """Перенести значения прошлого периода в текущий там, где текущий ещё не заполнен.

    Источник по умолчанию — последний ЗАВЕРШЁННЫЙ период той же ИС. Переносятся входы (A, B),
    рассчитанный X, уровень, «невозможно измерить» с причиной и артефакты; перенесённое помечено
    carried_over=True и data_source=CARRIED. Заполненное вручную не трогается никогда.
    """
    target = await _period_or_404(db, period_id)
    if target.status == STATUS_COMPLETE:
        raise ConflictError("Оценка завершена — перенос значений недоступен")
    if source_id is not None:
        source = await _period_or_404(db, source_id)
        if source.system_id != target.system_id:
            raise ValidationError("Перенос возможен только из периода той же ИС")
    else:
        candidates = (await db.execute(
            select(AssessmentPeriod).where(
                AssessmentPeriod.system_id == target.system_id,
                AssessmentPeriod.id != target.id,
                AssessmentPeriod.status == STATUS_COMPLETE,
            ).order_by(AssessmentPeriod.created_at.desc())
        )).scalars().all()
        if not candidates:
            raise NotFoundError("Нет завершённого периода этой ИС — переносить нечего")
        source = candidates[0]

    src_values = {v.metric_id: v for v in (await db.execute(
        select(AssessmentValue).where(AssessmentValue.period_id == source.id)
    )).scalars()}
    tgt_values = {v.metric_id: v for v in (await db.execute(
        select(AssessmentValue).where(AssessmentValue.period_id == target.id)
    )).scalars()}

    carried = 0
    for metric_id, src in src_values.items():
        if src.calculated_x is None and not src.unmeasurable:
            continue
        tgt = tgt_values.get(metric_id)
        if tgt is not None and (tgt.calculated_x is not None or tgt.unmeasurable):
            continue   # уже переоценено вручную — не затираем
        if tgt is None:
            tgt = AssessmentValue(period_id=target.id, metric_id=metric_id)
            db.add(tgt)
        tgt.val_a, tgt.val_b = src.val_a, src.val_b
        tgt.calculated_x, tgt.quality_level = src.calculated_x, src.quality_level
        tgt.unmeasurable, tgt.expert_comment = src.unmeasurable, src.expert_comment
        tgt.artifact_links = src.artifact_links
        tgt.data_source = "CARRIED"
        tgt.carried_over = True
        carried += 1
    target.carried_from_period_id = source.id
    await db.commit()
    return {"periodId": str(target.id), "sourcePeriodId": str(source.id), "carried": carried}


async def delta_summary(db: AsyncSession, period_id: uuid.UUID) -> dict:
    """Сколько обязательных подхарактеристик перенесено без изменений и сколько переоценено."""
    period = await _period_or_404(db, period_id)
    rows = (await db.execute(
        select(MetricCatalog.characteristic, MetricCatalog.subcharacteristic, AssessmentValue.carried_over,
               AssessmentValue.calculated_x, AssessmentValue.unmeasurable)
        .join(AssessmentValue, AssessmentValue.metric_id == MetricCatalog.id)
        .where(AssessmentValue.period_id == period_id)
    )).all()
    req = required_set(depth_of(period))
    filled = [(c, s, flag) for c, s, flag, x, unm in rows if (c, s) in req and (x is not None or unm)]
    carried = {(c, s) for c, s, flag in filled if flag}
    reassessed = {(c, s) for c, s, flag in filled if not flag}
    return {"required": len(req), "carriedOver": len(carried), "reassessed": len(reassessed - carried)}


# ── Рычаг 3: self-service чек-лист владельца ИС ──

def _question(characteristic: str, subcharacteristic: str) -> str:
    return (f"«{subcharacteristic}» ({characteristic}): приложите артефакт, подтверждающий текущее "
            f"состояние — отчёт мониторинга, выгрузку, регламент или протокол испытаний.")


async def generate_checklist(db: AsyncSession, period_id: uuid.UUID) -> list[OwnerChecklistItem]:
    period = await _period_or_404(db, period_id)
    have = {(i.characteristic, i.subcharacteristic) for i in (await db.execute(
        select(OwnerChecklistItem).where(OwnerChecklistItem.period_id == period_id)
    )).scalars()}
    for c, s in required_pairs(depth_of(period)):
        if (c, s) not in have:
            db.add(OwnerChecklistItem(period_id=period_id, characteristic=c, subcharacteristic=s,
                                      question=_question(c, s)))
    await db.commit()
    return await list_checklist(db, period_id)


async def list_checklist(db: AsyncSession, period_id: uuid.UUID) -> list[OwnerChecklistItem]:
    return list((await db.execute(
        select(OwnerChecklistItem).where(OwnerChecklistItem.period_id == period_id)
        .order_by(OwnerChecklistItem.characteristic, OwnerChecklistItem.subcharacteristic)
    )).scalars())


async def open_items(db: AsyncSession) -> list[dict]:
    """Пункты, ждущие ответа владельца (новые и отклонённые аналитиком), по всем незавершённым
    периодам — рабочий список владельца ИС на «Моих задачах»."""
    rows = (await db.execute(
        select(OwnerChecklistItem, AssessmentPeriod, System)
        .join(AssessmentPeriod, AssessmentPeriod.id == OwnerChecklistItem.period_id)
        .join(System, System.id == AssessmentPeriod.system_id)
        .where(OwnerChecklistItem.verification.in_((CHECK_PENDING, CHECK_REJECTED)),
               AssessmentPeriod.status != STATUS_COMPLETE)
        .order_by(System.name, AssessmentPeriod.period, OwnerChecklistItem.characteristic)
    )).all()
    return [{
        "id": str(item.id), "periodId": str(period.id), "period": period.period, "systemName": system.name,
        "characteristic": item.characteristic, "subcharacteristic": item.subcharacteristic,
        "question": item.question, "answer": item.answer, "artifactUrl": item.artifact_url,
        "verification": item.verification, "verifierComment": item.verifier_comment,
    } for item, period, system in rows]


async def _item_or_404(db: AsyncSession, item_id: uuid.UUID) -> OwnerChecklistItem:
    item = await db.get(OwnerChecklistItem, item_id)
    if item is None:
        raise NotFoundError("Пункт чек-листа не найден")
    return item


async def answer_item(db: AsyncSession, item_id: uuid.UUID, answer: str | None,
                      artifact_url: str | None, username: str) -> OwnerChecklistItem:
    item = await _item_or_404(db, item_id)
    if item.verification in (CHECK_VERIFIED, CHECK_REJECTED):
        raise ConflictError("Пункт уже проверен аналитиком — ответ не меняется")
    if not (answer or "").strip() and not (artifact_url or "").strip():
        raise ValidationError("Нужен ответ или ссылка на артефакт")
    item.answer = (answer or "").strip() or None
    item.artifact_url = (artifact_url or "").strip() or None
    item.submitted_by = username
    item.submitted_at = _now()
    item.verification = CHECK_SUBMITTED
    await db.commit()
    await db.refresh(item)
    return item


async def sample_checklist(db: AsyncSession, period_id: uuid.UUID, share: float | None) -> dict:
    """Случайная выборка отвеченных пунктов на проверку; остальные принимаются без проверки.

    Генератор детерминирован по id периода: повторный вызов даёт ту же выборку, «перебросить
    кости» до удобной выборки нельзя. Минимум один пункт, если что-то отвечено.
    """
    share = DEFAULT_SAMPLE_SHARE if share is None else share
    if not 0 < share <= 1:
        raise ValidationError("Доля выборки — от 0 до 1")
    items = [i for i in await list_checklist(db, period_id) if i.verification == CHECK_SUBMITTED and not i.sampled]
    if not items:
        return {"sampled": 0, "acceptedWithoutCheck": 0}
    k = max(1, round(len(items) * share))
    rng = random.Random(uuid.UUID(str(period_id)).int)
    chosen = {i.id for i in rng.sample(items, k)}
    for i in items:
        if i.id in chosen:
            i.sampled = True
        else:
            i.verification = CHECK_NOT_SAMPLED
    await db.commit()
    return {"sampled": k, "acceptedWithoutCheck": len(items) - k}


async def verify_item(db: AsyncSession, item_id: uuid.UUID, verdict: str, comment: str | None,
                      username: str) -> OwnerChecklistItem:
    if verdict not in (CHECK_VERIFIED, CHECK_REJECTED):
        raise ValidationError("Вердикт: VERIFIED или REJECTED")
    item = await _item_or_404(db, item_id)
    if not item.sampled:
        raise ConflictError("Проверяются только пункты выборки")
    if item.submitted_by and item.submitted_by == username:
        # SoD: собственный ответ не верифицируется тем же человеком.
        raise ConflictError("Нельзя проверять собственный ответ")
    if verdict == CHECK_REJECTED and not (comment or "").strip():
        raise ValidationError("Отклонение требует комментария — владелец должен понять, что исправить")
    item.verification = verdict
    item.verified_by = username
    item.verified_at = _now()
    item.verifier_comment = comment
    await db.commit()
    await db.refresh(item)
    return item


# ── Норматив человеко-часов ──

async def set_analyst_hours(db: AsyncSession, period: AssessmentPeriod, hours: float | None) -> None:
    if hours is None:
        return
    if hours < 0 or hours > 1000:
        raise ValidationError("Часы аналитика — от 0 до 1000")
    period.analyst_hours = hours


async def effort_report(db: AsyncSession) -> dict:
    """Факт часов аналитика на оценку против норматива — по глубине оценки (продуктовая метрика)."""
    # Импорт фасада econ — здесь, а не на уровне модуля: econ.router тянет risk, а risk — econ;
    # при загрузке assessment раньше risk модульный импорт замыкал цикл.
    from app.modules.econ import config_value

    norms = await config_value(db, "assessment_norm_hours", DEFAULT_NORM_HOURS) or DEFAULT_NORM_HOURS
    periods = list((await db.execute(select(AssessmentPeriod))).scalars())
    by_depth: dict[str, list[float]] = defaultdict(list)
    without_hours: dict[str, int] = defaultdict(int)
    for p in periods:
        if p.status != STATUS_COMPLETE:
            continue
        d = depth_of(p)
        if p.analyst_hours is None:
            without_hours[d] += 1
        else:
            by_depth[d].append(float(p.analyst_hours))
    rows = []
    for d in DEPTHS:
        hours = by_depth.get(d, [])
        avg = round(sum(hours) / len(hours), 1) if hours else None
        norm = float(norms.get(d, DEFAULT_NORM_HOURS[d]))
        rows.append({
            "depth": d, "depthLabel": DEPTH_LABELS[d], "normHours": norm,
            "periods": len(hours), "periodsWithoutHours": without_hours.get(d, 0),
            "avgHours": avg,
            "deviationPct": round((avg - norm) / norm * 100, 1) if avg is not None and norm else None,
            "requiredSubchars": len(required_pairs(d)),
        })
    items = (await db.execute(select(OwnerChecklistItem))).scalars().all()
    answered = [i for i in items if i.verification != CHECK_PENDING]
    return {
        "rows": rows,
        "checklist": {
            "items": len(items), "answered": len(answered),
            "sampled": sum(1 for i in items if i.sampled),
            "rejected": sum(1 for i in items if i.verification == CHECK_REJECTED),
        },
    }
