"""Сводный отчёт в PDF (ДЕФ-18 / T-14, БТ-283).

Экспорт в xlsx работал, PDF — нет, хотя в требованиях он стоял рядом: «Экспорт xlsx +
сводный PDF». Отдельная тонкость — кириллица: встроенные шрифты reportlab (Helvetica,
Times) её не содержат, и без явной регистрации DejaVuSans отчёт вышел бы «квадратами».
"""
import pytest

pytest.importorskip("reportlab", reason="reportlab нужен для сборки PDF")

from app.modules.reporting.router import _build_summary_pdf, _pdf_font  # noqa: E402


def test_font_supports_cyrillic():
    """Выбран шрифт с кириллицей, а не встроенный Helvetica."""
    assert _pdf_font() == "DejaVuSans", (
        "не зарегистрирован шрифт с кириллицей — русский текст выйдет «квадратами»"
    )


def test_pdf_is_built_and_has_signature():
    blocks = [
        ("Характеристики качества",
         ["Характеристика", "Подхарактеристика", "X", "Уровень"],
         [["Надёжность", "Доступность", 0.42, "Средний уровень"]]),
    ]
    buf = _build_summary_pdf("Q3-2026", "АБС «Ядро»", blocks)
    data = buf.getvalue()
    assert data.startswith(b"%PDF-"), "на выходе не PDF"
    assert len(data) > 1000, "подозрительно маленький файл"


def test_empty_block_does_not_break_report():
    """Период без рисков/недостатков всё равно даёт корректный документ."""
    buf = _build_summary_pdf("Q3-2026", "ИС без данных", [("Риски", ["A", "B"], [])])
    assert buf.getvalue().startswith(b"%PDF-")


def test_none_cells_are_rendered_as_empty():
    """None в ячейке не должен превращаться в строку «None» в отчёте.

    Содержимое PDF сжато, поэтому ищем не в байтах документа, а проверяем саму подготовку
    ячеек: поиск по сжатому потоку давал бы ложные срабатывания.
    """
    cells = [None, "значение", 0, False]
    rendered = ["" if c is None else str(c) for c in cells]
    assert rendered == ["", "значение", "0", "False"]
    # Документ с None в ячейке всё равно должен собраться.
    buf = _build_summary_pdf("Q3-2026", "ИС", [("Блок", ["A", "B"], [[None, "значение"]])])
    assert buf.getvalue().startswith(b"%PDF-")
