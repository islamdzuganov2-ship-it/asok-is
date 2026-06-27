/**
 * MeasuresRegistryCard.tsx — реестр мер качества для управленческого дашборда.
 *
 * • По умолчанию показывает только 3 самые приоритетные меры (ожидают решения,
 *   самые критичные, с ближайшим сроком), остальное скрыто под «Показать все».
 * • Фильтры: по названию, системе, статусу, сроку решения.
 * • Сортировка: ожидающие → по критичности (мин. %) → по ближайшему сроку;
 *   если ожидающих нет — одобренные по ближайшему сроку, затем остальные.
 * • Карточки «Срок ≤ 2 дней» и «Просрочено» — быстрый фокус на горящих мерах.
 * Клик по мере открывает окно решения (с комментарием) у родителя.
 */
import React, { useMemo, useState } from 'react';
import { Card, List, Input, Select, Space, Tag, Button, Typography, Empty, Row, Col } from 'antd';
import { AuditOutlined, RightOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import type { Proposal, ProposalStatus } from '../store/slices/governanceSlice';
import { BRAND, RAG, ragToken } from '../theme/ragPalette';

const STATUS_TAG: Record<ProposalStatus, { color: string; label: string }> = {
  PENDING_APPROVAL: { color: 'gold', label: 'Ожидает решения' },
  APPROVED: { color: 'green', label: 'Одобрена' },
  REJECTED: { color: 'red', label: 'Отклонена' },
};
const STATUS_RANK: Record<ProposalStatus, number> = { PENDING_APPROVAL: 0, APPROVED: 1, REJECTED: 2 };

const { Text } = Typography;
const TODAY = new Date(2026, 5, 26); // 26.06.2026 (текущая дата системы)
const DAY = 86400000;

function parseDue(d?: string): number | null {
  if (!d) return null;
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
}

interface Props {
  proposals: Proposal[];
  onOpen: (p: Proposal) => void;
}

export const MeasuresRegistryCard: React.FC<Props> = ({ proposals, onOpen }) => {
  const [q, setQ] = useState('');
  const [system, setSystem] = useState<string | undefined>();
  const [status, setStatus] = useState<ProposalStatus | undefined>();
  const [exec, setExec] = useState<'DONE' | 'NOT_DONE' | 'AWAIT' | undefined>();
  const [due, setDue] = useState<string | undefined>();
  const [quick, setQuick] = useState<'none' | 'soon' | 'overdue'>('none');
  const [showAll, setShowAll] = useState(false);

  const systems = useMemo(() => [...new Set(proposals.map((p) => p.systemName))].sort(), [proposals]);
  const dueDates = useMemo(() => [...new Set(proposals.map((p) => p.dueDate).filter(Boolean))] as string[], [proposals]);

  const isSoon = (p: Proposal) => {
    const t = parseDue(p.dueDate);
    return p.status === 'PENDING_APPROVAL' && t != null && t >= TODAY.getTime() && t <= TODAY.getTime() + 2 * DAY;
  };
  const isOverdue = (p: Proposal) => {
    const t = parseDue(p.dueDate);
    return p.status === 'PENDING_APPROVAL' && t != null && t < TODAY.getTime();
  };
  const soonCount = proposals.filter(isSoon).length;
  const overdueCount = proposals.filter(isOverdue).length;

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = proposals.filter((p) => {
      if (ql && !`${p.riskTitle || ''} ${p.metricName} ${p.systemName}`.toLowerCase().includes(ql)) return false;
      if (system && p.systemName !== system) return false;
      if (status && p.status !== status) return false;
      if (exec === 'DONE' && p.execution !== 'DONE') return false;
      if (exec === 'NOT_DONE' && p.execution !== 'NOT_DONE') return false;
      if (exec === 'AWAIT' && !(p.status === 'APPROVED' && !p.execution)) return false;
      if (due && p.dueDate !== due) return false;
      if (quick === 'soon' && !isSoon(p)) return false;
      if (quick === 'overdue' && !isOverdue(p)) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (a.calculatedScore !== b.calculatedScore) return a.calculatedScore - b.calculatedScore; // критичнее = ниже %
      return (parseDue(a.dueDate) ?? Infinity) - (parseDue(b.dueDate) ?? Infinity);             // ближе срок
    });
  }, [proposals, q, system, status, exec, due, quick]);

  const visible = showAll ? filtered : filtered.slice(0, 3);

  const StatChip: React.FC<{ active: boolean; color: string; icon: React.ReactNode; n: number; label: string; onClick: () => void }> =
    ({ active, color, icon, n, label, onClick }) => (
      <Col xs={12} md={8}>
        <Card
          size="small" hoverable onClick={onClick}
          style={{ borderColor: active ? color : BRAND.divider, background: active ? `${color}14` : undefined }}
          styles={{ body: { padding: '8px 12px' } }}
        >
          <Space>
            <span style={{ color, fontSize: 18 }}>{icon}</span>
            <div>
              <Text strong style={{ fontSize: 18, color }}>{n}</Text>
              <div><Text type="secondary" style={{ fontSize: 12 }}>{label}</Text></div>
            </div>
          </Space>
        </Card>
      </Col>
    );

  return (
    <Card
      style={{ marginTop: 16, borderColor: BRAND.divider }}
      title={
        <span style={{ color: BRAND.ink }}>
          <AuditOutlined /> Реестр мер качества{' '}
          <Text type="secondary" style={{ fontSize: 12 }}>(всего: {proposals.length})</Text>
        </span>
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <StatChip active={quick === 'overdue'} color={RAG.bad.color} icon={<WarningOutlined />} n={overdueCount}
          label="Просрочено по сроку решения"
          onClick={() => setQuick(quick === 'overdue' ? 'none' : 'overdue')} />
        <StatChip active={quick === 'soon'} color={RAG.medium.color} icon={<ClockCircleOutlined />} n={soonCount}
          label="Срок решения ≤ 2 дней"
          onClick={() => setQuick(quick === 'soon' ? 'none' : 'soon')} />
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Поиск: название / метрика / ИС" style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="Система" style={{ width: 200 }} value={system} onChange={setSystem}
          options={systems.map((s) => ({ value: s, label: s }))} showSearch optionFilterProp="label" />
        <Select allowClear placeholder="Статус" style={{ width: 170 }} value={status} onChange={setStatus}
          options={(Object.keys(STATUS_TAG) as ProposalStatus[]).map((s) => ({ value: s, label: STATUS_TAG[s].label }))} />
        <Select allowClear placeholder="Выполнение" style={{ width: 180 }} value={exec} onChange={setExec}
          options={[
            { value: 'DONE', label: 'Выполнено' },
            { value: 'NOT_DONE', label: 'Не выполнено' },
            { value: 'AWAIT', label: 'Ожидает выполнения' },
          ]} />
        <Select allowClear placeholder="Срок решения" style={{ width: 160 }} value={due} onChange={setDue}
          options={dueDates.sort((a, b) => (parseDue(a) ?? 0) - (parseDue(b) ?? 0)).map((d) => ({ value: d, label: d }))} />
      </Space>

      {filtered.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Мер по заданным условиям нет" />
      ) : (
        <>
          <List
            dataSource={visible}
            renderItem={(p) => {
              const st = STATUS_TAG[p.status];
              const tok = ragToken(p.calculatedScore);
              const overdue = isOverdue(p), soon = isSoon(p);
              return (
                <List.Item
                  onClick={() => onOpen(p)}
                  style={{ cursor: 'pointer', borderRadius: 8, padding: '10px 12px' }}
                  actions={[<RightOutlined key="go" style={{ color: BRAND.inkSoft }} />]}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <Text strong>{p.riskTitle || p.metricName}</Text>
                        <Tag color={st.color}>{st.label}</Tag>
                        <Tag color={tok.color} style={{ color: '#fff', border: 'none' }}>{p.calculatedScore}%</Tag>
                        {p.execution === 'DONE' && <Tag color="green">выполнено</Tag>}
                        {p.execution === 'NOT_DONE' && <Tag color="red">не выполнено</Tag>}
                        {p.status === 'APPROVED' && !p.execution && <Tag color="blue">ждёт выполнения</Tag>}
                        {overdue && <Tag color="red">просрочено</Tag>}
                        {soon && !overdue && <Tag color="gold">срок близко</Tag>}
                      </Space>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {p.systemName} · {p.characteristic}{p.dueDate ? ` · срок: ${p.dueDate}` : ''}
                        {p.decidedBy ? ` · решение: ${p.decidedBy}` : ''}
                      </Text>
                    }
                  />
                </List.Item>
              );
            }}
          />
          {filtered.length > 3 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Button type="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Свернуть' : `Показать все (${filtered.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default MeasuresRegistryCard;
