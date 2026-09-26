"""
Промышленная эксплуатация контура на данных ITSM — ЧИСТЫЕ функции (BL-007, фаза I, RE-24…RE-27).

Пилот идёт от ручного ввода аналитика (§0.5). Здесь — задел для перехода на автовыгрузку ITSM:
четыре «пробела» выгрузки (§2.7 ТЗ контура) и способ закрыть каждый без ручного ввода.

  RE-24 (Пробел B) — трудозатраты по линиям не пишутся в тикет. Восстанавливаются из журнала
        переназначений: время, пока тикет был на линии, × K_утил (доля реальной работы в этом
        времени, 0,2–0,4). K_утил калибруется на 30–50 тикетах, где трудозатраты известны.
  RE-25 (Пробел A) — тикет не знает ИС. Связь восстанавливается по справочнику «группа
        назначения → ИС» и алиасам ИС (как система называется в ITSM).
  RE-26 (Пробел C) — один сбой порождает N тикетов без родителя. Корреляция: тикеты одной ИС
        в окне 30–60 минут от первого — один сбой, «главный» — самый ранний.
  RE-27 (Пробел D) — время в ITSM ≠ время сбоя: тикет открывают позже начала, закрывают позже
        восстановления, деградацию не регистрируют вовсе. Поправки калибруются по APM.

Без БД и I/O — тестируются в изоляции (tests/test_itsm_groundwork.py); сервис itsm_service.py
подставляет данные.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# ─────────────────────────────── общие утилиты ───────────────────────────────


def parse_ts(raw: str | datetime | None) -> datetime | None:
    """ISO-дата/время или «ДД.ММ.ГГГГ ЧЧ:ММ» → aware datetime (UTC, если зона не указана)."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    text = str(raw).strip().replace("Z", "+00:00")
    for parse in (datetime.fromisoformat,
                  lambda s: datetime.strptime(s, "%d.%m.%Y %H:%M"),
                  lambda s: datetime.strptime(s, "%d.%m.%Y %H:%M:%S"),
                  lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M:%S")):
        try:
            d = parse(text)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def normalize_name(name: str | None) -> str:
    """Нормализация имени ИС/алиаса/группы: регистр, ё→е, кавычки, лишние пробелы (RE-25)."""
    s = (name or "").lower().replace("ё", "е")
    s = re.sub(r"[\"'«»“”]", "", s)
    return re.sub(r"\s+", " ", s).strip()


# ─────────────────────────── RE-25: тикет → ИС ───────────────────────────

@dataclass(frozen=True)
class SystemResolution:
    system_id: object | None
    via: str | None          # "alias" | "name" | "group" | None
    key: str | None = None   # по какому значению сопоставлено


def resolve_system(ci_name: str | None, assignment_group: str | None,
                   aliases: dict[str, object], names: dict[str, object],
                   groups: dict[str, object]) -> SystemResolution:
    """ИС тикета. Приоритет: CI как алиас → CI как имя ИС → группа назначения.

    CI точнее группы: одна группа сопровождения ведёт несколько ИС, поэтому группа — последний
    вариант. Все словари — с нормализованными ключами (normalize_name).
    """
    ci = normalize_name(ci_name)
    if ci and ci in aliases:
        return SystemResolution(aliases[ci], "alias", ci_name)
    if ci and ci in names:
        return SystemResolution(names[ci], "name", ci_name)
    grp = normalize_name(assignment_group)
    if grp and grp in groups:
        return SystemResolution(groups[grp], "group", assignment_group)
    return SystemResolution(None, None)


# ────────────── RE-24: трудозатраты из журнала переназначений ──────────────

K_UTIL_DEFAULT = 0.3          # доля реальной работы во времени на линии (0,2–0,4, §2.7)
K_UTIL_MIN_SAMPLES = 30       # меньше — калибровка статистически не держится (§2.7: 30–50 тикетов)
_LINE_RE = re.compile(r"\b(L[123])\b", re.IGNORECASE)


def _line_of(target: str) -> str | None:
    """Линия из записи журнала: «L2», «2-я линия», «Группа L3 АБС»."""
    m = _LINE_RE.search(target or "")
    if m:
        return m.group(1).upper()
    m = re.search(r"([123])\s*-?\s*(я|ая)?\s*лини", (target or "").lower())
    return f"L{m.group(1)}" if m else None


def labor_from_reassignments(reassignments: list[tuple[str, str]] | tuple, resolved_at: str | datetime | None,
                             k_util: float = K_UTIL_DEFAULT) -> dict[str, float]:
    """T_линия = Σ(время на линии) × K_утил, часы (RE-24).

    Время на линии — от назначения на неё до следующего переназначения или восстановления.
    Записи, из которых линию не определить, пропускаются: лучше не учесть час, чем приписать
    его чужой линии со своей ставкой.
    """
    events = sorted(
        ((parse_ts(at), _line_of(to)) for at, to in reassignments),
        key=lambda e: e[0] or datetime.max.replace(tzinfo=timezone.utc),
    )
    events = [(t, line) for t, line in events if t is not None]
    end = parse_ts(resolved_at)
    hours: dict[str, float] = {}
    for i, (start, line) in enumerate(events):
        stop = events[i + 1][0] if i + 1 < len(events) else end
        if line is None or stop is None or stop <= start:
            continue
        hours[line] = hours.get(line, 0.0) + (stop - start).total_seconds() / 3600.0
    return {line: round(h * k_util, 2) for line, h in hours.items()}


@dataclass
class KUtilCalibration:
    k_util: float
    samples: int
    reliable: bool           # не меньше K_UTIL_MIN_SAMPLES
    mape_pct: float | None   # средняя абсолютная ошибка восстановления на выборке, %


def calibrate_k_util(samples: list[tuple[float, float]]) -> KUtilCalibration:
    """K_утил по тикетам с известными трудозатратами: пары (время на линиях, ч; факт. трудозатраты, ч).

    Медиана отношений, а не среднее: один тикет, «забытый» на линии на выходные, иначе утащил бы
    коэффициент для всех. MAPE — насколько хорошо K восстанавливает факт на этой же выборке.
    """
    ratios = [actual / elapsed for elapsed, actual in samples if elapsed > 0 and actual >= 0]
    if not ratios:
        return KUtilCalibration(K_UTIL_DEFAULT, 0, False, None)
    k = round(statistics.median(ratios), 4)
    errs = [abs(elapsed * k - actual) / actual * 100 for elapsed, actual in samples if elapsed > 0 and actual > 0]
    return KUtilCalibration(k, len(ratios), len(ratios) >= K_UTIL_MIN_SAMPLES,
                            round(statistics.mean(errs), 1) if errs else None)


# ───────────────── RE-26: дедупликация без родительских тикетов ─────────────────

CORRELATION_WINDOW_MIN = 45   # окно корреляции 30–60 минут (§2.7)


@dataclass
class TicketRef:
    ref: str
    system_key: str           # ИС (id или нормализованное имя)
    opened_at: datetime
    parent_ref: str | None = None


def correlate(tickets: list[TicketRef], window_minutes: int = CORRELATION_WINDOW_MIN) -> dict[str, str]:
    """child_ref → parent_ref. Тикеты одной ИС, открытые в окне от ПЕРВОГО тикета группы, — один сбой.

    Окно считается от первого тикета, а не «цепочкой» от предыдущего: иначе поток тикетов раз в
    40 минут весь день склеился бы в один многочасовой сбой. Явный parent_ref из ITSM приоритетнее.
    """
    links: dict[str, str] = {t.ref: t.parent_ref for t in tickets if t.parent_ref and t.parent_ref != t.ref}
    by_system: dict[str, list[TicketRef]] = {}
    for t in tickets:
        if t.ref not in links:
            by_system.setdefault(t.system_key, []).append(t)
    window = timedelta(minutes=window_minutes)
    for group in by_system.values():
        group.sort(key=lambda t: t.opened_at)
        head: TicketRef | None = None
        for t in group:
            if head is not None and t.opened_at - head.opened_at <= window:
                links[t.ref] = head.ref
            else:
                head = t
    return links


def validate_correlation(predicted: dict[str, str], labeled_duplicates: set[tuple[str, str]]) -> dict:
    """Качество правила на вручную размеченных парах (дубль, главный): точность и полнота."""
    pred = {(c, p) for c, p in predicted.items()}
    tp = len(pred & labeled_duplicates)
    precision = round(tp / len(pred), 3) if pred else None
    recall = round(tp / len(labeled_duplicates), 3) if labeled_duplicates else None
    return {"predicted": len(pred), "labeled": len(labeled_duplicates), "true_positive": tp,
            "precision": precision, "recall": recall}


# ───────────────────────────── RE-27: калибровка по APM ─────────────────────────────

@dataclass
class ApmCorrection:
    """Поправки ко времени ITSM по данным APM (медианы по сопоставленным сбоям)."""
    start_lag_min: float        # насколько тикет открыт ПОЗЖЕ реального начала сбоя
    recovery_lag_min: float     # насколько тикет закрыт ПОЗЖЕ реального восстановления
    degradation_share: float    # доля сбоев, которые APM видит как деградацию, а ITSM — как отказ
    samples: int = 0
    notes: list[str] = field(default_factory=list)


def apm_calibration(pairs: list[tuple[str, str | None, str, str | None, bool]]) -> ApmCorrection:
    """pairs: (itsm_opened, itsm_resolved, apm_start, apm_end, apm_degraded).

    Медианы, а не средние: единичный «тикет открыли утром за ночной сбой» не должен сдвигать
    поправку для всей истории.
    """
    start_lags, recovery_lags, degraded = [], [], 0
    for itsm_open, itsm_res, apm_start, apm_end, apm_degraded in pairs:
        o, s = parse_ts(itsm_open), parse_ts(apm_start)
        if o and s:
            start_lags.append((o - s).total_seconds() / 60)
        r, e = parse_ts(itsm_res), parse_ts(apm_end)
        if r and e:
            recovery_lags.append((r - e).total_seconds() / 60)
        degraded += 1 if apm_degraded else 0
    notes = []
    if len(pairs) < 10:
        notes.append("меньше 10 сопоставленных сбоев — поправка ориентировочная")
    return ApmCorrection(
        start_lag_min=round(statistics.median(start_lags), 1) if start_lags else 0.0,
        recovery_lag_min=round(statistics.median(recovery_lags), 1) if recovery_lags else 0.0,
        degradation_share=round(degraded / len(pairs), 3) if pairs else 0.0,
        samples=len(pairs), notes=notes,
    )


def apply_apm_correction(opened_at: datetime, resolved_at: datetime | None,
                         c: ApmCorrection) -> tuple[datetime, datetime | None, float | None]:
    """Реальное начало/восстановление и длительность простоя (мин) для тикета ITSM (RE-27).

    Восстановление не сдвигается раньше скорректированного начала — иначе отрицательный простой.
    """
    start = opened_at - timedelta(minutes=c.start_lag_min)
    if resolved_at is None:
        return start, None, None
    end = max(start, resolved_at - timedelta(minutes=c.recovery_lag_min))
    return start, end, round((end - start).total_seconds() / 60, 2)
