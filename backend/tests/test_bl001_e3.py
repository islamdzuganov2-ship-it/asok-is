"""BL-001, этап E3 контура СИИ (ГОСТ Р 59898-2021).

Чистая математика (выбросы, конкордация Кендалла с χ², паритет сред, сравнение в единых
шкалах) и сервис: тестовые наборы, паритет, экспертная группа с переносом согласованной
оценки в EXPERT_SCALE, условия испытаний в отчёте, сравнение СИИ, справочник узлов модели.
"""
from __future__ import annotations

import uuid

import pytest

from app.modules.assessment import ai_e3_service as svc
from app.modules.assessment.ai_e3_schemas import DatasetIn, ExpertScoreIn, OutlierCheckIn, ParityRowIn
from app.modules.assessment.models import AiAssessmentValue, AssessmentPeriod
from app.modules.quality import ai_e3, list_qm_nodes
from app.modules.systems.models import CriticalityClass, System
from app.shared.exceptions import ConflictError, ValidationError

EXP = "Функциональные возможности"
SUB_A = "Способность к самообучению"          # EXPERT_SCALE
SUB_B = "Функциональная пригодность"
SUB_C = "Функциональная корректность"
SUB_D = "Согласованность (compliance)"


# ═══════════════════ Чистые функции ═══════════════════

def test_outliers_iqr_and_zscore():
    values = [10, 11, 12, 11, 10, 12, 11, 100]
    iqr = ai_e3.detect_outliers(values, "IQR")
    assert iqr["count"] == 1 and iqr["indices"] == [7] and iqr["share"] == 0.125
    z = ai_e3.detect_outliers([1] * 20 + [50], "ZSCORE")
    assert z["count"] == 1
    assert ai_e3.detect_outliers([1, 2], "IQR")["count"] == 0          # мало данных — не оцениваем
    with pytest.raises(ValueError):
        ai_e3.detect_outliers(values, "DBSCAN")


def test_chi2_survival_matches_tables():
    assert abs(ai_e3.chi2_sf(3.841, 1) - 0.05) < 0.001
    assert abs(ai_e3.chi2_sf(5.991, 2) - 0.05) < 0.001
    assert abs(ai_e3.chi2_sf(18.307, 10) - 0.05) < 0.001


def test_kendall_w_perfect_and_random_agreement():
    agree = {e: {"a": 90, "b": 70, "c": 50, "d": 30} for e in ("e1", "e2", "e3")}
    k = ai_e3.kendall_w(agree)
    assert k["w"] == 1.0 and k["consistent"] and k["p_value"] < 0.05 and k["df"] == 3
    disagree = {"e1": {"a": 90, "b": 70, "c": 50, "d": 30}, "e2": {"a": 30, "b": 50, "c": 70, "d": 90}}
    k2 = ai_e3.kendall_w(disagree)
    assert k2["w"] == 0.0 and not k2["consistent"]
    # Связки (одинаковые оценки) — средний ранг и поправка, W остаётся в [0, 1].
    tied = {"e1": {"a": 80, "b": 80, "c": 40}, "e2": {"a": 90, "b": 60, "c": 60}}
    assert 0 <= ai_e3.kendall_w(tied)["w"] <= 1
    assert ai_e3.kendall_w({"e1": {"a": 1, "b": 2}})["w"] is None   # один эксперт — не группа


def test_parity_summary_requires_all_factors_and_justification():
    rows = [{"factor": c, "status": "MATCH"} for c, _ in ai_e3.ENV_PARITY_FACTORS]
    assert ai_e3.parity_summary(rows)["ok"]
    rows[0] = {"factor": rows[0]["factor"], "status": "ACCEPTABLE", "justification": ""}
    s = ai_e3.parity_summary(rows[:-1])
    assert not s["ok"] and s["unjustified"] and len(s["missing"]) == 1


def test_compare_only_on_common_scales():
    def row(sub, x, baseline=0.9):
        return {"characteristic": EXP, "subcharacteristic": sub, "metric_kind": "ACCURACY",
                "baseline": baseline, "tol_low": 0.05, "tol_high": 0.05, "normalized_x": x}
    res = ai_e3.compare_on_common_scales([
        {"period_id": "p1", "system": "Скоринг A", "period": "Q2", "rows": [row(SUB_B, 0.9), row(SUB_C, 0.5), row(SUB_D, 1.0)]},
        {"period_id": "p2", "system": "Скоринг B", "period": "Q2", "rows": [row(SUB_B, 0.6), row(SUB_C, 0.7, baseline=0.8)]},
    ])
    assert [c["subcharacteristic"] for c in res["common"]] == [SUB_B]
    reasons = {e["subcharacteristic"]: e["reason"] for e in res["excluded"]}
    assert "шкалы не совпадают" in reasons[SUB_C] and "не во всех" in reasons[SUB_D]
    assert [r["system"] for r in res["ranking"]] == ["Скоринг A", "Скоринг B"]


# ═══════════════════ Сервис ═══════════════════

async def _ai_period(db, name="Скоринг розницы", period="Q2-2026") -> AssessmentPeriod:
    s = System(id=uuid.uuid4(), name=name, code=f"AI-{uuid.uuid4().hex[:6]}",
               criticality_class=CriticalityClass.BUSINESS_CRITICAL, system_kind="AI")
    db.add(s)
    await db.flush()
    p = AssessmentPeriod(system_id=s.id, period=period, status="DRAFT")
    db.add(p)
    await db.commit()
    return p


async def test_classic_system_period_is_rejected(db_session):
    s = System(id=uuid.uuid4(), name="АБС", code="ABS-1", criticality_class=CriticalityClass.MISSION_CRITICAL)
    db_session.add(s)
    await db_session.flush()
    p = AssessmentPeriod(system_id=s.id, period="Q2-2026", status="DRAFT")
    db_session.add(p)
    await db_session.commit()
    with pytest.raises(ConflictError):
        await svc.list_datasets(db_session, p.id)


async def test_dataset_outliers_and_conditions(db_session):
    p = await _ai_period(db_session)
    cond = await svc.test_conditions(db_session, p.id)
    assert not cond.ready and any("тестовый набор" in g for g in cond.gaps)

    d = await svc.save_dataset(db_session, p.id, DatasetIn(name="Holdout 2026-Q2", records=12000,
                                                           class_balance={"0": 0.9, "1": 0.1}))
    with pytest.raises(ValidationError):
        await svc.save_dataset(db_session, p.id, DatasetIn(name="bad", class_balance={"0": 0.5}))
    res = await svc.check_outliers(db_session, p.id, uuid.UUID(d.id), OutlierCheckIn(
        feature="сумма заявки", values=[10, 11, 12, 11, 10, 12, 11, 100], handling="FLAGGED"))
    assert res["count"] == 1
    stored = (await svc.list_datasets(db_session, p.id))[0]
    assert stored.outlier_method == "IQR" and stored.outliers_count == 1 and stored.outlier_handling == "FLAGGED"

    rows = [ParityRowIn(factor=c, status="MATCH", test_env="стенд", prod_env="прод") for c, _ in ai_e3.ENV_PARITY_FACTORS]
    with pytest.raises(ValidationError):
        await svc.save_parity(db_session, p.id, [ParityRowIn(factor="hardware", status="ACCEPTABLE")])
    parity = await svc.save_parity(db_session, p.id, rows)
    assert parity["summary"]["ok"]
    assert (await svc.test_conditions(db_session, p.id)).ready


async def test_expert_group_consensus_applies_only_when_consistent(db_session):
    p = await _ai_period(db_session)
    db_session.add(AiAssessmentValue(period_id=p.id, group_name="Функциональность", characteristic=EXP,
                                     subcharacteristic=SUB_A, metric_kind="EXPERT_SCALE",
                                     baseline=0.8, tol_low=0.1, tol_high=0.2))
    await db_session.commit()
    subs = [SUB_A, SUB_B, SUB_C, SUB_D]
    await svc.save_expert_scores(db_session, p.id, "e1", "Эксперт 1", [ExpertScoreIn(characteristic=EXP, subcharacteristic=s, score=v) for s, v in zip(subs, (80, 60, 40, 20))])
    await svc.save_expert_scores(db_session, p.id, "e2", "Эксперт 2", [ExpertScoreIn(characteristic=EXP, subcharacteristic=s, score=v) for s, v in zip(subs, (20, 40, 60, 80))])
    with pytest.raises(ConflictError):
        await svc.apply_consensus(db_session, p.id)                       # W = 0 — не переносим
    cond = await svc.test_conditions(db_session, p.id)
    assert any("не согласована" in g for g in cond.gaps)

    await svc.save_expert_scores(db_session, p.id, "e2", "Эксперт 2", [ExpertScoreIn(characteristic=EXP, subcharacteristic=s, score=v) for s, v in zip(subs, (90, 70, 50, 30))])
    await svc.save_expert_scores(db_session, p.id, "e3", "Эксперт 3", [ExpertScoreIn(characteristic=EXP, subcharacteristic=s, score=v) for s, v in zip(subs, (85, 65, 45, 25))])
    c = await svc.consensus(db_session, p.id)
    assert c["kendall"]["w"] == 1.0 and c["kendall"]["consistent"] and len(c["experts"]) == 3
    res = await svc.apply_consensus(db_session, p.id)
    assert res["applied"] == 1                                          # только EXPERT_SCALE-строка
    from sqlalchemy import select
    v = (await db_session.execute(select(AiAssessmentValue).where(AiAssessmentValue.period_id == p.id))).scalar_one()
    assert float(v.raw_value) == pytest.approx(0.85)                   # среднее 85 → 0.85
    assert v.conformant is True and "W Кендалла = 1.0" in v.expert_comment


async def test_compare_two_ai_systems(db_session):
    p1 = await _ai_period(db_session, "Скоринг A")
    p2 = await _ai_period(db_session, "Скоринг B")
    for p, x in ((p1, 0.9), (p2, 0.6)):
        db_session.add(AiAssessmentValue(period_id=p.id, group_name="Функциональность", characteristic=EXP,
                                         subcharacteristic=SUB_C, metric_kind="ACCURACY", baseline=0.9,
                                         tol_low=0.05, tol_high=0.05, normalized_x=x))
    await db_session.commit()
    res = await svc.compare(db_session, [p1.id, p2.id])
    assert res["ranking"][0]["system"] == "Скоринг A" and len(res["common"]) == 1
    with pytest.raises(ValidationError):
        await svc.compare(db_session, [p1.id])


async def test_qm_nodes_seeded_for_both_models(db_session):
    nodes = await list_qm_nodes(db_session)
    iso = [n for n in nodes if n.model_kind == "ISO25010"]
    ai = [n for n in nodes if n.model_kind == "GOST59898"]
    assert sum(n.level == "SUBCHARACTERISTIC" for n in iso) == 31
    assert sum(n.level == "SUBCHARACTERISTIC" for n in ai) == 37
    assert sum(n.level == "GROUP" for n in ai) == 4 and sum(n.is_ai_specific for n in ai) == 7
    assert len(await list_qm_nodes(db_session)) == len(nodes)          # идемпотентно
