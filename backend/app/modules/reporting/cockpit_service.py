"""
Агрегатор кокпита (ТЗ v21, §10.5, КП-41) — материал для кокпитов CEO/CTO.

Шесть-семь параллельных запросов с фронта дают шесть независимых спиннеров и не гарантируют
общую точку отсчёта для дельт (две плитки могли бы сравнивать с разными «предыдущими
периодами»). Этот модуль НЕ считает ничего сам — он вызывает существующие сервисы и складывает
результат в один ответ; права проверяются на уровне эндпоинта (все поля видны любому
аутентифицированному — так же, как и по прямым эндпоинтам сегодня), видимость конкретной
плитки на кокпите определяет фронт по `CockpitTile.perm`.

Governance.economics_service импортируется НАПРЯМУЮ, не через фасад `app.modules.governance`:
последний исторически держат «лёгким» именно ради избежания цикла с `risk.event_service`
(risk импортирует governance-фасад за STATUS_APPROVED/Proposal) — см. докстринг
economics_service.py. Reporting в эту пару не входит, поэтому прямой импорт здесь безопасен.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.econ import (
    AcceptanceQueueOut,
    CostDashboardOut,
    ManagerMetricsOut,
    PortfolioTrendOut,
    acceptance_queue,
    cost_dashboard,
    manager_metrics,
    portfolio_trend,
)
from app.modules.governance import OverdueSummaryOut, PortfolioEffectCurveOut
from app.modules.governance.economics_service import overdue_summary, portfolio_effect_curve
from app.modules.incidents import IncidentAnalyticsOut
from app.modules.incidents import analytics as incident_analytics
from app.modules.risk import (
    PortfolioRiskSummaryOut,
    TriggeredRiskOut,
    portfolio_risk_summary,
    triggered_risks,
)
from app.modules.systems import System


class CockpitFilters:
    def __init__(
        self,
        system_id: list[uuid.UUID] | None = None,
        criticality: list[str] | None = None,
        characteristic: str | None = None,
    ) -> None:
        self.system_id = system_id
        self.criticality = criticality
        self.characteristic = characteristic


async def ceo_bundle(db: AsyncSession, f: CockpitFilters) -> dict:
    dashboard: CostDashboardOut = await cost_dashboard(
        db, system_id=f.system_id, criticality=f.criticality, characteristic=f.characteristic,
    )
    acceptance: AcceptanceQueueOut = await acceptance_queue(
        db, system_id=f.system_id, criticality=f.criticality, characteristic=f.characteristic,
    )
    summary: PortfolioRiskSummaryOut = await portfolio_risk_summary(
        db, system_id=f.system_id, criticality=f.criticality, characteristic=f.characteristic,
    )
    curve: PortfolioEffectCurveOut = await portfolio_effect_curve(
        db, system_id=f.system_id, criticality=f.criticality, characteristic=f.characteristic,
    )
    overdue: OverdueSummaryOut = await overdue_summary(
        db, system_id=f.system_id, criticality=f.criticality, characteristic=f.characteristic,
    )
    return {
        "costDashboard": dashboard,
        "acceptanceQueue": acceptance,
        "portfolioSummary": summary,
        "effectCurve": curve,
        "overdueSummary": overdue,
    }


async def cto_bundle(db: AsyncSession, f: CockpitFilters) -> dict:
    # /incidents и /risks/triggered фильтруют по ИМЕНИ системы, а не id (устоявшийся контракт
    # этих двух эндпоинтов, не переопределяем его здесь) — резолвим id → имя, если разрез сужен
    # ровно до одной ИС; при нескольких/нуле система остаётся портфельной (без фильтра).
    system_name: str | None = None
    if f.system_id and len(f.system_id) == 1:
        sysobj = await db.get(System, f.system_id[0])
        system_name = sysobj.name if sysobj else None
    trend: PortfolioTrendOut = await portfolio_trend(
        db, metric="score", system_id=f.system_id, criticality=f.criticality,
    )
    incidents: IncidentAnalyticsOut = await incident_analytics(db, system=system_name)
    triggered: list[TriggeredRiskOut] = await triggered_risks(db, system=system_name)
    managers: ManagerMetricsOut = await manager_metrics(db)
    return {
        "portfolioTrendScore": trend,
        "incidentAnalytics": incidents,
        "triggeredRisks": triggered,
        "managerMetrics": managers,
    }
