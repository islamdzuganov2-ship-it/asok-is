/**
 * CtoDashboard.tsx (ТЗ v21 §6) — кокпит CTO: очередь решений и надёжность ИТ-ландшафта.
 * Полная лента виджетов (прежний контур) остаётся доступна по ссылке «Полная картина» (§11.1).
 */
import React from 'react';
import { FundOutlined } from '@ant-design/icons';
import ExecCockpit from '../../dashboards/cockpit/ExecCockpit';
import { CTO_TILES } from '../../dashboards/cockpit/ctoTiles';
import { GOLD } from '../../theme/premium';

const CtoDashboard: React.FC = () => (
  <ExecCockpit
    dashboardKey="cto-cockpit"
    title="Кокпит CTO"
    icon={<FundOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
    tiles={CTO_TILES}
    defaultLens="score"
    fullPictureHref="/dashboard/executive"
    role="cto"
  />
);

export default CtoDashboard;
