/**
 * CeoDashboard.tsx (ТЗ v21 §5, БТ-500) — кокпит CEO: деньги под риском и решения, требующие
 * подписи. Плитки — обычные карточки конструктора дашбордов (см. dashboards/cards/cockpitCards),
 * добавляются/убираются через «Настроить» → «Добавить карточку», как на любом другом дашборде.
 * Полная лента виджетов (прежний контур) остаётся доступна по ссылке «Полная картина».
 */
import React from 'react';
import { Button } from 'antd';
import { FundOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import GridDashboard from '../../dashboards/GridDashboard';
import CockpitInsight from '../../dashboards/cockpit/CockpitInsight';
import { useGetCockpitBundleQuery } from '../../store/api/apiSlice';
import { cockpitBundleArgs } from '../../dashboards/cockpit/bundleArgs';
import { DEFAULT_SLICE } from '../../store/slice/sliceTypes';
import { GOLD } from '../../theme/premium';

const CeoDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: bundle } = useGetCockpitBundleQuery(cockpitBundleArgs('CEO', DEFAULT_SLICE));
  return (
    <GridDashboard
      dashboardKey="ceoCockpit"
      title="Кокпит CEO"
      icon={<FundOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
      subtitle={<CockpitInsight role="CEO" bundle={bundle} />}
      headerExtra={<Button onClick={() => navigate('/dashboard/executive')}>Полная картина →</Button>}
    />
  );
};

export default CeoDashboard;
