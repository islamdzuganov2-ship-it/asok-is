"""
gate.py — детерминированный ШЛЮЗ ПРАВИЛ (Rule Engine) перед LLM.

Роль в схеме заказчика:

    Правила (IF Severity>=High / Coverage<70% / Regression Failed)
        │
        ▼
    Rule Engine (Python)   ← ЭТОТ МОДУЛЬ: считает и ВЫНОСИТ ВЕРДИКТ
        │
        ▼
    LLM                    ← только ОБЪЯСНЯЕТ вердикт (причины/риски/рекомендации),
        │                    не переопределяет его (см. modules/llm/reasoning.py)
        ▼
    Объяснение · Причины · Риски · Рекомендации

Ключевой инвариант: РЕШЕНИЕ (сработало правило или нет, какова серьёзность) принимает
детерминированный Python, а не модель. LLM получает список сработавших правил как ПОВОД для
разбора и обязан объяснить их — но не может отменить или «передумать».

Триггеры адаптированы к домену оценки качества ИС (ISO/IEC 25010, методика МК_8.1):
  • Severity>=High     → интегральное качество Q ниже порога «критического» уровня;
  • Coverage<70%       → измерено < 70% подхарактеристик (много «Невозможно измерить»);
  • Regression Failed  → деградация к предыдущему периоду (Δ ≤ порога в п.п.).
Пороги — конфигурируемые константы модуля (единый источник правды).
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ─── Пороги правил (единый источник правды) ──────────────────────────────────────────
SEVERITY_Q_THRESHOLD = 0.41       # Q < 41% → «Низкий»/«Ниже среднего» (критический уровень)
COVERAGE_THRESHOLD = 0.70         # доля измеренных подхарактеристик < 70%
REGRESSION_DELTA_PP = -12.0       # падение интегрального качества ≤ -12 п.п. к прошлому периоду


@dataclass(frozen=True)
class RuleSignal:
    """Одно сработавшее правило: код, ярлык (как на схеме) и человекочитаемая деталь."""
    code: str
    label: str
    detail: str


@dataclass(frozen=True)
class GateResult:
    """Итог работы движка правил: какие правила сработали и общая серьёзность."""
    signals: list[RuleSignal] = field(default_factory=list)
    severity: str = "none"        # none | medium | high

    def fired(self) -> bool:
        return bool(self.signals)

    def codes(self) -> list[str]:
        return [s.code for s in self.signals]

    def as_block(self) -> str:
        """Текстовый блок сработавших правил для передачи в конвейер (rules_block)."""
        return "\n".join(f"- [{s.label}] {s.detail}" for s in self.signals)


def evaluate_gate(
    q: float | None = None,
    measured_subs: int = 0,
    total_subs: int = 0,
    delta_pp: float | None = None,
    criticality: str | None = None,
) -> GateResult:
    """Оценивает правила на ПОСЧИТАННЫХ движком метриках. Возвращает вердикт (не мнение LLM).

    q            — интегральное качество [0..1] (None, если не измерялось);
    measured_subs/total_subs — измеренные и все подхарактеристики (для покрытия);
    delta_pp     — изменение Q к предыдущему периоду в п.п. (None, если истории нет);
    criticality  — критичность ИС (справочно, усиливает трактовку Severity).
    """
    signals: list[RuleSignal] = []

    # R1 — Severity>=High: интегральное качество ниже критического порога.
    if q is not None and q < SEVERITY_Q_THRESHOLD:
        crit = f", критичность ИС: {criticality}" if criticality else ""
        signals.append(RuleSignal(
            "severity_high", "Severity>=High",
            f"интегральное качество {round(q * 100)}% ниже порога "
            f"{round(SEVERITY_Q_THRESHOLD * 100)}%{crit}",
        ))

    # R2 — Coverage<70%: измерено меньше 70% подхарактеристик.
    if total_subs > 0:
        coverage = measured_subs / total_subs
        if coverage < COVERAGE_THRESHOLD:
            signals.append(RuleSignal(
                "coverage_low", "Coverage<70%",
                f"измерено {measured_subs} из {total_subs} подхарактеристик "
                f"({round(coverage * 100)}%), остальное — «Невозможно измерить»",
            ))

    # R3 — Regression Failed: деградация к предыдущему периоду.
    if delta_pp is not None and delta_pp <= REGRESSION_DELTA_PP:
        signals.append(RuleSignal(
            "regression_failed", "Regression Failed",
            f"падение интегрального качества на {round(abs(delta_pp))} п.п. к прошлому периоду",
        ))

    codes = {s.code for s in signals}
    if "severity_high" in codes or {"coverage_low", "regression_failed"} <= codes:
        severity = "high"
    elif codes:
        severity = "medium"
    else:
        severity = "none"
    return GateResult(signals=signals, severity=severity)
