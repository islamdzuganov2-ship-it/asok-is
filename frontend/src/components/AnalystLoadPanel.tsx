/**
 * AnalystLoadPanel.tsx — вкладка «Глубина и чек-лист» раздела «Внесение данных» (BL-007 RE-19).
 *
 * Снимает объём с роли аналитика, не деля роль (§6.2 ТЗ контура):
 *  • глубина оценки по классу ИС — полная / профильная / скрининг (менять может QM, не сам аналитик);
 *  • дельта-переоценка — перенос значений прошлого завершённого периода, правятся только изменения;
 *  • self-service чек-лист владельца ИС — владелец прикладывает артефакты, аналитик проверяет
 *    случайную выборку (SoD: свой ответ не проверяется);
 *  • норматив часов на оценку по глубине — факт против норматива.
 * Всё считает бэкенд (assessment/analyst_load_service.py), здесь — подача и действия.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useGetAssessmentPeriodsQuery, useGetSystemsQuery } from '../store/api/apiSlice';
import { message } from '../theme/appMessage';
import { premiumCard, SPACE } from '../theme/premium';
import { numericColumn } from '../theme/table';

const { Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`);
  }
  return r.json();
}

interface DepthInfo { depth: string; depthLabel: string; requiredCount: number; totalCount: number; criticality: string | null }
interface DeltaSummary { required: number; carriedOver: number; reassessed: number }
interface ChecklistItem {
  id: string; characteristic: string; subcharacteristic: string; question: string;
  answer: string | null; artifact_url: string | null; submitted_by: string | null;
  sampled: boolean; verification: string; verified_by: string | null; verifier_comment: string | null;
}
interface EffortRow { depth: string; depthLabel: string; normHours: number; periods: number; periodsWithoutHours: number; avgHours: number | null; deviationPct: number | null; requiredSubchars: number }
interface EffortReport { rows: EffortRow[]; checklist: { items: number; answered: number; sampled: number; rejected: number } }

export const VERIFICATION_LABEL: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'ждёт ответа владельца', color: 'default' },
  SUBMITTED: { label: 'ответ получен', color: 'blue' },
  NOT_SAMPLED: { label: 'принят без проверки', color: 'cyan' },
  VERIFIED: { label: 'проверен', color: 'green' },
  REJECTED: { label: 'отклонён', color: 'red' },
};

const DEPTH_OPTIONS = [
  { value: 'FULL', label: 'Полная (31 подхарактеристика)' },
  { value: 'PROFILE', label: 'Профильная + скрининг' },
  { value: 'SCREENING', label: 'Скрининг (по одной на характеристику)' },
];

const AnalystLoadPanel: React.FC = () => {
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const canEdit = permissions.includes('assessment.edit');
  const canSetDepth = permissions.includes('assessment.review');
  const { data: periods = [] } = useGetAssessmentPeriodsQuery();
  const { data: systemsResp } = useGetSystemsQuery();
  const systemName = useMemo(() => new Map((systemsResp?.items ?? []).map((s) => [s.id, s.name])), [systemsResp]);
  const [periodId, setPeriodId] = useState<string | undefined>();
  const [depth, setDepth] = useState<DepthInfo | null>(null);
  const [delta, setDelta] = useState<DeltaSummary | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [effort, setEffort] = useState<EffortReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<{ id: string; comment: string } | null>(null);

  const openPeriods = periods.filter((p) => p.status !== 'COMPLETE');

  const loadPeriod = useCallback(async (id: string) => {
    try {
      const [d, s, c] = await Promise.all([
        call<DepthInfo>(`/assessments/${id}/depth`),
        call<DeltaSummary>(`/assessments/${id}/delta-summary`),
        canEdit ? call<ChecklistItem[]>(`/assessments/${id}/checklist`) : Promise.resolve([]),
      ]);
      setDepth(d); setDelta(s); setItems(c);
    } catch (e: any) { message.error(e.message); }
  }, [canEdit]);

  useEffect(() => { if (periodId) loadPeriod(periodId); }, [periodId, loadPeriod]);
  useEffect(() => {
    call<EffortReport>('/assessments/analyst-effort/report').then(setEffort).catch(() => setEffort(null));
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); message.success(ok); if (periodId) await loadPeriod(periodId); }
    catch (e: any) { message.error(e.message); }
    finally { setBusy(null); }
  };

  const itemCols: ColumnsType<ChecklistItem> = [
    { title: 'Подхарактеристика', key: 'sub', width: 220,
      render: (_: unknown, r) => <><Text strong>{r.subcharacteristic}</Text><div><Text type="secondary" style={{ fontSize: 12 }}>{r.characteristic}</Text></div></> },
    { title: 'Ответ владельца', key: 'answer',
      render: (_: unknown, r) => (r.answer || r.artifact_url
        ? <>{r.answer && <div>{r.answer}</div>}{r.artifact_url && <a href={r.artifact_url} target="_blank" rel="noreferrer">артефакт</a>}
            {r.submitted_by && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.submitted_by}</Text></div>}</>
        : <Text type="secondary">—</Text>) },
    { title: 'Статус', key: 'status', width: 190,
      render: (_: unknown, r) => {
        const v = VERIFICATION_LABEL[r.verification] ?? { label: r.verification, color: 'default' };
        return <Space direction="vertical" size={2}>
          <Tag color={v.color}>{v.label}</Tag>
          {r.sampled && r.verification === 'SUBMITTED' && <Tag color="purple">в выборке на проверку</Tag>}
          {r.verifier_comment && <Text type="secondary" style={{ fontSize: 12 }}>{r.verifier_comment}</Text>}
        </Space>;
      } },
    { title: '', key: 'actions', width: 210,
      render: (_: unknown, r) => (r.sampled && r.verification === 'SUBMITTED' && canEdit ? (
        <Space>
          <Button size="small" type="primary" loading={busy === `v${r.id}`}
            onClick={() => act(`v${r.id}`, () => call(`/assessments/checklist/${r.id}/verify`, { method: 'PUT', body: JSON.stringify({ verdict: 'VERIFIED' }) }), 'Пункт подтверждён')}>
            Подтвердить
          </Button>
          <Button size="small" danger onClick={() => setReject({ id: r.id, comment: '' })}>Отклонить</Button>
        </Space>
      ) : null) },
  ];

  const effortCols: ColumnsType<EffortRow> = [
    { title: 'Глубина', dataIndex: 'depthLabel' },
    numericColumn<EffortRow>({ title: 'Подхарактеристик', dataIndex: 'requiredSubchars', width: 140 }),
    numericColumn<EffortRow>({ title: 'Норматив, ч', dataIndex: 'normHours', width: 120 }),
    numericColumn<EffortRow>({ title: 'Факт, ч (среднее)', dataIndex: 'avgHours', width: 150, render: (v: number | null) => v ?? '—' }),
    numericColumn<EffortRow>({ title: 'Отклонение', dataIndex: 'deviationPct', width: 120,
      render: (v: number | null) => (v === null ? '—' : <Text type={v > 0 ? 'danger' : 'success'}>{v > 0 ? '+' : ''}{v}%</Text>) }),
    numericColumn<EffortRow>({ title: 'Оценок', dataIndex: 'periods', width: 90 }),
    numericColumn<EffortRow>({ title: 'Без учёта часов', dataIndex: 'periodsWithoutHours', width: 140 }),
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert type="info" showIcon
        message="Объём оценки — по классу ИС"
        description="Mission Critical — полная оценка, Business Critical — профильные подхарактеристики и скрининг, вспомогательные ИС — только скрининг. Значения прошлого периода можно перенести и переоценить только изменившееся; артефакты собирает владелец ИС, аналитик проверяет выборку." />

      <Card {...premiumCard('slate')} title="Период оценки">
        <Select
          showSearch optionFilterProp="label" style={{ minWidth: 360 }} placeholder="Выберите незавершённый период"
          value={periodId} onChange={setPeriodId}
          options={openPeriods.map((p) => ({ value: p.id, label: `${systemName.get(p.system_id) ?? p.system_id} · ${p.period}` }))}
        />
        {periodId && depth && (
          <Descriptions size="small" column={2} bordered style={{ marginTop: SPACE.base }}>
            <Descriptions.Item label="Класс ИС">{depth.criticality ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Глубина">
              {canSetDepth ? (
                <Select size="small" style={{ minWidth: 260 }} value={depth.depth} options={DEPTH_OPTIONS}
                  onChange={(v) => act('depth', () => call(`/assessments/${periodId}/depth`, { method: 'PUT', body: JSON.stringify({ depth: v }) }), 'Глубина изменена')} />
              ) : depth.depthLabel}
            </Descriptions.Item>
            <Descriptions.Item label="Обязательно к заполнению">{depth.requiredCount} из {depth.totalCount}</Descriptions.Item>
            <Descriptions.Item label="Перенесено / переоценено">
              {delta ? `${delta.carriedOver} / ${delta.reassessed}` : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
        {periodId && canEdit && (
          <Button style={{ marginTop: SPACE.base }} loading={busy === 'carry'}
            onClick={() => act('carry', () => call(`/assessments/${periodId}/carry-over`, { method: 'POST' }), 'Значения прошлого периода перенесены')}>
            Перенести значения прошлого периода
          </Button>
        )}
      </Card>

      {periodId && canEdit && (
        <Card {...premiumCard('sage')} title="Чек-лист владельца ИС"
          extra={<Space>
            <Button size="small" loading={busy === 'gen'}
              onClick={() => act('gen', () => call(`/assessments/${periodId}/checklist/generate`, { method: 'POST' }), 'Чек-лист сформирован')}>
              Сформировать
            </Button>
            <Button size="small" type="primary" loading={busy === 'sample'}
              onClick={() => act('sample', () => call(`/assessments/${periodId}/checklist/sample`, { method: 'POST' }), 'Выборка на проверку сформирована')}>
              Выборка 20%
            </Button>
          </Space>}
          styles={{ body: { padding: 0 } }}>
          <Table<ChecklistItem> rowKey="id" size="small" dataSource={items} columns={itemCols}
            pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="Чек-лист не сформирован" /> }} />
        </Card>
      )}

      {effort && (
        <Card {...premiumCard('gold')} title="Норматив часов на оценку" styles={{ body: { padding: 0 } }}>
          <Table<EffortRow> rowKey="depth" size="small" dataSource={effort.rows} columns={effortCols} pagination={false} />
          <div style={{ padding: SPACE.base }}>
            <Text type="secondary">
              Чек-листы: пунктов {effort.checklist.items}, отвечено {effort.checklist.answered},
              в выборке {effort.checklist.sampled}, отклонено {effort.checklist.rejected}.
            </Text>
          </div>
        </Card>
      )}

      <Modal open={!!reject} title="Отклонить ответ владельца" okText="Отклонить" okButtonProps={{ danger: true }}
        onCancel={() => setReject(null)}
        onOk={() => reject && act(`r${reject.id}`, () => call(`/assessments/checklist/${reject.id}/verify`, {
          method: 'PUT', body: JSON.stringify({ verdict: 'REJECTED', comment: reject.comment }),
        }), 'Ответ отклонён').then(() => setReject(null))}>
        <Input.TextArea rows={3} placeholder="Что исправить владельцу (обязательно)"
          value={reject?.comment} onChange={(e) => setReject((r) => (r ? { ...r, comment: e.target.value } : r))} />
      </Modal>
    </Space>
  );
};

export default AnalystLoadPanel;
