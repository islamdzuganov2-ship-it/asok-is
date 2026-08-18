"""
REST API домена quality — каталог метрик (ТЗ v13).

RBAC: чтение каталога — всем аутентифицированным (нужен формам ввода и дашбордам),
правка — по праву `quality.catalog.edit`, которое по умолчанию есть только у встроенных
ролей (ADMIN/SUPER_ADMIN). Каталог — справочные данные модели качества ISO 25010, на них
опираются все оценки, включая закрытые периоды.

До 2026-08-15 роутер не имел ни одного гейта: анонимный `DELETE /metrics/{id}` доходил до
тела обработчика и удалил бы строку каталога (ДЕФ-01). Инвариант «каждый маршрут под
гейтом» стережёт `tests/test_route_guards.py`.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission, resolve_user_id
from app.modules.quality.models import FormulaType, MetricCatalog, WeightSetVersion
from app.modules.quality.schemas import (
    CharWeightRow,
    MetricCreate,
    MetricOut,
    MetricUpdate,
    SubcharWithinRow,
    WeightEditIn,
    WeightEditorOut,
    WeightsOut,
    WeightVersionSummaryOut,
)
from app.modules.quality.weight_versions import (
    DEFAULT_CRITICALITY_WEIGHTS,
    RecomputeReport,
    combined_weights_for_version,
    ensure_active_version,
    get_active_version,
    list_versions,
    preview_weight_edit,
    recompute_and_snapshot,
    save_weight_edit,
    validate_weight_edit,
)
from app.modules.quality.weights import CRITICALITY_PROFILES, ISO_KEY_BY_PAIR, SUBCHAR_WEIGHTS, TOTAL_WEIGHT
from app.shared.exceptions import ValidationError

router = APIRouter()


def _formula_type(value: str) -> FormulaType:
    try:
        return FormulaType(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unknown formula_type") from exc


@router.get("/", response_model=List[MetricOut])
async def get_metrics(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> list[MetricCatalog]:
    result = await db.execute(select(MetricCatalog).order_by(MetricCatalog.id))
    return list(result.scalars().all())


@router.post("/", response_model=MetricOut, status_code=status.HTTP_201_CREATED)
async def create_metric(
    metric_data: MetricCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> MetricCatalog:
    payload = metric_data.model_dump(exclude_none=True)
    payload["formula_type"] = _formula_type(payload["formula_type"])
    metric = MetricCatalog(**payload)
    db.add(metric)
    await db.commit()
    await db.refresh(metric)
    return metric


@router.put("/{metric_id}", response_model=MetricOut)
async def update_metric(
    metric_id: int,
    metric_data: MetricUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> MetricCatalog:
    payload = metric_data.model_dump(exclude_unset=True)
    if "formula_type" in payload:
        payload["formula_type"] = _formula_type(payload["formula_type"])

    result = await db.execute(
        update(MetricCatalog)
        .where(MetricCatalog.id == metric_id)
        .values(**payload)
        .returning(MetricCatalog)
    )
    updated = result.scalar_one_or_none()
    if updated is None:
        raise HTTPException(status_code=404, detail="Metric not found")

    await db.commit()
    return updated


@router.delete("/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_metric(
    metric_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.catalog.edit")),
) -> None:
    result = await db.execute(delete(MetricCatalog).where(MetricCatalog.id == metric_id))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Metric not found")
    await db.commit()


# ═══════════════════ Веса подхарактеристик (ТЗ v19 УК-04..07) ═══════════════════

@router.get("/weights", response_model=WeightsOut)
async def get_weights(
    profile: str = "BUSINESS OPERATIONAL",
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(get_current_user),
) -> WeightsOut:
    """Текущий применяемый весовой вектор — открыт всем аутентифицированным: объяснимость
    (пункт 1) требует, чтобы ЛЮБОЙ пользователь мог увидеть, откуда взялись веса в баллах.

    ТЗ v19 УК-05: вес теперь по профилю критичности — `profile` по умолчанию BUSINESS
    OPERATIONAL (самый частый класс ИС), достаточно для потребителей без разреза по ИС
    (например, общий рейтинг просадки характеристик). Кто считает балл КОНКРЕТНОЙ ИС, берёт
    вес из /assessments/dashboard или /reports/executive-dashboard — там профиль системы известен."""
    active = await ensure_active_version(db)
    if profile not in CRITICALITY_PROFILES:
        profile = "BUSINESS OPERATIONAL"
    weights_by_profile = combined_weights_for_version(active)
    profile_weights = weights_by_profile.get(profile, {})
    return WeightsOut(
        active_version_id=active.id,
        active_version_label=active.label,
        total_weight=TOTAL_WEIGHT,
        subchar_weights=[
            {
                "characteristic": c, "subcharacteristic": s,
                "weight": profile_weights.get((c, s), SUBCHAR_WEIGHTS[(c, s)]),
                "isoKey": ISO_KEY_BY_PAIR[(c, s)],
            }
            for (c, s) in SUBCHAR_WEIGHTS
        ],
        criticality_weights=DEFAULT_CRITICALITY_WEIGHTS,
    )


@router.post("/weights/recompute", response_model=RecomputeReport)
async def recompute_weights(
    apply: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("quality.catalog.edit")),
) -> RecomputeReport:
    """Пересчёт истории под текущими весами (Р-3, §6 ТЗ v19: обязательный отчёт «до/после»
    до применения). apply=false (по умолчанию) — только отчёт, ничего не пишет. apply=true —
    активирует версию весов (если изменилась) и записывает снапшоты по каждой (ИС, период)."""
    created_by = await resolve_user_id(db, current_user.get("id"))
    return await recompute_and_snapshot(db, apply=apply, created_by=created_by)


def _rows_to_char_dict(rows: list[CharWeightRow]) -> dict[str, float]:
    return {r.characteristic: r.weight for r in rows}


def _rows_to_subchar_dict(rows: list[SubcharWithinRow]) -> dict[tuple[str, str], float]:
    return {(r.characteristic, r.subcharacteristic): r.weight for r in rows}


@router.get("/weights/editor", response_model=WeightEditorOut)
async def get_weight_editor(
    profile: str,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.weights.edit")),
) -> WeightEditorOut:
    """Текущие u/w выбранного профиля — форма для правки (УК-07)."""
    if profile not in CRITICALITY_PROFILES:
        raise ValidationError(f"Неизвестный профиль критичности: {profile}. Ожидается один из: {', '.join(CRITICALITY_PROFILES)}")
    active = await ensure_active_version(db)
    char_w = (active.char_weights or {}).get(profile) or {}
    sub_w = (active.subchar_weights or {}).get(profile) or []
    return WeightEditorOut(
        profile=profile,
        active_version_id=active.id,
        active_version_label=active.label,
        char_weights=[CharWeightRow(characteristic=c, weight=w) for c, w in sorted(char_w.items())],
        subchar_within=[SubcharWithinRow(characteristic=c, subcharacteristic=s, weight=w) for c, s, w in sub_w],
    )


@router.put("/weights/editor", response_model=WeightEditorOut)
async def put_weight_editor(
    payload: WeightEditIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_permission("quality.weights.edit")),
) -> WeightEditorOut:
    """Сохраняет правку одного профиля — Σ=100 на каждом уровне, иначе отказ с указанием
    конкретной характеристики (критерий приёмки п.2). Немедленно влияет на Score КАЖДОЙ ИС
    этого профиля критичности — версионирование даёт откат, не отменяемость самого действия."""
    char_dict = _rows_to_char_dict(payload.char_weights)
    sub_dict = _rows_to_subchar_dict(payload.subchar_within)
    errors = validate_weight_edit(char_dict, sub_dict)
    if payload.profile not in CRITICALITY_PROFILES:
        errors.insert(0, f"Неизвестный профиль критичности: {payload.profile}")
    if errors:
        raise ValidationError("; ".join(errors))

    created_by = await resolve_user_id(db, current_user.get("id"))
    version = await save_weight_edit(
        db, profile=payload.profile, char_weights=char_dict, subchar_within=sub_dict,
        note=payload.note, created_by=created_by,
    )
    char_w = (version.char_weights or {}).get(payload.profile) or {}
    sub_w = (version.subchar_weights or {}).get(payload.profile) or []
    return WeightEditorOut(
        profile=payload.profile,
        active_version_id=version.id,
        active_version_label=version.label,
        char_weights=[CharWeightRow(characteristic=c, weight=w) for c, w in sorted(char_w.items())],
        subchar_within=[SubcharWithinRow(characteristic=c, subcharacteristic=s, weight=w) for c, s, w in sub_w],
    )


@router.post("/weights/editor/preview", response_model=RecomputeReport)
async def preview_weight_editor(
    payload: WeightEditIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.weights.edit")),
) -> RecomputeReport:
    """«Как изменится Score портфеля», без записи (УК-07: предпросмотр перед сохранением)."""
    char_dict = _rows_to_char_dict(payload.char_weights)
    sub_dict = _rows_to_subchar_dict(payload.subchar_within)
    errors = validate_weight_edit(char_dict, sub_dict)
    if payload.profile not in CRITICALITY_PROFILES:
        errors.insert(0, f"Неизвестный профиль критичности: {payload.profile}")
    if errors:
        raise ValidationError("; ".join(errors))
    return await preview_weight_edit(db, profile=payload.profile, char_weights=char_dict, subchar_within=sub_dict)


@router.get("/weights/versions", response_model=list[WeightVersionSummaryOut])
async def list_weight_versions(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("quality.weights.edit")),
) -> list[WeightSetVersion]:
    """История версий весов — кто и когда менял (УК-07: «история изменений, кто и когда»)."""
    return await list_versions(db)
