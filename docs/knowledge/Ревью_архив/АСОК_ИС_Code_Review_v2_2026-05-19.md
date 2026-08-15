---
tags:
  - фронт
  - бэк
---

# Code Review v2 — АСОК ИС (реальный репо, с учётом всех правок)
**Дата:** 2026-05-19 | **Репо:** https://github.com/islamdzuganov2-ship-it/asok-is | **Коммитов:** 1 (без изменений)

---

## Статус по замечаниям предыдущего ревью

| # | Замечание | Статус |
|---|---|---|
| BUG-01 | .gitlab-ci.yml не YAML | ❌ НЕ ИСПРАВЛЕНО |
| BUG-02a | Redis без healthcheck | ❌ НЕ ИСПРАВЛЕНО |
| BUG-02b | Нет alembic upgrade head | ❌ НЕ ИСПРАВЛЕНО |
| BUG-02c | VITE vs REACT_APP | ❌ НЕ ИСПРАВЛЕНО |
| BUG-02d | Нет celery_worker | ❌ НЕ ИСПРАВЛЕНО |
| BUG-03 | Sync DB URL | ✅ ИСПРАВЛЕНО (asyncpg в compose) |
| WARN-01 | Хардкод user в healthcheck | ❌ НЕ ИСПРАВЛЕНО |
| NOTE-01 | Text Document.txt мусор | ❌ НЕ ИСПРАВЛЕНО (0 байт) |
| NOTE-02 | .vscode* в корне | ❌ НЕ ИСПРАВЛЕНО |

---

## Что реально находится в репо

### Файлы в корне
- docker-compose.yml — 83 строки, 4 сервиса (без celery, без ollama)
- .env.example — 14 строк, asyncpg DSN теперь правильный в compose
- .gitlab-ci.yml — 19 строк ТЕКСТА, не YAML
- .vscodeextensions.json — 11 строк, рабочий JSON (нужен ms-python, eslint, prettier, rest-client)
- .vscodesettings.json — 28 строк, настроен black, mypy, flake8, prettier — ХОРОШО
- .vscodelaunch.json — 43 строки: attach к docker на порт 5678, Chrome debug, pytest runner
- Text Document.txt — 0 байт, пустой файл
- .gitattributes — стандартный

### Директории backend/ и frontend/ — структура есть, код недоступен через web

---

## Детальное ревью доступных файлов

### docker-compose.yml — полный анализ (83 строки)

**✅ Хорошо:**
- asyncpg DSN правильный: `postgresql+asyncpg://asok_user:...@postgres:5432/asok_is`
- Healthcheck у postgres рабочий
- depends_on postgres: condition: service_healthy — правильно
- Networks: asok_net bridge — изоляция есть
- Volume trick `/app/__pycache__` — исключает кэш из hot reload

**❌ Проблемы (все из предыдущего ревью, не исправлены):**

1. Redis без healthcheck:
```yaml
redis:
  condition: service_started  # race condition — не исправлено
```

2. Backend запускается без миграций:
```yaml
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# alembic upgrade head отсутствует
```

3. Frontend использует VITE переменную (скорее всего Vite, не CRA — нужно проверить package.json):
```yaml
- VITE_API_BASE_URL=http://localhost:8000/api/v1
```

4. Нет celery_worker сервиса

5. Backend healthcheck использует curl — нет в python:slim образах:
```yaml
test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
```

6. Хардкод имени пользователя:
```yaml
test: ["CMD-SHELL", "pg_isready -U asok_user -d asok_is"]
```

### .gitlab-ci.yml — НЕ YAML

Файл содержит:
```
### lint
- lint:backend — flake8, max-line-length=100
...
```
Это markdown. GitLab отвергнет при первом пуше.

### .vscodesettings.json — ХОРОШО

Настроен корректно: black formatter, mypy, flake8, prettier для TS, formatOnSave.
Единственное замечание: файл находится в корне как `.vscodesettings.json` вместо `.vscode/settings.json` — VSCode его НЕ подхватит автоматически.

### .vscodelaunch.json — ХОРОШО по содержанию, неправильное расположение

Три конфигурации: attach к Docker (порт 5678), Chrome debug, pytest runner.
Содержание качественное. Та же проблема: должен быть `.vscode/launch.json`.

### .vscodeextensions.json — ХОРОШО по содержанию, неправильное расположение

Рекомендованные расширения: ms-python, pylance, docker, eslint, prettier, rest-client.
Должен быть `.vscode/extensions.json`.

---

## Итоговая оценка

| Категория | Оценка | Динамика |
|---|---|---|
| Инфраструктура (compose) | 5/10 | = (без изменений) |
| CI/CD (.gitlab-ci.yml) | 0/10 | = (не YAML) |
| Dev Environment (VSCode) | 7/10 | ✅ хорошие конфиги, неправильное размещение |
| Бэкенд код | н/о | недоступен через web |
| Фронтенд код | н/о | недоступен через web |

---

## Следующий шаг — конкретный план

### Приоритет 1 (сегодня, ~1 час): инфраструктура
1. Заменить .gitlab-ci.yml рабочим YAML
2. Добавить healthcheck Redis + изменить condition
3. Добавить alembic upgrade head в команду backend
4. Добавить celery_worker в compose
5. Заменить curl в healthcheck на wget или python
6. Перенести .vscode* файлы в директорию .vscode/
7. Удалить Text Document.txt

### Приоритет 2 (после): залить backend код
Весь сгенерированный код (итерации 1-4) уже готов в Obsidian — нужно сделать commit.
