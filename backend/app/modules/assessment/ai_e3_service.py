"""Этап E3 контура СИИ по ГОСТ Р 59898-2021 (BL-001) — сервис приложения.

Условия испытаний (разд. 7.2, 9): описанный тестовый набор с критерием выбросов, паритет
тестовой и эксплуатационной сред (табл. 3), экспертная группа с проверенной согласованностью.
Плюс сравнение нескольких СИИ в единых шкалах (п. 7.2.2.5). Математика — quality.ai_e3 (чистые
функции); здесь — хранение, проверки доступа к периоду СИИ и сборка ответов.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assessment.ai_e3_schemas import (
    DatasetIn,
    DatasetOut,
    ExpertScoreIn,
    OutlierCheckIn,
    ParityRowIn,
    TestConditionsOut,
)
from app.modules.assessment.models import (
    AiAssessmentValue,
    AiEnvParity,
    AiExpertScore,
    AiTestDataset,
    AiWeight,
    AssessmentPeriod,
)
from app.modules.quality import (
    AI_SUB_INDEX, ai_aggregate, ai_compute_metric, ai_e3, ai_model_tree, ai_normalize_to_baseline,
)
from app.modules.systems import System
from app.shared.exceptions import ConflictError, NotFoundError, ValidationError

PURPOSES = ("TEST", "VALIDATION", "STRESS")
HANDLINGS = ("REMOVED", "KEPT", "WINSORIZED", "FLAGGED")
EXPERT_SCALE = "EXPERT_SCALE"
MIN_EXPERTS = 2
_GROUP_OF = {(c["title"], s["name"]): g["group"]
             for g in ai_model_tree() for c in g["characteristics"] for s in c["subs"]}


async def require_ai_period(db: AsyncSession, period_id: uuid.UUID) -> AssessmentPeriod:
    period = await db.get(AssessmentPeriod, period_id)
    if period is None:
        raise NotFoundError("Период оценки не найден")
    system = await db.get(System, period.system_id)
    if system is None or (system.system_kind or "CLASSIC") != "AI":
        raise ConflictError("Период не относится к системе ИИ (контур 59898)")
    return period


# ═══════════════════ Тестовые наборы и выбросы (разд. 9) ═══════════════════

def _dataset_out(d: AiTestDataset) -> DatasetOut:
    return DatasetOut(
        id=str(d.id), period_id=str(d.period_id), name=d.name, purpose=d.purpose, records=d.records,
        source=d.source, collected_from=d.collected_from, representativeness=d.representativeness,
        class_balance=d.class_balance, outlier_method=d.outlier_method,
        outlier_k=float(d.outlier_k) if d.outlier_k is not None else None, outlier_feature=d.outlier_feature,
        outliers_count=d.outliers_count,
        outliers_share=float(d.outliers_share) if d.outliers_share is not None else None,
        outlier_handling=d.outlier_handling, notes=d.notes, updated_at=d.updated_at,
    )


def _validate_dataset(data: DatasetIn) -> None:
    if data.purpose not in PURPOSES:
        raise ValidationError(f"Назначение набора: {', '.join(PURPOSES)}")
    if data.outlier_method and data.outlier_method.upper() not in ai_e3.OUTLIER_METHODS:
        raise ValidationError(f"Метод выбросов: {', '.join(ai_e3.OUTLIER_METHODS)}")
    if data.outlier_handling and data.outlier_handling not in HANDLINGS:
        raise ValidationError(f"Обработка выбросов: {', '.join(HANDLINGS)}")
    if data.class_balance and abs(sum(data.class_balance.values()) - 1.0) > 0.01:
        raise ValidationError("Доли классов должны давать в сумме 1")


async def list_datasets(db: AsyncSession, period_id: uuid.UUID) -> list[DatasetOut]:
    await require_ai_period(db, period_id)
    rows = (await db.execute(
        select(AiTestDataset).where(AiTestDataset.period_id == period_id).order_by(AiTestDataset.created_at)
    )).scalars().all()
    return [_dataset_out(d) for d in rows]


async def save_dataset(db: AsyncSession, period_id: uuid.UUID, data: DatasetIn,
                       dataset_id: uuid.UUID | None = None) -> DatasetOut:
    await require_ai_period(db, period_id)
    _validate_dataset(data)
    if dataset_id is None:
        d = AiTestDataset(period_id=period_id)
        db.add(d)
    else:
        d = await db.get(AiTestDataset, dataset_id)
        if d is None or d.period_id != period_id:
            raise NotFoundError("Набор данных не найден")
    for field, value in data.model_dump().items():
        if field == "outlier_method" and value:
            value = value.upper()
        setattr(d, field, value)
    await db.commit()
    await db.refresh(d)
    return _dataset_out(d)


async def delete_dataset(db: AsyncSession, period_id: uuid.UUID, dataset_id: uuid.UUID) -> None:
    await require_ai_period(db, period_id)
    d = await db.get(AiTestDataset, dataset_id)
    if d is None or d.period_id != period_id:
        raise NotFoundError("Набор данных не найден")
    await db.delete(d)
    await db.commit()


async def check_outliers(db: AsyncSession, period_id: uuid.UUID, dataset_id: uuid.UUID,
                         data: OutlierCheckIn) -> dict:
    """Выбросы по значениям признака: считает сервер, результат пишется в метаданные набора."""
    await require_ai_period(db, period_id)
    d = await db.get(AiTestDataset, dataset_id)
    if d is None or d.period_id != period_id:
        raise NotFoundError("Набор данных не найден")
    if data.handling and data.handling not in HANDLINGS:
        raise ValidationError(f"Обработка выбросов: {', '.join(HANDLINGS)}")
    try:
        res = ai_e3.detect_outliers(data.values, data.method, data.k)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    d.outlier_method, d.outlier_k, d.outlier_feature = res["method"], res["k"], data.feature
    d.outliers_count, d.outliers_share = res["count"], res["share"]
    d.outlier_handling = data.handling or d.outlier_handling
    await db.commit()
    return res


# ═══════════════════ Паритет сред (табл. 3) ═══════════════════

_FACTOR_LABELS = dict(ai_e3.ENV_PARITY_FACTORS)


async def get_parity(db: AsyncSession, period_id: uuid.UUID) -> dict:
    await require_ai_period(db, period_id)
    rows = (await db.execute(select(AiEnvParity).where(AiEnvParity.period_id == period_id))).scalars().all()
    plain = [{"factor": r.factor, "label": _FACTOR_LABELS.get(r.factor, r.factor), "test_env": r.test_env,
              "prod_env": r.prod_env, "status": r.status, "justification": r.justification} for r in rows]
    order = {code: i for i, (code, _) in enumerate(ai_e3.ENV_PARITY_FACTORS)}
    plain.sort(key=lambda r: order.get(r["factor"], 99))
    return {"rows": plain, "factors": [{"code": c, "label": lbl} for c, lbl in ai_e3.ENV_PARITY_FACTORS],
            "summary": ai_e3.parity_summary(plain)}


async def save_parity(db: AsyncSession, period_id: uuid.UUID, items: list[ParityRowIn]) -> dict:
    await require_ai_period(db, period_id)
    for item in items:
        if item.factor not in _FACTOR_LABELS:
            raise ValidationError(f"Неизвестный фактор паритета: {item.factor}")
        if item.status not in ai_e3.PARITY_STATUSES:
            raise ValidationError(f"Статус паритета: {', '.join(ai_e3.PARITY_STATUSES)}")
        if item.status == ai_e3.PARITY_ACCEPTABLE and not (item.justification or "").strip():
            raise ValidationError(f"«{_FACTOR_LABELS[item.factor]}»: допустимое отличие требует обоснования")
        row = (await db.execute(select(AiEnvParity).where(
            AiEnvParity.period_id == period_id, AiEnvParity.factor == item.factor,
        ))).scalar_one_or_none()
        if row is None:
            row = AiEnvParity(period_id=period_id, factor=item.factor)
            db.add(row)
        row.test_env, row.prod_env = item.test_env, item.prod_env
        row.status, row.justification = item.status, item.justification
    await db.commit()
    return await get_parity(db, period_id)


# ═══════════════════ Экспертная группа и согласованность ═══════════════════

async def save_expert_scores(db: AsyncSession, period_id: uuid.UUID, expert: str, expert_name: str | None,
                             items: list[ExpertScoreIn]) -> int:
    """Эксперт вносит СВОИ оценки (0–100) — чужие оценки править нельзя по построению."""
    await require_ai_period(db, period_id)
    for item in items:
        key = (item.characteristic.strip(), item.subcharacteristic.strip())
        if key not in AI_SUB_INDEX:
            raise ValidationError(f"Пара не из модели 59898: {key[0]} / {key[1]}")
        row = (await db.execute(select(AiExpertScore).where(
            AiExpertScore.period_id == period_id, AiExpertScore.characteristic == key[0],
            AiExpertScore.subcharacteristic == key[1], AiExpertScore.expert == expert,
        ))).scalar_one_or_none()
        if row is None:
            row = AiExpertScore(period_id=period_id, characteristic=key[0], subcharacteristic=key[1], expert=expert)
            db.add(row)
        row.expert_name, row.score, row.comment = expert_name, item.score, item.comment
    await db.commit()
    return len(items)


def _object_key(characteristic: str, subcharacteristic: str) -> str:
    return f"{characteristic} / {subcharacteristic}"


async def consensus(db: AsyncSession, period_id: uuid.UUID) -> dict:
    await require_ai_period(db, period_id)
    rows = (await db.execute(select(AiExpertScore).where(AiExpertScore.period_id == period_id))).scalars().all()
    matrix: dict[str, dict[str, float]] = {}
    names: dict[str, str | None] = {}
    split: dict[str, tuple[str, str]] = {}
    for r in rows:
        obj = _object_key(r.characteristic, r.subcharacteristic)
        split[obj] = (r.characteristic, r.subcharacteristic)
        matrix.setdefault(r.expert, {})[obj] = float(r.score)
        names[r.expert] = r.expert_name
    kendall = ai_e3.kendall_w(matrix)
    objects = [{"characteristic": split[o][0], "subcharacteristic": split[o][1], "mean": kendall["means"].get(o),
                "rank_sum": kendall["rank_sums"].get(o),
                "scores": {e: matrix[e].get(o) for e in matrix}} for o in sorted(split)]
    return {"experts": [{"login": e, "name": names[e], "scored": len(matrix[e])} for e in sorted(matrix)],
            "kendall": kendall, "objects": objects}


async def apply_consensus(db: AsyncSession, period_id: uuid.UUID) -> dict:
    """Перенос средней оценки согласованной группы в значения EXPERT_SCALE (с нормировкой к
    эталону). Несогласованную группу не переносим: среднее несогласованных оценок не является
    экспертной оценкой в смысле стандарта."""
    result = await consensus(db, period_id)
    k = result["kendall"]
    if not k["consistent"]:
        raise ConflictError(
            f"Группа экспертов не согласована (W = {k['w']}, p = {k['p_value']}, порог W ≥ {k['threshold']}"
            f" при p < {ai_e3.ALPHA}) — обсудите расхождения и переоцените"
        )
    applied = 0
    for obj in result["objects"]:
        if obj["mean"] is None:
            continue
        key = (obj["characteristic"], obj["subcharacteristic"])
        value = (await db.execute(select(AiAssessmentValue).where(
            AiAssessmentValue.period_id == period_id, AiAssessmentValue.characteristic == key[0],
            AiAssessmentValue.subcharacteristic == key[1],
        ))).scalar_one_or_none()
        if value is None:
            if AI_SUB_INDEX[key]["metric_kind"] != EXPERT_SCALE:
                continue   # по каталогу метрика измеримая — экспертная оценка её не заменяет
            value = AiAssessmentValue(period_id=period_id, group_name=_GROUP_OF.get(key, "—"),
                                      characteristic=key[0], subcharacteristic=key[1], metric_kind=EXPERT_SCALE)
            db.add(value)
        if value.metric_kind != EXPERT_SCALE or value.unmeasurable:
            continue   # у измеримой метрики экспертная группа значение не подменяет
        value.inputs = {"score": obj["mean"], "experts": len(result["experts"]), "kendall_w": k["w"]}
        raw = ai_compute_metric(EXPERT_SCALE, value.inputs)
        value.raw_value = raw
        x, conformant = ai_normalize_to_baseline(
            raw, float(value.baseline) if value.baseline is not None else None,
            float(value.tol_low) if value.tol_low is not None else None,
            float(value.tol_high) if value.tol_high is not None else None,
        ) if raw is not None else (None, None)
        value.normalized_x, value.conformant = x, conformant
        value.expert_comment = (f"Групповая экспертная оценка: {len(result['experts'])} экспертов, "
                                f"W Кендалла = {k['w']} (p = {k['p_value']})")
        applied += 1
    await db.commit()
    return {"applied": applied, "kendall_w": k["w"], "consistent": True}


# ═══════════════════ Условия испытаний: сводка для отчёта и завершения ═══════════════════

async def test_conditions(db: AsyncSession, period_id: uuid.UUID) -> TestConditionsOut:
    await require_ai_period(db, period_id)
    datasets = (await db.execute(select(AiTestDataset).where(AiTestDataset.period_id == period_id))).scalars().all()
    parity = (await get_parity(db, period_id))["summary"]
    expert_values = (await db.execute(select(AiAssessmentValue).where(
        AiAssessmentValue.period_id == period_id, AiAssessmentValue.metric_kind == EXPERT_SCALE,
        AiAssessmentValue.unmeasurable.is_(False),
    ))).scalars().all()
    group = None
    gaps: list[str] = []
    if expert_values:
        group = (await consensus(db, period_id))["kendall"]
        if group["m"] < MIN_EXPERTS:
            gaps.append("экспертные оценки даны без экспертной группы (нужно ≥ 2 экспертов)")
        elif not group["consistent"]:
            gaps.append(f"экспертная группа не согласована (W = {group['w']})")
    without_criterion = [d.name for d in datasets if not d.outlier_method]
    if not datasets:
        gaps.append("не описан тестовый набор данных (разд. 9)")
    if without_criterion:
        gaps.append("у наборов не задан критерий выбросов: " + ", ".join(without_criterion))
    if not parity["ok"]:
        gaps.append(f"паритет сред не подтверждён ({parity['checked']} из {parity['total']} факторов проверено"
                    + (f", расхождений: {len(parity['mismatches'])}" if parity["mismatches"] else "") + ")")
    return TestConditionsOut(datasets=len(datasets), datasets_without_outlier_criterion=without_criterion,
                             parity=parity, expert_group=group, ready=not gaps, gaps=gaps)


# ═══════════════════ Сравнение нескольких СИИ (п. 7.2.2.5) ═══════════════════

async def compare(db: AsyncSession, period_ids: list[uuid.UUID]) -> dict:
    if len(period_ids) < 2:
        raise ValidationError("Для сравнения выберите не меньше двух оценок СИИ")
    assessments = []
    for pid in period_ids:
        period = await require_ai_period(db, pid)
        system = await db.get(System, period.system_id)
        values = (await db.execute(select(AiAssessmentValue).where(AiAssessmentValue.period_id == pid))).scalars().all()
        weights = (await db.execute(select(AiWeight).where(AiWeight.period_id == pid))).scalars().all()
        rows = [{"characteristic": v.characteristic, "subcharacteristic": v.subcharacteristic,
                 "metric_kind": v.metric_kind,
                 "baseline": float(v.baseline) if v.baseline is not None else None,
                 "tol_low": float(v.tol_low) if v.tol_low is not None else None,
                 "tol_high": float(v.tol_high) if v.tol_high is not None else None,
                 "normalized_x": float(v.normalized_x) if v.normalized_x is not None else None} for v in values]
        char_w = {w.name: float(w.weight) for w in weights if w.scope == "CHARACTERISTIC"}
        full = ai_aggregate(rows, char_w or None)
        assessments.append({"period_id": str(pid), "system": system.name if system else "—",
                            "period": period.period, "rows": rows, "q_full": full["q"]})
    return ai_e3.compare_on_common_scales(assessments)
