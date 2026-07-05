/**
 * System Role: Senior Full-Stack Lead & Surgical Code Auditor
 * Execution Mode: MODE 1 (CODE GENERATION)
 * State: Fully validated syntax, no placeholders, no nesting issues.
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { RootState } from '../index';

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

export const apiSlice = createApi({
    reducerPath: 'api',
    baseQuery: fetchBaseQuery({
        baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1',
        prepareHeaders: (headers, { getState }) => {
            const token = (getState() as RootState).auth.token || localStorage.getItem('token');
            if (token) {
                headers.set('authorization', `Bearer ${token}`);
            }
            return headers;
        },
    }),
    tagTypes: ['Assessment', 'Dashboard', 'Metrics', 'Systems'],
    endpoints: (builder) => ({
        getExecutiveDashboard: builder.query<DashboardData, void>({
            query: () => '/reports/executive-dashboard',
            providesTags: ['Dashboard'],
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
                const query = params?.system_id ? `?system_id=${params.system_id}` : '';
                return `/assessments/periods${query}`;
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
                const query = params?.system_id ? `?system_id=${params.system_id}` : '';
                return `/assessments/periods/summary${query}`;
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
    }),
});

export const {
    useCreateAssessmentPeriodMutation,
    useCreateAssessmentValueMutation,
    useCreateMetricMutation,
    useCreateSystemMutation,
    useFinalizeAssessmentMutation,
    useGetJudgmentsQuery,
    useSaveJudgmentsMutation,
    useLazyGetJudgmentConclusionQuery,
    useGetAssessmentMetricsQuery,
    useGetCalculatedMetricsQuery,
    useGetPeriodSummariesQuery,
    useGetExecutiveDashboardQuery,
    useGetSystemsQuery,
    useImportAssessmentExcelMutation,
    useImportWorkbookMutation,
    useSaveAssessmentMetricsMutation,
    useSubmitExpertJudgmentMutation,
    useGetAssessmentPeriodsQuery,
    useGetExcelReportsQuery,
    useGetExcelMatricesQuery,
    useUploadExcelReportMutation,
} = apiSlice;
