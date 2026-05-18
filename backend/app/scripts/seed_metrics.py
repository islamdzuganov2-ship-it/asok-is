"""
Скрипт для заполнения справочника метрик (24 метрики)
Запуск: docker compose exec backend python -m app.scripts.seed_metrics
"""
import asyncio
import sys
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

# Добавляем корень проекта (backend/) в sys.path, чтобы работали импорты app.*
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.models.metric_catalog import MetricCatalog, FormulaType
from app.core.database import Base

METRICS_DATA = [
    {
        "id": 1,
        "characteristic": "Функциональная пригодность",
        "subcharacteristic": "Функциональное покрытие",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - A/B, где A - не покрытые требования, B - всего требований",
        "data_source": "ТЗ + Результаты тестирования"
    },
    {
        "id": 2,
        "characteristic": "Совместимость",
        "subcharacteristic": "Интеграция с другими ИС",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - успешные интеграции, B - всего интеграций",
        "data_source": "Концептуальный дизайн + Интеграционное тестирование"
    },
    {
        "id": 3,
        "characteristic": "Надежность",
        "subcharacteristic": "Коррекция ошибок",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - исправленные ошибки, B - всего ошибок",
        "data_source": "Jira/ALM"
    },
    {
        "id": 4,
        "characteristic": "Надежность",
        "subcharacteristic": "Доступность системы",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - время доступности, B - общее время",
        "data_source": "Система мониторинга (ручной ввод)"
    },
    {
        "id": 5,
        "characteristic": "Надежность",
        "subcharacteristic": "Среднее время восстановления",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - (A/B), где A - фактическое время, B - нормативное",
        "data_source": "СУП (ручной ввод)"
    },
    {
        "id": 6,
        "characteristic": "Надежность",
        "subcharacteristic": "Полнота резервных копий",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - успешные бэкапы, B - всего бэкапов",
        "data_source": "Система резервного копирования"
    },
    {
        "id": 7,
        "characteristic": "Пригодность для обслуживания",
        "subcharacteristic": "Модифицируемость",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, оценка сложности внесения изменений",
        "data_source": "Экспертная оценка"
    },
    {
        "id": 8,
        "characteristic": "Пригодность для обслуживания",
        "subcharacteristic": "Корректность плановых релизов",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - A/B, где A - проблемные релизы, B - всего релизов",
        "data_source": "Jira SVR"
    },
    {
        "id": 9,
        "characteristic": "Пригодность для обслуживания",
        "subcharacteristic": "Корректность срочных релизов",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - A/B, где A - проблемные срочные релизы",
        "data_source": "Jira SVR"
    },
    {
        "id": 10,
        "characteristic": "Пригодность для обслуживания",
        "subcharacteristic": "Разделение компонентов (микросервисы)",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, оценка модульности архитектуры",
        "data_source": "Экспертная оценка"
    },
    {
        "id": 11,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Мониторинг бизнес-метрик",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, наличие мониторинга",
        "data_source": "Система мониторинга"
    },
    {
        "id": 12,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Мониторинг серверов",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, покрытие мониторингом",
        "data_source": "Система мониторинга"
    },
    {
        "id": 13,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Автоматизация регрессионной модели",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - автоматизированные тесты, B - всего тестов",
        "data_source": "Jira/ALM"
    },
    {
        "id": 14,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Автономность тестирования",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, оценка независимости тестов",
        "data_source": "Экспертная оценка"
    },
    {
        "id": 15,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Полнота видов тестирования",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - выполненные виды тестов, B - требуемые",
        "data_source": "Jira/ALM"
    },
    {
        "id": 16,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Идентичность тестовых сред",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, соответствие тестовой среды продуктивной",
        "data_source": "Экспертная оценка"
    },
    {
        "id": 17,
        "characteristic": "Тестируемость",
        "subcharacteristic": "Состав тестовых окружений",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, полнота инфраструктуры",
        "data_source": "Экспертная оценка"
    },
    {
        "id": 18,
        "characteristic": "Переносимость",
        "subcharacteristic": "Время установки релиза",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - (A/B), где A - фактическое время, B - нормативное",
        "data_source": "Jira SVR"
    },
    {
        "id": 19,
        "characteristic": "Эффективность",
        "subcharacteristic": "Средняя пропускная способность",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - фактическая, B - требуемая производительность",
        "data_source": "Система мониторинга (ручной ввод)"
    },
    {
        "id": 20,
        "characteristic": "Эффективность",
        "subcharacteristic": "Корректность времени отклика",
        "formula_type": FormulaType.INVERSE,
        "description": "X = 1 - (A/B), где A - фактическое время, B - нормативное",
        "data_source": "Система мониторинга (ручной ввод)"
    },
    {
        "id": 21,
        "characteristic": "Безопасность",
        "subcharacteristic": "Корректность механизма аутентификации",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, соответствие требованиям безопасности",
        "data_source": "Результаты тестирования безопасности"
    },
    {
        "id": 22,
        "characteristic": "Безопасность",
        "subcharacteristic": "Соответствие правил аутентификации",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, проверка политик паролей",
        "data_source": "Результаты тестирования безопасности"
    },
    {
        "id": 23,
        "characteristic": "Безопасность",
        "subcharacteristic": "Реализация ролевой модели",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, полнота RBAC",
        "data_source": "Результаты тестирования безопасности"
    },
    {
        "id": 24,
        "characteristic": "Удобство использования",
        "subcharacteristic": "Полнота описания Руководства Пользователя",
        "formula_type": FormulaType.DIRECT,
        "description": "X = A/B, где A - описанные функции, B - всего функций",
        "data_source": "Экспертная оценка"
    },
]

async def seed_metrics_async():
    """Асинхронное заполнение справочника метрик"""
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://asok_user:asok_pass123@postgres:5432/asok_is"
    )
    engine = create_async_engine(database_url, echo=False)
    async_session = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    try:
        # Создаём таблицы, если не существуют
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        inserted_count = 0
        
        async with async_session() as session:
            for metric_data in METRICS_DATA:
                # Проверяем существование
                result = await session.execute(
                    select(MetricCatalog).where(MetricCatalog.id == metric_data["id"])
                )
                existing = result.scalar_one_or_none()
                
                if existing:
                    # Обновляем существующую запись
                    existing.characteristic = metric_data["characteristic"]
                    existing.subcharacteristic = metric_data["subcharacteristic"]
                    existing.formula_type = metric_data["formula_type"]
                    existing.description = metric_data["description"]
                    existing.data_source = metric_data["data_source"]
                else:
                    # Создаём новую — ← ЗДЕСЬ НЕ ДОЛЖНО БЫТЬ Column()!
                    new_metric = MetricCatalog(
                        id=metric_data["id"],
                        characteristic=metric_data["characteristic"],
                        subcharacteristic=metric_data["subcharacteristic"],
                        formula_type=metric_data["formula_type"],
                        description=metric_data["description"],
                        data_source=metric_data["data_source"],  # ← Просто строка, не Column()
                        is_active=True
                    )
                    session.add(new_metric)
                    inserted_count += 1
            
            await session.commit()
        
        print(f"✅ Загружено {len(METRICS_DATA)} метрик в справочник")
        if inserted_count > 0:
            print(f"   🆕 Новых записей: {inserted_count}")
        
    except Exception as e:
        print(f"❌ Ошибка при загрузке метрик: {e}")
        raise
    finally:
        await engine.dispose()

def seed_metrics():
    """Синхронная обёртка для запуска через python -m"""
    asyncio.run(seed_metrics_async())

if __name__ == "__main__":
    seed_metrics()