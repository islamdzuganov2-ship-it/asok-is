"""seed_korp_quality.py — DEPRECATED. Оставлен как совместимый вход, делегирует в seed_demo.

Раньше этот скрипт заводил отдельную систему и писал в оценку значения по НЕканоническим
характеристикам («Функциональная», «Надежность», «Пригодность для обслуживания» и т.п.) и в
чужом формате периодов («3Q 2024»). Это расходилось с эталонной моделью ISO 25010
(constants/quality_model.py) и с сценарным сидом — ещё один источник несогласованной
синтетики в базе.

Теперь синтетика заносится ТОЛЬКО в оценку и ТОЛЬКО из одного источника — сценарного сида
seed_demo. Модуль сохраняет имя `seed_korp_quality`, но делегирует в единый источник, чтобы
старые команды не ломались.

Запуск (эквивалентно `python -m app.scripts.seed_demo`):
    docker compose exec backend python -m app.scripts.seed_korp_quality
"""
import asyncio

from app.scripts.seed_demo import seed_data


async def seed_korp_quality() -> None:
    """DEPRECATED-обёртка: единый источник синтетики — сценарный сид оценки (seed_demo)."""
    print(
        "seed_korp_quality УСТАРЕЛ: заливка неканонических характеристик отключена. "
        "Синтетика заносится только в оценку через сценарный сид seed_demo — выполняю его."
    )
    await seed_data()
    print("Готово: оценка засеяна из единого сценарного источника (seed_demo).")


if __name__ == "__main__":
    asyncio.run(seed_korp_quality())
