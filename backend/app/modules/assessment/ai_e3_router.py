"""REST API этапа E3 контура СИИ (ГОСТ Р 59898-2021; BL-001) — /api/v1/ai-assessments.

Условия испытаний: тестовые наборы и выбросы (разд. 9), паритет сред (табл. 3), экспертная
группа с конкордацией Кендалла; сравнение нескольких СИИ в единых шкалах (п. 7.2.2.5);
справочник узлов модели качества. ORM — только в ai_e3_service.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.assessment import ai_e3_service as svc
from app.modules.assessment.ai_e3_schemas import (
    ApplyConsensusOut,
    ConsensusOut,
    DatasetIn,
    DatasetOut,
    ExpertScoreIn,
    OutlierCheckIn,
    ParityOut,
    ParityRowIn,
    QmNodeOut,
    TestConditionsOut,
)
from app.modules.iam import require_permission
from app.modules.quality import QM_MODEL_KINDS, list_qm_nodes
from app.shared.exceptions import ValidationError

router = APIRouter()
_VIEW = "view.ai_assessments"
_EDIT = "assessment.edit"
_EXPERT = "ai.expert.evaluate"


@router.get("/qm-nodes", response_model=list[QmNodeOut])
async def get_qm_nodes(model_kind: str | None = Query(None), db: AsyncSession = Depends(get_db),
                       _: dict = Depends(require_permission(_VIEW))):
    """Справочник узлов модели качества (ISO 25010 и ГОСТ 59898) из БД."""
    if model_kind and model_kind not in QM_MODEL_KINDS:
        raise ValidationError(f"model_kind: {', '.join(QM_MODEL_KINDS)}")
    return [QmNodeOut(id=str(n.id), model_kind=n.model_kind, level=n.level,
                      parent_id=str(n.parent_id) if n.parent_id else None, code=n.code, name_ru=n.name_ru,
                      metric_kind=n.metric_kind, is_ai_specific=bool(n.is_ai_specific), sort=n.sort)
            for n in await list_qm_nodes(db, model_kind)]


@router.get("/compare")
async def compare_ai(period_ids: str = Query(..., description="id периодов через запятую"),
                     db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_VIEW))) -> dict:
    """Сравнение нескольких СИИ в единых шкалах (п. 7.2.2.5)."""
    try:
        ids = [UUID(x.strip()) for x in period_ids.split(",") if x.strip()]
    except ValueError as exc:
        raise ValidationError("Некорректный id периода") from exc
    return await svc.compare(db, ids)


# ── Тестовые наборы и выбросы ──
@router.get("/{period_id}/datasets", response_model=list[DatasetOut])
async def list_datasets(period_id: UUID, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(require_permission(_VIEW))):
    return await svc.list_datasets(db, period_id)


@router.post("/{period_id}/datasets", response_model=DatasetOut, status_code=201)
async def create_dataset(period_id: UUID, payload: DatasetIn, db: AsyncSession = Depends(get_db),
                         _: dict = Depends(require_permission(_EDIT))):
    return await svc.save_dataset(db, period_id, payload)


@router.put("/{period_id}/datasets/{dataset_id}", response_model=DatasetOut)
async def update_dataset(period_id: UUID, dataset_id: UUID, payload: DatasetIn,
                         db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_EDIT))):
    return await svc.save_dataset(db, period_id, payload, dataset_id)


@router.delete("/{period_id}/datasets/{dataset_id}", status_code=204)
async def delete_dataset(period_id: UUID, dataset_id: UUID, db: AsyncSession = Depends(get_db),
                         _: dict = Depends(require_permission(_EDIT))):
    await svc.delete_dataset(db, period_id, dataset_id)


@router.post("/{period_id}/datasets/{dataset_id}/outliers")
async def check_outliers(period_id: UUID, dataset_id: UUID, payload: OutlierCheckIn,
                         db: AsyncSession = Depends(get_db), _: dict = Depends(require_permission(_EDIT))) -> dict:
    """Выбросы по значениям признака (IQR / z-оценка) — результат пишется в метаданные набора."""
    return await svc.check_outliers(db, period_id, dataset_id, payload)


# ── Паритет сред ──
@router.get("/{period_id}/env-parity", response_model=ParityOut)
async def get_parity(period_id: UUID, db: AsyncSession = Depends(get_db),
                     _: dict = Depends(require_permission(_VIEW))):
    return await svc.get_parity(db, period_id)


@router.put("/{period_id}/env-parity", response_model=ParityOut)
async def save_parity(period_id: UUID, payload: list[ParityRowIn], db: AsyncSession = Depends(get_db),
                      _: dict = Depends(require_permission(_EDIT))):
    return await svc.save_parity(db, period_id, payload)


# ── Экспертная группа ──
@router.put("/{period_id}/expert-scores")
async def save_expert_scores(period_id: UUID, payload: list[ExpertScoreIn], db: AsyncSession = Depends(get_db),
                             user: dict = Depends(require_permission(_EXPERT))) -> dict:
    """Эксперт вносит свои оценки 0–100 (логин — из токена, чужие оценки не редактируются)."""
    saved = await svc.save_expert_scores(db, period_id, user.get("username") or "—",
                                         user.get("full_name"), payload)
    return {"saved": saved}


@router.get("/{period_id}/expert-consensus", response_model=ConsensusOut)
async def get_consensus(period_id: UUID, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(require_permission(_VIEW))):
    """Согласованность группы: W Кендалла, χ², p-значение, средние по субхарактеристикам."""
    return await svc.consensus(db, period_id)


@router.post("/{period_id}/expert-consensus/apply", response_model=ApplyConsensusOut)
async def apply_consensus(period_id: UUID, db: AsyncSession = Depends(get_db),
                          _: dict = Depends(require_permission(_EDIT))):
    """Средняя оценка СОГЛАСОВАННОЙ группы → значения EXPERT_SCALE (иначе 409)."""
    return await svc.apply_consensus(db, period_id)


@router.get("/{period_id}/test-conditions", response_model=TestConditionsOut)
async def get_test_conditions(period_id: UUID, db: AsyncSession = Depends(get_db),
                              _: dict = Depends(require_permission(_VIEW))):
    """Готовность условий испытаний: набор с критерием выбросов, паритет сред, экспертная группа."""
    return await svc.test_conditions(db, period_id)
