"""Юнит-тесты ролевых персон LLM (BL-009, ТЗ v18 п.8–9).

Критерии приёмки:
  1) каждой роли RBAC сопоставлена персона (ролевые контексты синхронизированы с каталогом ролей);
  2) правила честности физически ОДНИ И ТЕ ЖЕ у всех персон — их нельзя ослабить точечно;
  3) требуемые ТЗ персоны (топ-менеджер, менеджер качества, риск-менеджер) существуют
     и адресуют вывод по-разному;
  4) промпт персоны не содержит разметки конкретной модели (модель-агностичность);
  5) персона реально меняет поведение конвейера (линзы, глубина «почему», бюджет).
"""
import pytest

from app.modules.iam.models import User
from app.modules.llm import personas
from app.modules.llm.personas import BASE_HONESTY, PERSONAS, Persona, resolve
from app.modules.llm.prompts import reasoning_system_prompt


# ─── Критерий 1: синхронизация с каталогом ролей RBAC ────────────────────────────────

def test_every_rbac_role_has_persona():
    missing = [r for r in User.ALL_ROLES if r not in personas.ROLE_TO_PERSONA]
    assert not missing, f"роли без назначенной персоны: {missing}"


def test_persona_roles_reference_existing_rbac_roles():
    # Обратная сторона той же синхронизации: персона не должна ссылаться на несуществующую роль.
    for persona in PERSONAS.values():
        for role in persona.roles:
            assert role in User.ALL_ROLES, f"{persona.code} ссылается на неизвестную роль {role}"


def test_unknown_role_falls_back_to_default():
    assert resolve("").code == personas.DEFAULT_PERSONA_CODE
    assert resolve(None).code == personas.DEFAULT_PERSONA_CODE
    assert resolve("НЕТ_ТАКОЙ_РОЛИ").code == personas.DEFAULT_PERSONA_CODE


def test_role_lookup_is_case_insensitive():
    assert resolve("ceo").code == "TOP_MANAGER"


# ─── Критерий 2: общие правила честности у всех персон ───────────────────────────────

@pytest.mark.parametrize("code", sorted(PERSONAS))
def test_persona_inherits_honesty_rules(code: str):
    prompt = PERSONAS[code].system_prompt
    assert BASE_HONESTY in prompt, f"персона {code} не наследует общие правила честности"
    # Точечные признаки правил — на случай, если блок когда-нибудь переформулируют по частям.
    assert "данные отсутствуют" in prompt
    assert "Не придумывай" in prompt


# ─── Критерий 3: требуемые ТЗ персоны и различие адресации ───────────────────────────

@pytest.mark.parametrize("code", ["TOP_MANAGER", "QUALITY_MANAGER", "RISK_MANAGER"])
def test_required_personas_exist(code: str):
    assert code in PERSONAS


def test_role_to_persona_mapping_matches_tz():
    assert resolve(User.ROLE_CEO).code == "TOP_MANAGER"
    assert resolve(User.ROLE_CTO).code == "TOP_MANAGER"
    assert resolve(User.ROLE_MANAGER).code == "QUALITY_MANAGER"
    assert resolve(User.ROLE_RISK_MANAGER).code == "RISK_MANAGER"


def test_personas_address_different_audiences():
    prompts = {code: p.system_prompt for code, p in PERSONAS.items()}
    assert len(set(prompts.values())) == len(prompts), "промпты персон не различаются"
    assert "ТОП-МЕНЕДЖМЕНТ" in prompts["TOP_MANAGER"]
    assert "МЕНЕДЖЕР ПО КАЧЕСТВУ" in prompts["QUALITY_MANAGER"]
    assert "РИСК-МЕНЕДЖЕР" in prompts["RISK_MANAGER"]


def test_only_top_manager_applies_principles_checklist():
    # Чек-лист управленческих принципов адресован именно резюме для правления.
    applying = [c for c, p in PERSONAS.items() if p.apply_principles]
    assert applying == ["TOP_MANAGER"]


# ─── Критерий 4: модель-агностичность промпта ────────────────────────────────────────

_MODEL_MARKUP = ("<|im_start|>", "<|im_end|>", "[INST]", "<s>", "<start_of_turn>",
                 "### Instruction", "<|system|>", "<|user|>")


@pytest.mark.parametrize("code", sorted(PERSONAS))
def test_prompt_has_no_model_specific_markup(code: str):
    prompt = reasoning_system_prompt(PERSONAS[code])
    for token in _MODEL_MARKUP:
        assert token not in prompt, f"в промпте {code} разметка конкретной модели: {token}"


# ─── Критерий 5: персона меняет параметры конвейера ──────────────────────────────────

@pytest.mark.parametrize("code", sorted(PERSONAS))
def test_persona_declares_at_least_three_lenses(code: str):
    # BL-005 требует минимум 3 ролевые точки зрения; персона не вправе опустить планку.
    assert len(PERSONAS[code].lens_codes) >= 3


def test_top_manager_output_budget_is_the_tightest():
    top = PERSONAS["TOP_MANAGER"]
    assert all(top.max_tokens <= p.max_tokens for p in PERSONAS.values())
    # Руководителю — короткая цепочка причин до управляемого уровня.
    assert top.why_depth < PERSONAS["QUALITY_MANAGER"].why_depth


def test_catalog_exposes_every_persona():
    codes = {row["code"] for row in personas.catalog()}
    assert codes == set(PERSONAS)


def test_get_by_code_falls_back_to_default():
    assert personas.get("НЕТ").code == personas.DEFAULT_PERSONA_CODE
    assert isinstance(personas.get("TOP_MANAGER"), Persona)
