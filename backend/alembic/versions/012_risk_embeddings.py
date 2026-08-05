"""Risk base semantic embeddings via pgvector (T-20)

Включает расширение pgvector и добавляет колонку risk_base.embedding (Vector(256)) под
семантический поиск базы рисков по косинусной близости. Эмбеддинг считается лексическим
провайдером (app.modules.risk.embeddings) при создании/правке/импорте карточки; бэкфилл
существующих строк — POST /risks/reembed. NB: в рабочем стеке схема создаётся через create_all
на старте (расширение — в conftest/скрипте инициализации); миграция держит alembic-историю
консистентной и включает расширение в проде.

Revision ID: 012
Revises: 011
Create Date: 2026-08-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None

EMBED_DIM = 256


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("risk_base", sa.Column("embedding", Vector(EMBED_DIM), nullable=True))


def downgrade() -> None:
    op.drop_column("risk_base", "embedding")
    # Расширение vector не удаляем: его могут использовать другие объекты/окружения.
