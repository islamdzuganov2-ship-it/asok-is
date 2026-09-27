/**
 * System Role: Senior Full-Stack Lead & Surgical Code Auditor
 * Execution Mode: MODE 1 (CODE GENERATION)
 * State: Fully validated syntax, no placeholders, no nesting issues.
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { RootState } from '../index';
import { logout, requirePasswordChange } from '../slices/authSlice';
import { isPasswordChangeRequired } from '../../utils/passwordPolicy';
import { qs as qsCockpit } from '../../utils/apiFetch';
import type {
    CockpitBundle, CockpitBundleArgs, CockpitInsightArgs, CockpitInsightResult,
} from '../../dashboards/cockpit/apiTypes';
import type {
    AdminUser,
    AuditEvent,
    CalculatedMetric,
    DashboardData,
    EditableMetric,
    ExcelImportResult,
    ExpertJudgmentDto,
    IncidentAnalytics,
    IncidentCategoriesDto,
    IncidentCreateDto,
    IncidentImportResultDto,
    JudgmentConclusion,
    JudgmentItem,
    JudgmentsStatus,
    LlmPipelineResponse,
    LlmQualityResponse,
    LlmQualityRunResponse,
    LlmStatusOut,
    MandatorySectionsOut,
    MetricCreateDto,
    MoneyCell,
    MyPermissions,
    PendingJudgment,
    PeriodCreateDto,
    PeriodDto,
    PeriodListParams,
    PeriodSummary,
    PermissionCatalog,
    PermissionMatrix,
    PreferencesResponse,
    QualityWeightsOut,
    SystemCreateDto,
    SystemDynamics,
    SystemItem,
    SystemsListResponse,
    TechIncidentDto,
    TriggeredRisk,
    UserCreateDto,
    UserPrefs,
    UserUpdateDto,
    ValueAddDto,
} from './apiTypes';
export type * from './apiTypes';

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
 *
 * 403 PASSWORD_CHANGE_REQUIRED (ИБ-11) → не выход, а экран смены временного пароля.
 */
const baseQueryWithAuthGuard: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> =
    async (args, api, extraOptions) => {
        const result = await rawBaseQuery(args, api, extraOptions);
        if (result.error && result.error.status === 401) {
            const state = api.getState() as RootState;
            if (state.auth.isAuthenticated) {
                api.dispatch(logout());
            }
        } else if (result.error && isPasswordChangeRequired(result.error.status, result.error.data)) {
            api.dispatch(requirePasswordChange());
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
        getAuditLog: builder.query<AuditEvent[], { action?: string; username?: string }>({
            query: ({ action, username }) => ({ url: '/iam/audit-log', params: { action, username, limit: 500 } }),
        }),
        getLlmStatus: builder.query<LlmStatusOut, void>({
            query: () => '/reports/llm-status',
        }),
        // Денежный слой теплокарты (УК-11): ALE / ΔALE / покрытие по ячейкам «ИС × характеристика».
        getHeatmapMoneyLayer: builder.query<MoneyCell[], void>({
            query: () => '/risk-events/heatmap-money-layer',
        }),
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
    useGetLlmStatusQuery,
    useGetAuditLogQuery,
    useGetHeatmapMoneyLayerQuery,
    useSetMandatorySectionsMutation,
    useGetMyPreferencesQuery,
    usePutMyPreferencesMutation,
    useGetLlmQualityQuery,
    useRunLlmQualityMutation,
    useGetLlmPipelineQuery,
} = apiSlice;
