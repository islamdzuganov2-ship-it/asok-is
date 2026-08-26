/**
 * RiskOwnerDashboard.tsx (BL-008) — основной дашборд роли «Владелец риска» (RISK_MANAGER).
 *
 * Первый дашборд, который умел настраиваться (DashboardShell: галочки + порядок списком).
 * Теперь на общем конструкторе: те же виджеты стали карточками каталога, к вкл/выкл и порядку
 * добавились свободное расположение, размеры и возможность взять карточку с любого другого
 * доступного дашборда. Сохранённые ранее настройки (prefs.dashboards.risk.widgets) читаются
 * и конвертируются в раскладку — см. useDashboardLayout.layoutFromWidgets.
 */
import React from 'react';
import { Button, Space } from 'antd';
import { SafetyCertificateOutlined, WarningOutlined, AuditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const RiskOwnerDashboard: React.FC = () => {
  const navigate = useNavigate();
  return (
    <GridDashboard
      dashboardKey="risk"
      icon={<SafetyCertificateOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
      title="Основное — владелец риска"
      subtitle="Сводка риск-контура: техсбои, проактивные триггеры, реестр и экономика риска"
      headerExtra={
        <Space wrap>
          {/* Обе кнопки — равноправные переходы, не вкладки: «Риск-экономика» раньше была
              жёстко на type="primary" и всегда выглядела «выбранной». */}
          <Button icon={<WarningOutlined />} onClick={() => navigate('/risks')}>Реестр рисков</Button>
          <Button icon={<AuditOutlined />} onClick={() => navigate('/risk-economics')}>Риск-экономика</Button>
        </Space>
      }
    />
  );
};

export default RiskOwnerDashboard;
