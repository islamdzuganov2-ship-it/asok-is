/**
 * riskCards.tsx — карточки дашборда «Основное — риск» (владелец риска) в общем каталоге.
 *
 * Виджеты этого дашборда были сделаны самодостаточными ещё в BL-008 (сами тянут данные через
 * RTK Query, уважают тумблер Демо/LLM) — им не нужен скоуп, и они переезжают в каталог как есть.
 * Обёртка нужна только ряду KPI: он рендерил голый Row без карточки, а в сетке у каждой ячейки
 * должна быть своя рамка, иначе плитки «висят» на полотне.
 */
import React from 'react';
import {
  RiskKpiWidget, RiskTriggersWidget, IncidentsByCategoryWidget, EconomicImpactWidget, TopSystemsWidget,
} from '../riskWidgets';
import GridCard from '../GridCard';
import type { CardDef } from '../types';

const Scroll: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ height: '100%', overflow: 'auto' }}>{children}</div>
);

const RiskKpiCard: React.FC = () => (
  <GridCard title="Ключевые показатели (техсбои)" accent="terracotta">
    <RiskKpiWidget />
  </GridCard>
);

const RiskTriggersCard: React.FC = () => <Scroll><RiskTriggersWidget /></Scroll>;
const RiskEconomicImpactCard: React.FC = () => <Scroll><EconomicImpactWidget /></Scroll>;
const RiskByCategoryCard: React.FC = () => <Scroll><IncidentsByCategoryWidget /></Scroll>;
const RiskTopSystemsCard: React.FC = () => <Scroll><TopSystemsWidget /></Scroll>;

const PERM = 'view.dashboard.risk';

export const RISK_CARDS: CardDef[] = [
  { id: 'risk.kpi', title: 'Ключевые показатели (техсбои)', source: 'risk', perm: PERM, scope: 'none', w: 12, h: 5, minW: 4, minH: 4, hint: 'Всего сбоев, открытые, MTTR, доля релизных', Component: RiskKpiCard },
  { id: 'risk.triggers', title: 'Проактивные риск-триггеры', source: 'risk', perm: PERM, scope: 'none', w: 6, h: 11, minW: 3, minH: 5, hint: 'Риски по текущему состоянию ИС', Component: RiskTriggersCard },
  { id: 'risk.economicImpact', title: 'Экономическое влияние', source: 'risk', perm: PERM, scope: 'none', w: 6, h: 11, minW: 3, minH: 5, hint: 'Портфельный ALE и топ рисков по стоимости', Component: RiskEconomicImpactCard },
  { id: 'risk.byCategory', title: 'Сбои по первопричинам', source: 'risk', perm: PERM, scope: 'none', w: 12, h: 11, minW: 4, minH: 5, hint: 'Таблица категорий с переходом в аналитику сбоев', Component: RiskByCategoryCard },
  { id: 'risk.topSystems', title: 'Нестабильные ИС', source: 'risk', perm: PERM, scope: 'none', w: 6, h: 11, minW: 3, minH: 5, hint: 'Системы с наибольшим числом сбоев', Component: RiskTopSystemsCard },
];
