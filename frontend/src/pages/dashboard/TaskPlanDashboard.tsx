/**
 * TaskPlanDashboard.tsx — «План задач по повышению качества» (формирование тех. долга).
 *
 * Карточки (эффективность сотрудников, диаграмма Ганта, пузырьковая карта со списком задач)
 * вынесены в каталог, фильтры и карточка задачи — в TaskPlanScope.
 *
 * Эскалация (SoD) без изменений:
 *   • инициирует ТОЛЬКО менеджер по качеству — с причиной невыполнения/просрочки;
 *   • решение принимает ТОЛЬКО топ-менеджмент — «указание игнорировать» или «запросить доп. меры»;
 *   • после решения задачу отрабатывает менеджер по качеству.
 */
import React from 'react';
import { ScheduleOutlined } from '@ant-design/icons';
import GridDashboard from '../../dashboards/GridDashboard';
import { GOLD } from '../../theme/premium';

const TaskPlanDashboard: React.FC = () => (
  <GridDashboard
    dashboardKey="taskplan"
    title="План задач по повышению качества"
    subtitle="Формирование и контроль технического долга качества"
    icon={<ScheduleOutlined style={{ color: GOLD.base, marginRight: 8 }} />}
  />
);

export default TaskPlanDashboard;
