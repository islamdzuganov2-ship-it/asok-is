/**
 * NotificationsLogPage.tsx — журнал уведомлений (ТЗ v19 п.6, УК-15).
 *
 * Каждое событие — отправленное, упавшее при доставке или недоставляемое (у получателя нет
 * email или он не найден среди пользователей) — с числом попыток и причиной. Отдельный отчёт
 * «недоставляемые»: кому уведомления не доходят и почему. Упавшие отправки повторяются по
 * расписанию; кнопка «Повторить» делает то же сразу.
 */
import React, { useState } from 'react';
import { Alert, Button, Card, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { MailOutlined, PaperClipOutlined, ReloadOutlined } from '@ant-design/icons';
import AppTable, { type AppColumn } from '../../components/AppTable';
import {
  useGetNotificationLogQuery, useGetUndeliverableQuery, useRetryNotificationsMutation,
  type NotificationDelivery, type UndeliverableRow,
} from '../../store/api/controlApi';
import { message } from '../../theme/appMessage';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, SPACE } from '../../theme/premium';

const { Title, Text } = Typography;

const STATUS: Record<NotificationDelivery['status'], { color: string; label: string }> = {
  SENT: { color: 'green', label: 'отправлено' },
  FAILED: { color: 'orange', label: 'сбой канала' },
  UNDELIVERABLE: { color: 'red', label: 'недоставляемо' },
};

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU') : '—');

const NotificationsLogPage: React.FC = () => {
  const [status, setStatus] = useState<string | undefined>();
  const { data, isFetching, isError, refetch } = useGetNotificationLogQuery({ status });
  const { data: undeliverable, refetch: refetchUndeliverable } = useGetUndeliverableQuery();
  const [retry, { isLoading: retrying }] = useRetryNotificationsMutation();

  const columns: AppColumn<NotificationDelivery>[] = [
    { title: 'Время', dataIndex: 'createdAt', width: 170, render: fmtTime, defaultSortOrder: 'descend' },
    { title: 'Событие', dataIndex: 'subject', render: (v: string, r) => (
      <Space size={4}>{r.hasAttachments && <Tooltip title="С вложением (.ics)"><PaperClipOutlined /></Tooltip>}<Text>{v}</Text></Space>
    ) },
    { title: 'Получатель', dataIndex: 'recipient', width: 180 },
    { title: 'Адрес', dataIndex: 'address', width: 200, render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
    { title: 'Статус', dataIndex: 'status', width: 140, render: (v: NotificationDelivery['status']) => <Tag color={STATUS[v].color}>{STATUS[v].label}</Tag> },
    { title: 'Попыток', dataIndex: 'attempts', width: 90 },
    { title: 'Причина', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
  ];
  const undeliverableColumns: AppColumn<UndeliverableRow>[] = [
    { title: 'Получатель', dataIndex: 'recipient' },
    { title: 'Причина', dataIndex: 'reason' },
    { title: 'Событий', dataIndex: 'events', width: 100 },
    { title: 'Последнее', dataIndex: 'lastAt', width: 170, render: fmtTime },
  ];

  const onRetry = async () => {
    try {
      const r = await retry().unwrap();
      message.success(`Доставлено повторно: ${r.delivered}`);
      refetch(); refetchUndeliverable();
    } catch { message.error('Повтор не выполнен'); }
  };

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} /><MailOutlined /> Журнал уведомлений</Title>
      <Text type="secondary">
        Каждое уведомление записывается — доставленное, упавшее или недоставляемое. Канал доставки
        (почта/мессенджер) подключается адаптером; пока он не настроен, события фиксируются здесь.
      </Text>
      {(undeliverable?.length ?? 0) > 0 && (
        <Card {...premiumCard('terracotta', { marginTop: SPACE.base })} title="Недоставляемые: кому не доходит и почему">
          <AppTable<UndeliverableRow> tableKey="notifications-undeliverable" rowKey={(r) => `${r.recipient}|${r.reason}`}
            size="small" dataSource={undeliverable ?? []} columns={undeliverableColumns} pagination={false} />
        </Card>
      )}
      <Card {...premiumCard('gold', { marginTop: SPACE.base })}>
        <Space wrap style={{ marginBottom: SPACE.base }}>
          <Select allowClear placeholder="Статус" style={{ minWidth: 200 }} value={status} onChange={setStatus}
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          <Button icon={<ReloadOutlined />} loading={retrying} onClick={onRetry}>Повторить упавшие</Button>
        </Space>
        {isError && <Alert type="error" showIcon message="Не удалось загрузить журнал" style={{ marginBottom: SPACE.base }} />}
        <AppTable<NotificationDelivery>
          tableKey="notifications-log" exportName="zhurnal-uvedomleniy"
          size="small" rowKey="id" loading={isFetching} dataSource={data ?? []} columns={columns}
          pagination={{ pageSize: 25 }} scroll={{ x: 'max-content' }}
          expandable={{ expandedRowRender: (r) => <Text style={{ whiteSpace: 'pre-wrap' }}>{r.body || '—'}</Text> }}
        />
      </Card>
    </div>
  );
};

export default NotificationsLogPage;
