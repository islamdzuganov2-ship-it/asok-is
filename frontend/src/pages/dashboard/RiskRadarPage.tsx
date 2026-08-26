/**
 * RiskRadarPage.tsx — «Риск-радар» (T-16): проактивная защита от технического сбоя.
 *
 * Показывает риски из базы, которые МОГУТ РЕАЛИЗОВАТЬСЯ по текущему состоянию ИС: частые техсбои
 * по первопричинам (маппинг категория → характеристика ISO) и/или просевшие характеристики.
 * Источник в режиме LLM — GET /risks/triggered; в демо — тот же алгоритм на сценарном наборе.
 * Карточки вынесены в каталог (dashboards/cards/radarCards.tsx) и доступны на любом дашборде.
 */
import React from 'react';
import { AlertOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { accentColorOf } from '../../theme/premium';

const RiskRadarPage: React.FC = () => (
  <GridDashboard
    dashboardKey="radar"
    title="Риск-радар — проактивная защита от техсбоя"
    subtitle="Риски, которые могут реализоваться по текущему состоянию (частые техсбои + просевшие характеристики)"
    icon={<AlertOutlined style={{ color: accentColorOf('terracotta'), marginRight: 8 }} />}
  />
);

export default RiskRadarPage;
