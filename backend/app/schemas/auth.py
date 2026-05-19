"""
Pydantic v2 схемы аутентификации.
"""
from pydantic import BaseModel, Field
from typing import Optional


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenPayload(BaseModel):
    """JWT payload — sub=user_id, role=роль, exp=время истечения."""
    sub: str
    role: str
    exp: int


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class DemoUserCredentials(BaseModel):
    username: str
    password: str
    role: str