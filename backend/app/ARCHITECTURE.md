# Архитектура backend АСОК ИС — доменно-модульный монолит

> Разработческая шпаргалка по границам модулей. Полное ТЗ: `docs/ТЗ_Модульный_Монолит_v13.md`.
> Миграция из слоевой структуры (Strangler Fig) ЗАВЕРШЕНА, shim-слои удалены: весь код живёт на
> канонических путях. Легаси-остатки: `api/v1/api.py` и `workers/tasks.py` (композиционные корни),
> `models/audit.py`. Границы охраняются тестами `tests/test_architecture.py`.

## Слои
```
app/
  modules/         бизнес-домены (iam, systems, quality, assessment, risk, reporting, dataio, llm, ai_quality)
  shared/          db (миксины), exceptions, types, ports (контракты интеграций)
  infrastructure/  config, database (+ЕДИНЫЙ Base), redis, workers, integrations/{kms,tms,itsm,dwh}
  main.py          composition root
```

## Правило зависимостей (единственное важное правило)
```
modules  ─────►  shared, infrastructure
infrastructure ►  shared
shared         ►  (ничего из app)
```
- ❌ `shared`/`infrastructure` **не** импортируют `modules`.
- ❌ Домен **не** лезет в приватные части чужого домена — только его публичный фасад (`modules/<x>/__init__.py`).
- ✅ Кросс-доменные ORM-связи — строками: `ForeignKey("systems.id")`, `relationship("System")`.
- ✅ Внешние системы — через **порт** (`shared/ports.py`), реализация — **адаптер** (`infrastructure/integrations`).

## Анатомия домена
```
modules/<domain>/
  __init__.py    # фасад: re-export публичных функций/схем/роутера
  router.py      # APIRouter
  service.py     # логика/оркестрация
  models.py      # ORM (from app.infrastructure.database import Base)
  schemas.py     # Pydantic In/Out
```

## Как добавить новый домен
1. `app/modules/<domain>/` с файлами выше; `models.py` использует общий `Base`.
2. Зарегистрировать модели в реестре (`infrastructure/database.py` → `import_models()`), чтобы их видел Alembic.
3. Смонтировать `router` в `main.py`/`bootstrap`.
4. Наружу отдавать только фасад (`__init__.py`).

## Как добавить внешнюю интеграцию (СУЗ/ТМС/ITSM/DWH)
1. Объявить/переиспользовать **порт** в `shared/ports.py` (Protocol).
2. Реализовать **адаптер** в `infrastructure/integrations/<sys>/`.
3. Домен зависит от порта; конкретный адаптер внедряется зависимостью. Эндпоинты/секреты — из `config`.

## Инвариант качества
`docker compose exec backend pytest -q` — все зелёные (82 на 2026‑07‑04), `GET /health` = ok.
Архитектурные тесты (`tests/test_architecture.py`) ломаются, если: вернуть импорт легаси-пути,
сломать фасад модуля, нарушить Dependency Rule, расколоть Base или потерять celery-задачу.
