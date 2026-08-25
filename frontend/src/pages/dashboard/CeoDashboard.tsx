/**
 * CeoDashboard.tsx (ТЗ v21 §5) — кокпит CEO: деньги под риском и решения, требующие подписи.
 * Полная лента виджетов (прежний контур) остаётся доступна по ссылке «Полная картина» (§11.1).
 */
import React from 'react';
import { FundOutlined } from '@ant-design/icons';
import ExecCockpit from '../../dashboards/cockpit/ExecCockpit';
import { CEO_TILES } from '../../dashboards/cockpit/ceoTiles';
import { GOLD } from '../../theme/premium';

const CeoDashboard: React.FC = () => (
  <ExecCockpit
    dashboardKey="ceo-cockpit"
    title="Кокпит CEO"
    icon={<FundOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
    tiles={CEO_TILES}
    defaultLens="ale"
    fullPictureHref="/dashboard/executive"
    role="ceo"
  />
);

export default CeoDashboard;
