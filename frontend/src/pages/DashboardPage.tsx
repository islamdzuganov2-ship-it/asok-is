/**
 * DashboardPage.tsx — аналитический дашборд АСОК ИС.
 *
 * Данные и три модалки-раскрытия переехали в AnalyticsScope, четыре карточки (KPI, распределение
 * уровней, проблемные ИС, тепловая карта) — в каталог. Страница осталась обёрткой над
 * конструктором (ТЗ v22, БТ-500). Источник данных прежний: GET /assessments/dashboard,
 * в демо-режиме — сценарный набор без обращения к бэкенду.
 */
import React from 'react';
import { DashboardOutlined } from '@ant-design/icons';
import GridDashboard from '../dashboards/GridDashboard';
import { GOLD } from '../theme/premium';

const DashboardPage: React.FC = () => (
  <GridDashboard
    dashboardKey="analytics"
    title="Аналитический дашборд качества ИС"
    subtitle="Детальный операционный взгляд: уровни, метрики, полная тепловая карта по всем ИС"
    icon={<DashboardOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default DashboardPage;
