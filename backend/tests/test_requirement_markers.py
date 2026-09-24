"""Страж формата маркеров требований в исходниках бэкенда (Р-12, ревью 2026-09-07).

ТЗ-23 проверяет покрытие требований grep'ом по схеме `<ПРЕФИКС>-NN`. Маркер в неканоническом
виде (однозначный номер без ведущего нуля) или вне объявленного диапазона выпадает из подсчёта молча —
требование выглядит нереализованным, хотя код есть. Тест держит два инварианта:

1. номер маркера — ровно две цифры (`УК-07`, не `УК-7`);
2. номер лежит в объявленном диапазоне своей схемы (УК-01…60, КП-01…45, КД-01…24, RE-01…27).

Не маркерами считаются: коды вопросов (`В-КП-1`, `В-56` — перед префиксом дефис) и коды
данных (`RE-2026-001` — после номера дефис).
"""
import re
from pathlib import Path

SCHEMES = {"УК": 60, "КП": 45, "КД": 24, "RE": 27}
# (?<![\w-]) — не часть другого кода (В-КП-5, ПРЕ-01); (?![\d-]) — не код данных (RE-2026-001).
MARKER = re.compile(r"(?<![\w-])(УК|КП|КД|RE)-(\d+)(?![\d-])")

ROOT = Path(__file__).resolve().parent.parent / "app"


def _markers():
    for f in ROOT.rglob("*.py"):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for m in MARKER.finditer(line):
                yield f.relative_to(ROOT), n, m.group(1), m.group(2)


def test_markers_are_two_digit():
    bad = [f"{f}:{n} {p}-{num}" for f, n, p, num in _markers() if len(num) != 2]
    assert not bad, "неканонический номер (нужно две цифры): " + ", ".join(bad)


def test_markers_within_declared_range():
    bad = [f"{f}:{n} {p}-{num}" for f, n, p, num in _markers()
           if len(num) == 2 and not 1 <= int(num) <= SCHEMES[p]]
    assert not bad, "маркер вне диапазона схемы: " + ", ".join(bad)
