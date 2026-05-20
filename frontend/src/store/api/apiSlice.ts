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
    description: string;
    val_a: number | null;
    val_b: number | null;
    expert_comment: string;
}

export interface CalculatedMetric {
    id: string;
    name: string;
    calculatedX: number;
    systemLevel: string;
    adjustedLevel?: string;
    expertComment?: string;
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
        getSystems: builder.query<SystemsListResponse, void>({
            query: () => '/systems?is_active=true&limit=100',
            providesTags: ['Systems'],
        }),
        createAssessmentPeriod: builder.mutation<PeriodDto, PeriodCreateDto>({
            query: (body) => ({
                url: '/assessments/periods',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Assessment', 'Dashboard'],
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
    }),
});

export const {
    useCreateAssessmentPeriodMutation,
    useGetAssessmentMetricsQuery,
    useGetCalculatedMetricsQuery,
    useGetExecutiveDashboardQuery,
    useGetSystemsQuery,
    useSaveAssessmentMetricsMutation,
    useSubmitExpertJudgmentMutation,
} = apiSlice;
