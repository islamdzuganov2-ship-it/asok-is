"""Юнит-тесты сопоставления строк ответственных с пользователями (ТЗ v19 УК-13).

Чистые функции без БД — app/scripts/match_owners_to_users.py. Формат строк-владельцев в системе
(демо и, предположительно, прод) — «[Роль ]Фамилия И.О.», а User.full_name встречается в двух
формах: расписанной («Орлов Андрей Викторович») и уже сокращённой («Петрова А.С.»). Оба формата
должны давать одинаковый результат сопоставления.
"""
from app.scripts.match_owners_to_users import (
    MatchCandidate,
    match_user,
    parse_owner_string,
)

ORLOV_SPELLED = MatchCandidate(id="u1", full_name="Орлов Андрей Викторович", username="orlov")
ORLOV_ABBREV = MatchCandidate(id="u1b", full_name="Орлов А.В.", username="orlov2")
PETROVA = MatchCandidate(id="u2", full_name="Петрова А.С.", username="petrova")
KOZLOVA = MatchCandidate(id="u3", full_name="Козлова Елена Викторовна", username="kozlova")


def test_parse_owner_string_extracts_surname_and_initials():
    parsed = parse_owner_string("Риск-менеджер Орлов А.В.")
    assert parsed is not None
    assert parsed.surname == "Орлов"
    assert parsed.initials == "А.В."


def test_parse_owner_string_without_role_prefix():
    parsed = parse_owner_string("Сидоров К.М.")
    assert parsed is not None
    assert parsed.surname == "Сидоров"
    assert parsed.initials == "К.М."


def test_parse_owner_string_none_for_free_text():
    assert parse_owner_string("Отдел эксплуатации") is None
    assert parse_owner_string(None) is None
    assert parse_owner_string("") is None


def test_match_exact_full_name():
    outcome = match_user("Орлов Андрей Викторович", [ORLOV_SPELLED, PETROVA])
    assert outcome.matched is ORLOV_SPELLED
    assert outcome.ambiguous == []


def test_match_surname_and_initials_against_spelled_out_full_name():
    outcome = match_user("Риск-менеджер Орлов А.В.", [ORLOV_SPELLED, PETROVA])
    assert outcome.matched is ORLOV_SPELLED


def test_match_surname_and_initials_against_pre_abbreviated_full_name():
    """Регрессия: User.full_name='Петрова А.С.' — второй токен уже 'А.С.' одним куском,
    наивное 'первая буква токена' даёт неверные инициалы 'А.' вместо 'А.С.'."""
    outcome = match_user("Петрова А.С.", [ORLOV_SPELLED, PETROVA])
    assert outcome.matched is PETROVA


def test_no_match_on_different_surname():
    outcome = match_user("Петров А.С.", [PETROVA])  # мужской род vs «Петрова» — разные фамилии
    assert outcome.matched is None
    assert outcome.ambiguous == []


def test_no_match_when_no_candidate_close():
    outcome = match_user("Сидоров К.М.", [ORLOV_SPELLED, PETROVA, KOZLOVA])
    assert outcome.matched is None
    assert outcome.ambiguous == []


def test_ambiguous_when_two_users_share_surname_and_initials():
    dup = MatchCandidate(id="u1-dup", full_name="Орлов Алексей Викторович", username="orlov3")
    outcome = match_user("Орлов А.В.", [ORLOV_SPELLED, dup])
    assert outcome.matched is None
    assert set(outcome.ambiguous) == {ORLOV_SPELLED, dup}


def test_match_handles_abbreviated_candidate_form_too():
    outcome = match_user("Орлов А.В.", [ORLOV_ABBREV])
    assert outcome.matched is ORLOV_ABBREV


def test_empty_owner_string_is_unmatched_not_ambiguous():
    outcome = match_user(None, [ORLOV_SPELLED])
    assert outcome.matched is None
    assert outcome.ambiguous == []
