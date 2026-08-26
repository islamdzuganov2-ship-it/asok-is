/**
 * AssigneeTasksPage.tsx — «Мои задачи» для роли «Исполнитель» (ТЗ v17, req 6).
 *
 * Исполнитель видит назначенные на него поручения (меры, где owner = его ФИО) и может задавать
 * уточнения, предлагать новый срок, проставлять трудоёмкость и факт по бюджету. Всё это «падает»
 * менеджеру по качеству (см. governanceSlice) — логика перенесена в MyTasksScope без изменений,
 * карточки живут в каталоге и доступны на любом дашборде.
 */
import React from 'react';
import { ScheduleOutlined } from '@ant-design/icons';
import GridDashboard from '../dashboards/GridDashboard';
import { GOLD } from '../theme/premium';

const AssigneeTasksPage: React.FC = () => (
  <GridDashboard
    dashboardKey="mytasks"
    title="Мои задачи"
    subtitle="Поручения, назначенные на вас. Уточнения и предложения по срокам направляются менеджеру по качеству."
    icon={<ScheduleOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default AssigneeTasksPage;
