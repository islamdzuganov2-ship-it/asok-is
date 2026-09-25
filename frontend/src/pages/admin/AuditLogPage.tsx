/**
 * AuditLogPage.tsx — журнал событий ИБ (ИБ-08; SEC-03 в docs/SECURITY_AUDIT_RF_2026-09-08.md).
 *
 * Только чтение и только суперадминистратор (`view.admin.audit` — исключительное право, не
 * раздаётся матрицей): журнал раскрывает действия всех ролей. Изменить или удалить запись
 * нельзя ни отсюда, ни через API, ни SQL-запросом приложения — таблица append-only на уровне БД.
 */
import React, { useState } from 'react';
import { Alert, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useGetAuditLogQuery, type AuditEvent } from '../../store/api/apiSlice';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, SPACE } from '../../theme/premium';

const { Title, Text } = Typography;

/** Подписи кодов событий (iam/audit.py). Неизвестный код показывается как есть. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.login_failed': 'Неудачный вход',
  'auth.login_locked': 'Вход заблокирован',
  'auth.logout': 'Выход',
  'auth.refresh': 'Продление сессии',
  'auth.refresh_denied': 'Отказ в продлении',
  'auth.refresh_reuse': 'Повтор refresh-токена',
  'user.create': 'Создан пользователь',
  'user.update': 'Изменён пользователь',
  'user.delete': 'Удалён пользователь',
  'user.password_reset': 'Сброс пароля',
  'user.sessions_revoked': 'Сессии отозваны',
  'rbac.matrix_change': 'Изменена матрица прав',
  'rbac.mandatory_sections_change': 'Изменены обязательные разделы',
  'measure.decision': 'Решение по мере',
  'measure.escalation_decision': 'Решение по эскалации',
  'report.export': 'Выгрузка отчёта',
  'quality.weights_change': 'Изменены веса',
};

const OUTCOME_COLOR: Record<string, string> = { success: 'green', failure: 'orange', denied: 'red' };

const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU');

const AuditLogPage: React.FC = () => {
  const [action, setAction] = useState<string | undefined>();
  const [username, setUsername] = useState('');
  const { data, isFetching, isError } = useGetAuditLogQuery({ action, username: username.trim() || undefined });

  const columns: ColumnsType<AuditEvent> = [
    {
      title: 'Время', dataIndex: 'created_at', width: 170, render: fmtTime,
      sorter: (a, b) => a.created_at.localeCompare(b.created_at), defaultSortOrder: 'descend',
    },
    { title: 'Пользователь', dataIndex: 'username', render: (v: string | null) => v ?? '—' },
    { title: 'Событие', dataIndex: 'action', render: (v: string) => ACTION_LABELS[v] ?? v },
    {
      title: 'Исход', dataIndex: 'outcome', width: 110,
      render: (v: string | null) => (v ? <Tag color={OUTCOME_COLOR[v]}>{v}</Tag> : '—'),
    },
    {
      title: 'Объект', key: 'entity',
      render: (_: unknown, r) => [r.entity_type, r.entity_key ?? r.entity_id].filter(Boolean).join(': ') || '—',
    },
    {
      title: 'Изменение', key: 'diff',
      render: (_: unknown, r) => {
        const parts = [r.old_values && `было ${JSON.stringify(r.old_values)}`, r.new_values && `стало ${JSON.stringify(r.new_values)}`];
        return <Text style={{ fontSize: 12 }}>{parts.filter(Boolean).join(' → ') || '—'}</Text>;
      },
    },
    { title: 'IP', dataIndex: 'ip_address', width: 130, render: (v: string | null) => v ?? '—' },
    { title: 'Запрос', dataIndex: 'request_id', width: 120, render: (v: string | null) => (v ? v.slice(0, 12) : '—') },
  ];

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} /><AuditOutlined /> Журнал событий ИБ</Title>
      <Text type="secondary">
        Входы, выходы, изменения прав и пользователей, решения по мерам, выгрузки. Записи неизменяемы.
      </Text>
      <Card {...premiumCard('gold', { marginTop: SPACE.base })}>
        <Space wrap style={{ marginBottom: SPACE.base }}>
          <Select
            allowClear placeholder="Событие" style={{ minWidth: 240 }} value={action}
            onChange={(v) => setAction(v)}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Input.Search allowClear placeholder="Логин" style={{ width: 220 }} onSearch={setUsername} />
        </Space>
        {isError && <Alert type="error" showIcon message="Не удалось загрузить журнал" style={{ marginBottom: SPACE.base }} />}
        <Table<AuditEvent>
          size="small" rowKey="id" loading={isFetching} dataSource={data ?? []} columns={columns}
          pagination={{ pageSize: 25 }} scroll={{ x: 'max-content' }}
        />
      </Card>
    </div>
  );
};

export default AuditLogPage;
