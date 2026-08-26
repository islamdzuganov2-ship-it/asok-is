/**
 * myTasksCards.tsx — карточки раздела «Мои задачи» (роль «Исполнитель»).
 */
import React from 'react';
import { Button, Empty, Space, Table, Tag, Typography } from 'antd';
import { CommentOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import type { Proposal } from '../../store/slices/governanceSlice';
import { BRAND, RAG, ragToken, solidTagStyle } from '../../theme/ragPalette';
import { GOLD, SPACE } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import KpiCard from '../../components/KpiCard';
import { useMyTasksScope, statusTag, statusRank, dueMs } from '../scopes/MyTasksScope';
import GridCard from '../GridCard';

const { Text } = Typography;

export const MyTasksKpiCard: React.FC = () => {
  const { stats, fullName } = useMyTasksScope();
  return (
    <GridCard
      title="Мои поручения"
      accent="gold"
      dotColor={GOLD.base}
      hint={fullName ? `назначено на ${fullName}` : undefined}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.base }}>
        <KpiCard title="Всего поручений" value={stats.total} />
        <KpiCard title="Выполнено" value={stats.done} color={RAG.good.strong} />
        <KpiCard title="Просрочено / не выполнено" value={stats.overdue} color={stats.overdue ? RAG.bad.strong : undefined} />
        <KpiCard title="Личная эффективность" value={`${stats.eff}%`} color={ragToken(stats.eff).strong} />
      </div>
    </GridCard>
  );
};

export const MyTasksTableCard: React.FC = () => {
  const { tasks, openTask } = useMyTasksScope();
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const navigate = useNavigate();

  const columns: ColumnsType<Proposal> = [
    { title: 'Поручение', dataIndex: 'riskTitle', sorter: sorterFor((r: Proposal) => r.riskTitle || r.metricName),
      render: (v: string, r) => (
        <div>
          <Text strong style={{ color: BRAND.ink }}>{v || r.metricName}</Text>
          <div style={{ fontSize: 12, color: BRAND.inkSoft }}>{r.systemName} · {r.characteristic}</div>
        </div>
      ) },
    numericColumn<Proposal>({ title: 'Балл', dataIndex: 'calculatedScore', width: 76,
      sorter: sorterFor((r: Proposal) => r.calculatedScore),
      render: (v: number) => <Tag style={solidTagStyle(ragToken(v).strong)}>{v}%</Tag> }),
    { title: 'Срок', dataIndex: 'dueDate', width: 116,
      sorter: sorterFor((r: Proposal) => dueMs(r)),
      render: (v: string, r) => (
        <Space direction="vertical" size={0}>
          <Text>{v || '—'}</Text>
          {r.dueChangeRequest?.status === 'PENDING' && <Tag color="gold" style={{ marginInlineEnd: 0 }}>перенос на рассмотрении</Tag>}
          {r.dueChangeRequest?.status === 'ACCEPTED' && <Tag color="green" style={{ marginInlineEnd: 0 }}>перенос принят</Tag>}
          {r.dueChangeRequest?.status === 'DECLINED' && <Tag color="red" style={{ marginInlineEnd: 0 }}>перенос отклонён</Tag>}
        </Space>
      ) },
    { title: 'Статус', key: 'status', width: 130, sorter: sorterFor((r: Proposal) => statusRank(r)),
      render: (_: unknown, r) => statusTag(r) },
    numericColumn<Proposal>({ title: 'Часы', dataIndex: 'effortHours', width: 84,
      sorter: sorterFor((r: Proposal) => r.effortHours),
      render: (v: number | undefined) => (v ? <Text>{v} ч</Text> : <Text type="secondary">—</Text>) }),
    numericColumn<Proposal>({ title: 'Уточнения', key: 'clar', width: 96,
      sorter: sorterFor((r: Proposal) => r.clarifications?.length ?? 0),
      render: (_: unknown, r) => (r.clarifications?.length ? <Tag icon={<CommentOutlined />}>{r.clarifications.length}</Tag> : <Text type="secondary">—</Text>) }),
  ];

  return (
    <GridCard
      accent="ink"
      title="Список поручений"
      hint="клик по строке — карточка поручения"
      extra={permissions.includes('view.dashboard.taskplan')
        ? <Button size="small" onClick={() => navigate('/dashboard/taskplan')}>Открыть в плане задач →</Button>
        : undefined}
    >
      {tasks.length === 0 ? (
        <Empty description="На вас пока не назначено поручений" style={{ padding: 48 }} />
      ) : (
        <Table<Proposal>
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => openTask(r), style: { cursor: 'pointer' } })}
          scroll={{ x: 720 }}
        />
      )}
    </GridCard>
  );
};
