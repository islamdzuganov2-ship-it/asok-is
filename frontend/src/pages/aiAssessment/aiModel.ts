/**
 * aiModel.ts — контракт оценки СИИ по ГОСТ Р 59898-2021 и схемы ввода метрик.
 *
 * Зеркало ответа /ai-assessments/ai-model и METRIC_KINDS бэкенда
 * (modules/quality/ai_quality_model.py): какие входы нужны каждому виду метрики и как они
 * подписаны в форме. Вынесено из AiAssessmentPage — контракт и подписи полей к React отношения
 * не имеют, а страницу раздували.
 *
 * Массивы (y, ŷ, релевантности, пиксели) вводятся текстом в CSV и парсятся перед отправкой:
 * форма на 200 числовых полей была бы непригодна для ручного ввода.
 */
// --- Типы модели 59898 (зеркало ответа /ai-assessments/ai-model) ---
export interface AiSub { name: string; metric_kind: string; inputs_schema: string[]; is_ai_specific: boolean; hint: string }
export interface AiChar { title: string; subs: AiSub[] }
export interface AiGroup { group: string; characteristics: AiChar[] }

export interface AiValue {
  id: string; group_name: string; characteristic: string; subcharacteristic: string;
  metric_kind: string; inputs: Record<string, number> | null;
  baseline: number | null; tol_low: number | null; tol_high: number | null;
  raw_value: number | null; normalized_x: number | null; conformant: boolean | null;
  unmeasurable: boolean; expert_comment: string | null; is_ai_specific: boolean;
}
export interface AiPeriod { id: string; system_id: string; system_name?: string; period: string; status: string }
export interface CalcOut { q: number | null; level: string; characteristics: Array<{ title: string; score: number }>; weighted?: boolean }
export interface ConfRow {
  characteristic: string; subcharacteristic: string; metric_kind: string;
  raw_value: number | null; baseline: number | null; tol_low: number | null; tol_high: number | null;
  normalized_x: number | null; verdict: string;
}
export interface ConfReport { q: number | null; level: string; rows: ConfRow[]; conformant_count: number; nonconformant_count: number; no_baseline_count: number }

export interface SystemLite { id: string; name: string; code?: string; system_kind?: string }

export const INPUT_LABEL: Record<string, string> = {
  A: 'A (факт)', B: 'B (база)', TP: 'TP', TN: 'TN', FP: 'FP', FN: 'FN', score: 'Оценка 0–100',
  y: 'y — фактические значения (CSV)', y_hat: 'ŷ — предсказания (CSV)',
  rel: 'Релевантности по порядку выдачи (CSV)', curve: 'Точки кривой: x,y; x,y; …',
  I: 'I — эталонное изображение (пиксели CSV)', I_hat: 'Î — реконструкция (пиксели CSV)',
  max_i: 'MAX (динамический диапазон, напр. 255)',
};
// Поля-массивы вводятся текстом (CSV) и парсятся перед отправкой; curve — парами «x,y; x,y».
export const ARRAY_FIELDS = new Set(['y', 'y_hat', 'rel', 'I', 'I_hat']);
export const CURVE_FIELDS = new Set(['curve']);
export const parseCsv = (s: string): number[] => s.replace(/;/g, ',').split(',').map((p) => p.trim()).filter(Boolean).map(Number);
export const parseCurve = (s: string): number[][] => s.split(';').map((pair) => pair.trim()).filter(Boolean)
  .map((pair) => pair.split(',').map((p) => Number(p.trim())));
export const VERDICT_TAG: Record<string, string> = {
  'В допуске': 'green', 'Вне допуска': 'red', 'Эталон не задан': 'default',
  'Невозможно измерить': 'default', 'Не рассчитано': 'orange',
};

// Зеркало METRIC_KINDS бэкенда (modules/quality/ai_quality_model.py) для переопределения вида метрики.
export const KIND_SCHEMAS: Record<string, string[]> = {
  RATIO_DIRECT: ['A', 'B'], RATIO_INVERSE: ['A', 'B'],
  ACCURACY: ['TP', 'TN', 'FP', 'FN'], PRECISION: ['TP', 'FP'], RECALL: ['TP', 'FN'],
  SPECIFICITY: ['TN', 'FP'], F1: ['TP', 'FP', 'FN'], EXPERT_SCALE: ['score'],
  MSE: ['y', 'y_hat'], MAE: ['y', 'y_hat'], AUC_ROC: ['curve'], AUC_PRC: ['curve'],
  NDCG: ['rel'], PSNR: ['I', 'I_hat', 'max_i'], SSIM: ['I', 'I_hat'],
};
