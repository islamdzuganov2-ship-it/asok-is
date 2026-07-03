"""
export_llm_dataset.py — экспорт корпуса для дообучения встроенной LLM.

Собирает накопленные профессиональные суждения (+ связанные риски) в SFT-датасет
(формат instruction/output, JSONL) — это «обучающие вводные», которые система накапливает.
Каждый прогон включает свежие суждения → корпус растёт (основа для дообучения LoRA
и/или RAG-контекста). Целевой ответ (output) — grounded-заключение строго по суждениям.

Запуск:  docker compose exec backend python -m app.scripts.export_llm_dataset
Результат: models/llm/dataset/judgments_sft.jsonl
"""
from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.assessment import AssessmentPeriod, ProfessionalJudgment
from app.models.risk_base import RiskBase
from app.models.system import System
from app.services.llm_service import CONCLUSION_SYSTEM_PROMPT, _judgment_fallback

# models/llm монтируется read-only, поэтому датасет пишем в writable-каталог backend/llm_dataset.
OUT_DIR = os.environ.get("LLM_DATASET_DIR", "llm_dataset")
OUT_FILE = os.path.join(OUT_DIR, "judgments_sft.jsonl")


async def build_dataset() -> list[dict]:
    examples: list[dict] = []
    async with AsyncSessionLocal() as db:
        rows = list((await db.execute(
            select(ProfessionalJudgment, AssessmentPeriod, System)
            .join(AssessmentPeriod, ProfessionalJudgment.period_id == AssessmentPeriod.id)
            .join(System, AssessmentPeriod.system_id == System.id)
        )).all())

        by_period: dict[str, dict] = defaultdict(lambda: {"system": "", "period": "", "judgments": [], "chars": set()})
        for j, period, system in rows:
            b = by_period[str(period.id)]
            b["system"] = system.name
            b["period"] = period.period
            b["judgments"].append(f"{j.characteristic} / {j.subcharacteristic}: {j.judgment_text}")
            b["chars"].add(j.characteristic)

        # Активные риски по характеристикам (маппинг рисков в обучающий контекст).
        risks = list((await db.execute(select(RiskBase).where(RiskBase.status == "active"))).scalars().all())
        risks_by_char: dict[str, list[str]] = defaultdict(list)
        for r in risks:
            if r.characteristic:
                risks_by_char[r.characteristic].append(f"- {r.title}: {r.mitigation or '—'}")

        for b in by_period.values():
            if not b["judgments"]:
                continue
            jb = "\n".join(b["judgments"])
            rb = "\n".join(line for c in b["chars"] for line in risks_by_char.get(c, [])[:2])
            instruction = (
                f"ИС: {b['system']}. Период: {b['period']}.\n"
                f"Профессиональные суждения по подхарактеристикам:\n{jb}\n"
                + (f"\nСвязанные риски (база рисков банка):\n{rb}\n" if rb else "")
                + "Сформируй управленческое заключение по заданному формату."
            )
            output = _judgment_fallback(b["system"], b["period"], jb, rb)
            examples.append({
                "system": CONCLUSION_SYSTEM_PROMPT,
                "instruction": instruction,
                "output": output,
            })
    return examples


async def main() -> None:
    examples = await build_dataset()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(f"Экспортировано примеров: {len(examples)} → {OUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
