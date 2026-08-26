/**
 * RiskEventsTab.tsx — реестр рисковых событий контура (BL-007).
 *
 * Событие — это не «риск вообще», а конкретная реализация с числовой годовой стоимостью:
 * ALE считает бэкенд по привязанным техсбоям (C_ТС × ARO), либо, если частота не набирается
 * статистикой, по экспертным ARO/SLE. Разворот строки открывает карточку взаимосвязи
 * ТС → мера → экономика → качество (БТ-322).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { message } from '../../theme/appMessage';
import KpiCard from '../../components/KpiCard';
import FieldHint from '../../components/FieldHint';
import { OwnerLink } from '../../components/OwnerLink';
import RiskEventLinksPanel from '../../components/RiskEventLinksPanel';
import { premiumCard } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import { api, fmtMoney, fmtNum, RISK_STATUS, type AleResult, type RiskEvent } from './shared';

const { Text } = Typography;

export const RiskEventsTab: React.FC = () => {
  const [rows, setRows] = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await api<RiskEvent[]>('/risk-events')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const portfolioAle = useMemo(
    () => rows.reduce((s, r) => s + (r.aleAvg ?? 0), 0), [rows],
  );

  const create = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/risk-events', { method: 'POST', body: JSON.stringify(v) });
      message.success('Рисковое событие создано');
      setOpen(false); form.resetFields(); await load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`Не удалось сохранить: ${e.message}`);
    } finally { setSaving(false); }
  };

  const recompute = async (id: string) => {
    setBusyId(id);
    try {
      const r = await api<AleResult>(`/risk-events/${id}/recompute-ale`, { method: 'POST' });
      message.success(`ALE пересчитан: ТС ${r.incidentsCounted}, с ценой ${r.incidentsCosted}, ARO ${fmtNum(r.aro)}`);
      await load();
    } catch (e: any) { message.error(`Пересчёт не удался: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const columns: ColumnsType<RiskEvent> = [
    { title: 'Код', dataIndex: 'code', width: 130, sorter: sorterFor((r: RiskEvent) => r.code) },
    { title: 'Название', dataIndex: 'title', width: 220, sorter: sorterFor((r: RiskEvent) => r.title), render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Владелец', dataIndex: 'owner', width: 150, sorter: sorterFor((r: RiskEvent) => r.owner), render: (o?: string) => <OwnerLink owner={o} fallback="—" /> },
    numericColumn({ title: 'ARO', dataIndex: 'aro', width: 90, sorter: sorterFor((r: RiskEvent) => r.aro), render: (v: number) => fmtNum(v) }),
    numericColumn({ title: 'ALE средний', dataIndex: 'aleAvg', width: 140, sorter: sorterFor((r: RiskEvent) => r.aleAvg), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'ALE P90', dataIndex: 'aleP90', width: 140, sorter: sorterFor((r: RiskEvent) => r.aleP90), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'MaxSLE', dataIndex: 'maxSle', width: 140, sorter: sorterFor((r: RiskEvent) => r.maxSle), render: (v: number) => fmtMoney(v) }),
    {
      title: 'Статус', dataIndex: 'status', width: 120, sorter: sorterFor((r: RiskEvent) => r.status),
      render: (s: string) => {
        const m = RISK_STATUS[s] ?? { label: s, color: 'default' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '', key: 'actions', width: 150, fixed: 'right',
      render: (_: unknown, r: RiskEvent) => (
        <Button size="small" icon={<ReloadOutlined />} loading={busyId === r.id} onClick={() => recompute(r.id)}>
          Пересчитать ALE
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <KpiCard
          title="Портфельный ALE (сумма средних)"
          value={`${Math.round(portfolioAle).toLocaleString('ru-RU')} ₽`}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Добавить рисковое событие
        </Button>
      </Space>

      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card {...premiumCard('slate')} styles={{ body: { padding: 0 } }}>
        <Table<RiskEvent>
          columns={columns} dataSource={rows} rowKey="id" loading={loading} size="small"
          scroll={{ x: 1180 }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: 'Нет рисковых событий. Добавьте первое и привяжите к нему техсбои для расчёта ALE.' }}
          expandable={{
            expandedRowRender: (r: RiskEvent) => <RiskEventLinksPanel event={r} onChanged={load} />,
          }}
        />
      </Card>

      <Modal title="Новое рисковое событие" open={open} onOk={create} confirmLoading={saving}
        onCancel={() => setOpen(false)} okText="Сохранить" cancelText="Отмена" width={640}>
        <Form form={form} layout="vertical" initialValues={{ aroIsExpert: false, regulatory: false }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label={<FieldHint title="Уникальный код рискового события для ссылок из мер, отчётов и цепочки «риск → мера → эффект».">Код</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="RE-2026-001" />
            </Form.Item>
            <Form.Item name="category" label={<FieldHint title="Смысловая группа события — для фильтрации и группировки в реестре и на дашборде стоимости.">Категория</FieldHint>} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="отказоустойчивость" />
            </Form.Item>
          </Space>
          <Form.Item name="title" label={<FieldHint title="Краткая формулировка события: что происходит и к чему приводит.">Название</FieldHint>} rules={[{ required: true }]}>
            <Input placeholder="Отказ узла кластера → простой" />
          </Form.Item>
          <Form.Item name="description" label={<FieldHint title="Подробности события: условия возникновения, затронутые компоненты, что уже известно.">Описание</FieldHint>}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="owner" label={<FieldHint title="Кто отвечает за это рисковое событие — ведёт его в реестре и согласовывает меры по нему.">Владелец риска</FieldHint>} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="ФИО риск-менеджера" />
            </Form.Item>
            <Form.Item name="aro" label={<FieldHint title="Annualized Rate of Occurrence — сколько раз в год ожидается реализация события. Можно оставить пустым и посчитать по истории техсбоев (кнопка «Пересчитать ALE»).">ARO (частота/год)</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="sleExpert" label={<FieldHint title="Single Loss Expectancy — ущерб от одной реализации события в рублях, если задаёте его экспертно (не по формуле восстановления/простоя). Используется вместо расчётного SLE, когда указан.">SLE экспертный, ₽</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
            <Form.Item name="riskAppetite" label={<FieldHint title="Порог ALE в рублях в год, выше которого риск считается неприемлемым для организации — используется для приоритизации мер.">Риск-аппетит, ₽/год</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="aroIsExpert" label={<FieldHint title="Включите, если ARO выше задано экспертной оценкой, а не рассчитано по истории инцидентов — влияет на то, что покажет «Пересчитать ALE».">ARO задан экспертно</FieldHint>} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="regulatory" label={<FieldHint title="Пометьте, если риск связан с обязательным регуляторным требованием — такие риски нельзя закрыть решением «Принять», только устранить или компенсировать.">Регуляторное вето</FieldHint>} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
};

