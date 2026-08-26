/**
 * QualityDynamicsPage.tsx — вкладка менеджера по качеству «Динамика качества».
 *
 * Три карточки (интегральный тренд ИС, характеристики во времени, подхарактеристики) вынесены в
 * каталог, выбор ИС и модалка причин изменения — в DynamicsScope. Аномальные изменения
 * (|Δ| ≥ порога) по-прежнему подсвечиваются красными маркерами, причины вводятся в модалке.
 */
import React from 'react';
import { LineChartOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const QualityDynamicsPage: React.FC = () => (
  <GridDashboard
    dashboardKey="dynamics"
    title="Динамика качества"
    subtitle="Изменение качества во времени по характеристикам и подхарактеристикам"
    icon={<LineChartOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default QualityDynamicsPage;
