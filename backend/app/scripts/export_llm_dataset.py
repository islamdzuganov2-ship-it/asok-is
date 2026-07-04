"""
DEPRECATED shim (ТЗ v13). Экспорт корпуса переехал в app.modules.llm.dataset.
Точка запуска сохранена:  docker compose exec backend python -m app.scripts.export_llm_dataset
"""
import asyncio

from app.modules.llm.dataset import OUT_DIR, OUT_FILE, build_dataset, main  # noqa: F401

if __name__ == "__main__":
    asyncio.run(main())
