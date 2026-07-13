"""Юнит-тесты модель-агностичной загрузки: автоподбор GGUF и самоопрос модели (ModelProfile)."""
import os

import app.modules.llm.service as svc
from app.infrastructure.config import settings


def _touch(path, size: int = 1):
    with open(path, "wb") as f:
        f.write(b"\0" * size)


def test_explicit_file_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "chosen.gguf")
    _touch(tmp_path / "chosen.gguf")
    _touch(tmp_path / "other.gguf")
    assert svc.discover_model_path() == str(tmp_path / "chosen.gguf")


def test_auto_picks_newest(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "auto")
    old, new = tmp_path / "old.gguf", tmp_path / "new.gguf"
    _touch(old)
    _touch(new)
    os.utime(old, (1, 1))
    os.utime(new, (10**9, 10**9))
    assert svc.discover_model_path() == str(new)


def test_auto_none_when_no_gguf(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "auto")
    assert svc.discover_model_path() is None


def test_explicit_missing_falls_back_to_auto(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "missing.gguf")
    _touch(tmp_path / "present.gguf")
    assert svc.discover_model_path() == str(tmp_path / "present.gguf")


def test_list_models_marks_selected(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "auto")
    a, b = tmp_path / "a.gguf", tmp_path / "b.gguf"
    _touch(a, 1024 * 1024)
    _touch(b, 2 * 1024 * 1024)
    os.utime(a, (1, 1))
    os.utime(b, (10**9, 10**9))
    models = svc.list_models()
    assert {m["file"] for m in models} == {"a.gguf", "b.gguf"}
    selected = [m for m in models if m["selected"]]
    assert len(selected) == 1 and selected[0]["file"] == "b.gguf"


def test_auto_skips_mmproj_projector(tmp_path, monkeypatch):
    # mmproj-*.gguf — проектор мультимодалки, не самостоятельная LLM: авто-подбор его игнорирует,
    # даже если он новее (иначе загрузка «модели» упадёт).
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "auto")
    model, proj = tmp_path / "qwen2.5-0.5b.gguf", tmp_path / "mmproj-model-f16.gguf"
    _touch(model)
    _touch(proj)
    os.utime(model, (1, 1))
    os.utime(proj, (10**9, 10**9))  # проектор новее — но должен быть отфильтрован
    assert svc.discover_model_path() == str(model)
    assert all("mmproj" not in m["file"] for m in svc.list_models())


def test_parse_quant_from_filename_and_metadata():
    assert svc._parse_quant("gemma-3-12b-it-Q4_K_M.gguf", {}) == "Q4_K_M"
    assert svc._parse_quant("model-IQ3_XS.gguf", {}) == "IQ3_XS"
    assert svc._parse_quant("plain.gguf", {"general.file_type": "MOSTLY_F16"}) == "MOSTLY_F16"


class _FakeLlama:
    """Заглушка llama_cpp.Llama: только то, что читает _build_profile (самоопрос)."""
    metadata = {
        "general.architecture": "gemma3",
        "general.name": "Gemma 3 12B",
        "general.size_label": "12B",
        "gemma3.context_length": "8192",
        "tokenizer.chat_template": "{{ messages }}",
    }
    chat_format = "gemma"

    def n_ctx(self):
        return 4096


def test_build_profile_self_introspects_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LLM_N_GPU_LAYERS", 0)
    p = tmp_path / "gemma-3-12b-it-Q4_K_M.gguf"
    _touch(p, 3 * 1024 * 1024)
    prof = svc._build_profile(_FakeLlama(), str(p))
    assert prof.architecture == "gemma3"
    assert prof.name == "Gemma 3 12B"
    assert prof.params == "12B"
    assert prof.n_ctx == 4096
    assert prof.n_ctx_train == 8192
    assert prof.quant == "Q4_K_M"
    assert prof.has_chat_template is True
    assert prof.size_mb == 3


def test_model_info_shape_without_model(monkeypatch, tmp_path):
    # Без файла модели model_info не падает и отдаёт паспорт None + статистику мозга.
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "LOCAL_LLM_MODEL_FILE", "auto")
    svc.reload()  # сброс кэша загрузки на пустой каталог
    info = svc.model_info()
    assert info["available"] is False
    assert info["profile"] is None
    assert "brain" in info
