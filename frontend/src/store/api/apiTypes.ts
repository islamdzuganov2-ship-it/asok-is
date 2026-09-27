/**
 * apiTypes.ts — контракты ответов/запросов REST API, вынесенные из apiSlice.ts (потолок размера
 * модуля, check-size.mjs). apiSlice реэкспортирует всё отсюда — потребители по-прежнему
 * импортируют типы из apiSlice, публичный контракт не меняется.
 */
export interface ProblematicSystem {
    id: string;
    name: string;
    criticality: string;
    lowMetricsCount: number;
}

export interface DashboardData {
    globalHealthScore: number;
    aiInsights: string;
    heatmapData: Array<[number, number, number]>;
    xAxisLabels: string[];
    yAxisLabels: string[];
    problematicSystems: ProblematicSystem[];
}

export interface SystemItem {
    id: string;
    name: string;
    code?: string;
    status_lc: string;
    criticality_class: string;
    /** CLASSIC → контур ISO 25010; AI → контур ГОСТ Р 59898-2021 (BL-001). */
    system_kind?: 'CLASSIC' | 'AI';
    is_active: boolean;
}

export interface SystemCreateDto {
    name: string;
    code?: string;
    status_lc: string;
    criticality_class: string;
    system_kind?: 'CLASSIC' | 'AI';
    owner?: string;
    is_active: boolean;
}

export interface SystemsListResponse {
    items: SystemItem[];
    total: number;
    page: number;
    limit: number;
}

export interface SubcharWeightOut {
    characteristic: string;
    subcharacteristic: string;
    weight: number;
    isoKey: string;
}

export interface QualityWeightsOut {
    activeVersionId: string | null;
    activeVersionLabel: string | null;
    totalWeight: number;
    subcharWeights: SubcharWeightOut[];
    criticalityWeights: Record<string, number>;
}

export interface PeriodCreateDto {
    system_id: string;
    period: string;
}

export interface PeriodDto {
    id: string;
    system_id: string;
    period: string;
    status: string;
    created_at: string;
    updated_at: string;
}

export interface PeriodListParams {
    system_id?: string;
}

export interface ExpertJudgmentDto {
    metricId: string;
    calculatedLevel: string;
    adjustedLevel?: string;
    justificationText: string;
    linkedRiskTask?: string;
}

export interface EditableMetric {
    id: string;
    name: string;
    characteristic?: string;
    subcharacteristic?: string;
    metric_id?: number | null;
    description: string;
    val_a: number | null;
    val_b: number | null;
    expert_comment: string;
    unmeasurable?: boolean;
    calculatedX?: number | null;
    qualityLevel?: string | null;
}

/** Тело добавления оценки для одной пары (характеристика × подхарактеристика). */
export interface ValueAddDto {
    characteristic: string;
    subcharacteristic: string;
    formula_type?: 'DIRECT' | 'INVERSE';
    val_a: number | null;
    val_b: number | null;
    expert_comment?: string;
    /** «Невозможно измерить»: нет возможности собрать данные (комментарий обязателен). */
    unmeasurable?: boolean;
    /** Подтверждающий артефакт (ссылка/файл/№ тикета). */
    artifact_links?: string;
}

/** Профессиональное суждение по подхарактеристике (задача менеджера по качеству, НЕ мера). */
export interface JudgmentItem {
    id?: string;
    characteristic: string;
    subcharacteristic: string;
    judgment_text: string;
    author?: string;
}

export interface JudgmentsStatus {
    period_id: string;
    filled: number;
    total: number;
    complete: boolean;
    items: JudgmentItem[];
}

export interface JudgmentConclusion {
    period_id: string;
    system_name: string;
    judgments_count: number;
    conclusion: string;
    mapped_risks: Array<{ title: string; characteristic?: string; mitigation?: string }>;
    llm: boolean;
    confidence?: string;
    fingerprint?: string;
    fired_rules?: string[];          // сработавшие правила движка (Rule Engine → LLM)
    reasoning?: { stages?: Array<{ code: string; title: string; content: string; used_llm?: boolean; fell_back?: boolean }> } | null;
}

/** Метрика оценки, по которой НЕ внесено профессиональное суждение (T-48). */
export interface PendingJudgment {
    period_id: string;
    system_id: string;
    system_name: string;
    period: string;
    characteristic: string;
    subcharacteristic: string;
    /** Балл подхарактеристики, %; -1 — «Невозможно измерить». */
    score_pct: number;
    quality_level?: string | null;
    expert_comment?: string | null;
}

/** Сводка по периоду оценки: полнота заполнения подхарактеристик модели. */
export interface PeriodSummary {
    id: string;
    system_id: string;
    system_name: string;
    period: string;
    status: string;
    filled: number;
    total: number;
    complete: boolean;
}

export interface CalculatedMetric {
    id: string;
    name: string;
    calculatedX: number;
    systemLevel: string;
    adjustedLevel?: string;
    expertComment?: string;
}

export interface MetricCreateDto {
    characteristic: string;
    subcharacteristic: string;
    formula_type: 'DIRECT' | 'INVERSE';
    description?: string;
    data_source?: string;
    is_active: boolean;
}

export interface ExcelImportResult {
    filename: string;
    period_id: string;
    imported: number;
    skipped: number;
    errors: string[];
    sheets: Array<{ name: string; imported: number; skipped: number }>;
}

// ─── Аналитика техсбоев (T-21) ───
export interface TechIncidentDto {
    id: string;
    systemName: string;
    category: string;
    severity: string;
    title: string;
    description?: string;
    rootCause?: string;
    releaseRef?: string;
    // T-36/T-37/T-42: обязательные поля разбора + пользовательская первопричина + связь с мерой.
    admissionCause?: string;
    responsibleUnit?: string;
    preventiveMeasures?: string;
    categoryCustom?: string;
    linkedMeasureId?: string | null;
    occurredAt: string;
    resolvedAt?: string | null;
    source: string;
    createdBy?: string;
    // RE-07: стоимость единичной реализации (C_ТС), считает движок econ.
    costTotal?: number | null;
}
export interface IncidentCategoryOption { code: string; label: string }
export interface IncidentCategoriesDto { base: IncidentCategoryOption[]; custom: string[] }
export interface IncidentImportResultDto { created: number; skipped: number; errors: string[] }
export interface IncidentCategoryStat {
    category: string;
    count: number;
    share: number;
    openCount: number;
    avgMttrHours: number | null;
}
export interface IncidentSystemStat {
    systemName: string;
    count: number;
    openCount: number;
}
/** Фактическая результативность меры (ДЕФ-32): ΔScore характеристики «до/после». */
export interface MeasureEffect {
    characteristic: string;
    title: string;
    status: string;
    periodBefore: string;
    periodAfter: string;
    scoreBefore: number;
    scoreAfter: number;
    delta: number;
    verdict: 'улучшение' | 'без изменений' | 'ухудшение';
}

export interface IncidentAnalytics {
    total: number;
    openCount: number;
    resolvedCount: number;
    avgMttrHours: number | null;
    /** Тайминги устранения (ДЕФ-31, БТ-272); поля могут быть null — «не измеряли». */
    ttr?: {
        avgReactionMin: number | null;
        avgResolutionMin: number | null;
        avgTargetMin: number | null;
        avgRootCauseLagHours: number | null;
        rootCauseFixedCount: number;
        measuredCount: number;
    };
    releaseInducedShare: number;
    byCategory: IncidentCategoryStat[];
    topSystems: IncidentSystemStat[];
}
export interface IncidentCreateDto {
    systemName: string;
    category: string;
    severity: string;
    title: string;
    description?: string;
    rootCause?: string;
    releaseRef?: string;
    admissionCause?: string;
    responsibleUnit?: string;
    preventiveMeasures?: string;
    categoryCustom?: string;
    linkedMeasureId?: string | null;
    occurredAt: string;
    resolvedAt?: string | null;
}

// ─── Риск-триггеры (T-16): проактивные риски по текущему состоянию ───
export interface TriggeredRisk {
    id: string;
    code: string;
    title: string;
    category: string;
    characteristic?: string | null;
    severity: string;
    likelihood: string;
    consequence?: string | null;
    mitigation?: string | null;
    triggered_by: string;   // «техсбои: инфраструктура (3), сеть (1)» / «просевшая характеристика»
}

// ─── Динамика качества ИС по периодам (T-15/T-12) ───
export interface DynamicsPoint {
    period: string;
    integral: number;                        // интегральный показатель за период, %
    characteristics: Record<string, number>; // характеристика → средний %
}
export interface MeasureMarker {
    characteristic: string;
    createdAt: string;
    title: string;
    status: string;
}
export interface SystemDynamics {
    systemId: string;
    systemName: string;
    points: DynamicsPoint[];
    measures: MeasureMarker[];
}

// ─── RBAC / администрирование (BL-008) ───
export interface MyPermissions { role: string; permissions: string[] }
export interface AdminUser {
    id: string;
    username: string;
    email?: string | null;
    full_name?: string | null;
    role: string;
    is_active: boolean;
    must_change_password?: boolean;   // ИБ-11: временный пароль ещё не сменён
}
export interface UserCreateDto {
    username: string; password: string; email?: string; full_name?: string; role: string;
}
export interface UserUpdateDto { full_name?: string; role?: string; is_active?: boolean }
export interface PermissionDef { key: string; group: string; label: string; description: string }
export interface PermissionCatalog { groups: string[]; permissions: PermissionDef[]; roles: string[] }
export type PermissionMatrix = Record<string, string[]>;
export interface MandatorySectionsOut { permissions: string[] }

/** Событие журнала ИБ (ИБ-08, `GET /iam/audit-log`, только SUPER_ADMIN). */
export interface AuditEvent {
    id: string;
    created_at: string;
    user_id: string | null;
    username: string | null;
    action: string;
    outcome: string | null;
    entity_type: string | null;
    entity_id: string | null;
    entity_key: string | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
    request_id: string | null;
}
import type { MoneyCell } from '../../dashboards/cockpit/lensMath';
export type { MoneyCell };

/**
 * Статус встроенной LLM + признак демо-данных бэкенда (`GET /reports/llm-status`).
 * `demo_data` (КП-43, ТЗ-21 §9.1) — бэкенд запущен в DEMO_MODE, т.е. БД наполнена демо-набором.
 * Плитки кокпита всегда читают бэкенд, поэтому честная плашка «Демонстрационные данные» над ними
 * опирается на этот признак, а не на клиентский тумблер «Демо/LLM».
 */
export interface LlmStatusOut {
    enabled?: boolean;
    available: boolean;
    loading?: boolean;
    demo_data?: boolean;
    profile?: { name?: string; file_name?: string; architecture?: string; n_gpu_layers?: number } | null;
}

// Персональные настройки пользователя — форма поля в ./preferencesTypes.
import type { UserPrefs, PreferencesResponse } from './preferencesTypes';

export type {
    WidgetPref, CardLayoutPref, DashboardPrefs, UserPrefs, PreferencesResponse,
} from './preferencesTypes';

// Самооценка LLM по ISO/IEC 25010 (ТЗ v18 п.10) — контракт в ./llmQualityTypes.
import type { LlmQualityResponse, LlmQualityRunResponse } from './llmQualityTypes';

export type {
    LlmSubcheck, LlmCharacteristicCheck, LlmModelProfile, LlmQualityReport,
    LlmQualityHistoryRow, LlmQualityResponse, LlmQualityRunResponse,
} from './llmQualityTypes';
export interface LlmPipelineSource {
    code: string; title: string; mechanism: string; storage: string;
    feeds: string[]; level: string; level_title: string; state: string;
    module: string; note: string;
}
export interface LlmPipelineResponse {
    levels: { code: string; title: string; weights_change: boolean; runtime: boolean; description: string }[];
    sources: LlmPipelineSource[];
    active_count: number;
    continuous_finetuning: boolean;
    rag_mechanism: string;
    personas: { code: string; title: string; audience: string; roles: string[]; why_depth: number }[];
}
