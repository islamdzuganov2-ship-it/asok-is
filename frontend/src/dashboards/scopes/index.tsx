/**
 * scopes/index.tsx — подмешивание «скоупов» под набор карточек, которые сейчас на экране.
 *
 * Карточка, унесённая на чужой дашборд, тащит за собой состояние своего происхождения (см.
 * ManagerScope). ScopeHost смотрит, карточки каких скоупов реально видны, и оборачивает сетку
 * ТОЛЬКО в нужные провайдеры: положил на «Мой дашборд» одну плитку сбоев — поднимется скоуп
 * сбоев, а менеджерский запрос к /assessments/dashboard не уйдёт вовсе.
 *
 * Порядок вложения провайдеров фиксирован (порядком в SCOPES), чтобы React не пересоздавал
 * поддерево при добавлении карточки нового скоупа и не сбрасывал состояние соседей.
 */
import React from 'react';
import type { ScopeKey } from '../types';
import { ManagerScopeProvider, ManagerScopeToolbar } from './ManagerScope';
import { ExecScopeProvider, ExecScopeToolbar } from './ExecScope';
import { IncidentsScopeProvider, IncidentsScopeToolbar } from './IncidentsScope';
import { TaskPlanScopeProvider, TaskPlanScopeToolbar } from './TaskPlanScope';
import { DynamicsScopeProvider, DynamicsScopeToolbar } from './DynamicsScope';
import { AnalyticsScopeProvider, AnalyticsScopeToolbar } from './AnalyticsScope';
import { MyTasksScopeProvider, MyTasksScopeToolbar } from './MyTasksScope';
import { EconScopeProvider, EconScopeToolbar } from './EconScope';

interface ScopeEntry {
  key: ScopeKey;
  Provider: React.FC<{ children: React.ReactNode }>;
  /** Панель над сеткой: управление, общее для всех карточек скоупа (выбор ИС, период…). */
  Toolbar?: React.FC;
}

/** Порядок значим — см. комментарий к модулю. */
const SCOPES: ScopeEntry[] = [
  { key: 'manager', Provider: ManagerScopeProvider, Toolbar: ManagerScopeToolbar },
  { key: 'exec', Provider: ExecScopeProvider, Toolbar: ExecScopeToolbar },
  { key: 'incidents', Provider: IncidentsScopeProvider, Toolbar: IncidentsScopeToolbar },
  { key: 'taskplan', Provider: TaskPlanScopeProvider, Toolbar: TaskPlanScopeToolbar },
  { key: 'dynamics', Provider: DynamicsScopeProvider, Toolbar: DynamicsScopeToolbar },
  { key: 'analytics', Provider: AnalyticsScopeProvider, Toolbar: AnalyticsScopeToolbar },
  { key: 'mytasks', Provider: MyTasksScopeProvider, Toolbar: MyTasksScopeToolbar },
  { key: 'econ', Provider: EconScopeProvider, Toolbar: EconScopeToolbar },
];

export const ScopeHost: React.FC<{ scopes: Set<ScopeKey>; children: React.ReactNode }> = ({ scopes, children }) => (
  <>{SCOPES.reduceRight(
    (tree, s) => (scopes.has(s.key) ? <s.Provider>{tree}</s.Provider> : tree),
    children as React.ReactElement,
  )}</>
);

/** Панели активных скоупов — рендерятся ВНУТРИ ScopeHost, иначе не увидят контекст. */
export const ScopeToolbars: React.FC<{ scopes: Set<ScopeKey> }> = ({ scopes }) => {
  const active = SCOPES.filter((s) => s.Toolbar && scopes.has(s.key));
  if (!active.length) return null;
  return (
    <>
      {active.map((s) => {
        const T = s.Toolbar!;
        return <T key={s.key} />;
      })}
    </>
  );
};
