/**
 * Базовый API срез для RTK Query.
 * Отвечает за взаимодействие с Backend FastAPI.
 * Содержит эндпоинты для получения данных дашборда и отправки экспертных суждений.
 */
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

// Типизация ответа для дашборда
export interface DashboardData {
    globalHealthScore: number;
    aiInsights: string;
    heatmapData: Array<[number, number, number]>; // [x, y, value]
    xAxisLabels: string[];
    yAxisLabels: string[];
}

// Типизация DTO для экспертного суждения (согласно ТЗ п.3.2)
export interface ExpertJudgmentDto {
    metricId: string;
    calculatedLevel: 'Низкий' | 'Средний' | 'Высокий';
    adjustedLevel?: 'Низкий' | 'Средний' | 'Высокий';
    justificationText: string;
    linkedRiskTask?: string;
}

export const apiSlice = createApi({
    reducerPath: 'api',
    baseQuery: fetchBaseQuery({ 
        baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1',
        prepareHeaders: (headers) => {
            // Внедрение токена из стейта/localStorage
            const token = localStorage.getItem('token');
            if (token) {
                headers.set('authorization', `Bearer ${token}`);
            }
            return headers;
        },
    }),
    tagTypes: ['Assessment', 'Dashboard'],
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
    }),
});

export const { useGetExecutiveDashboardQuery, useSubmitExpertJudgmentMutation } = apiSlice;