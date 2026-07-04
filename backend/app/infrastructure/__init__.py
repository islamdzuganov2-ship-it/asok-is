"""
infrastructure/ — технический фундамент приложения (ТЗ v13).

    config.py       — Settings (env), контроль небезопасной конфигурации
    database.py     — engine, AsyncSessionLocal, get_db, ЕДИНЫЙ declarative Base, реестр моделей
    redis.py        — фабрика redis-клиента
    workers.py      — celery_app
    integrations/   — адаптеры внешних систем (реализации портов из shared.ports):
                        kms/ (СУЗ)  tms/ (ТМС)  itsm/ (ITSM)  dwh/ (хранилище данных)

infrastructure зависит от shared, но НЕ от modules.
"""
