/**
 * AssessmentWorkspacePage.tsx — раздел «Внесение данных» (ранее «Оценка ИС», ТЗ v16 T-44/T-45).
 *
 * 7 вкладок (содержимое неактивной вкладки монтируется по первому открытию — тяжёлые запросы не
 * выполняются заранее):
 *   1. Новая оценка              — создание ИС/метрик и инициация периода (NewAssessmentPage);
 *   2. Корректировка оценки      — правка завершённых оценок (T-47, бэкенд — в очереди);
 *   3. Внесение проф. суждения   — оценки без суждения (T-48, бэкенд — в очереди);
 *   4. Формирование отчётов (CSV)— выгрузка готовых оценок с проф. суждением (ExcelReportsPage);
 *   5. Загрузка оценок           — Excel/CSV + инструкция + шаблон + предпросмотр (T-50, DataUploadPanel);
 *   6. Загрузка ТС               — Excel/CSV техсбоев + инструкция + шаблон (T-51/T-43, DataUploadPanel);
 *   7. Реестры мер               — полный реестр мер за весь период со статусами (T-52, MeasuresRegistryCard).
 */
import React, { useState } from 'react';
import { Alert, Button, Space, Tabs, Typography, message } from 'antd';
import {
  FormOutlined, EditOutlined, CommentOutlined, FileExcelOutlined,
  UploadOutlined, ThunderboltOutlined, UnorderedListOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { shallowEqual, useSelector } from 'react-redux';
import NewAssessmentPage from './NewAssessmentPage';
import ExcelReportsPage from './ExcelReportsPage';
import DataUploadPanel from '../components/DataUploadPanel';
import { ASSESSMENT_UPLOAD_SPEC, INCIDENT_UPLOAD_SPEC } from '../constants/uploadSpecs';
import { MeasuresRegistryCard } from '../components/MeasuresRegistryCard';
import { MeasureDecisionModal } from '../components/MeasureDecisionModal';
import { selectVisibleProposals, type Proposal } from '../store/slices/governanceSlice';

const { Title, Text } = Typography;

/** Заготовка бэкенд-зависимой вкладки — честно описывает назначение и статус. */
const PlannedTab: React.FC<{ title: string; task: string; children: React.ReactNode }> = ({ title, task, children }) => (
  <div style={{ maxWidth: 900 }}>
    <Title level={4} style={{ marginTop: 0 }}>{title}</Title>
    <Alert
      type="info"
      showIcon
      message={`Раздел в реализации (${task})`}
      description={children}
    />
  </div>
);

// Выгрузка реестра мер в CSV-документ (T-52; задел под ЕХД/DWH). UTF-8 c BOM, разделитель «;».
const STATUS_RU: Record<string, string> = { PENDING_APPROVAL: 'Ожидает решения', APPROVED: 'Одобрена', REJECTED: 'Отклонена' };
const EXEC_RU: Record<string, string> = { DONE: 'Выполнено', NOT_DONE: 'Не выполнено' };

function exportProposalsCsv(rows: Proposal[]) {
  const cols: { title: string; get: (p: Proposal) => unknown }[] = [
    { title: 'ИС', get: (p) => p.systemName },
    { title: 'Характеристика', get: (p) => p.characteristic },
    { title: 'Метрика', get: (p) => p.metricName },
    { title: 'Мера/риск', get: (p) => p.riskTitle || p.metricName },
    { title: 'Балл %', get: (p) => p.calculatedScore },
    { title: 'Уровень', get: (p) => p.calculatedLevel },
    { title: 'Статус', get: (p) => STATUS_RU[p.status] ?? p.status },
    { title: 'Обоснование', get: (p) => p.rationale },
    { title: 'Ответственный', get: (p) => p.owner },
    { title: 'Роль', get: (p) => p.ownerRole },
    { title: 'Срок', get: (p) => p.dueDate },
    { title: 'Решение принял', get: (p) => p.decidedBy },
    { title: 'Комментарий решения', get: (p) => p.decisionComment },
    { title: 'Исполнение', get: (p) => (p.execution ? EXEC_RU[p.execution] ?? p.execution : '') },
    { title: 'Комментарий исполнения', get: (p) => p.executionComment },
    { title: 'Ссылка СУЗ', get: (p) => p.suzLink },
  ];
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.map((c) => esc(c.title)).join(';'), ...rows.map((p) => cols.map((c) => esc(c.get(p))).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reestr_mer.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Вкладка «Реестры мер» — полный реестр governance-мер со статусами/решениями/комментариями. */
const MeasuresRegistryTab: React.FC = () => {
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const [decision, setDecision] = useState<Proposal | null>(null);
  return (
    <div>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <div>
          <Title level={4} style={{ marginTop: 0, marginBottom: 2 }}>Реестры мер</Title>
          <Text type="secondary">Полный список мер за весь период: статусы, решения, комментарии, ответственные, сроки, исполнение. Клик по мере — карточка.</Text>
        </div>
        <Button
          icon={<DownloadOutlined />}
          disabled={!proposals.length}
          onClick={() => { exportProposalsCsv(proposals); message.success(`Реестр мер выгружен в CSV (${proposals.length})`); }}
        >
          Выгрузить в CSV
        </Button>
      </Space>
      <MeasuresRegistryCard proposals={proposals} onOpen={setDecision} />
      <MeasureDecisionModal open={!!decision} proposal={decision} onClose={() => setDecision(null)} />
    </div>
  );
};

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
            key: 'edit',
            label: <span><EditOutlined /> Корректировка оценки</span>,
            children: (
              <PlannedTab title="Корректировка оценки" task="ТЗ v16, T-47">
                <Space direction="vertical" size={4}>
                  <Text>Здесь отображаются все <b>завершённые</b> оценки с возможностью открыть период на редактирование значений и комментариев.</Text>
                  <Text type="secondary">Требует бэкенд-эндпоинт разблокировки/патча завершённого периода. Пока правка доступна из «Новой оценки» и «Отчётов».</Text>
                </Space>
              </PlannedTab>
            ),
          },
          {
            key: 'judgment',
            label: <span><CommentOutlined /> Внесение проф. суждения</span>,
            children: (
              <PlannedTab title="Внесение профессионального суждения" task="ТЗ v16, T-48">
                <Space direction="vertical" size={4}>
                  <Text>Показывает <b>только</b> оценки/метрики <b>без внесённого</b> профессионального суждения; ввод/правка суждения со связкой «оценка ↔ суждение».</Text>
                  <Text type="secondary">Требует бэкенд-фильтр «без суждения». Внесение суждений по метрикам сейчас доступно на дашборде «Основное» и в «Экспертизе».</Text>
                </Space>
              </PlannedTab>
            ),
          },
          {
            key: 'reports',
            label: <span><FileExcelOutlined /> Формирование отчётов (CSV)</span>,
            children: <ExcelReportsPage />,
          },
          {
            key: 'upload-assessments',
            label: <span><UploadOutlined /> Загрузка оценок</span>,
            children: <DataUploadPanel spec={ASSESSMENT_UPLOAD_SPEC} />,
          },
          {
            key: 'upload-incidents',
            label: <span><ThunderboltOutlined /> Загрузка ТС</span>,
            children: <DataUploadPanel spec={INCIDENT_UPLOAD_SPEC} />,
          },
          {
            key: 'measures',
            label: <span><UnorderedListOutlined /> Реестры мер</span>,
            children: <MeasuresRegistryTab />,
          },
        ]}
      />
    </div>
  );
};

export default AssessmentWorkspacePage;
