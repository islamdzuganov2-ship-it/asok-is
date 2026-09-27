"""
Парольная политика (ИБ-11, docs/BACKLOG_ИБ.md; ГОСТ Р 57580.1 ИАФ, приказ ФСТЭК № 17).

Требования к паролю, который задаёт человек (администратор при создании/сбросе или сам
пользователь при смене):
  · не короче 12 символов;
  · символы минимум трёх групп из четырёх: строчные, прописные, цифры, спецсимволы;
  · не содержит логин;
  · не сводится к распространённому слову или клавиатурной последовательности, даже с
    «украшениями» (Password2026!, Qwerty123456, P@ssw0rd-1234 отклоняются);
  · не совпадает ни с одним из 5 последних паролей пользователя.

Пароль, заданный администратором, временный: при первом входе пользователь обязан его сменить
(User.must_change_password, auth_service.change_password). Существующие пароли политика не
трогает — она применяется в момент задания пароля.
"""
from __future__ import annotations

from typing import Iterable

from app.modules.iam.security import verify_password

MIN_LENGTH = 12
MAX_LENGTH = 128
MIN_CLASSES = 3
HISTORY_DEPTH = 5

RULES = (
    f"не короче {MIN_LENGTH} символов",
    "символы минимум трёх групп из четырёх: строчные буквы, прописные буквы, цифры, спецсимволы",
    "не содержит логин",
    "не основан на распространённом слове или клавиатурной последовательности",
    f"не совпадает ни с одним из {HISTORY_DEPTH} последних паролей",
)

# Базовые слова частых паролей и клавиатурные последовательности (латиница, кириллица и
# «русские слова в английской раскладке»). Сравнение — после приведения регистра и leetspeak,
# без цифр и спецсимволов: так ловится весь класс «слово + год + восклицательный знак».
_COMMON_WORDS = frozenset({
    "password", "passwd", "pass", "parol", "gfhjkm", "пароль", "admin", "administrator", "root",
    "user", "login", "welcome", "letmein", "master", "secret", "default", "changeme", "test",
    "guest", "qwerty", "qwertyuiop", "asdf", "asdfgh", "asdfghjkl", "zxcv", "zxcvbn", "zxcvbnm",
    "qazwsx", "йцукен", "фыва", "фывапролджэ", "ячсмит", "abcd", "abcdef", "abcdefgh", "iloveyou",
    "love", "monkey", "dragon", "sunshine", "princess", "football", "baseball", "superman",
    "batman", "shadow", "michael", "hello", "trustno", "starwars", "whatever", "freedom",
    "summer", "winter", "spring", "autumn", "лето", "зима", "весна", "осень", "привет", "любовь",
    "company", "bank", "банк", "asok", "асок", "system", "система", "manager", "analyst",
    "office", "moscow", "москва", "russia", "россия",
})
_LEET = str.maketrans({"@": "a", "4": "a", "0": "o", "1": "i", "!": "i", "3": "e", "$": "s",
                       "5": "s", "7": "t", "+": "t", "8": "b", "9": "g"})
_MIN_OWN_LETTERS = 4


def _classes(password: str) -> int:
    groups = (
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    )
    return sum(groups)


def _own_letters(text: str, words: list[str]) -> int:
    letters = "".join(c for c in text if c.isalpha())
    for word in words:
        letters = letters.replace(word, "")
    return len(letters)


def _is_dictionary_based(password: str, username: str | None) -> bool:
    """После снятия частых слов (и логина) в пароле остаётся меньше 4 «своих» букв.

    Считается дважды: по буквам как есть (цифры и символы — не буквы: «Aa!123456789012»
    отклоняется) и после разбора leetspeak (P@ssw0rd → password: «P@ssw0rd-1234» отклоняется).
    """
    words = set(_COMMON_WORDS)
    if username and len(username) >= 3:
        words.add(username.lower())
    # Длинные слова снимаются первыми: «qwertyuiop» целиком, а не «qwerty» + остаток.
    ordered = sorted(words, key=len, reverse=True)
    lowered = password.lower()
    return min(_own_letters(lowered, ordered), _own_letters(lowered.translate(_LEET), ordered)) < _MIN_OWN_LETTERS


def violations(password: str, username: str | None = None) -> list[str]:
    """Нарушенные правила (формулировки из RULES); пустой список — пароль допустим."""
    found: list[str] = []
    if len(password) < MIN_LENGTH:
        found.append(RULES[0])
    if len(password) > MAX_LENGTH:
        found.append(f"не длиннее {MAX_LENGTH} символов")
    if _classes(password) < MIN_CLASSES:
        found.append(RULES[1])
    if username and len(username) >= 3 and username.lower() in password.lower():
        found.append(RULES[2])
    elif _is_dictionary_based(password, username):
        found.append(RULES[3])
    return found


def is_reused(password: str, hashes: Iterable[str]) -> bool:
    """Пароль совпадает с одним из сохранённых bcrypt-хэшей (действующий + история)."""
    return any(h and verify_password(password, h) for h in hashes)


def previous_hashes(current_hash: str | None, history: list[str] | None) -> list[str]:
    """С чем сравнивать новый пароль: действующий хэш и история, без повторов."""
    out = [current_hash] if current_hash else []
    return out + [h for h in (history or []) if h and h not in out]


def push_history(history: list[str] | None, new_hash: str) -> list[str]:
    """История хэшей для следующей проверки: новый пароль + предыдущие, всего HISTORY_DEPTH."""
    return ([new_hash] + [h for h in (history or []) if h != new_hash])[:HISTORY_DEPTH]


class PasswordPolicyError(ValueError):
    def __init__(self, broken: list[str]):
        self.violations = broken
        super().__init__("Пароль не соответствует политике: " + "; ".join(broken))


def ensure_acceptable(password: str, username: str | None, previous_hashes: Iterable[str] = ()) -> None:
    """Проверка перед сохранением пароля; нарушение — PasswordPolicyError со списком правил."""
    broken = violations(password, username)
    if not broken and is_reused(password, previous_hashes):
        broken = [RULES[4]]
    if broken:
        raise PasswordPolicyError(broken)
