"""Тесты контракта синхронизации задач (ТЗ v19 п.6, УК-06) — заглушка на будущее.

Решение сессии: интеграция с внешним таск-трекером не подключается сейчас (внутренний Гант
уже закрывает потребность) — эти тесты проверяют, что заглушка ЧЕСТНА: не выдумывает внешние
ID/статусы и ничего не отправляет вовне, а не то, что она что-то реально синхронизирует.
"""
from app.infrastructure.integrations.tasksync import StubTaskSyncPort, get_task_sync_port
from app.shared.ports import ExternalTask, TaskSyncPort


def test_stub_task_sync_port_satisfies_protocol():
    assert isinstance(StubTaskSyncPort(), TaskSyncPort)


def test_factory_returns_stub_when_tracker_not_configured():
    assert isinstance(get_task_sync_port(), StubTaskSyncPort)


def test_push_task_returns_local_marker_not_fabricated_id():
    port = StubTaskSyncPort()
    external_id = port.push_task("proposal", "123", "Внедрить резервирование", "Сидоров К.М.", "01.10.2026")
    assert external_id.startswith("stub://")
    assert "proposal" in external_id and "123" in external_id


def test_fetch_status_honestly_returns_none():
    """None — «не синхронизировано», а не выдуманный ExternalTask со статусом «готово»."""
    assert StubTaskSyncPort().fetch_status("любой-id") is None


def test_external_task_dataclass_shape():
    t = ExternalTask(external_id="X-1", title="Задача", status="open")
    assert t.assignee is None and t.due_date is None  # опциональные поля честно пустые, не ""
