"""Тесты контура утилизации ресурсов (ТЗ v17, задачи RES-01, RES-02).

Закрепляют инварианты манифеста развёртывания, выявленные нагрузочным профилированием:

  RES-01 — у сервисов с резидентными весами LLM обязан быть потолок памяти и CPU.
           Без лимита OOM-killer выбирает жертву на всём хосте: замер показал бэкенд
           на 6.2 ГиБ из 7.7 ГиБ доступных (77.8 %) без каких-либо ограничений.

  RES-02 — celery-воркер НЕ грузит веса модели. modules/llm/tasks.py использует тот же
           in-process llama.cpp, а prefork с --concurrency=2 дал бы две копии весов
           (2 × ~6.2 ГиБ) сверх копии бэкенда при 8.27 ГБ RAM хоста → гарантированный OOM.

Тесты читают docker-compose.yml как данные (без запуска Docker) — это делает их быстрыми
и пригодными для CI, где демон Docker может отсутствовать.
"""
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml", reason="PyYAML нужен для разбора docker-compose.yml")

COMPOSE_PATH = Path(__file__).resolve().parents[2] / "docker-compose.yml"

# Сервисы, для которых потолок ресурсов обязателен: оба монтируют каталог моделей
# и способны инстанцировать llama.cpp внутри своего процесса.
GUARDED_SERVICES = ["backend", "celery_worker"]


@pytest.fixture(scope="module")
def compose() -> dict:
    assert COMPOSE_PATH.is_file(), f"не найден манифест {COMPOSE_PATH}"
    return yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))


def _limits(compose: dict, service: str) -> dict:
    svc = compose["services"][service]
    limits = svc.get("deploy", {}).get("resources", {}).get("limits", {})
    assert limits, (
        f"RES-01: у сервиса «{service}» нет deploy.resources.limits. "
        "Контейнер с резидентной моделью без потолка памяти утаскивает в OOM весь хост."
    )
    return limits


@pytest.mark.parametrize("service", GUARDED_SERVICES)
def test_res01_service_has_memory_limit(compose: dict, service: str) -> None:
    """RES-01: у сервиса задан потолок памяти."""
    limits = _limits(compose, service)
    assert "memory" in limits, f"RES-01: не задан limits.memory для «{service}»"


@pytest.mark.parametrize("service", GUARDED_SERVICES)
def test_res01_service_has_cpu_limit(compose: dict, service: str) -> None:
    """RES-01: у сервиса задан потолок CPU.

    Замер зафиксировал 764 % CPU (≈7.6 из 12 ядер) на одном LLM-запросе — без потолка
    инференс вытесняет БД, Redis и фронт с процессора.
    """
    limits = _limits(compose, service)
    assert "cpus" in limits, f"RES-01: не задан limits.cpus для «{service}»"


def test_res01_backend_memory_limit_fits_model_weights(compose: dict) -> None:
    """RES-01: лимит бэкенда вмещает веса модели, но не превышает RAM хоста.

    Нижняя граница — измеренные 6.2 ГиБ резидентных весов плюс запас на приложение;
    слишком низкий лимит убивал бы контейнер прямо на загрузке модели.
    Верхняя граница — RAM хоста (8.27 ГБ), иначе лимит не выполняет свою функцию.
    """
    memory = str(_limits(compose, "backend")["memory"]).upper().rstrip("B")
    assert memory.endswith("M") or memory.endswith("G"), f"непонятная единица: {memory}"
    mib = float(memory[:-1]) * (1024 if memory.endswith("G") else 1)
    assert 6400 <= mib <= 7800, (
        f"RES-01: лимит памяти бэкенда {mib:.0f} МиБ вне рабочего диапазона. "
        "Ниже 6400 МиБ контейнер умрёт на загрузке весов (замер: 6.2 ГиБ), "
        "выше 7800 МиБ лимит бессмысленен при 8.27 ГБ RAM хоста."
    )


def test_res02_celery_worker_has_llm_disabled(compose: dict) -> None:
    """RES-02: воркер запускается с LLM_ENABLED=false.

    Иначе каждый prefork-потомок загрузит собственную копию весов.
    """
    env = compose["services"]["celery_worker"].get("environment", [])
    # environment может быть списком "K=V" или словарём — поддерживаем оба вида.
    values = dict(item.split("=", 1) for item in env) if isinstance(env, list) else dict(env)
    assert values.get("LLM_ENABLED", "").strip().lower() == "false", (
        "RES-02: celery_worker обязан иметь LLM_ENABLED=false. "
        "modules/llm/tasks.py грузит llama.cpp в процесс воркера; при --concurrency=2 "
        "это две копии весов (~12 ГиБ) сверх бэкенда при 8.27 ГБ RAM хоста."
    )


def test_res02_celery_concurrency_matches_cpu_limit(compose: dict) -> None:
    """RES-02: параллелизм воркера не превышает выделенный ему потолок CPU."""
    command = compose["services"]["celery_worker"]["command"]
    command = " ".join(command) if isinstance(command, list) else str(command)
    assert "--concurrency=" in command, "не найден --concurrency в команде воркера"
    concurrency = int(command.split("--concurrency=")[1].split()[0])
    cpus = float(str(_limits(compose, "celery_worker")["cpus"]).strip('"'))
    assert concurrency <= cpus, (
        f"RES-02: --concurrency={concurrency} превышает limits.cpus={cpus:g} — "
        "воркеры будут конкурировать за процессорное время внутри собственного лимита."
    )
