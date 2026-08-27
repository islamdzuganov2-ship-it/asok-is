/**
 * llmQualityTypes.ts — контракт самооценки LLM-подсистемы по ISO/IEC 25010 (ТЗ v18 п.10).
 *
 * score = null означает «невозможно измерить» — это ЧЕСТНЫЙ статус, а не отсутствие данных:
 * подхарактеристика либо неприменима к LLM-компоненту, либо требует инференса, который в данном
 * прогоне не выполнялся. В UI такие строки показываются отдельным статусом, а не нулём.
 */
export interface LlmSubcheck {
    subcharacteristic: string;
    what: string;
    status: 'measured' | 'not_measurable';
    score: number | null;
    evidence: string;
}
export interface LlmCharacteristicCheck {
    characteristic: string;
    score: number | null;
    measured: number;
    total: number;
    subcharacteristics: LlmSubcheck[];
}
export interface LlmModelProfile {
    file_name?: string; name?: string; architecture?: string; quant?: string;
    params?: string; size_mb?: number; n_ctx?: number; n_ctx_train?: number;
    n_gpu_layers?: number; has_chat_template?: boolean;
}
export interface LlmQualityReport {
    id: string;
    generated_at: string;
    duration_s: number;
    mode: 'full' | 'static';
    trigger: string;
    model: LlmModelProfile | null;
    model_available: boolean;
    integral: number | null;
    coverage: number;
    measured: number;
    total: number;
    characteristics: LlmCharacteristicCheck[];
    verdict: string;
    notes: string[];
}
export interface LlmQualityHistoryRow {
    id: string; generated_at: string; mode: string; trigger: string;
    integral: number | null; coverage: number; duration_s: number; model?: string;
}
export interface LlmQualityResponse {
    report: LlmQualityReport | null;
    history: LlmQualityHistoryRow[];
    schedule: string;
}
export interface LlmQualityRunResponse {
    status: 'QUEUED' | 'COMPLETED';
    mode: string;
    task_id?: string;
    report?: LlmQualityReport;
    hint?: string;
}
