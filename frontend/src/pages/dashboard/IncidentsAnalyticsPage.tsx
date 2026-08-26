/**
 * IncidentsAnalyticsPage.tsx — «Аналитика технических сбоев» (T-21).
 *
 * Отдельный анализатор надёжности: первопричины, MTTR, тайминги устранения, топ нестабильных ИС,
 * реестр сбоев. Карточки — в каталоге, фильтры (ИС T-39, кварталы T-40) и карточка сбоя —
 * в IncidentsScope. Источник данных по режиму: 'mock' — демо-набор, 'live' — БД через /incidents.
 * Не вмешивается в расчётный движок оценки качества.
 */
import React from 'react';
import { Button } from 'antd';
import { ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import GridDashboard from '../../dashboards/GridDashboard';
import { accentColorOf } from '../../theme/premium';

const IncidentsAnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const canManage = ['QUALITY_MANAGER', 'ADMIN'].includes(role);

  return (
    <GridDashboard
      dashboardKey="incidents"
      title="Аналитика технических сбоев"
      subtitle="Надёжность ИТ-ландшафта по первопричинам"
      icon={<ThunderboltOutlined style={{ color: accentColorOf('terracotta'), marginRight: 8 }} />}
      headerExtra={canManage ? (
        <Button type="primary" icon={<UploadOutlined />} onClick={() => navigate('/assessments/new?tab=upload-incidents')}>
          Загрузить сбои из Excel
        </Button>
      ) : undefined}
    />
  );
};

export default IncidentsAnalyticsPage;
