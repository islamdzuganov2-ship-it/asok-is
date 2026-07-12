"""
train_lora.py — дообучение (LoRA/QLoRA) встроенной LLM АСОК ИС под стиль банковских
управленческих заключений на корпусе профессиональных суждений.

Требует GPU (или Apple Silicon) и зависимостей: transformers, peft, trl, datasets, bitsandbytes,
accelerate. НЕ запускается на проде-стенде (CPU) — это отдельный шаг цикла обучения (см. docs/LLM_TRAINING.md).

Вход:  models/llm_brain/judgments_sft.jsonl («резервный мозг», см. app/scripts/export_llm_dataset.py)
Выход: models/llm/lora-adapter/ (адаптер) → далее merge + convert + quantize в GGUF.

Базовую модель (--base) берите ту же, что заложена в GGUF (система модель-агностична: LoRA
дообучается на конкретной базе; для другой базовой модели дообучение повторяют на её корпусе).

Запуск:  python backend/llm/train_lora.py --base Qwen/Qwen2.5-1.5B-Instruct --data models/llm_brain/judgments_sft.jsonl
"""
from __future__ import annotations

import argparse


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--data", default="models/llm_brain/judgments_sft.jsonl")
    ap.add_argument("--out", default="models/llm/lora-adapter")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    args = ap.parse_args()

    import torch
    from datasets import load_dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # 4-bit QLoRA — умещается на одну потребительскую GPU (>=8 ГБ VRAM).
    bnb = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(args.base, quantization_config=bnb, device_map="auto")

    def to_chat(ex: dict) -> dict:
        messages = [
            {"role": "system", "content": ex["system"]},
            {"role": "user", "content": ex["instruction"]},
            {"role": "assistant", "content": ex["output"]},
        ]
        return {"text": tok.apply_chat_template(messages, tokenize=False)}

    ds = load_dataset("json", data_files=args.data, split="train").map(to_chat)

    peft_cfg = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    cfg = SFTConfig(
        output_dir=args.out, num_train_epochs=args.epochs, learning_rate=args.lr,
        per_device_train_batch_size=2, gradient_accumulation_steps=4,
        logging_steps=5, save_strategy="epoch", bf16=True, max_seq_length=2048,
        packing=False, dataset_text_field="text",
    )
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds, peft_config=peft_cfg)
    trainer.train()
    trainer.save_model(args.out)
    print(f"LoRA-адаптер сохранён: {args.out}")


if __name__ == "__main__":
    main()
