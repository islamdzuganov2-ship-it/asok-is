"""Юнит-тесты разбора Excel и валидации загрузки (анти-спуфинг по сигнатуре)."""
import pytest
from fastapi import HTTPException

from app.modules.dataio import router as ex


def test_normalize_header():
    assert ex._normalize_header(" Val_A\n") == "val_a"
    assert ex._normalize_header(None) == ""


def test_map_headers_ru_and_en():
    row = ("metric_id", "val_a", "val_b", "Комментарий")
    h = ex._map_headers(row)
    assert h["metric_id"] == 0 and h["val_a"] == 1 and h["val_b"] == 2
    assert h["expert_comment"] == 3


def test_as_float_handles_comma_and_empty():
    assert ex._as_float("12,5") == 12.5
    assert ex._as_float("7") == 7.0
    assert ex._as_float("") is None
    assert ex._as_float(None) is None


def test_validate_xlsx_rejects_wrong_extension():
    with pytest.raises(HTTPException) as e:
        ex._validate_xlsx("data.txt", b"PK\x03\x04...")
    assert e.value.status_code == 400


def test_validate_xlsx_rejects_spoofed_content():
    # Расширение .xlsx, но содержимое не zip/ooxml — отклоняем
    with pytest.raises(HTTPException) as e:
        ex._validate_xlsx("data.xlsx", b"<html>not excel</html>")
    assert e.value.status_code == 400


def test_validate_xlsx_rejects_oversized():
    big = b"PK\x03\x04" + b"0" * (ex.MAX_UPLOAD_SIZE + 1)
    with pytest.raises(HTTPException) as e:
        ex._validate_xlsx("data.xlsx", big)
    assert e.value.status_code == 413


def test_validate_xlsx_accepts_valid():
    ex._validate_xlsx("data.xlsx", b"PK\x03\x04valid-zip-bytes")  # не должно бросать
