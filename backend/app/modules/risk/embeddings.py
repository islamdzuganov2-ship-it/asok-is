"""
Провайдер эмбеддингов для семантического поиска базы рисков (T-20).

Заказчик выбрал ЛЕКСИЧЕСКИЙ провайдер: детерминированный хэш-эмбеддинг (нормализация русской
морфологии → словоформы + символьные n-граммы → hashing trick → L2-нормировка). Никаких тяжёлых
ML-зависимостей и НИКАКОГО обращения к LLM-контуру (который «хрупкий»): поиск работает офлайн,
детерминирован (тестируем в CI) и не нагружает память рядом с GGUF-моделью.

Движок спрятан за интерфейсом EmbeddingProvider — заменить лексику на реальную модель
(sentence-transformers / llama-cpp embeddings) можно БЕЗ изменения схемы БД и кода поиска:
достаточно вернуть другой провайдер из get_embedding_provider() с той же размерностью EMBED_DIM.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

# Размерность вектора. Совпадает с колонкой risk_base.embedding = Vector(EMBED_DIM).
# 256 достаточно для хэш-пространства базы знаний рисков (десятки-сотни записей) и дёшево.
EMBED_DIM = 256

_WORD_RE = re.compile(r"[a-zа-я0-9]+")


class EmbeddingProvider(Protocol):
    """Контракт провайдера: фиксированная размерность + текст → L2-нормированный вектор."""

    dim: int

    def embed(self, text: str) -> list[float]:
        ...


def _normalize(text: str) -> str:
    """ё→е, нижний регистр — снимает расхождение источников (как _norm_char в service)."""
    return (text or "").lower().replace("ё", "е")


def _features(text: str) -> list[tuple[str, float]]:
    """Текст → взвешенные признаки: словоформы (вес 1.0) + символьные 3-граммы внутри слова
    с границами (вес 0.5). N-граммы дают устойчивость к морфологии и опечаткам — словоформы
    «надежность / надежности / надежностью» делят почти все 3-граммы."""
    tokens = _WORD_RE.findall(_normalize(text))
    feats: list[tuple[str, float]] = []
    for tok in tokens:
        feats.append((f"w:{tok}", 1.0))
        marked = f"#{tok}#"
        for i in range(len(marked) - 2):
            feats.append((f"g:{marked[i:i + 3]}", 0.5))
    return feats


def _bucket_sign(feature: str) -> tuple[int, float]:
    """Hashing trick со знаком (снижает смещение от коллизий): бакет из хэша, знак — из отдельного
    бита. hashlib (не встроенный hash()) — чтобы вектор был стабилен между процессами и в тестах."""
    h = int(hashlib.md5(feature.encode("utf-8")).hexdigest(), 16)
    bucket = h % EMBED_DIM
    sign = 1.0 if (h // EMBED_DIM) % 2 == 0 else -1.0
    return bucket, sign


class LexicalEmbeddingProvider:
    """Детерминированный лексический эмбеддинг: bag-of-features + hashing trick + L2-нормировка."""

    dim = EMBED_DIM

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * EMBED_DIM
        for feature, weight in _features(text):
            bucket, sign = _bucket_sign(feature)
            vec[bucket] += sign * weight
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0.0:
            return vec  # пустой/бессловесный текст → нулевой вектор (осмысленно ничего не матчит)
        return [x / norm for x in vec]


_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    """Единственная точка выбора провайдера (шов под будущий апгрейд на реальную модель)."""
    global _provider
    if _provider is None:
        _provider = LexicalEmbeddingProvider()
    return _provider


def embed_text(text: str) -> list[float]:
    """Утилита: текст → вектор активного провайдера (симметрично для документа и запроса)."""
    return get_embedding_provider().embed(text)
