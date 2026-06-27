/**
 * AssessmentWorkspacePage.tsx — единое рабочее место «Оценка ИС».
 *
 * Объединяет в одной вкладке меню два этапа рабочего процесса оценки,
 * не смешивая их (каждый — на своей под-вкладке, юзабилити сохранена):
 *   • «Новая оценка»      — создание ИС/метрик и инициация периода (форма);
 *   • «Отчёты и реестры»  — риски/недостатки/план/реестр мер + экспорт по периоду.
 *
 * Содержимое неактивной под-вкладки не монтируется до первого открытия,
 * поэтому тяжёлые запросы отчётов не выполняются, пока пользователь на форме.
 */
import React, { useState } from 'react';
import { Tabs } from 'antd';
import { FormOutlined, FileExcelOutlined } from '@ant-design/icons';
import NewAssessmentPage from './NewAssessmentPage';
import ExcelReportsPage from './ExcelReportsPage';

const AssessmentWorkspacePage: React.FC = () => {
  const [tab, setTab] = useState('new');
  return (
    <div style={{ padding: '0 8px' }}>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'new',
            label: <span><FormOutlined /> Новая оценка</span>,
            children: <NewAssessmentPage />,
          },
          {
            key: 'reports',
            label: <span><FileExcelOutlined /> Отчёты и реестры</span>,
            children: <ExcelReportsPage />,
          },
        ]}
      />
    </div>
  );
};

export default AssessmentWorkspacePage;
