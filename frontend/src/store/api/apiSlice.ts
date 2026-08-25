/**
 * System Role: Senior Full-Stack Lead & Surgical Code Auditor
 * Execution Mode: MODE 1 (CODE GENERATION)
 * State: Fully validated syntax, no placeholders, no nesting issues.
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { RootState } from '../index';
import { logout } from '../slices/authSlice';
import { qs as qsCockpit } from '../../utils/apiFetch';
import type {
    CockpitBundle, CockpitBundleArgs, CockpitInsightArgs, CockpitInsightResult,
} from '../../dashboards/cockpit/apiTypes';

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
}
export interface UserCreateDto {
    username: string; password: string; email?: string; full_name?: string; role: string;
}
export interface UserUpdateDto { full_name?: string; role?: string; is_active?: boolean }
export interface PermissionDef { key: string; group: string; label: string; description: string }
export interface PermissionCatalog { groups: string[]; permissions: PermissionDef[]; roles: string[] }
export type PermissionMatrix = Record<string, string[]>;
export interface MandatorySectionsOut { permissions: string[] }

// Персональные настройки виджетов дашбордов (BL-008, Фаза 4).
export interface WidgetPref { id: string; enabled: boolean; order: number }
export interface DashboardPrefs { widgets: WidgetPref[] }
export interface UserPrefs { dashboards?: Record<string, DashboardPrefs>; [k: string]: unknown }
export interface PreferencesResponse { prefs: UserPrefs }

// ── Самооценка LLM по ISO/IEC 25010 (ТЗ v18 п.10) ──────────────────────────────────
// score = null означает «невозможно измерить» — это ЧЕСТНЫЙ статус, а не отсутствие данных:
// подхарактеристика либо неприменима к LLM-компоненту, либо требует инференса, который в
// данном прогоне не выполнялся. В UI такие строки показываются отдельным статусом.
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

const rawBaseQuery = fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1',
    prepareHeaders: (headers, { getState }) => {
        const token = (getState() as RootState).auth.token || localStorage.getItem('token');
        if (token) {
            headers.set('authorization', `Bearer ${token}`);
        }
        return headers;
    },
});

/**
 * 401 → выход и возврат на страницу входа.
 *
 * Пока обход аутентификации был зашит в DEMO_MODE (ДЕФ-02), бэкенд НИКОГДА не отвечал 401:
 * просроченный токен молча повышался до ADMIN, и отсутствие обработки на фронте не было
 * заметно. После разделения флагов истёкший токен даёт честный 401 — без этой обработки
 * дашборд «замирал» бы и продолжал опрашивать API по кругу вместо релогина.
 *
 * Refresh-токен на клиенте не хранится (в localStorage кладётся только access), поэтому
 * молчаливое продление невозможно — корректный сценарий именно выход.
 */
const baseQueryWithAuthGuard: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> =
    async (args, api, extraOptions) => {
        const result = await rawBaseQuery(args, api, extraOptions);
        if (result.error && result.error.status === 401) {
            const state = api.getState() as RootState;
            if (state.auth.isAuthenticated) {
                api.dispatch(logout());
            }
        }
        return result;
    };

export const apiSlice = createApi({
    reducerPath: 'api',
    baseQuery: baseQueryWithAuthGuard,
    // Авто-освежение кэша без ручного F5 (жалоба «нет автоматического сброса кэша»):
    //  · refetchOnFocus — вернулись во вкладку → данные перезапрашиваются;
    //  · refetchOnReconnect — восстановилась сеть → перезапрос;
    //  · refetchOnMountOrArgChange:30 — при переходе на страницу данные старше 30с обновляются
    //    (иначе RTK Query отдаёт кэш и дашборд показывает устаревшие цифры до перезагрузки).
    // Включатели событий focus/reconnect уже поднимаются setupListeners (store/index.ts).
    refetchOnFocus: true,
    refetchOnReconnect: true,
    refetchOnMountOrArgChange: 30,
    tagTypes: ['Assessment', 'Dashboard', 'Metrics', 'Systems', 'Incidents', 'Users', 'Permissions', 'MyPermissions', 'Preferences', 'LlmQuality'],
    endpoints: (builder) => ({
        getExecutiveDashboard: builder.query<DashboardData, void>({
            query: () => '/reports/executive-dashboard',
            providesTags: ['Dashboard'],
        }),
        // ТЗ v21 §10.5 (КП-41): один запрос вместо пяти-шести — RTK Query дедуплицирует
        // одинаковые аргументы САМ (несколько плиток кокпита вызывают этот хук с одним и тем же
        // разрезом и получают ОДИН сетевой запрос), поэтому CockpitTile.useValue не меняется —
        // каждая плитка просто читает свой ломтик уже загруженного бандла.
        getCockpitBundle: builder.query<CockpitBundle, CockpitBundleArgs>({
            query: ({ role, systemId, criticality, characteristic }) =>
                `/reports/cockpit${qsCockpit({ role, system_id: systemId, criticality, characteristic })}`,
            providesTags: ['Dashboard'],
        }),
        // ТЗ v21 §9.2: mutation, не query — одноразовая генерация, не кэшируем по аргументам
        // (facts у каждого запроса свои); компонент сам решает, когда вызывать.
        getCockpitInsight: builder.mutation<CockpitInsightResult, CockpitInsightArgs>({
            query: (body) => ({ url: '/reports/cockpit-insight', method: 'POST', body }),
        }),
        getExcelReports: builder.query<any, void>({
            query: () => '/reports/excel-data',
        }),
        getExcelMatrices: builder.query<any, string>({
            query: (periodId) => `/reports/assessment-period/${periodId}/matrices`,
            providesTags: ['Assessment'],
        }),
        uploadExcelReport: builder.mutation<any, FormData>({
            query: (formData) => ({
                url: '/reports/upload',
                method: 'POST',
                body: formData,
            }),
        }),
        getSystems: builder.query<SystemsListResponse, void>({
            query: () => '/systems?is_active=true&limit=100',
            providesTags: ['Systems'],
        }),
        createSystem: builder.mutation<SystemItem, SystemCreateDto>({
            query: (body) => ({
                url: '/systems',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Systems', 'Dashboard'],
        }),
        createMetric: builder.mutation<void, MetricCreateDto>({
            query: (body) => ({
                url: '/metrics/',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Metrics', 'Dashboard'],
        }),
        createAssessmentPeriod: builder.mutation<PeriodDto, PeriodCreateDto>({
            query: (body) => ({
                url: '/assessments/periods',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Assessment', 'Dashboard'],
        }),
        getAssessmentPeriods: builder.query<PeriodDto[], PeriodListParams | void>({
            query: (params) => {
                const sid = (params as PeriodListParams | undefined)?.system_id;
                return `/assessments/periods${sid ? `?system_id=${sid}` : ''}`;
            },
            providesTags: ['Assessment'],
        }),
        submitExpertJudgment: builder.mutation<void, ExpertJudgmentDto>({
            query: (body) => ({
                url: '/assessments/expert-judgment',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Assessment', 'Dashboard'],
        }),
        getAssessmentMetrics: builder.query<EditableMetric[], string>({
            query: (id) => `/assessments/${id}/metrics`,
            providesTags: ['Metrics'],
        }),
        saveAssessmentMetrics: builder.mutation<EditableMetric[], { id: string; metrics: EditableMetric[] }>({
            query: ({ id, metrics }) => ({
                url: `/assessments/${id}/metrics`,
                method: 'PUT',
                body: metrics,
            }),
            invalidatesTags: ['Metrics', 'Assessment', 'Dashboard'],
        }),
        getCalculatedMetrics: builder.query<CalculatedMetric[], string>({
            query: (id) => `/assessments/${id}/calculated`,
            providesTags: ['Assessment'],
        }),
        getPeriodSummaries: builder.query<PeriodSummary[], { system_id?: string } | void>({
            query: (params) => {
                const sid = (params as { system_id?: string } | undefined)?.system_id;
                return `/assessments/periods/summary${sid ? `?system_id=${sid}` : ''}`;
            },
            providesTags: ['Assessment'],
        }),
        createAssessmentValue: builder.mutation<EditableMetric, { id: string; body: ValueAddDto }>({
            query: ({ id, body }) => ({
                url: `/assessments/${id}/values`,
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Metrics', 'Assessment', 'Dashboard'],
        }),
        finalizeAssessment: builder.mutation<PeriodSummary, string>({
            query: (id) => ({
                url: `/assessments/${id}/finalize`,
                method: 'POST',
            }),
            invalidatesTags: ['Assessment', 'Dashboard'],
        }),
        /** T-47: открыть завершённую оценку на корректировку (разблокировка периода). */
        reopenAssessment: builder.mutation<PeriodSummary, string>({
            query: (id) => ({
                url: `/assessments/${id}/reopen`,
                method: 'POST',
            }),
            invalidatesTags: ['Assessment', 'Metrics', 'Dashboard'],
        }),
        /** T-48: метрики без профессионального суждения (по умолчанию — последний период ИС). */
        getPendingJudgments: builder.query<PendingJudgment[], { system?: string; all_periods?: boolean } | void>({
            query: (p) => {
                const a = p as { system?: string; all_periods?: boolean } | undefined;
                const params = new URLSearchParams();
                if (a?.system) params.set('system', a.system);
                if (a?.all_periods) params.set('all_periods', 'true');
                const qs = params.toString();
                return `/assessments/judgments-pending${qs ? `?${qs}` : ''}`;
            },
            providesTags: ['Assessment'],
        }),
        getJudgments: builder.query<JudgmentsStatus, string>({
            query: (id) => `/assessments/${id}/judgments`,
            providesTags: ['Assessment'],
        }),
        saveJudgments: builder.mutation<JudgmentsStatus, { id: string; items: JudgmentItem[] }>({
            query: ({ id, items }) => ({
                url: `/assessments/${id}/judgments`,
                method: 'PUT',
                body: items,
            }),
            invalidatesTags: ['Assessment'],
        }),
        getJudgmentConclusion: builder.query<JudgmentConclusion, string>({
            query: (id) => `/assessments/${id}/judgment-conclusion`,
        }),
        importAssessmentExcel: builder.mutation<ExcelImportResult, { id: string; file: File }>({
            query: ({ id, file }) => {
                const formData = new FormData();
                formData.append('period_id', id);
                formData.append('file', file);
                return {
                    url: '/excel/import-assessment',
                    method: 'POST',
                    body: formData,
                };
            },
            invalidatesTags: ['Metrics', 'Assessment', 'Dashboard'],
        }),
        importWorkbook: builder.mutation<any, { id: string; file: File }>({
            query: ({ id, file }) => {
                const formData = new FormData();
                formData.append('period_id', id);
                formData.append('file', file);
                return {
                    url: '/excel/import-workbook',
                    method: 'POST',
                    body: formData,
                };
            },
            invalidatesTags: ['Metrics', 'Assessment', 'Dashboard'],
        }),
        // ─── Аналитика техсбоев (T-21) ───
        getIncidents: builder.query<TechIncidentDto[], { system?: string } | void>({
            query: (p) => `/incidents${(p as { system?: string } | undefined)?.system ? `?system=${encodeURIComponent((p as { system?: string }).system!)}` : ''}`,
            providesTags: ['Incidents'],
        }),
        getIncidentAnalytics: builder.query<IncidentAnalytics, { system?: string } | void>({
            query: (p) => `/incidents/analytics${(p as { system?: string } | undefined)?.system ? `?system=${encodeURIComponent((p as { system?: string }).system!)}` : ''}`,
            providesTags: ['Incidents'],
        }),
        getIncidentCategories: builder.query<IncidentCategoriesDto, void>({
            query: () => '/incidents/categories',
            providesTags: ['Incidents'],
        }),
        createIncident: builder.mutation<TechIncidentDto, IncidentCreateDto>({
            query: (body) => ({ url: '/incidents', method: 'POST', body }),
            invalidatesTags: ['Incidents'],
        }),
        importIncidents: builder.mutation<IncidentImportResultDto, Record<string, string>[]>({
            query: (rows) => ({ url: '/incidents/import', method: 'POST', body: rows }),
            invalidatesTags: ['Incidents'],
        }),
        resolveIncident: builder.mutation<TechIncidentDto, { id: string; resolvedAt?: string }>({
            query: ({ id, resolvedAt }) => ({ url: `/incidents/${id}/resolve`, method: 'POST', body: { resolvedAt } }),
            invalidatesTags: ['Incidents'],
        }),
        // ─── Риск-триггеры (T-16): проактивные риски по техсбоям/просевшим характеристикам ───
        getTriggeredRisks: builder.query<TriggeredRisk[], { system?: string; characteristics?: string } | void>({
            query: (p) => {
                const a = p as { system?: string; characteristics?: string } | undefined;
                const params = new URLSearchParams();
                if (a?.system) params.set('system', a.system);
                if (a?.characteristics) params.set('characteristics', a.characteristics);
                const qs = params.toString();
                return `/risks/triggered${qs ? `?${qs}` : ''}`;
            },
            providesTags: ['Incidents'],
        }),
        getSystemDynamics: builder.query<SystemDynamics, string>({
            query: (systemId) => `/reports/system-dynamics?system_id=${systemId}`,
            providesTags: ['Dashboard'],
        }),
        // ТЗ v20 — веса подхарактеристик ГОСТ 25010, источник для взвешенных карточек
        // (критичность ИС, эффективность сотрудников, подпись под спидометром, «Динамика»).
        // Домен quality смонтирован под /metrics (ТЗ v13, api/v1/api.py) — НЕ /quality, несмотря
        // на имя python-модуля app.modules.quality; правильный полный путь — /metrics/weights.
        getQualityWeights: builder.query<QualityWeightsOut, void>({
            query: () => '/metrics/weights',
            providesTags: ['Metrics'],
        }),
        // ─── RBAC / администрирование (BL-008) ───
        getMyPermissions: builder.query<MyPermissions, void>({
            query: () => '/iam/me/permissions',
            providesTags: ['MyPermissions'],
        }),
        getUsers: builder.query<AdminUser[], void>({
            query: () => '/iam/users',
            providesTags: ['Users'],
        }),
        createUser: builder.mutation<AdminUser, UserCreateDto>({
            query: (body) => ({ url: '/iam/users', method: 'POST', body }),
            invalidatesTags: ['Users'],
        }),
        updateUser: builder.mutation<AdminUser, { id: string; body: UserUpdateDto }>({
            query: ({ id, body }) => ({ url: `/iam/users/${id}`, method: 'PATCH', body }),
            invalidatesTags: ['Users'],
        }),
        resetUserPassword: builder.mutation<{ ok: boolean }, { id: string; password: string }>({
            query: ({ id, password }) => ({ url: `/iam/users/${id}/reset-password`, method: 'POST', body: { password } }),
        }),
        deleteUser: builder.mutation<{ ok: boolean }, string>({
            query: (id) => ({ url: `/iam/users/${id}`, method: 'DELETE' }),
            invalidatesTags: ['Users'],
        }),
        getPermissionCatalog: builder.query<PermissionCatalog, void>({
            query: () => '/iam/permissions/catalog',
            providesTags: ['Permissions'],
        }),
        getPermissionMatrix: builder.query<PermissionMatrix, void>({
            query: () => '/iam/permissions/matrix',
            providesTags: ['Permissions'],
        }),
        setRolePermissions: builder.mutation<PermissionMatrix, { role: string; permissions: string[] }>({
            query: ({ role, permissions }) => ({ url: `/iam/permissions/matrix/${role}`, method: 'PUT', body: { permissions } }),
            invalidatesTags: ['Permissions', 'MyPermissions'],
        }),
        // ТЗ v20 п.10 — разделы, обязательные для всех пользователей (фиксирует SUPER_ADMIN).
        getMandatorySections: builder.query<MandatorySectionsOut, void>({
            query: () => '/iam/mandatory-sections',
            providesTags: ['Permissions'],
        }),
        setMandatorySections: builder.mutation<MandatorySectionsOut, { permissions: string[] }>({
            query: (body) => ({ url: '/iam/mandatory-sections', method: 'PUT', body }),
            invalidatesTags: ['Permissions'],
        }),
        getMyPreferences: builder.query<PreferencesResponse, void>({
            query: () => '/iam/me/preferences',
            providesTags: ['Preferences'],
        }),
        putMyPreferences: builder.mutation<PreferencesResponse, { prefs: UserPrefs }>({
            query: (body) => ({ url: '/iam/me/preferences', method: 'PUT', body }),
            invalidatesTags: ['Preferences'],
        }),
        // ТЗ v18 п.10 — самооценка LLM по ISO/IEC 25010 (только суперадминистратор).
        getLlmQuality: builder.query<LlmQualityResponse, void>({
            query: () => '/reports/llm-quality',
            providesTags: ['LlmQuality'],
        }),
        runLlmQuality: builder.mutation<LlmQualityRunResponse, { mode: 'full' | 'static' }>({
            query: ({ mode }) => ({ url: `/reports/llm-quality/run?mode=${mode}`, method: 'POST' }),
            // Полный прогон уходит в фон и отчёт появится позже — инвалидация здесь обновляет
            // экран сразу после быстрого («static») прогона, а фоновой результат подхватится
            // следующим запросом страницы.
            invalidatesTags: ['LlmQuality'],
        }),
        getLlmPipeline: builder.query<LlmPipelineResponse, void>({
            query: () => '/reports/llm-pipeline',
        }),
    }),
});

export const {
    useCreateAssessmentPeriodMutation,
    useCreateAssessmentValueMutation,
    useCreateMetricMutation,
    useCreateSystemMutation,
    useFinalizeAssessmentMutation,
    useReopenAssessmentMutation,
    useGetJudgmentsQuery,
    useGetPendingJudgmentsQuery,
    useSaveJudgmentsMutation,
    useLazyGetJudgmentConclusionQuery,
    useGetAssessmentMetricsQuery,
    useGetCalculatedMetricsQuery,
    useGetPeriodSummariesQuery,
    useGetExecutiveDashboardQuery,
    useGetCockpitBundleQuery,
    useGetCockpitInsightMutation,
    useGetSystemsQuery,
    useImportAssessmentExcelMutation,
    useImportWorkbookMutation,
    useSaveAssessmentMetricsMutation,
    useSubmitExpertJudgmentMutation,
    useGetAssessmentPeriodsQuery,
    useGetExcelReportsQuery,
    useGetExcelMatricesQuery,
    useUploadExcelReportMutation,
    useGetIncidentsQuery,
    useGetIncidentAnalyticsQuery,
    useGetIncidentCategoriesQuery,
    useCreateIncidentMutation,
    useImportIncidentsMutation,
    useResolveIncidentMutation,
    useGetTriggeredRisksQuery,
    useGetSystemDynamicsQuery,
    useGetQualityWeightsQuery,
    useGetMyPermissionsQuery,
    useLazyGetMyPermissionsQuery,
    useGetUsersQuery,
    useCreateUserMutation,
    useUpdateUserMutation,
    useResetUserPasswordMutation,
    useDeleteUserMutation,
    useGetPermissionCatalogQuery,
    useGetPermissionMatrixQuery,
    useSetRolePermissionsMutation,
    useGetMandatorySectionsQuery,
    useSetMandatorySectionsMutation,
    useGetMyPreferencesQuery,
    usePutMyPreferencesMutation,
    useGetLlmQualityQuery,
    useRunLlmQualityMutation,
    useGetLlmPipelineQuery,
} = apiSlice;
