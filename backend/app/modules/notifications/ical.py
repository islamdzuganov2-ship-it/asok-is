"""
Календарные приглашения iCalendar (RFC 5545) для сроков мер (ТЗ v19 п.6, УК-17).

Чистые функции без БД: срок меры → текст .ics. Событие — на весь день срока (сроки мер — даты,
не время, УК-36), с напоминанием за сутки. Приглашение уходит тем же NotificationPort, что и
письма, вложением — канал доставки остаётся за портом (заглушка сейчас, SMTP позже).

UID стабилен для меры: повторная отправка после переноса срока ОБНОВЛЯЕТ событие в календаре
получателя (SEQUENCE растёт), а не создаёт второе.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

PRODID = "-//АСОК ИС//Сроки мер//RU"
MAX_OCTETS = 75


def escape_text(value: str) -> str:
    """Экранирование TEXT по RFC 5545 §3.3.11: обратная косая, `;`, `,`, перевод строки."""
    return (value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def fold_line(line: str) -> str:
    """Перенос длинной строки: не длиннее 75 октетов UTF-8, продолжение начинается с пробела.
    Режем по символам, не по байтам — многобайтная кириллица не разрывается посередине."""
    out: list[str] = []
    current = ""
    limit = MAX_OCTETS
    for ch in line:
        if len((current + ch).encode("utf-8")) > limit:
            out.append(current)
            current = ch
            limit = MAX_OCTETS - 1  # у строк продолжения первый октет — пробел
        else:
            current += ch
    out.append(current)
    return "\r\n ".join(out)


def _stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def measure_uid(proposal_id: str) -> str:
    return f"measure-{proposal_id}@asok-is"


def build_measure_event(
    *, proposal_id: str, summary: str, description: str, due: date,
    attendee_email: str | None = None, attendee_name: str | None = None,
    sequence: int = 0, now: datetime | None = None,
) -> str:
    """Текст .ics с одним событием «срок меры». С адресатом — METHOD:REQUEST (приглашение
    в календарь руководителя), без — PUBLISH (файл для ручного импорта)."""
    now = now or datetime.now(timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        f"METHOD:{'REQUEST' if attendee_email else 'PUBLISH'}",
        "BEGIN:VEVENT",
        f"UID:{measure_uid(proposal_id)}",
        f"DTSTAMP:{_stamp(now)}",
        f"SEQUENCE:{sequence}",
        f"DTSTART;VALUE=DATE:{due.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{(due + timedelta(days=1)).strftime('%Y%m%d')}",
        f"SUMMARY:{escape_text(summary)}",
        f"DESCRIPTION:{escape_text(description)}",
        "TRANSP:TRANSPARENT",
    ]
    if attendee_email:
        cn = f";CN={escape_text(attendee_name)}" if attendee_name else ""
        lines.append(f"ATTENDEE{cn};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:{attendee_email}")
    lines += [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text('Завтра срок меры: ' + summary)}",
        "TRIGGER:-P1D",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(fold_line(line) for line in lines) + "\r\n"
