"""
modules/ — бизнес-домены АСОК ИС (доменно-модульный монолит, ТЗ v13).

Каждый домен — автономный пакет со своей внутренней слоистостью:
    router.py    — HTTP-контракт (FastAPI APIRouter)
    service.py   — прикладная логика (оркестрация, транзакции)
    models.py    — ORM-модели домена (Base из app.infrastructure.database)
    schemas.py   — Pydantic-контракты (In/Out)
    __init__.py  — ПУБЛИЧНЫЙ ФАСАД домена (только то, что можно звать снаружи)

Правила зависимостей (Dependency Rule):
  • modules → shared, infrastructure  (можно)
  • modules → приватные части чужого домена  (НЕЛЬЗЯ — только через его фасад/__init__)
  • shared, infrastructure → modules  (НЕЛЬЗЯ)

Кросс-доменные ORM-связи — по строковым ссылкам (ForeignKey("systems.id"),
relationship("System")); классы регистрируются в едином Base через реестр моделей.
"""
