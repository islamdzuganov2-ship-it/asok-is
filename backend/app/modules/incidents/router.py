"""
REST API домена incidents (T-21) — /api/v1/incidents.

Аналитика технических сбоев (надёжность ИС). RBAC: ввод/правку/закрытие ведёт менеджер по качеству
(QM/ADMIN), чтение и аналитика — всем аутентифицированным (топ-менеджмент смотрит по флагу
`execIncidents` на фронте). Доменные исключения маппятся на HTTP обработчиком в main.py.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.modules.iam import get_current_user, require_permission
from app.modules.incidents import economics_service, itsm_service, service
from app.modules.incidents.schemas import (
    IncidentAnalyticsOut,
    IncidentCategoriesOut,
    IncidentImportResult,
    IncidentImportRow,
    ApmCalibrationIn,
    ItsmGroupMappingIn,
    ItsmGroupMappingOut,
    LaborCalibrationIn,
    ResolveIn,
    SystemAliasIn,
    SystemAliasOut,
    TechIncidentCreate,
    TechIncidentEconomicsIn,
    TechIncidentEconomicsOut,
    TechIncidentOut,
    TechIncidentUpdate,
)

router = APIRouter()

MANAGER_ROLES = ("QUALITY_MANAGER", "ADMIN")  # ведут реестр сбоев (менеджер по качеству)


@router.get("", response_model=list[TechIncidentOut])
async def list_incidents(
    system: str | None = None,
    category: str | None = None,
    severity: str | None = None,
    status: str | None = None,  # open | resolved
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.dashboard.incidents", "incidents.edit", "view.dashboard.risk")),
) -> list:
    return await service.list_incidents(db, system=system, category=category, severity=severity, status=status)


@router.get("/analytics", response_model=IncidentAnalyticsOut)
async def incident_analytics(
    system: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.dashboard.incidents", "incidents.edit", "view.dashboard.risk")),
) -> IncidentAnalyticsOut:
    return await service.analytics(db, system=system)


@router.get("/categories", response_model=IncidentCategoriesOut)
async def incident_categories(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.dashboard.incidents", "incidents.edit", "view.dashboard.risk")),
) -> IncidentCategoriesOut:
    """Справочник первопричин (T-37): базовые + пользовательские «Другое» для выпадающего списка формы."""
    return await service.list_categories(db)


@router.post("", response_model=TechIncidentOut, status_code=201)
async def create_incident(
    payload: TechIncidentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("incidents.edit")),
):
    return await service.create(db, payload, user.get("username") or "—")


@router.post("/import", response_model=IncidentImportResult)
async def import_incidents(
    rows: list[IncidentImportRow],
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("incidents.edit")),
) -> IncidentImportResult:
    """Импорт ТС из внешнего ITSM/ЕХД/DWH (T-43): распарсенные строки → нормализация + дедуп → БД."""
    return await service.import_incidents(db, rows, user.get("username") or "import")


@router.patch("/{iid}", response_model=TechIncidentOut)
async def update_incident(
    iid: uuid.UUID,
    payload: TechIncidentUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
):
    inc = await service.get_or_404(db, iid)
    return await service.update(db, inc, payload)


@router.post("/{iid}/resolve", response_model=TechIncidentOut)
async def resolve_incident(
    iid: uuid.UUID,
    payload: ResolveIn | None = None,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
):
    inc = await service.get_or_404(db, iid)
    return await service.resolve(db, inc, payload.resolved_at if payload else None)


# ── BL-007: экономика сбоя (RE-05 ввод, RE-06 деградация, RE-03 ставки, RE-07 C_ТС) ──

@router.get("/{iid}/economics", response_model=TechIncidentEconomicsOut)
async def get_incident_economics(
    iid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("view.risk_economics", "incidents.edit")),
):
    """Экономика сбоя с разложением C_ТС — деньги, поэтому по праву контура или правки реестра."""
    return economics_service.economics_out(await service.get_or_404(db, iid))


@router.put("/{iid}/economics", response_model=TechIncidentEconomicsOut)
async def put_incident_economics(
    iid: uuid.UUID,
    payload: TechIncidentEconomicsIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
):
    """Ввод экономики сбоя аналитиком: K по типу деградации, правило «→ простой», пересчёт C_ТС."""
    inc = await service.get_or_404(db, iid)
    return economics_service.economics_out(await economics_service.update_economics(db, inc, payload))


# ── BL-007, задел фазы I: автовыгрузка ITSM (RE-23…RE-27) ──
# Живого ITSM нет — загружается файл выгрузки (CSV/JSON по контракту §2.6).

_MAX_EXPORT_BYTES = 10 * 1024 * 1024


async def _read_export(file: UploadFile) -> bytes:
    content = await file.read(_MAX_EXPORT_BYTES + 1)
    if len(content) > _MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="Выгрузка ITSM больше 10 МБ — разбейте по периодам")
    return content


@router.post("/itsm/quality")
async def itsm_quality(
    fmt: str = "csv",
    file: UploadFile = File(...),
    _: dict = Depends(require_permission("incidents.edit")),
) -> dict:
    """RE-23: аудит качества полей выгрузки ДО загрузки — ничего не пишет."""
    return await itsm_service.quality_report(await _read_export(file), fmt)


@router.post("/itsm/import")
async def itsm_import(
    fmt: str = "csv",
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("incidents.edit")),
) -> dict:
    """RE-23: загрузка выгрузки ITSM — привязка к ИС (RE-25), дедуп (RE-26), трудозатраты (RE-24),
    поправки APM (RE-27), upsert по номеру тикета."""
    return await itsm_service.import_export(db, await _read_export(file), fmt, user.get("username") or "itsm")


@router.get("/itsm/group-mappings", response_model=list[ItsmGroupMappingOut])
async def itsm_group_mappings(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit", "view.dashboard.incidents")),
):
    return await itsm_service.list_group_mappings(db)


@router.put("/itsm/group-mappings", response_model=ItsmGroupMappingOut)
async def put_itsm_group_mapping(
    payload: ItsmGroupMappingIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
):
    """RE-25: группа назначения ITSM → ИС."""
    return await itsm_service.upsert_group_mapping(db, payload.group_name, payload.system_id, payload.note)


@router.get("/itsm/aliases", response_model=list[SystemAliasOut])
async def itsm_aliases(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit", "view.dashboard.incidents")),
):
    return await itsm_service.list_aliases(db)


@router.post("/itsm/aliases", response_model=SystemAliasOut, status_code=201)
async def add_itsm_alias(
    payload: SystemAliasIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
):
    """RE-25: алиас ИС — как система называется в ITSM/APM."""
    return await itsm_service.add_alias(db, payload.alias, payload.system_id)


@router.post("/itsm/calibrate-labor")
async def itsm_calibrate_labor(
    payload: LaborCalibrationIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
) -> dict:
    """RE-24: калибровка K_утил на тикетах с известными трудозатратами (apply — сохранить)."""
    return await itsm_service.save_k_util(db, payload.samples, payload.apply)


@router.post("/itsm/apm-calibration")
async def itsm_apm_calibration(
    payload: ApmCalibrationIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("incidents.edit")),
) -> dict:
    """RE-27: поправки ко времени ITSM по APM (apply — применять при каждой загрузке)."""
    return await itsm_service.save_apm_correction(db, payload.pairs, payload.apply)
