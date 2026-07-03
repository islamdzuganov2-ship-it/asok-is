# АСОК ИС — полный цикл обучения встроенной LLM (инструкция + код)

> Встроенная LLM (llama.cpp/GGUF, in-process) работает out-of-the-box. Этот документ описывает
> **полный цикл дообучения** под стиль банковских управленческих заключений и **самообучение**
> на накапливаемых профессиональных суждениях. Весь код — в репозитории.

## 0. Два уровня «обучения»
| Уровень | Что это | Когда | Код |
|---|---|---|---|
| **A. Поведение промптом** | системный промпт + few-shot + параметры (temperature 0.1) | всегда, без GPU | `backend/app/services/llm_service.py`, `backend/llm/Modelfile` |
| **B. Самообучение (RAG)** | суждения/выводы прошлых периодов передаются модели как контекст → каждый новый ввод обогащает заключение | онлайн, без GPU | `generate_judgment_conclusion(..., history_block=...)` + эндпоинт `/assessments/{id}/judgment-conclusion` |
| **C. Дообучение (LoRA/QLoRA)** | реальное дообучение весов на корпусе суждений | периодически, на GPU | `backend/llm/train_lora.py` |

Уровни A и B работают на текущем стенде (CPU). Уровень C — отдельный шаг на GPU.

## 1. Сбор данных (накопление «вводных»)
Система копит профессиональные суждения (`professional_judgments`) и связывает их с базой рисков.
Экспорт корпуса в SFT-датасет (JSONL, формат instruction/output):
```bash
docker compose exec backend python -m app.scripts.export_llm_dataset
# → backend/llm_dataset/judgments_sft.jsonl (растёт с каждым новым суждением)
```
Каждый пример: `{system, instruction (ИС+период+суждения+риски), output (grounded-заключение)}`.

## 2. Дообучение (QLoRA, GPU)
```bash
pip install "transformers>=4.44" peft trl datasets bitsandbytes accelerate
python backend/llm/train_lora.py \
    --base Qwen/Qwen2.5-1.5B-Instruct \
    --data backend/llm_dataset/judgments_sft.jsonl \
    --out models/llm/lora-adapter --epochs 3
```
Результат — LoRA-адаптер в `models/llm/lora-adapter/` (4-bit QLoRA, умещается на ~8 ГБ VRAM).

## 3. Слияние адаптера с базовой моделью
```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct")
merged = PeftModel.from_pretrained(base, "models/llm/lora-adapter").merge_and_unload()
merged.save_pretrained("models/llm/asok-merged")
AutoTokenizer.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct").save_pretrained("models/llm/asok-merged")
```

## 4. Конвертация в GGUF (llama.cpp)
```bash
git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp
python convert_hf_to_gguf.py ../models/llm/asok-merged --outfile ../models/llm/asok-model-f16.gguf
```

## 5. Квантизация в Q4_K_M
```bash
cmake -B build && cmake --build build --config Release -j
./build/bin/llama-quantize ../models/llm/asok-model-f16.gguf ../models/llm/asok-model.gguf Q4_K_M
```

## 6. Развёртывание в АСОК ИС
- Положить `asok-model.gguf` в `models/llm/` (примонтирован в контейнер).
- В `docker-compose.override.yml` указать `LOCAL_LLM_MODEL_FILE=asok-model.gguf` (или убрать override,
  если имя штатное). `docker compose up -d backend`.
- Проверка: `GET /api/v1/reports/llm-status` → `available:true`.

## 7. Проверка качества (eval) перед выкаткой
- Прогнать grounded-тесты: `docker compose exec backend python -m pytest tests/test_llm_service.py -q`.
- Ручной прогон эталонных кейсов (≥10): ответ на русском, содержит рекомендацию, **нет чисел вне входа**
  (grounding-проверка в `llm_service` заменит недостоверный ответ честным fallback).
- Замер времени отклика на CPU (цель: ≤ 5 c для 1.5B).

## 8. Периодичность (цикл самообучения)
```
Новые суждения (каждый период) → export_llm_dataset → корпус растёт
   ├─ Онлайн: RAG (history_block) — сразу учитывается в заключениях (уровень B)
   └─ Оффлайн (раз в квартал/по объёму): train_lora → merge → GGUF → выкатка (уровень C)
```
Grounding-контроль (temperature 0.1 + пост-проверка процентов) сохраняется на всех уровнях —
дообучение меняет стиль, но не отменяет запрет на выдуманные числа.

## Файлы
- `backend/app/scripts/export_llm_dataset.py` — экспорт корпуса.
- `backend/llm/train_lora.py` — QLoRA-дообучение.
- `backend/llm/Modelfile` — сборка через Ollama.
- `backend/app/services/llm_service.py` — инференс, grounding, `generate_judgment_conclusion` (RAG-самообучение).
- Связано: `docs/LLM_SETUP.md`, `docs/ТЗ_LLM_MVP_v10.md`.
