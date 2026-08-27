/**
 * MyDashboardPage.tsx — «Мой дашборд»: личный набор карточек (ТЗ v22, БТ-500).
 *
 * Пустой холст, который пользователь наполняет сам из общего каталога — любыми карточками любых
 * доступных ему дашбордов. Отличие от штатных дашбордов только в дефолте: у них он повторяет
 * прежнюю вёрстку, здесь его нет вовсе, потому что смысл раздела — собрать состав под себя.
 */
import React from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const MyDashboardPage: React.FC = () => (
  <GridDashboard
    dashboardKey="my"
    title="Мой дашборд"
    subtitle="Личный набор карточек: соберите то, что важно именно вам"
    icon={<AppstoreOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default MyDashboardPage;
