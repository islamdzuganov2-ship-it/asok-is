/**
 * SettingsPage.tsx — «Настройка» для аналитика и менеджера по качеству (ТЗ v17, req 3/4).
 *
 * У топ-менеджера своя «Настройка» — AdminFlagsPage (переключатели дашбордов + оформление, req 5).
 * Здесь пока только оформление (тема + шрифт); блок вынесен в переиспользуемый ThemeSettingsCard.
 */
import React from 'react';
import { Typography } from 'antd';
import { accentDot, pageContainer, pageTitle, GOLD } from '../theme/premium';
import ThemeSettingsCard from '../components/ThemeSettingsCard';

const { Title, Text } = Typography;

const SettingsPage: React.FC = () => (
  <div style={pageContainer}>
    <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Настройка</Title>
    <Text type="secondary">Персональные настройки интерфейса.</Text>
    <div style={{ marginTop: 16 }}>
      <ThemeSettingsCard />
    </div>
  </div>
);

export default SettingsPage;
