---
tags: [асок-ис, архив, frontend, historical]
date: 2026-06-27
status: archived
---

# Архив: удалённые значения `data/mockDashboards.ts`

> Из `mockDashboards.ts` удалены демо-**значения** (вытеснены `data/mockScaleData.ts`).
> **Типы оставлены** в файле живыми. Полные значения — в git до коммита 2026-06-27.

## `EXECUTIVE_MOCK` (управленческий дашборд, демо)
- globalIndex: 68
- systems (3): Systematica Radius 33% MISSION CRITICAL (Надёжность); CRM ОПК 41% BUSINESS CRITICAL
  (Сопровождаемость); Единое Хранилище Данных (ЕХД) 46% BUSINESS CRITICAL (Тестируемость) —
  с aiSummary/recommendation/owner/escalateTo/actions[3].
- heatmap: characteristics [Функц., Произв., Надёжн., Сопров., Безоп.]; 5 строк со score-ячейками.
- techDebt: { resolvedPct: 65, period: 'Q1', note: 'устранено задач по плану обеспечения качества' }.

## `MANAGER_MOCK_SYSTEMS` (3 системы, демо)
- ЕХД: Тестируемость 25% (m1 Покрытие автотестами 16% … m4 Стабильность среды 40%), Сопровождаемость 48%, Надёжность 55%.
- Systematica Radius: Надёжность 30%, Сопровождаемость 70%, Безопасность 82%.
- CRM ОПК: Сопровождаемость 35%, Функциональная пригодность 40%.

## `MANAGER_MOCK`
Дублировал первый элемент `MANAGER_MOCK_SYSTEMS` (ЕХД).

## Живая замена
`data/mockScaleData.ts`: `EXECUTIVE_SCALE`, `MANAGER_SCALE_SYSTEMS`, `ANALYTICS_SCALE`, `SCALE_PROPOSALS`.
