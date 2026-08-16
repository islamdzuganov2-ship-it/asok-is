"""ТЗ v19 п.14 (УК-14) — карточка меры на языке топ-менеджмента.

Пользователь настоял явно (сессия ТЗ v19): изложение проблемы/решения строится АНАЛИЗОМ уже
посчитанных полей меры, а не подстановкой в формулу и не переписыванием чужого текста слово в
слово. Обоснование/ожидание (rationale/expectation) — профессиональное суждение менеджера по
качеству, мы его не переформулируем произвольно; но денежные/срочные/ответственные факты
синтезируются в связную управленческую прозу через app.modules.llm.generate_management_summary
(персона TOP_MANAGER, ≤80 слов, без формул — контракт и пост-проверка там же).

«Не ноль молча» (принцип, сквозной для ТЗ v19): если денег/срока/ответственного нет — запись
ПРЯМО говорит «не оценено»/«не назначен», а не тихо опускает пункт и не подставляет 0.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.modules.governance.models import Proposal
from app.modules.llm import generate_management_summary


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ManagementSummaryOut(_CamelModel):
    text: str
    word_count: int
    has_money: bool          # реальная денежная оценка есть (не просто «не оценено» в тексте)
    has_deadline: bool
    has_responsible: bool
    missing: list[str]       # какие из трёх обязательных фактов не заполнены на мере


def _fmt_money(v: float | None) -> str | None:
    if not v:
        return None
    return f"{v:,.0f} ₽".replace(",", " ")


def _fmt_date(p: Proposal) -> str | None:
    if p.due_on is not None:
        return p.due_on.strftime("%d.%m.%Y")
    return p.due_date or None


def build_management_summary(p: Proposal) -> ManagementSummaryOut:
    missing: list[str] = []

    problem = (p.rationale or "").strip() or "не описана в обосновании меры"
    ask = (p.expectation or "").strip() or "не сформулировано"

    total_ale = sum(v for v in (p.delta_ale_cash, p.delta_ale_deferred, p.delta_ale_capacity) if v)
    money_fmt = _fmt_money(total_ale)
    has_money = money_fmt is not None
    money_note = f"{money_fmt}/год" if money_fmt else "не оценено"
    if not has_money:
        missing.append("деньги")

    deadline_fmt = _fmt_date(p)
    has_deadline = deadline_fmt is not None
    deadline_note = f"до {deadline_fmt}" if deadline_fmt else "не назначен"
    if not has_deadline:
        missing.append("срок")

    cost_bits = []
    if p.capex:
        cost_bits.append(f"разово {_fmt_money(p.capex)}")
    if p.opex_per_year:
        cost_bits.append(f"{_fmt_money(p.opex_per_year)}/год далее")
    cost_note = " + ".join(cost_bits) if cost_bits else "не оценено"

    result_bits = []
    if p.expected_delta_score:
        result_bits.append(f"балл качества +{float(p.expected_delta_score):g}")
    if money_fmt:
        result_bits.append(f"риск ниже на {money_fmt}/год")
    result_note = ", ".join(result_bits) if result_bits else "не оценено"

    responsible_name = (p.owner or "").strip() or None
    has_responsible = responsible_name is not None
    responsible_note = (
        f"{responsible_name}{f', {p.owner_role}' if p.owner_role else ''}"
        if responsible_name else "не назначен"
    )
    if not has_responsible:
        missing.append("ответственный")

    text = generate_management_summary(
        problem=problem, ask=ask, money_note=money_note, deadline_note=deadline_note,
        cost_note=cost_note, result_note=result_note, responsible_note=responsible_note,
        responsible_name=responsible_name,
    )

    return ManagementSummaryOut(
        text=text,
        word_count=len(text.split()),
        has_money=has_money,
        has_deadline=has_deadline,
        has_responsible=has_responsible,
        missing=missing,
    )
