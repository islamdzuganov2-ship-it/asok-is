/**
 * navMeta.tsx — маршрут и иконка для каждого раздела меню.
 *
 * Ключ — код права, тот же, что в NAV_SECTIONS (uiSlice): связь «право → пункт меню» видна без
 * отдельной таблицы соответствий. Вынесено из AppLayout, потому что этими же словарями
 * пользуется редактор порядка меню (SidebarNavEditor) — держать их внутри layout значило бы
 * пробрасывать их обратно вниз через пропсы из места, которое к ним не относится.
 */
import React from 'react';
import {
  DashboardOutlined, FormOutlined, FileExcelOutlined, FundOutlined, AuditOutlined,
  WarningOutlined, LineChartOutlined, ScheduleOutlined, HomeOutlined, ThunderboltOutlined,
  AlertOutlined, SafetyCertificateOutlined, AppstoreOutlined,
} from '@ant-design/icons';

export const ROUTE_BY_PERM: Record<string, string> = {
  'view.my_dashboard': '/dashboard/my',
  'view.dashboard.cto': '/dashboard/cto',
  'view.dashboard.ceo': '/dashboard/ceo',
  'view.dashboard.manager': '/dashboard/manager',
  'view.dashboard.risk': '/dashboard/risk',
  'view.dashboard.analytics': '/dashboard/analytics',
  'view.dashboard.dynamics': '/dashboard/manager/dynamics',
  'view.assessments': '/assessments/new',
  'view.dashboard.incidents': '/dashboard/incidents',
  'view.risks': '/risks',
  'view.risk_economics': '/risk-economics',
  'view.reports': '/reports',
  'view.dashboard.taskplan': '/dashboard/taskplan',
  'view.my_tasks': '/my-tasks',
  'view.dashboard.risk_radar': '/dashboard/risk-radar',
};

export const ICON_BY_PERM: Record<string, React.ReactNode> = {
  'view.my_dashboard': <AppstoreOutlined />,
  'view.dashboard.cto': <FundOutlined />,
  'view.dashboard.ceo': <FundOutlined />,
  'view.dashboard.manager': <HomeOutlined />,
  'view.dashboard.risk': <SafetyCertificateOutlined />,
  'view.dashboard.analytics': <DashboardOutlined />,
  'view.dashboard.dynamics': <LineChartOutlined />,
  'view.assessments': <FormOutlined />,
  'view.dashboard.incidents': <ThunderboltOutlined />,
  'view.risks': <WarningOutlined />,
  'view.risk_economics': <AuditOutlined />,
  'view.reports': <FileExcelOutlined />,
  'view.dashboard.taskplan': <ScheduleOutlined />,
  'view.my_tasks': <ScheduleOutlined />,
  'view.dashboard.risk_radar': <AlertOutlined />,
};
