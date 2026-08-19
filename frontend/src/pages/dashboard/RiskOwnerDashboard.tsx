/**
 * RiskOwnerDashboard.tsx (BL-008) — основной дашборд роли «Владелец риска» (RISK_MANAGER).
 * Построен на DashboardShell: пользователь настраивает состав виджетов под себя («Настроить» →
 * галочки + перетаскивание, раскладка сохраняется per-user на бэкенде). Виджеты — в riskWidgets.
 */
import React from 'react';
import { Button, Space } from 'antd';
import { SafetyCertificateOutlined, WarningOutlined, AuditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../../dashboards/DashboardShell';
import { RISK_WIDGETS } from '../../dashboards/riskWidgets';
import { GOLD } from '../../theme/premium';

const RiskOwnerDashboard: React.FC = () => {
  const navigate = useNavigate();
  return (
    <DashboardShell
      dashboardKey="risk"
      widgets={RISK_WIDGETS}
      icon={<SafetyCertificateOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
      title="Основное — владелец риска"
      subtitle="Сводка риск-контура: техсбои, проактивные триггеры, реестр и экономика риска. «Настроить» — свой состав виджетов."
      headerExtra={
        <Space wrap>
          {/* Обе кнопки — равноправные переходы, не вкладки: «Риск-экономика» раньше была
              жёстко на type="primary" и всегда выглядела «выбранной» (тёмная заливка), даже
              находясь на «Основное» — читалось как будто мы уже на странице риск-экономики. */}
          <Button icon={<WarningOutlined />} onClick={() => navigate('/risks')}>Реестр рисков</Button>
          <Button icon={<AuditOutlined />} onClick={() => navigate('/risk-economics')}>Риск-экономика</Button>
        </Space>
      }
    />
  );
};

export default RiskOwnerDashboard;
