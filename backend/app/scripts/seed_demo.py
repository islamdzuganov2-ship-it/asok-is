import asyncio
import uuid
import random
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

# Импорты ваших моделей (предполагаем стандартную структуру вашего проекта)
from app.core.database import engine
from sqlalchemy.orm import sessionmaker
from app.models.user import User
from app.models.system import System
from app.models.assessment import AssessmentPeriod, AssessmentValue
from app.models.metric_catalog import MetricCatalog
from app.core.security import get_password_hash
from app.services.calculation_engine import calculate_metric, map_to_level

# Настройка сессии
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def seed_data():
    async with AsyncSessionLocal() as db:
        logger.info("Начинаем генерацию демо-данных...")

        # 1. Создание пользователей
        users_data = [
            {"email": "demo@example.com", "password": "manager", "role": "MANAGER"},
            {"email": "analyst@example.com", "password": "analyst", "role": "TEST_ANALYST"},
            {"email": "cto@example.com", "password": "cto", "role": "CTO"},
            {"email": "admin@example.com", "password": "admin123", "role": "ADMIN"}
        ]
        
        db_users = []
        for u in users_data:
            result = await db.execute(select(User).where(User.email == u["email"]))
            user = result.scalar_one_or_none()
            if not user:
                user = User(
                    id=uuid.uuid4(),
                    email=u["email"],
                    password_hash=get_password_hash(u["password"]),
                    role=u["role"],
                    is_active=True
                )
                db.add(user)
            db_users.append(user)
        
        # 2. Создание систем (ИС)
        systems_data = [
            {"name": "АБС", "criticality": "MISSION CRITICAL"},
            {"name": "ДБО", "criticality": "MISSION CRITICAL"},
            {"name": "CRM", "criticality": "BUSINESS CRITICAL"},
            {"name": "ХД", "criticality": "BUSINESS CRITICAL"},
            {"name": "СЭД", "criticality": "BUSINESS OPERATIONAL"}
        ]
        
        db_systems = []
        for sys_data in systems_data:
            result = await db.execute(select(System).where(System.name == sys_data["name"]))
            system = result.scalar_one_or_none()
            if not system:
                system = System(id=uuid.uuid4(), name=sys_data["name"], criticality=sys_data["criticality"])
                db.add(system)
            db_systems.append(system)

        await db.commit() # Сохраняем, чтобы получить ID
        
        # 3. Получение метрик из справочника
        result = await db.execute(select(MetricCatalog))
        metrics = result.scalars().all()
        
        if not metrics:
            logger.error("Справочник метрик пуст! Сначала запустите seed_metrics.py")
            return

        # 4. Генерация периодов и значений метрик (AssessmentValues)
        periods = ["Q1-2025", "Q2-2025", "Q3-2025", "Q4-2025"]
        values_created = 0

        for system in db_systems:
            for period_name in periods:
                # Ищем или создаем период
                result = await db.execute(
                    select(AssessmentPeriod).where(AssessmentPeriod.system_id == system.id, AssessmentPeriod.period == period_name)
                )
                period = result.scalar_one_or_none()
                
                if not period:
                    period = AssessmentPeriod(id=uuid.uuid4(), system_id=system.id, period=period_name, status="COMPLETED")
                    db.add(period)
                    await db.commit()
                
                # Генерация метрик для периода
                for metric in metrics:
                    result = await db.execute(
                        select(AssessmentValue).where(AssessmentValue.period_id == period.id, AssessmentValue.metric_id == metric.id)
                    )
                    if result.scalar_one_or_none():
                        continue # Уже существует
                    
                    # Имитация реалистичных данных (Gaussian noise)
                    base_b = 100
                    if metric.formula_type.name == "INVERSE":
                        # Для инверсных метрик (дефекты): чем меньше, тем лучше. Генерируем случайное число дефектов.
                        val_a = max(0, int(random.gauss(15, 10))) 
                    else:
                        # Для прямых: чем больше, тем лучше
                        val_a = min(base_b, max(0, int(random.gauss(80, 15))))
                    
                    # Расчет ядра (Calculation Engine)
                    calculated_x = calculate_metric(val_a, base_b, metric.formula_type.name)
                    quality_level = map_to_level(calculated_x)
                    
                    # Демо-комментарии для низких показателей
                    expert_comment = None
                    if quality_level in ["Низкий уровень", "Ниже среднего"]:
                        expert_comment = f"Автоматический AI-анализ: Обнаружена деградация показателя {metric.name}. Требуется ревью кода."

                    av = AssessmentValue(
                        id=uuid.uuid4(),
                        period_id=period.id,
                        metric_id=metric.id,
                        val_a=val_a,
                        val_b=base_b,
                        calculated_x=calculated_x,
                        quality_level=quality_level,
                        expert_comment=expert_comment,
                        data_source="AUTO_SEED"
                    )
                    db.add(av)
                    values_created += 1

        await db.commit()
        logger.info(f"✅ Демо-данные успешно сгенерированы! Создано оценок: {values_created}")

if __name__ == "__main__":
    asyncio.run(seed_data())