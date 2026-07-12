"""
brain.py — «резервный мозг» LLM: обучение и настройки, хранимые ВНЕ файла модели.

Зачем (требование заказчика): накопленное «обучение» и настройки не должны жить внутри весов
конкретной модели. Они хранятся отдельно, в переносимом виде (JSON/JSONL), и при переключении на
более умную/мощную GGUF-модель НОВАЯ модель сразу наследует весь накопленный контекст — потому что
мозг привязан к ДОМЕННЫМ ФАКТАМ (ИС, характеристики, выводы), а не к параметрам модели.

Каталог: settings.LLM_BRAIN_DIR (writable, отдельно от read-only каталога моделей). Содержимое:
  • brain_meta.json — версия схемы, список моделей, которые пользовались мозгом, счётчики;
  • profile.json    — переносимые настройки/оверрайды, «улучшающиеся со временем»;
  • memory.jsonl    — память рассуждений (по строке на заключение) → RAG-контекст для будущих прогонов;
  • corpus.jsonl    — обучающий SFT-корпус (для оффлайн-дообучения LoRA на любой базовой модели);
  • feedback.jsonl  — обратная связь человека (принять/отклонить/исправить) — влияет на recall.

Модуль намеренно НЕ импортирует service/reasoning (во избежание циклов): работает с простыми
типами (dict/str). Все операции устойчивы к отсутствию каталога/битым строкам и потокобезопасны.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from typing import Iterable

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1
_io_lock = threading.Lock()

# Имена файлов мозга.
_META = "brain_meta.json"
_PROFILE = "profile.json"
_MEMORY = "memory.jsonl"
_CORPUS = "corpus.jsonl"
_FEEDBACK = "feedback.jsonl"

_WORD_RE = re.compile(r"\w{5,}", re.UNICODE)


# ─── Пути и низкоуровневый ввод-вывод ────────────────────────────────────────────────

def brain_dir() -> str:
    return settings.LLM_BRAIN_DIR


def _path(name: str) -> str:
    return os.path.join(brain_dir(), name)


def _ensure_dir() -> None:
    os.makedirs(brain_dir(), exist_ok=True)


def _append_jsonl(name: str, obj: dict) -> None:
    _ensure_dir()
    line = json.dumps(obj, ensure_ascii=False)
    with _io_lock, open(_path(name), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _read_jsonl(name: str) -> list[dict]:
    path = _path(name)
    if not os.path.isfile(path):
        return []
    rows: list[dict] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # битая строка не должна ронять мозг
    except OSError as exc:
        logger.warning("Не удалось прочитать %s: %s", path, exc)
    return rows


def _read_json(name: str, default: dict) -> dict:
    path = _path(name)
    if not os.path.isfile(path):
        return dict(default)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return dict(default)


def _write_json(name: str, obj: dict) -> None:
    _ensure_dir()
    tmp = _path(name) + ".tmp"
    with _io_lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _path(name))


# ─── Фингерпринт заключения (стабильный ключ для памяти/фидбэка) ──────────────────────

def fingerprint(*parts: str) -> str:
    """Короткий стабильный отпечаток входа заключения — ключ памяти и обратной связи."""
    raw = "|".join((p or "").strip() for p in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


# ─── Профиль (переносимые настройки, «улучшающиеся со временем») ──────────────────────

def _default_profile() -> dict:
    return {"schema": _SCHEMA_VERSION, "overrides": {}, "learned_ctx": {}}


def load_profile() -> dict:
    return _read_json(_PROFILE, _default_profile())


def save_profile(profile: dict) -> None:
    _write_json(_PROFILE, profile)


# ─── Реестр моделей (какие модели пользовались этим мозгом) ───────────────────────────

def note_model(name: str, architecture: str = "") -> None:
    """Регистрирует факт использования мозга моделью (для аудита переносимости)."""
    meta = _read_json(_META, {"schema": _SCHEMA_VERSION, "models": []})
    models = meta.setdefault("models", [])
    now = _now_iso()
    for m in models:
        if m.get("name") == name and m.get("architecture", "") == (architecture or ""):
            m["runs"] = int(m.get("runs", 0)) + 1
            m["last_used"] = now
            break
    else:
        models.append({"name": name, "architecture": architecture or "",
                       "first_used": now, "last_used": now, "runs": 1})
    meta["schema"] = _SCHEMA_VERSION
    _write_json(_META, meta)


# ─── Память рассуждений (RAG-контекст, переносимый между моделями) ────────────────────

def remember(record: dict) -> str:
    """Сохраняет заключение в память мозга. record дополняется ts/fingerprint. Возвращает fingerprint.

    Ожидаемые ключи record: system, period, chars(list[str]), problem, root_cause,
    measures, risks, confidence, model_name. Любой из них может отсутствовать.
    """
    fp = record.get("fingerprint") or fingerprint(
        str(record.get("system", "")), str(record.get("period", "")),
        str(record.get("problem", "")), str(record.get("root_cause", "")),
    )
    entry = dict(record)
    entry["fingerprint"] = fp
    entry.setdefault("ts", _now_iso())
    try:
        _append_jsonl(_MEMORY, entry)
    except OSError as exc:
        logger.warning("Не удалось записать память рассуждений: %s", exc)
    return fp


def _feedback_by_fp() -> dict[str, str]:
    """Последний вердикт обратной связи по каждому fingerprint (accept|reject|edit)."""
    verdicts: dict[str, str] = {}
    for row in _read_jsonl(_FEEDBACK):
        fp = row.get("fingerprint")
        v = row.get("verdict")
        if fp and v:
            verdicts[fp] = v
    return verdicts


def _tokens(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text or "")}


def recall(system_name: str, chars: Iterable[str] = (), k: int = 3) -> str:
    """Подбирает k наиболее релевантных прошлых заключений как контекст (RAG) для нового прогона.

    Скоринг: та же ИС (+3), пересечение характеристик (+2 за каждую), лексическое совпадение (+1),
    поправка на обратную связь человека (принято +2, исправлено 0, отклонено — исключить).
    Возвращает компактный текстовый блок «преемственности» (как history_block) либо пустую строку.
    """
    memories = _read_jsonl(_MEMORY)
    if not memories:
        return ""
    char_set = {c.lower() for c in chars if c}
    name_tokens = _tokens(system_name)
    verdicts = _feedback_by_fp()

    scored: list[tuple[float, dict]] = []
    for m in memories:
        fp = m.get("fingerprint", "")
        verdict = verdicts.get(fp)
        if verdict == "reject":
            continue  # отклонённое человеком не подмешиваем
        score = 0.0
        if m.get("system") and system_name and m["system"].strip().lower() == system_name.strip().lower():
            score += 3.0
        mem_chars = {str(c).lower() for c in (m.get("chars") or [])}
        score += 2.0 * len(char_set & mem_chars)
        score += 1.0 * len(name_tokens & _tokens(f"{m.get('problem','')} {m.get('root_cause','')}"))
        if verdict == "accept":
            score += 2.0
        if score > 0:
            scored.append((score, m))

    if not scored:
        return ""
    scored.sort(key=lambda x: (x[0], x[1].get("ts", "")), reverse=True)
    lines: list[str] = []
    for _, m in scored[:k]:
        period = m.get("period", "")
        head = f"[{m.get('system','?')}, {period}]" if period else f"[{m.get('system','?')}]"
        root = (m.get("root_cause") or m.get("problem") or "").strip().replace("\n", " ")
        if root:
            lines.append(f"{head} прошлый вывод: {root[:280]}")
    return "\n".join(lines)


# ─── Обратная связь человека (влияет на recall и на корпус) ───────────────────────────

def record_feedback(fingerprint_id: str, verdict: str, edited_text: str = "", user: str = "") -> dict:
    """Фиксирует оценку человека по заключению. verdict: accept|reject|edit.

    Для edit сохраняется исправленный текст — он попадает в корпус как «золотой» пример,
    улучшая будущее дообучение (уровень C) и приоритет в recall.
    """
    verdict = (verdict or "").strip().lower()
    if verdict not in ("accept", "reject", "edit"):
        raise ValueError("verdict должен быть accept|reject|edit")
    entry = {"ts": _now_iso(), "fingerprint": fingerprint_id, "verdict": verdict,
             "edited_text": edited_text or "", "user": user or ""}
    _append_jsonl(_FEEDBACK, entry)
    if verdict == "edit" and edited_text.strip():
        append_corpus({"ts": entry["ts"], "fingerprint": fingerprint_id,
                       "source": "human_edit", "output": edited_text.strip()})
    return entry


# ─── Обучающий корпус (для оффлайн-дообучения на любой базовой модели) ────────────────

def append_corpus(example: dict) -> None:
    """Добавляет пример в переносимый обучающий корпус (SFT/LoRA-независимо от модели)."""
    try:
        _append_jsonl(_CORPUS, example)
    except OSError as exc:
        logger.warning("Не удалось дописать корпус: %s", exc)


def corpus_path() -> str:
    _ensure_dir()
    return _path(_CORPUS)


def human_edits() -> list[dict]:
    """Исправленные человеком заключения (verdict=edit) — «золотые» примеры для дообучения."""
    return [r for r in _read_jsonl(_CORPUS) if r.get("source") == "human_edit" and r.get("output")]


# ─── Сводка (для model_info / UI) ─────────────────────────────────────────────────────

def stats() -> dict:
    """Краткая статистика мозга для панели статуса LLM."""
    memories = _read_jsonl(_MEMORY)
    meta = _read_json(_META, {"models": []})
    return {
        "dir": brain_dir(),
        "memories": len(memories),
        "corpus": len(_read_jsonl(_CORPUS)),
        "feedback": len(_read_jsonl(_FEEDBACK)),
        "systems": len({m.get("system") for m in memories if m.get("system")}),
        "models_seen": len(meta.get("models", [])),
    }


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
