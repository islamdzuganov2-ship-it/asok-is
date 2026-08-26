/**
 * ExecutiveDashboard.tsx — управленческий дашборд (CEO/CTO).
 *
 * Вся вёрстка переехала в каталог карточек (dashboards/cards/execCards.tsx), состояние — в
 * ExecScope, а порядок и размеры теперь задаёт пользователь: страница стала тонкой обёрткой над
 * конструктором (ТЗ v22, БТ-500). Дефолтная раскладка в DASHBOARDS.exec повторяет прежний вид,
 * поэтому для не трогавшего настройки пользователя ничего не изменилось.
 */
import React from 'react';
import { FundOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const ExecutiveDashboard: React.FC = () => (
  <GridDashboard
    dashboardKey="exec"
    title="Управленческий дашборд"
    subtitle="Качество ИТ-ландшафта, техдолг и меры — сводно для руководства"
    icon={<FundOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default ExecutiveDashboard;
