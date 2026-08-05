"""Семантический поиск базы рисков через pgvector (T-20).

Два уровня:
  • провайдер эмбеддингов (без БД) — детерминизм, размерность/нормировка, устойчивость к
    русской морфологии и ё/е, нулевой вектор для пустого запроса;
  • поиск по БД (db_session, pgvector) — семантически близкая карточка выше, честный откат на
    ILIKE при отсутствии эмбеддингов, бэкфилл reembed_all.

Провайдер — лексический (выбор заказчика): без ML-зависимостей и без обращения к LLM-контуру.
"""
import uuid

from app.modules.risk import service
from app.modules.risk.embeddings import EMBED_DIM, embed_text
from app.modules.risk.models import RiskBase


def _dot(a: list[float], b: list[float]) -> float:
    """Скалярное произведение — для L2-нормированных векторов равно косинусной близости."""
    return sum(x * y for x, y in zip(a, b))


# ─── провайдер эмбеддингов (без БД) ───

def test_embedding_is_deterministic_normalized_and_sized():
    v1 = embed_text("Низкая надёжность: частые отказы после релиза")
    v2 = embed_text("Низкая надёжность: частые отказы после релиза")
    assert v1 == v2                                   # детерминизм (hashlib, не salted hash())
    assert len(v1) == EMBED_DIM
    assert abs(sum(x * x for x in v1) ** 0.5 - 1.0) < 1e-9   # L2-нормирован


def test_embedding_empty_query_is_zero_vector():
    assert not any(embed_text("   ...  "))            # пустой/пунктуация → нулевой вектор
    assert not any(embed_text(""))


def test_embedding_is_yo_ye_invariant():
    # ё и е дают один вектор — источники (база рисков / оценка) исторически расходятся.
    assert embed_text("надёжность") == embed_text("надежность")


def test_embedding_robust_to_russian_morphology():
    base = embed_text("надёжность")
    same_lemma = _dot(base, embed_text("надежности"))      # другая словоформа той же леммы
    unrelated = _dot(base, embed_text("защищённость"))     # другая характеристика
    # Словоформы одной леммы ближе, чем несвязанное слово (символьные n-граммы ловят морфологию).
    assert same_lemma > unrelated
    assert same_lemma > 0.5


# ─── поиск по БД (pgvector) ───

def _risk(code: str, title: str, category: str, description: str, *, embed: bool = True,
          keywords: str | None = None) -> RiskBase:
    r = RiskBase(id=uuid.uuid4(), code=code, title=title, category=category,
                 description=description, characteristic=category, keywords=keywords)
    if embed:
        r.embedding = service.embed_risk(r)
    return r


async def test_semantic_search_ranks_by_meaning(db_session):
    db_session.add_all([
        _risk("R-REL", "Низкая надёжность ИС", "Надёжность",
              "Частые отказы и сбои после релизов, растёт время восстановления MTTR"),
        _risk("R-SEC", "Слабый контроль доступа", "Защищённость",
              "Недостатки аутентификации и аудита событий безопасности"),
        _risk("R-PERF", "Деградация производительности", "Производительность",
              "Рост времени отклика под нагрузкой, узкие места в запросах"),
    ])
    await db_session.flush()

    # Запрос про отказы/надёжность — ближайшей должна быть карточка надёжности, не ИБ/перф.
    hits = await service.semantic_search_risks(db_session, "частые отказы и сбои надёжности", limit=3)
    assert hits and hits[0].code == "R-REL"
    assert {h.code for h in hits} == {"R-REL", "R-SEC", "R-PERF"}   # все активны — вернулись все


async def test_semantic_search_matches_paraphrase_without_shared_word(db_session):
    # Морфология: карточка «надёжности», запрос «надежность» (иная форма, без ё) — всё равно матч.
    db_session.add(_risk("R-REL", "Проблемы надёжности", "Надёжность",
                         "Система нестабильна, наблюдаются отказы"))
    db_session.add(_risk("R-USE", "Неудобный интерфейс", "Удобство использования",
                         "Сложные сценарии, много кликов"))
    await db_session.flush()

    hits = await service.semantic_search_risks(db_session, "надежность системы", limit=1)
    assert hits[0].code == "R-REL"


async def test_semantic_search_falls_back_to_ilike_when_no_embeddings(db_session):
    # Эмбеддинги ещё не проставлены (переходное состояние) → откат на лексический search_risks.
    db_session.add(_risk("R-REL", "Низкая надёжность", "Надёжность",
                         "Частые отказы после релиза", embed=False))
    await db_session.flush()

    hits = await service.semantic_search_risks(db_session, "отказы", limit=5)
    assert [h.code for h in hits] == ["R-REL"]           # найдено через ILIKE, без вектора


async def test_reembed_backfills_missing_vectors(db_session):
    db_session.add_all([
        _risk("R-1", "Риск один", "Надёжность", "описание отказов", embed=False),
        _risk("R-2", "Риск два", "Защищённость", "описание доступа", embed=False),
    ])
    await db_session.flush()

    filled = await service.reembed_all(db_session, only_missing=True)
    assert filled == 2
    # После бэкфилла семантический путь активен (не откат): по «отказы» первым — R-1.
    hits = await service.semantic_search_risks(db_session, "отказы надёжности", limit=2)
    assert hits[0].code == "R-1"
