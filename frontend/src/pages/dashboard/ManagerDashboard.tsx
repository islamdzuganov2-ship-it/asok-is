/**
 * ManagerDashboard.tsx — дашборд «Основное» роли «Менеджер по качеству» (ТЗ v9 §3.2 + v15).
 *
 * Каскад «ИС → характеристика → подхарактеристика» (T-27…T-30) живёт в ManagerScope, карточки —
 * в каталоге (dashboards/cards/managerCards.tsx). Страница — обёртка над конструктором: состав,
 * порядок и размеры карточек пользователь задаёт сам (ТЗ v22, БТ-500).
 *
 * Режим данных прежний: 'mock' — демо-набор (30 ИС), 'live' — реальные оценки из БД.
 */
import React from 'react';
import { PieChartOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const ManagerDashboard: React.FC = () => (
  <GridDashboard
    dashboardKey="manager"
    title="Основное"
    subtitle="Профиль качества ИС, метрики, меры и профессиональные суждения"
    icon={<PieChartOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default ManagerDashboard;
