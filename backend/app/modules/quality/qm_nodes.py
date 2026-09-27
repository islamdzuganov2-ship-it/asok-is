"""Справочник узлов модели качества в БД — `qm_nodes` (BL-001 E3).

Заполняется из кода идемпотентно: коды узлов устойчивы (M-группа.характеристика.субхарактеристика
по порядку в модели), повторный вызов ничего не дублирует. Источник истины — модели в коде;
таблица — их публикация для отчётов и внешних потребителей.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.quality.ai_quality_model import AI_QUALITY_MODEL
from app.modules.quality.models import QmNode
from app.modules.quality.quality_model import QUALITY_MODEL

MODEL_ISO = "ISO25010"
MODEL_GOST59898 = "GOST59898"
MODEL_KINDS = (MODEL_ISO, MODEL_GOST59898)


def model_nodes() -> list[dict]:
    """Плоский список узлов обеих моделей с кодами и ссылкой на код родителя."""
    out: list[dict] = []
    for ci, (char, subs) in enumerate(QUALITY_MODEL, start=1):
        c_code = f"C{ci}"
        out.append({"model_kind": MODEL_ISO, "level": "CHARACTERISTIC", "code": c_code, "parent": None,
                    "name_ru": char, "metric_kind": None, "is_ai_specific": False, "sort": ci})
        for si, (sub, _formula) in enumerate(subs, start=1):
            out.append({"model_kind": MODEL_ISO, "level": "SUBCHARACTERISTIC", "code": f"{c_code}.{si}",
                        "parent": c_code, "name_ru": sub, "metric_kind": None, "is_ai_specific": False, "sort": si})
    for gi, (group, chars) in enumerate(AI_QUALITY_MODEL, start=1):
        g_code = f"G{gi}"
        out.append({"model_kind": MODEL_GOST59898, "level": "GROUP", "code": g_code, "parent": None,
                    "name_ru": group, "metric_kind": None, "is_ai_specific": False, "sort": gi})
        for ci, (char, subs) in enumerate(chars, start=1):
            c_code = f"{g_code}.{ci}"
            out.append({"model_kind": MODEL_GOST59898, "level": "CHARACTERISTIC", "code": c_code, "parent": g_code,
                        "name_ru": char, "metric_kind": None, "is_ai_specific": False, "sort": ci})
            for si, (sub, metric_kind, is_ai, _hint) in enumerate(subs, start=1):
                out.append({"model_kind": MODEL_GOST59898, "level": "SUBCHARACTERISTIC", "code": f"{c_code}.{si}",
                            "parent": c_code, "name_ru": sub, "metric_kind": metric_kind,
                            "is_ai_specific": bool(is_ai), "sort": si})
    return out


async def seed_qm_nodes(db: AsyncSession) -> int:
    """Идемпотентный сид: добавляет отсутствующие узлы, существующие не трогает."""
    existing = {(n.model_kind, n.code): n for n in (await db.execute(select(QmNode))).scalars().all()}
    added = 0
    for spec in model_nodes():
        key = (spec["model_kind"], spec["code"])
        if key in existing:
            continue
        parent = existing.get((spec["model_kind"], spec["parent"])) if spec["parent"] else None
        node = QmNode(model_kind=spec["model_kind"], level=spec["level"], code=spec["code"],
                      parent_id=parent.id if parent else None, name_ru=spec["name_ru"],
                      metric_kind=spec["metric_kind"], is_ai_specific=spec["is_ai_specific"], sort=spec["sort"])
        db.add(node)
        await db.flush()
        existing[key] = node
        added += 1
    if added:
        await db.commit()
    return added


async def list_qm_nodes(db: AsyncSession, model_kind: str | None = None) -> list[QmNode]:
    """Узлы модели; пустой справочник сеется при первом обращении."""
    if not (await db.execute(select(func.count(QmNode.id)))).scalar():
        await seed_qm_nodes(db)
    stmt = select(QmNode).order_by(QmNode.model_kind, QmNode.code)
    if model_kind:
        stmt = stmt.where(QmNode.model_kind == model_kind)
    return list((await db.execute(stmt)).scalars().all())
