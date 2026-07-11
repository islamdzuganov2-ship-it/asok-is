"""
Домен incidents (T-21, код-ревью 2026-07-06): аналитика технических сбоев (надёжность ИС).

Новое бизнес-направление — отдельный анализатор сбоев по первопричинам (релиз/инфраструктура/
производительность/сеть/электроснабжение). Даёт менеджеру по качеству структуру сбоев, топ-
менеджменту — сводку надёжности (по флагу), LLM — доп. источник фактов (аддитивно, позже).
Самостоятельный реестр — не вмешивается в расчётный движок оценки качества.

Публичный фасад (ТЗ v13): роутер монтируется в api/v1/api.py; модель — в реестре import_models();
сервисные функции доступны соседним доменам (reporting/LLM) через этот фасад.
"""
from app.modules.incidents.models import CATEGORIES, TechIncident
from app.modules.incidents.service import analytics, list_incidents, triggering_characteristics

__all__ = ["TechIncident", "CATEGORIES", "analytics", "list_incidents", "triggering_characteristics"]
