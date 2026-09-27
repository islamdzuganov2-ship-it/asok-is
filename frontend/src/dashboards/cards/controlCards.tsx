/**
 * controlCards.tsx — карточки управленческого контура ТЗ-19, самодостаточные (scope 'none'):
 * каждая сама тянет свои данные и не зависит от соседей по дашборду.
 *
 *  • «Нагрузка и балансировка» (УК-32, УК-33) — кто перегружен, кто свободен, из чего сложился вес
 *    каждой меры (УК-31) и что кому передать;
 *  • «Сверка исполнения» (УК-45) — меры, отмеченные исполненными, по которым сбои продолжаются:
 *    сигнал менеджеру по качеству, решение — за ним;
 *  • «Приоритет бюджетных заявок» (УК-54) — заявки на CAPEX в порядке составного веса и сколько
 *    строк укладывается в заданный бюджет (распределение бюджета — вне системы).
 */
import React, { useState } from 'react';
import { Alert, Empty, InputNumber, List, Space, Tag, Tooltip, Typography } from 'antd';
import AppTable from '../../components/AppTable';
import type { ColumnsType } from 'antd/es/table';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import {
  useGetBudgetQueueQuery, useGetExecutionMismatchesQuery, useGetExecutorLoadQuery,
  type BudgetQueueRow, type ExecutorLoadRow, type LoadMeasure,
} from '../../store/api/controlApi';
import { numericColumn, sorterFor } from '../../theme/table';
import { RAG } from '../../theme/ragPalette';
import { SPACE, TYPE } from '../../theme/premium';
import { fmtMoney } from '../../utils/money';
import GridCard from '../GridCard';

const { Text } = Typography;

const STATE_TAG: Record<ExecutorLoadRow['state'], { color: string; label: string }> = {
  overloaded: { color: 'red', label: 'перегружен' },
  normal: { color: 'default', label: 'в норме' },
  free: { color: 'green', label: 'свободен' },
};

/** Карточки контура работают на живых данных: в демо-режиме честно говорим, что их нет. */
const useLive = () => useSelector((s: RootState) => s.ui.dataMode === 'live');
const LiveOnly: React.FC = () => (
  <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
    Доступно в режиме LLM (живые данные): считается по мерам и сбоям из БД.
  </Text>
);

// ─────────────────── УК-32/33: нагрузка и балансировка ───────────────────

const measureColumns: ColumnsType<LoadMeasure> = [
  { title: 'Мера', dataIndex: 'title', ellipsis: true, sorter: sorterFor((m: LoadMeasure) => m.title) },
  { title: 'ИС', dataIndex: 'system', width: 160, ellipsis: true, sorter: sorterFor((m: LoadMeasure) => m.system) },
  numericColumn({ title: 'Часы', dataIndex: 'hours', width: 80, sorter: sorterFor((m: LoadMeasure) => m.hours),
    render: (v: number | null) => (v == null ? <Text type="secondary">нет оценки</Text> : v) }),
  numericColumn({ title: 'Вес', dataIndex: 'weight', width: 150, sorter: sorterFor((m: LoadMeasure) => m.weight),
    // УК-31: видно, из чего сложился вес конкретной меры.
    render: (v: number | null, m: LoadMeasure) => (
      <Tooltip title={m.weightExplained}><span style={{ borderBottom: '1px dotted' }}>{v ?? '—'}</span></Tooltip>
    ) }),
];

export const ExecutorLoadCard: React.FC = () => {
  const live = useLive();
  const { data, isFetching, error } = useGetExecutorLoadQuery(undefined, { skip: !live });
  const columns: ColumnsType<ExecutorLoadRow> = [
    { title: 'Исполнитель', dataIndex: 'owner', width: 200, sorter: sorterFor((r: ExecutorLoadRow) => r.owner),
      render: (o: string) => <Text strong>{o}</Text> },
    { title: 'Состояние', dataIndex: 'state', width: 120, sorter: sorterFor((r: ExecutorLoadRow) => r.loadPct),
      render: (s: ExecutorLoadRow['state']) => <Tag color={STATE_TAG[s].color}>{STATE_TAG[s].label}</Tag> },
    numericColumn({ title: 'Мер', dataIndex: 'openMeasures', width: 70, sorter: sorterFor((r: ExecutorLoadRow) => r.openMeasures) }),
    numericColumn({ title: 'Часы / норма', dataIndex: 'hours', width: 130, sorter: sorterFor((r: ExecutorLoadRow) => r.hours),
      render: (v: number, r: ExecutorLoadRow) => `${v} / ${r.normHours}` }),
    numericColumn({ title: 'Вес мер', dataIndex: 'weightedLoad', width: 110, sorter: sorterFor((r: ExecutorLoadRow) => r.weightedLoad) }),
    numericColumn({ title: 'Без оценки часов', dataIndex: 'withoutEstimate', width: 150,
      sorter: sorterFor((r: ExecutorLoadRow) => r.withoutEstimate),
      render: (v: number) => (v ? <Text style={{ color: RAG.medium.strong }}>{v}</Text> : 0) }),
    numericColumn({ title: 'Просрочено', dataIndex: 'overdue', width: 110, sorter: sorterFor((r: ExecutorLoadRow) => r.overdue),
      render: (v: number) => (v ? <Text style={{ color: RAG.bad.strong }}>{v}</Text> : 0) }),
    numericColumn({ title: 'На MC-системах', dataIndex: 'onCriticalSystems', width: 140,
      sorter: sorterFor((r: ExecutorLoadRow) => r.onCriticalSystems) }),
  ];
  return (
    <GridCard title="Нагрузка и балансировка исполнителей" accent="slate" hint={data?.note}>
      {!live ? <LiveOnly /> : error ? <Alert type="error" showIcon message="Нагрузка недоступна" /> : (
        <Space direction="vertical" style={{ width: '100%' }} size={SPACE.cozy}>
          {(data?.hints.length ?? 0) > 0 && (
            <Alert type="warning" showIcon message="Рекомендации по перераспределению"
              description={
                <List size="small" dataSource={data!.hints} renderItem={(h) => (
                  <List.Item style={{ padding: '2px 0' }}>
                    <Text>«{h.title}» ({h.hours} ч): {h.fromOwner} → {h.toOwner}</Text>
                    <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}> — {h.reason}</Text>
                  </List.Item>
                )} />
              } />
          )}
          <AppTable<ExecutorLoadRow>
            tableKey="executor-load" exportName="nagruzka-ispolniteley"
            rowKey="owner" size="small" loading={isFetching} dataSource={data?.rows ?? []} columns={columns}
            pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 1000 }}
            expandable={{
              expandedRowRender: (r) => (
                <AppTable<LoadMeasure> tableKey="executor-load-measures" rowKey="proposalId" size="small" pagination={false}
                  dataSource={r.measures} columns={measureColumns} />
              ),
              rowExpandable: (r) => r.measures.length > 0,
            }}
            locale={{ emptyText: 'Нет открытых мер с ответственными' }}
          />
        </Space>
      )}
    </GridCard>
  );
};

// ─────────────────── УК-45: сверка исполнения со сбоями ───────────────────

export const ExecutionControlCard: React.FC = () => {
  const live = useLive();
  const { data, isFetching } = useGetExecutionMismatchesQuery(undefined, { skip: !live });
  return (
    <GridCard title="Сверка исполнения мер со сбоями" accent="terracotta"
      hint="Мера отмечена исполненной, а сбои той же природы продолжаются — сигнал, решение за вами">
      {!live ? <LiveOnly /> : (
        <List
          loading={isFetching}
          dataSource={data ?? []}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Расхождений не найдено" /> }}
          renderItem={(m) => (
            <List.Item key={m.proposalId}>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Space wrap>
                  <Text strong>{m.title}</Text>
                  <Tag>{m.system}</Tag>
                  <Tag color={m.kind === 'linked' ? 'red' : 'gold'}>
                    {m.kind === 'linked' ? 'сбои по риску меры' : 'похожие сбои без привязки'}
                  </Tag>
                  {m.owner && <Text type="secondary">отв.: {m.owner}</Text>}
                </Space>
                <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>{m.note}</Text>
                {m.incidents.map((i) => (
                  <Text key={i.id} style={{ fontSize: TYPE.caption.fontSize }}>
                    • {new Date(i.occurredAt).toLocaleDateString('ru-RU')} — {i.title}
                    {i.costTotal != null && ` · ${fmtMoney(i.costTotal)}`}
                    {i.similarity != null && ` · сходство ${Math.round(i.similarity * 100)}%`}
                  </Text>
                ))}
              </Space>
            </List.Item>
          )}
        />
      )}
    </GridCard>
  );
};

// ─────────────────── УК-54: приоритет бюджетных заявок ───────────────────

export const BudgetQueueCard: React.FC = () => {
  const live = useLive();
  const [budget, setBudget] = useState<number | null>(null);
  const { data, isFetching } = useGetBudgetQueueQuery(budget, { skip: !live });
  const columns: ColumnsType<BudgetQueueRow> = [
    numericColumn({ title: '№', dataIndex: 'rank', width: 50, sorter: sorterFor((r: BudgetQueueRow) => r.rank) }),
    { title: 'Заявка (мера)', dataIndex: 'title', ellipsis: true, sorter: sorterFor((r: BudgetQueueRow) => r.title),
      render: (t: string, r: BudgetQueueRow) => (
        <Space size={4}>
          <Tooltip title={r.explained}><span>{t}</span></Tooltip>
          {r.isAtypical && <Tooltip title="Деньги продвинули меру на малозначимой характеристике в начало очереди — проверьте"><Tag color="gold">нетипично</Tag></Tooltip>}
        </Space>
      ) },
    { title: 'ИС', dataIndex: 'systemName', width: 150, ellipsis: true, sorter: sorterFor((r: BudgetQueueRow) => r.systemName) },
    numericColumn({ title: 'CAPEX', dataIndex: 'capex', width: 130, sorter: sorterFor((r: BudgetQueueRow) => r.capex), render: fmtMoney }),
    numericColumn({ title: 'Под риском, ₽/год', dataIndex: 'moneyAtRisk', width: 160,
      sorter: sorterFor((r: BudgetQueueRow) => r.moneyAtRisk), render: fmtMoney }),
    numericColumn({ title: 'Накопленно', dataIndex: 'cumulativeCapex', width: 140,
      sorter: sorterFor((r: BudgetQueueRow) => r.cumulativeCapex),
      render: (v: number, r: BudgetQueueRow) => (
        <Text style={{ color: r.withinBudget === false ? RAG.bad.strong : undefined }}>{fmtMoney(v)}</Text>
      ) }),
  ];
  return (
    <GridCard title="Приоритет бюджетных заявок (CAPEX)" accent="gold" hint={data?.note}
      extra={live && (
        <InputNumber size="small" min={0} step={100000} value={budget} onChange={(v) => setBudget(v)}
          placeholder="Бюджет, ₽" style={{ width: 150 }} />
      )}>
      {!live ? <LiveOnly /> : (
        <AppTable<BudgetQueueRow> tableKey="budget-queue" exportName="prioritet-byudzhetnyh-zayavok"
          rowKey="proposalId" size="small" loading={isFetching} dataSource={data?.rows ?? []}
          columns={columns} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 800 }}
          locale={{ emptyText: 'Нет заявок на CAPEX среди открытых мер' }} />
      )}
    </GridCard>
  );
};
