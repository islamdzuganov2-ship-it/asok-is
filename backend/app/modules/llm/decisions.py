"""
decisions.py — матрицы принятия решений контура качества (BL-009, ТЗ v18).

Зачем отдельный модуль. Конвейер рассуждения (reasoning.py) объясняет, ЧТО произошло.
Но «что с этим делать» — уровень решения, срок, адресат, можно ли нести вывод правлению —
это управленческое правило, а не мнение модели. Поэтому оно вынесено в ЯВНЫЕ ТАБЛИЦЫ:

    детерминированный вход (вердикт движка правил, критичность ИС, полнота данных)
        → ячейка матрицы → решение с адресатом и сроком.

Инвариант тот же, что у gate.py: РЕШЕНИЕ ПРИНИМАЕТ ТАБЛИЦА, LLM его только объясняет.
Матрица аудируема (её можно распечатать и утвердить), воспроизводима и тестируема, а при
недоступности модели работает без изменений.

Три матрицы:
  1) ТРИАЖ            — серьёзность вердикта × критичность ИС → уровень решения, срок, адресат;
  2) ДОВЕРИЕ К ВЫВОДУ — уверенность конвейера × доля этапов на детерминированном откате
                        → можно ли выносить вывод на уровень правления;
  3) ДОСТАТОЧНОСТЬ ДАННЫХ — покрытие измерений × наличие источников → что дособрать
                        (питает проход уточняющих вопросов, см. reasoning.py, этап Э2.5).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

# ─── Общие шкалы ──────────────────────────────────────────────────────────────────────

SEVERITIES = ("none", "medium", "high")
CRITICALITIES = ("BUSINESS OPERATIONAL", "BUSINESS CRITICAL", "MISSION CRITICAL")
CONFIDENCES = ("низкая", "средняя", "высокая")

# Уровни решения: кто вправе принять решение по итогам разбора.
TIER_MONITOR = "наблюдение"          # держать на контроле, отдельное решение не требуется
TIER_OWNER = "владелец процесса"     # решает менеджер качества / владелец риска
TIER_BOARD = "правление"             # требуется решение топ-менеджмента


@dataclass(frozen=True)
class TriageDecision:
    """Ячейка матрицы триажа: уровень решения, адресат, срок и предписанное действие."""

    tier: str
    addressee: str
    sla_days: int
    action: str

    def to_dict(self) -> dict:
        return asdict(self)


# ── Матрица 1. Триаж: серьёзность × критичность ИС ────────────────────────────────────
# Читается как таблица: строка — вердикт движка правил, столбец — класс критичности ИС.
# Пороги серьёзности заданы в gate.py; здесь они только ПРИМЕНЯЮТСЯ, не переопределяются.
TRIAGE_MATRIX: dict[tuple[str, str], TriageDecision] = {
    # ── Правила не сработали ───────────────────────────────────────────────────────────
    ("none", "BUSINESS OPERATIONAL"): TriageDecision(
        TIER_MONITOR, "менеджер по качеству", 90,
        "плановый контроль в следующем периоде; отдельного решения не требуется"),
    ("none", "BUSINESS CRITICAL"): TriageDecision(
        TIER_MONITOR, "менеджер по качеству", 60,
        "плановый контроль; подтвердить устойчивость показателей в следующем периоде"),
    ("none", "MISSION CRITICAL"): TriageDecision(
        TIER_MONITOR, "менеджер по качеству", 30,
        "усиленный контроль как для критичной ИС, несмотря на отсутствие срабатываний"),
    # ── Средняя серьёзность ────────────────────────────────────────────────────────────
    ("medium", "BUSINESS OPERATIONAL"): TriageDecision(
        TIER_OWNER, "владелец процесса", 45,
        "включить меру в план обеспечения качества с ответственным и сроком"),
    ("medium", "BUSINESS CRITICAL"): TriageDecision(
        TIER_OWNER, "владелец процесса и владелец риска", 30,
        "мера в план качества + оценка риска владельцем риска"),
    ("medium", "MISSION CRITICAL"): TriageDecision(
        TIER_BOARD, "топ-менеджмент (информирование)", 20,
        "информировать правление; мера в план качества с контролем исполнения"),
    # ── Высокая серьёзность ────────────────────────────────────────────────────────────
    ("high", "BUSINESS OPERATIONAL"): TriageDecision(
        TIER_OWNER, "владелец процесса и владелец риска", 30,
        "устранение первопричины; повторная оценка после внедрения меры"),
    ("high", "BUSINESS CRITICAL"): TriageDecision(
        TIER_BOARD, "топ-менеджмент (решение)", 14,
        "вынести на решение правления: приоритет и ресурс на устранение первопричины"),
    ("high", "MISSION CRITICAL"): TriageDecision(
        TIER_BOARD, "топ-менеджмент (решение, приоритетно)", 7,
        "приоритетное решение правления; до устранения — компенсирующие меры и усиленный контроль"),
}


def normalize_criticality(value: str | None) -> str:
    """Приводит критичность ИС к шкале матрицы. Неизвестное/пустое → самый мягкий класс.

    Мягкий, а не жёсткий класс по умолчанию — сознательно: завышать уровень решения на
    основании ОТСУТСТВИЯ данных значило бы поднимать в правление то, что туда не относится.
    Отсутствие критичности при этом попадёт в пробелы данных (data_sufficiency).
    """
    v = (value or "").strip().upper().replace("_", " ")
    return v if v in CRITICALITIES else "BUSINESS OPERATIONAL"


def triage(severity: str | None, criticality: str | None) -> TriageDecision:
    """Матрица 1: уровень решения по вердикту движка правил и критичности ИС."""
    sev = (severity or "none").strip().lower()
    if sev not in SEVERITIES:
        sev = "none"
    return TRIAGE_MATRIX[(sev, normalize_criticality(criticality))]


# ── Матрица 2. Доверие к выводу: уверенность × доля откатов ───────────────────────────

@dataclass(frozen=True)
class TrustDecision:
    """Политика использования вывода: куда его можно нести и с какой оговоркой."""

    level: str            # высокий | ограниченный | низкий
    may_go_to_board: bool  # допустим ли вывод как основание решения правления
    policy: str

    def to_dict(self) -> dict:
        return asdict(self)


# Ключ: (уверенность конвейера, доля этапов на детерминированном откате).
# Бакеты отката: "низкая" ≤ 1/3, "средняя" ≤ 2/3, "высокая" > 2/3.
_FALLBACK_BUCKETS = ("низкая", "средняя", "высокая")

TRUST_MATRIX: dict[tuple[str, str], TrustDecision] = {
    ("высокая", "низкая"): TrustDecision(
        "высокий", True,
        "вывод пригоден как основание решения; ссылки на данные приведены в трассе"),
    ("высокая", "средняя"): TrustDecision(
        "ограниченный", True,
        "вывод пригоден, но часть этапов сформирована без модели — проверить трассу перед решением"),
    ("высокая", "высокая"): TrustDecision(
        "ограниченный", False,
        "большинство этапов детерминированы: использовать как сводку фактов, не как аналитический вывод"),
    ("средняя", "низкая"): TrustDecision(
        "ограниченный", True,
        "часть источников не передана: решение возможно с оговоркой о неполноте данных"),
    ("средняя", "средняя"): TrustDecision(
        "ограниченный", False,
        "неполные данные и частичный откат: дособрать источники перед вынесением на правление"),
    ("средняя", "высокая"): TrustDecision(
        "низкий", False,
        "вывод носит справочный характер: дособрать данные и повторить разбор"),
    ("низкая", "низкая"): TrustDecision(
        "низкий", False,
        "первичные источники контура отсутствуют: вывод справочный, решение принимать нельзя"),
    ("низкая", "средняя"): TrustDecision(
        "низкий", False,
        "первичные источники отсутствуют: требуется внесение суждений/мер, затем повторный разбор"),
    ("низкая", "высокая"): TrustDecision(
        "низкий", False,
        "данных недостаточно для анализа: вывод не может служить основанием ни для какого решения"),
}


def _fallback_bucket(fell_back: int, total: int) -> str:
    if total <= 0:
        return "высокая"
    ratio = fell_back / total
    if ratio <= 1 / 3:
        return "низкая"
    if ratio <= 2 / 3:
        return "средняя"
    return "высокая"


def trust(confidence: str | None, fell_back: int, total_stages: int) -> TrustDecision:
    """Матрица 2: можно ли опираться на вывод и на каком уровне."""
    conf = (confidence or "низкая").strip().lower()
    if conf not in CONFIDENCES:
        conf = "низкая"
    return TRUST_MATRIX[(conf, _fallback_bucket(fell_back, total_stages))]


# ── Матрица 3. Достаточность данных: покрытие × наличие источников ────────────────────

@dataclass(frozen=True)
class DataDecision:
    """Что дособрать, чтобы разбор стал полноценным."""

    level: str              # достаточно | частично | недостаточно
    gaps: list[str]         # чего именно не хватает (для проходa уточняющих вопросов)
    action: str

    def to_dict(self) -> dict:
        return asdict(self)


# Порог покрытия измерений совпадает с правилом Coverage<70% движка (gate.COVERAGE_THRESHOLD):
# один порог на систему, иначе движок и матрица дают расходящиеся сигналы об одном и том же.
COVERAGE_OK = 0.70


def data_sufficiency(measured_subs: int = 0, total_subs: int = 0, *,
                     has_judgments: bool = False, has_risks: bool = False,
                     has_measures: bool = False, has_history: bool = False,
                     has_criticality: bool = True) -> DataDecision:
    """Матрица 3: полнота входа и перечень пробелов (питает Э2.5 «уточняющие вопросы»)."""
    gaps: list[str] = []
    if not has_judgments:
        gaps.append("профессиональные суждения по подхарактеристикам")
    if total_subs > 0 and (measured_subs / total_subs) < COVERAGE_OK:
        gaps.append(
            f"измерения подхарактеристик (измерено {measured_subs} из {total_subs}, "
            f"порог {round(COVERAGE_OK * 100)}%)"
        )
    elif total_subs == 0:
        gaps.append("сведения о полноте измерений (число оценённых подхарактеристик)")
    if not has_risks:
        gaps.append("связанные записи базы рисков")
    if not has_measures:
        gaps.append("карточки мер (что уже делается)")
    if not has_history:
        gaps.append("данные прошлых периодов (для оценки динамики)")
    if not has_criticality:
        gaps.append("класс критичности ИС (определяет уровень решения)")

    if not gaps:
        return DataDecision("достаточно", [], "разбор выполняется в полном объёме")
    if has_judgments or has_measures:
        return DataDecision(
            "частично", gaps,
            "разбор выполняется с оговоркой о неполноте; пробелы вынесены в уточняющие вопросы")
    return DataDecision(
        "недостаточно", gaps,
        "первичные источники контура отсутствуют — требуется внесение данных, затем повторный разбор")


# ── Представление матриц (промпт, трасса, API/UI, документация) ───────────────────────

def as_block(triage_d: TriageDecision, trust_d: TrustDecision, data_d: DataDecision) -> str:
    """Текстовый блок решений для промпта и трассы: LLM обязана ОБЪЯСНИТЬ эти решения."""
    lines = [
        f"- Уровень решения: {triage_d.tier}; адресат: {triage_d.addressee}; "
        f"ориентировочный срок: {triage_d.sla_days} дн.; предписано: {triage_d.action}",
        f"- Доверие к выводу: {trust_d.level}; "
        f"вынесение на правление: {'допустимо' if trust_d.may_go_to_board else 'не допускается'} "
        f"({trust_d.policy})",
        f"- Полнота данных: {data_d.level}; {data_d.action}",
    ]
    if data_d.gaps:
        lines.append("- Пробелы данных: " + "; ".join(data_d.gaps))
    return "\n".join(lines)


def matrices() -> dict:
    """Полная выгрузка матриц для API/UI и печатной формы (утверждение заказчиком)."""
    return {
        "triage": {
            "axes": {"severity": list(SEVERITIES), "criticality": list(CRITICALITIES)},
            "cells": [
                {"severity": sev, "criticality": crit, **cell.to_dict()}
                for (sev, crit), cell in TRIAGE_MATRIX.items()
            ],
        },
        "trust": {
            "axes": {"confidence": list(CONFIDENCES), "fallback": list(_FALLBACK_BUCKETS)},
            "cells": [
                {"confidence": conf, "fallback": fb, **cell.to_dict()}
                for (conf, fb), cell in TRUST_MATRIX.items()
            ],
        },
        "data_sufficiency": {
            "coverage_threshold": COVERAGE_OK,
            "levels": ["достаточно", "частично", "недостаточно"],
        },
    }
