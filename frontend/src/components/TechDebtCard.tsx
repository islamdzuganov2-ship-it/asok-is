/**
 * TechDebtCard.tsx — статус технического долга по мерам качества.
 *
 * Компактный, читаемый на узких экранах вид: фильтр периода — отдельной строкой под
 * заголовком (не конкурирует с названием); счётчики статусов — списком строк
 * «цвет · подпись · число» (кликабельны, открывают список мер). Сверху — два burndown.
 */
import React, { useMemo, useState } from 'react';
import { Card, Modal, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FundOutlined } from '@ant-design/icons';
import type { Proposal } from '../store/slices/governanceSlice';
import { BRAND, RAG, ragToken } from '../theme/ragPalette';

const { Text } = Typography;
const TODAY = new Date(2026, 5, 26).getTime();

function parseDue(d?: string): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

type Bucket = 'pending' | 'awaiting' | 'done' | 'overdue';

const STATUS_ROWS: { b: Bucket; label: string; color: string }[] = [
  { b: 'pending', label: 'Ожидают решения', color: RAG.medium.color },
  { b: 'awaiting', label: 'Одобрены, ждут выполнения', color: '#6E89A6' },
  { b: 'done', label: 'Выполнено', color: RAG.good.color },
  { b: 'overdue', label: 'Просрочено / не выполнено', color: RAG.bad.color },
];
const BUCKET_TITLE: Record<Bucket, string> = Object.fromEntries(
  STATUS_ROWS.map((r) => [r.b, r.label]),
) as Record<Bucket, string>;

interface Props {
  proposals: Proposal[];
  onOpenMeasure?: (p: Proposal) => void;
}

export const TechDebtCard: React.FC<Props> = ({ proposals, onOpenMeasure }) => {
  const [year, setYear] = useState<string | undefined>();
  const [quarter, setQuarter] = useState<number | undefined>();
  const [detail, setDetail] = useState<Bucket | null>(null);

  const years = useMemo(() => {
    const ys = new Set<number>();
    proposals.forEach((p) => { const d = parseDue(p.dueDate); if (d) ys.add(d.getFullYear()); });
    return [...ys].sort();
  }, [proposals]);

  const filtered = useMemo(() => proposals.filter((p) => {
    if (!year && !quarter) return true;
    const d = parseDue(p.dueDate);
    if (!d) return false;
    if (year && String(d.getFullYear()) !== year) return false;
    if (quarter && Math.floor(d.getMonth() / 3) + 1 !== quarter) return false;
    return true;
  }), [proposals, year, quarter]);

  const lists: Record<Bucket, Proposal[]> = useMemo(() => {
    const approved = filtered.filter((p) => p.status === 'APPROVED');
    return {
      pending: filtered.filter((p) => p.status === 'PENDING_APPROVAL'),
      awaiting: approved.filter((p) => !p.execution),
      done: approved.filter((p) => p.execution === 'DONE'),
      overdue: approved.filter((p) =>
        p.execution === 'NOT_DONE' || (!p.execution && (parseDue(p.dueDate)?.getTime() ?? Infinity) < TODAY)),
    };
  }, [filtered]);

  const approvedCount = filtered.filter((p) => p.status === 'APPROVED').length;
  const donePct = approvedCount ? Math.round((lists.done.length / approvedCount) * 100) : 0;
  const totalActionable = lists.pending.length + approvedCount;
  const resolvedPct = totalActionable ? Math.round((lists.done.length / totalActionable) * 100) : 0;

  const detailColumns: ColumnsType<Proposal> = [
    { title: 'Мера', dataIndex: 'riskTitle', render: (v: string, r) => v || r.metricName },
    { title: 'ИС', dataIndex: 'systemName', width: 170 },
    { title: '%', dataIndex: 'calculatedScore', width: 64,
      render: (v: number) => <Tag color={ragToken(v).color} style={{ color: '#fff', border: 'none' }}>{v}%</Tag> },
    { title: 'Срок', dataIndex: 'dueDate', width: 104 },
  ];

  const barText: React.CSSProperties = { fontSize: 12, color: BRAND.inkSoft };

  return (
    <Card
      title={<span style={{ color: BRAND.ink }}><FundOutlined /> Статус технического долга</span>}
      style={{ borderColor: BRAND.divider, height: '100%' }}
    >
      {/* Период — отдельной строкой под заголовком, не конкурирует с названием */}
      <Space size={8} style={{ marginBottom: 14 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Период:</Text>
        <Select allowClear placeholder="Год" size="small" style={{ width: 92 }} value={year} onChange={setYear}
          options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        <Select allowClear placeholder="Квартал" size="small" style={{ width: 104 }} value={quarter} onChange={setQuarter}
          options={[1, 2, 3, 4].map((q) => ({ value: q, label: `Q${q}` }))} />
      </Space>

      <div style={barText}>Выполнено из одобренных мер</div>
      <Progress percent={donePct} strokeColor={RAG.good.color} trailColor={BRAND.divider} />

      <div style={barText}>Закрыто от всех мер в работе</div>
      <Progress percent={resolvedPct} strokeColor={RAG.medium.color} trailColor={BRAND.divider} />

      {/* Счётчики статусов — читаемым списком строк */}
      <div style={{ marginTop: 10 }}>
        {STATUS_ROWS.map((r, i) => (
          <div
            key={r.b}
            onClick={() => lists[r.b].length && setDetail(r.b)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 2px', borderTop: i ? `1px solid ${BRAND.divider}` : 'none',
              cursor: lists[r.b].length ? 'pointer' : 'default',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color, flex: '0 0 auto' }} />
              <Text style={{ fontSize: 13, color: BRAND.ink }}>{r.label}</Text>
            </span>
            <Text strong style={{ fontSize: 17, color: r.color, marginLeft: 8 }}>{lists[r.b].length}</Text>
          </div>
        ))}
      </div>

      <Text style={{ fontSize: 13, display: 'block', marginTop: 12 }}>
        Всего одобрено: <b>{approvedCount}</b> · из них выполнено: <b style={{ color: RAG.good.color }}>{lists.done.length}</b>
      </Text>

      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={620}
        title={detail ? `${BUCKET_TITLE[detail]} (${lists[detail].length})` : ''}
      >
        {detail && (
          <Table<Proposal>
            dataSource={lists[detail]}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            columns={detailColumns}
            onRow={(rec) => ({
              onClick: () => { onOpenMeasure?.(rec); setDetail(null); },
              style: { cursor: onOpenMeasure ? 'pointer' : 'default' },
            })}
          />
        )}
      </Modal>
    </Card>
  );
};

export default TechDebtCard;
