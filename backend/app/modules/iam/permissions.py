"""
Каталог прав доступа (BL-008 RBAC) — ЕДИНЫЙ источник истины.

Права — это стабильные строковые ключи, привязанные к реальным разделам/действиям.
Их набор задаётся кодом (не пользователем): каждое право соответствует пункту меню,
маршруту или защищённому эндпоинту. Пользователь-суперадмин редактирует лишь
СВЯЗЬ «роль → права» (матрицу `role_permissions`), а не сам каталог.

`DEFAULT_ROLE_PERMISSIONS` выведен из прежних хардкод-правил (App.tsx RequireRole +
require_role в роутерах), чтобы поведение в день внедрения не изменилось.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Permission:
    key: str
    group: str
    label: str
    description: str = ""


# ── Каталог (сгруппирован для UI матрицы) ──────────────────────────────────────
PERMISSIONS: list[Permission] = [
    # Дашборды (видимость раздела/маршрута)
    Permission("view.dashboard.cto", "Дашборды", "Дашборд CTO"),
    Permission("view.dashboard.ceo", "Дашборды", "Дашборд CEO"),
    Permission("view.dashboard.manager", "Дашборды", "Дашборд менеджера («Основное»)"),
    Permission("view.dashboard.risk", "Дашборды", "Дашборд владельца риска"),
    Permission("view.dashboard.analytics", "Дашборды", "Аналитический дашборд"),
    Permission("view.dashboard.dynamics", "Дашборды", "Динамика качества"),
    Permission("view.dashboard.taskplan", "Дашборды", "План задач"),
    Permission("view.dashboard.incidents", "Дашборды", "Аналитика сбоев"),
    Permission("view.dashboard.risk_radar", "Дашборды", "Риск-радар"),
    # Разделы приложения
    Permission("view.assessments", "Разделы", "Внесение данных / рабочее место оценки"),
    Permission("view.reports", "Разделы", "Отчёты"),
    Permission("view.risks", "Разделы", "База рисков"),
    Permission("view.risk_economics", "Разделы", "Риск-экономика"),
    Permission("view.measure_economics.own", "Разделы", "Цена неисполнения своей меры (Ц_ОМ)",
               "ТЗ v19 §17.8 (УК-58): финансовый блок карточки (CAPEX/OPEX/ROSI/Ц_ОМ) на "
               "СВОИХ мерах — отдельно от общего view.risk_economics, переключается через "
               "конструктор прав на усмотрение суперадминистратора"),
    Permission("view.ai_assessments", "Разделы", "Оценка СИИ (ГОСТ Р 59898)"),
    Permission("view.my_tasks", "Разделы", "Мои задачи (исполнитель)",
               "Поручения, назначенные на пользователя: уточнения и запрос переноса срока"),
    Permission("view.settings", "Разделы", "Настройка (персональная)"),
    Permission("view.admin.users", "Администрирование", "Раздел «Пользователи»"),
    Permission("view.admin.permissions", "Администрирование", "Раздел «Права»"),
    Permission("view.admin.llm_quality", "Администрирование", "Раздел «Качество LLM»",
               "Дашборд самооценки LLM-подсистемы по ISO/IEC 25010 (только суперадминистратор)"),
    # Действия (запись/операции)
    Permission("systems.edit", "Оценка", "Заводить и править реестр ИС",
               "Создание системы в реестре — точка входа сценария «Новая оценка»"),
    Permission("quality.catalog.edit", "Оценка", "Править каталог метрик ISO 25010",
               "Справочные данные модели качества: на них опираются ВСЕ оценки, "
               "включая закрытые периоды. По умолчанию — только встроенные роли"),
    Permission("assessment.edit", "Оценка", "Вносить и править оценки"),
    Permission("assessment.review", "Оценка", "Экспертное ревью оценок"),
    Permission("dataio.import", "Оценка", "Импорт данных (Excel)"),
    Permission("incidents.edit", "Оценка", "Вести реестр технических сбоев"),
    Permission("governance.propose", "Меры", "Предлагать меры/задачи качества"),
    Permission("governance.decide", "Меры", "Одобрять/отклонять меры (топ-менеджмент)"),
    Permission("governance.decide.minor", "Меры", "Одобрять/отклонять НЕкритичные меры",
               "ТЗ v19 §17.1/17.2 (УК-39/43): ниже денежного порога маршрутизации — без "
               "выхода на governance.decide. QUALITY_MANAGER/ADMIN — любая мера; EXECUTOR — "
               "только мера, где он сам указан ответственным (ОМ)"),
    Permission("econ.ref.edit", "Риск-экономика", "Вести справочники контура"),
    Permission("econ.config.edit", "Риск-экономика", "Править финпараметры (риск-аппетит/пороги)"),
    Permission("risk.base.edit", "Риск-экономика", "Вести базу рисков"),
    Permission("risk.register.edit", "Риск-экономика", "Вести реестр рисковых событий (владелец риска)"),
    Permission("nonconformity.edit", "Риск-экономика", "Вести несоответствия"),
    Permission("nonconformity.decide", "Риск-экономика", "Решение по несоответствию / принятие риска"),
    Permission("risk.verify", "Риск-экономика", "Верифицировать меры/несоответствия (аудитор)"),
    Permission("llm.reload", "Система", "Перезагружать LLM-модель"),
    Permission("llm.quality.run", "Система", "Запускать самооценку LLM по ISO/IEC 25010"),
    Permission("risk.reembed", "Система", "Пересчёт эмбеддингов базы рисков"),
    Permission("admin.users.manage", "Администрирование", "Заводить и менять пользователей"),
    Permission("admin.permissions.manage", "Администрирование", "Раздавать права ролям"),
    Permission("admin.mandatory_sections.manage", "Администрирование", "Фиксировать обязательные дашборды",
               "Разделы, обязательные для всех пользователей — их нельзя скрыть в персональных настройках"),
    Permission("quality.weights.edit", "Администрирование", "Редактировать веса ГОСТ 25010",
               "ТЗ v19 УК-07: правка u/w-весов по профилям критичности — влияет на Score КАЖДОЙ "
               "оценённой ИС немедленно. Решение по открытому вопросу В-9: только суперадминистратор"),
]

ALL_PERMISSION_KEYS: frozenset[str] = frozenset(p.key for p in PERMISSIONS)

# Права управления доступом — их у SUPER_ADMIN нельзя снять (защита от самоблокировки).
# Сюда же отнесены права на самооценку LLM: ТЗ v18 п.10 требует, чтобы дашборд качества
# LLM был доступен ИСКЛЮЧИТЕЛЬНО суперадминистратору. Попадание в этот набор означает,
# что право не входит даже в ADMIN_PERMISSIONS (см. ниже) и не раздаётся матрицей.
PROTECTED_SUPERADMIN_PERMISSIONS: frozenset[str] = frozenset({
    "view.admin.users", "view.admin.permissions",
    "admin.users.manage", "admin.permissions.manage",
    "view.admin.llm_quality", "llm.quality.run",
    "admin.mandatory_sections.manage",
    "quality.weights.edit",
})

# Встроенные роли — их права ФИКСИРОВАНЫ в коде (не редактируются матрицей):
#   · SUPER_ADMIN — весь каталог (управляет пользователями и правами);
#   · ADMIN — широкий функциональный доступ, но БЕЗ управления доступом (это прерогатива
#     SUPER_ADMIN). Держим в коде: демо-режим без токена работает как ADMIN, и это гарантирует
#     стабильный «широкий» доступ независимо от матрицы.
ADMIN_PERMISSIONS: frozenset[str] = ALL_PERMISSION_KEYS - PROTECTED_SUPERADMIN_PERMISSIONS
BUILTIN_ROLES: frozenset[str] = frozenset({"ADMIN", "SUPER_ADMIN"})


def group_order() -> list[str]:
    """Порядок групп для UI (по первому появлению в каталоге)."""
    seen: list[str] = []
    for p in PERMISSIONS:
        if p.group not in seen:
            seen.append(p.group)
    return seen


# ── Дефолтная матрица РЕДАКТИРУЕМЫХ ролей (сохраняет прежнее поведение) ─────────
# ADMIN и SUPER_ADMIN — встроенные (BUILTIN_ROLES), их права вычисляются в коде и здесь
# не задаются. Ключи ниже — коды остальных ролей из User.ALL_ROLES.
# ДЕФ-17 (T-06, БТ-036). «База рисков» ушла из общего набора: заказчик прямо отменил её
# для топ-менеджмента — «не требуется для роли топ менеджер, не его уровень» (2026-07-06).
# Через _VIEW_COMMON она продолжала доставаться CTO и CEO.
_VIEW_COMMON = {"view.reports", "view.settings"}
# Роли, которые ведут или разбирают риски предметно, получают доступ явно.
_WITH_RISK_BASE = _VIEW_COMMON | {"view.risks"}

DEFAULT_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "CTO": {
        "view.dashboard.cto", "view.dashboard.analytics", "view.dashboard.dynamics",
        "view.dashboard.taskplan", "view.dashboard.incidents", "view.dashboard.risk_radar",
        "view.risk_economics", "governance.decide", "nonconformity.decide",
    } | _VIEW_COMMON,
    "CEO": {
        "view.dashboard.ceo", "view.dashboard.analytics", "view.dashboard.dynamics",
        "view.dashboard.taskplan", "view.dashboard.incidents", "view.dashboard.risk_radar",
        "view.risk_economics", "governance.decide", "nonconformity.decide",
    } | _VIEW_COMMON,
    "QUALITY_MANAGER": {
        "view.dashboard.manager", "view.dashboard.analytics", "view.dashboard.dynamics",
        "view.dashboard.taskplan", "view.dashboard.incidents", "view.dashboard.risk_radar",
        "view.assessments", "view.risk_economics",
        "systems.edit",
        "assessment.edit", "assessment.review", "dataio.import", "incidents.edit",
        "governance.propose", "governance.decide.minor", "econ.ref.edit", "risk.base.edit",
        "nonconformity.edit",
    } | _WITH_RISK_BASE,
    "TEST_ANALYST": {
        "view.dashboard.analytics", "view.assessments", "view.risk_economics",
        "systems.edit", "assessment.edit", "dataio.import",
    } | _WITH_RISK_BASE,
    "RISK_MANAGER": {
        "view.dashboard.risk", "view.dashboard.analytics", "view.dashboard.incidents",
        "view.dashboard.risk_radar", "view.risk_economics",
        "risk.register.edit", "econ.ref.edit", "econ.config.edit",
        "nonconformity.edit", "nonconformity.decide",
    } | _WITH_RISK_BASE,
    "AUDITOR": {
        "view.dashboard.risk", "view.dashboard.analytics", "view.risk_economics",
        "risk.verify",
    } | _WITH_RISK_BASE,
    # ДЕФ-10 (БТ-015): «тот же состав дашбордов, что есть у топ-менеджера» — но БЕЗ решений
    # по мерам (governance.decide) и без правки оценок. Действия исполнителя (уточнение,
    # запрос переноса срока) идут через его собственный раздел «Мои задачи».
    "EXECUTOR": {
        "view.my_tasks",
        "view.dashboard.analytics", "view.dashboard.dynamics",
        "view.dashboard.taskplan", "view.dashboard.incidents", "view.dashboard.risk_radar",
        # ТЗ v19 §17.1 (УК-39): «может и сам директор на себя сделать меру, которую видит» —
        # только СВОИ меры ниже порога маршрутизации (проверяется в governance.service.can_self_decide).
        # НЕ добавляем governance.propose — approve/reject гейтятся отдельно (decide/decide.minor),
        # остальные governance.propose-эндпоинты (создание/эскалация/переписывание меры) вне
        # объёма §17.1 и не запрашивались.
        "governance.decide.minor",
        # view.measure_economics.own НЕ включено по умолчанию (§17.8, УК-58) — на усмотрение
        # SUPER_ADMIN через конструктор прав, а не встроенное поведение роли.
    } | _VIEW_COMMON,
}
