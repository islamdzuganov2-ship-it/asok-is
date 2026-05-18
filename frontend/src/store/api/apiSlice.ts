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
    problematicSystems: ProblematicSystem[]; // Добавлено для DashboardPage
}

export interface ExpertJudgmentDto {
    metricId: string;
    calculatedLevel: 'Низкий' | 'Средний' | 'Высокий';
    adjustedLevel?: 'Низкий' | 'Средний' | 'Высокий';
    justificationText: string;
    linkedRiskTask?: string;
}

// Добавленные интерфейсы для экранов ввода и ревью
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
    systemLevel: 'Низкий' | 'Средний' | 'Высокий';
    adjustedLevel?: 'Низкий' | 'Средний' | 'Высокий';
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
    tagTypes: ['Assessment', 'Dashboard', 'Metrics'],
    endpoints: (builder) => ({
        getExecutiveDashboard: builder.query<DashboardData, void>({
            query: () => '/reports/executive-dashboard',
            providesTags: ['Dashboard'],
        }),
        submitExpertJudgment: builder.mutation<void, ExpertJudgmentDto>({
            query: (body) => ({
                url: '/assessments/expert-judgment',
                method: 'POST',
                body,
            }),
            invalidatesTags: ['Assessment', 'Dashboard'],
        }),
        // Новые эндпоинты
        getAssessmentMetrics: builder.query<EditableMetric[], string>({
            query: (id) => `/assessments/${id}/metrics`,
            providesTags: ['Metrics'],
        }),
        saveAssessmentMetrics: builder.mutation<void, { id: string; metrics: EditableMetric[] }>({
            query: ({ id, metrics }) => ({
                url: `/assessments/${id}/metrics`,
                method: 'PUT',
                body: metrics,
            }),
            invalidatesTags: ['Metrics', 'Assessment'],
        }),
        getCalculatedMetrics: builder.query<CalculatedMetric[], string>({
            query: (id) => `/assessments/${id}/calculated`,
            providesTags: ['Assessment'],
        }),
    }),
});

export const { 
    useGetExecutiveDashboardQuery, 
    useSubmitExpertJudgmentMutation,
    useGetAssessmentMetricsQuery,
    useSaveAssessmentMetricsMutation,
    useGetCalculatedMetricsQuery
} = apiSlice;