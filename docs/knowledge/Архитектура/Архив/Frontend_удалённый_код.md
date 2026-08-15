---
tags: [асок-ис, архив, frontend, historical]
date: 2026-06-27
status: archived
---

# Архив: удалённый фронтенд-код

## `components/AiInsightBanner.tsx`
```tsx
import React from 'react';
import { Alert } from 'antd';

interface AiInsightBannerProps { insight?: string; }

export const AiInsightBanner: React.FC<AiInsightBannerProps> = ({ insight }) => {
    if (!insight) return null;
    return <Alert type="info" showIcon message={insight} />;
};
export default AiInsightBanner;
```

## `services/axiosInstance.ts`
```ts
import axios from 'axios';

export const axiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1',
});
axiosInstance.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});
export default axiosInstance;
```

## `store/api/authApi.ts`
```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { RootState } from '../index';

export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api/v1',
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  endpoints: (builder) => ({
    login: builder.mutation({ query: (body) => ({ url: '/auth/login', method: 'POST', body }) }),
    refreshToken: builder.mutation({ query: (body) => ({ url: '/auth/refresh', method: 'POST', body }) }),
  }),
});
export const { useLoginMutation, useRefreshTokenMutation } = authApi;
```

## `data/mockExcelData.ts`
Типы (RiskRecord/DefectRecord/QualityPlanRecord) + демо-заглушки риск/недостаток/план.
```ts
export interface RiskRecord { id; characteristic; subCharacteristic; riskDescription; riskConsequence; mitigation; }
export interface DefectRecord { id; characteristic; qualityMetric; digitalMetric; defectDescription; }
export interface QualityPlanRecord { id; characteristic; subCharacteristic; taskDescription; internalDocument; assignee; deadline; }

export const mockRisksData = [{ id:'1', characteristic:'Функциональная пригодность',
  subCharacteristic:'Функциональное покрытие', riskDescription:'Неполное покрытие требований автотестами',
  riskConsequence:'Риск отказов и (или) нарушения функционирования ИС',
  mitigation:'Увеличить штат QA-автоматизаторов, внедрить обязательное покрытие для критичных модулей' }];
export const mockDefectsData = [
  { id:'1', characteristic:'Функциональная пригодность', qualityMetric:'Уровень автоматизации',
    digitalMetric:'20%', defectDescription:'Низкий уровень АТ вызван ограниченными ресурсами…' },
  { id:'2', characteristic:'Совместимость', qualityMetric:'Покрытие интеграций',
    digitalMetric:'92%', defectDescription:'Отсутствует интеграция с 1С-ЗУП (в процессе реализации)' }];
export const mockPlanData = [{ id:'1', characteristic:'Надежность', subCharacteristic:'Полнота резервных копий',
  taskDescription:'Обеспечить 100% выполнение плана резервного копирования',
  internalDocument:'Распоряжение 77-НШ', assignee:'Иванов И.И. (Архитектор БД)', deadline:'Q3 2026' }];
```

## `app/App.tsx` (битый дубль точки входа)
Файл был повреждённым фрагментом (содержал текст `frontend/src/App.tsx` и оборванный JSX),
в граф сборки не входил (активная точка входа — `src/App.tsx`). Удалён вместе с папкой `src/app/`.

## Пустые заглушки (без содержимого)
- `components/TemplatesDisplay.tsx` — 0 строк.
- `store/api/assessmentApi.ts` — 0 строк.
