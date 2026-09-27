"""Встроенные демо-учётки — ТОЛЬКО для демо-стенда (ИБ-02, SEC-01).

Модуль подключается лениво и лишь при `DEMO_MODE=true` (auth_service.demo_users), а из образа
бэкенда исключён `.dockerignore`: в продуктивной сборке его физически нет — «в прод-профиле блок
DEMO_USERS не собирается». Демо-стенд поднимается с bind-mount исходников, поэтому там модуль есть.

Пароли хранятся bcrypt-хэшами, не открытым текстом, и сверяются verify_password (за постоянное
время), а не `==`. Сами пароли — в документации демо-стенда (superadmin/admin/analyst/manager).
Этих учёток нет в БД: сверка активности при refresh для них пропускается, но только пока включён
DEMO_MODE (auth_service.refresh).
"""
from __future__ import annotations

DEMO_USERS: dict[str, dict] = {
    "superadmin": {"id": "00000000-0000-0000-0000-000000000000", "username": "superadmin",
                   "password_hash": "$2b$12$IISnOf3eo/IiccG8kYztguCc1DkIaMpCxMfyvJOBKOATF4SY1Am1e",
                   "role": "SUPER_ADMIN", "full_name": "Супер-администратор"},
    "admin": {"id": "00000000-0000-0000-0000-000000000001", "username": "admin",
              "password_hash": "$2b$12$aVOlQKZS1bKlFcrKJzKWm.K3b3.S8C7aGUyg28R6/7EZNrActbulG",
              "role": "ADMIN", "full_name": "Демо-доступ"},
    "analyst": {"id": "00000000-0000-0000-0000-000000000002", "username": "analyst",
                "password_hash": "$2b$12$LpShncwD7n2hLXW5gemf2uZ7frv1D6.JKbMAdv/YmOVyhWrpSUwLm",
                "role": "TEST_ANALYST", "full_name": "Демо-доступ"},
    "manager": {"id": "00000000-0000-0000-0000-000000000003", "username": "manager",
                "password_hash": "$2b$12$VjAK0/d5Vl2BFt90ugK.F.NYZV6nCCtsbIRUesEv0F0Z9eF/jTc3W",
                "role": "QUALITY_MANAGER", "full_name": "Демо-доступ"},
}
