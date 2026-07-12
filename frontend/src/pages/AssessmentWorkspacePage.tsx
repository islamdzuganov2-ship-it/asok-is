/**
 * AssessmentWorkspacePage.tsx — раздел «Внесение данных» (ранее «Оценка ИС», ТЗ v16 T-44).
 *
 * Рабочее место внесения и сопровождения данных оценки. Каждый этап — на своей под-вкладке
 * (юзабилити сохранена), содержимое неактивной вкладки не монтируется до первого открытия:
 *   • «Новая оценка»      — создание ИС/метрик и инициация периода (форма);
 *   • «Отчёты и реестры»  — риски/недостатки/план/реестр мер + экспорт по периоду.
 *
 * План (ТЗ v16 T-45): расширить до 7 вкладок — Новая оценка · Корректировка оценки ·
 * Внесение проф. суждения · Формирование отчётов (CSV) · Загрузка оценок · Загрузка ТС ·
 * Реестры мер. Наполняются по одной отдельными задачами.
 */
import React, { useState } from 'react';
import { Tabs, Typography } from 'antd';
import { FormOutlined, FileExcelOutlined } from '@ant-design/icons';
import NewAssessmentPage from './NewAssessmentPage';
import ExcelReportsPage from './ExcelReportsPage';

const { Title, Text } = Typography;

const AssessmentWorkspacePage: React.FC = () => {
  const [tab, setTab] = useState('new');
  return (
    <div style={{ padding: '0 8px' }}>
      <div style={{ padding: '4px 4px 0' }}>
        <Title level={3} style={{ marginBottom: 0 }}>Внесение данных</Title>
        <Text type="secondary">Внесение и сопровождение оценок качества ИС · загрузка данных из внешних источников</Text>
      </div>
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
