/**
 * RiskEconomicsPage.tsx — риск-экономический контур (BL-007).
 *
 * Оболочка с вкладками. Две аналитические вкладки собраны из карточек общего каталога
 * (dashboards/cards/econCards) — те же карточки пользователь может положить на «Мой дашборд».
 * Три рабочие вкладки — реестр рисковых событий, справочники экономики и замыкание
 * несоответствий — лежат отдельными модулями в pages/riskEconomics: это формы ввода и реестры,
 * а не карточки дашборда.
 *
 * Ввод ручной (пилот идёт от ручного ввода, не от автовыгрузки ITSM). Расчёты (C_ТС, ALE, ROSI)
 * считает бэкенд.
 */
import React, { useState } from 'react';
import { Space, Tabs, Typography } from 'antd';
import { accentDot, pageContainer, pageTitle, GOLD, SPACE } from '../theme/premium';
import { EconScopeProvider } from '../dashboards/scopes/EconScope';
import {
  EconKpiCard, EconNonconformityCard, EconAleBySystemCard, EconHeatmapCard,
  EconTopRisksCard, EconPortfolioSummaryCard, EconRiskMeasureEffectCard, EconQuarterlyEffectCard,
} from '../dashboards/cards/econCards';
import { EconManagersCard } from '../dashboards/cards/econManagersCard';
import { RiskEventsTab } from './riskEconomics/RiskEventsTab';
import { ReferencesTab } from './riskEconomics/ReferencesTab';
import { ClosureTab } from './riskEconomics/ClosureTab';

const { Title, Text } = Typography;

const RiskEconomicsPage: React.FC = () => {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={pageContainer}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4} style={pageTitle}>
            <span style={accentDot(GOLD.base)} />Риск-экономический контур
          </Title>
          <Text type="secondary">
            Диагноз ставится в процентах, решение принимается по деньгам: рисковые события с годовой
            стоимостью (ALE), справочники экономики и замыкание несоответствий.
          </Text>
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'dashboard', label: 'Дашборд стоимости', children: <DashboardTab /> },
            { key: 'risks', label: 'Рисковые события', children: <RiskEventsTab /> },
            { key: 'refs', label: 'Справочники', children: <ReferencesTab /> },
            { key: 'closure', label: 'Замыкание контура', children: <ClosureTab /> },
            { key: 'managers', label: 'Эффективность руководителей', children: <ManagersTab /> },
          ]}
        />
      </Space>
    </div>
  );
};

// ════════════════════════ Дашборд стоимости (§5) ════════════════════════
// Виджеты вкладки живут в общем каталоге карточек (dashboards/cards/econCards.tsx): те же
// карточки пользователь может положить на «Мой дашборд» или на любой другой доступный ему
// дашборд. Здесь они собраны в штатный порядок вкладки — один источник вёрстки, без копии.
const DashboardTab: React.FC = () => (
  <EconScopeProvider>
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <EconKpiCard />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: SPACE.base }}>
        <EconNonconformityCard />
        <EconAleBySystemCard />
      </div>
      <EconHeatmapCard />
      <EconTopRisksCard />
      <EconPortfolioSummaryCard />
      <EconRiskMeasureEffectCard />
      <EconQuarterlyEffectCard />
    </Space>
  </EconScopeProvider>
);

// ════════════ Эффективность руководителей (задача 12, §7.1) — ДИАГНОСТИКА ════════════
// Та же карточка, что и в каталоге: рейтинг доступен и как элемент любого дашборда.
const ManagersTab: React.FC = () => (
  <EconScopeProvider>
    <EconManagersCard />
  </EconScopeProvider>
);


export default RiskEconomicsPage;
