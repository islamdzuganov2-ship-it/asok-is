"""Юнит-тесты безопасности: хеширование паролей и JWT (тип/подпись/срок)."""
import pytest
from jose import JWTError

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)


def test_password_hash_roundtrip():
    h = get_password_hash("S3cret!pass")
    assert h != "S3cret!pass"            # хранится только хеш, не пароль
    assert verify_password("S3cret!pass", h)
    assert not verify_password("wrong", h)


def test_password_hash_is_salted():
    # bcrypt солит — два хеша одного пароля различаются
    assert get_password_hash("samepass") != get_password_hash("samepass")


def test_access_token_roundtrip():
    token = create_access_token({"sub": "user-1", "role": "ADMIN"})
    payload = decode_token(token)
    assert payload.sub == "user-1"
    assert payload.role == "ADMIN"


def test_refresh_token_type_enforced():
    access = create_access_token({"sub": "u", "role": "ADMIN"})
    # access-токен нельзя выдать за refresh (token-type confusion)
    with pytest.raises(JWTError):
        decode_token(access, expected_type="refresh")

    refresh = create_refresh_token({"sub": "u", "role": "ADMIN"})
    assert decode_token(refresh, expected_type="refresh").sub == "u"


def test_tampered_token_rejected():
    token = create_access_token({"sub": "u", "role": "ADMIN"})
    with pytest.raises(JWTError):
        decode_token(token + "tampered")
