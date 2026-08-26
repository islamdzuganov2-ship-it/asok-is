/**
 * ReferencesTab.tsx — справочники экономики контура (BL-007, §2.4).
 *
 * Ставки сопровождения (L1-L3, внутренние и вендорские) и бизнес-процессы со стоимостью минуты
 * простоя — вход для расчёта C_ТС. Плюс сравнение «мы/рынок» по рыночным бенчмаркам (УК-24):
 * считает его бэкенд, здесь только вызов и подача.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { message } from '../../theme/appMessage';
import FieldHint from '../../components/FieldHint';
import { premiumCard } from '../../theme/premium';
import { RAG } from '../../theme/ragPalette';
import { numericColumn, sorterFor } from '../../theme/table';
import { BP_KINDS } from './bpKinds';
import BenchmarksPanel from './BenchmarksPanel';
import {
  api, fmtMoney, fmtNum,
  type BenchmarkComparison, type BpCost, type BusinessProcess, type SupportRate,
} from './shared';

const { Text } = Typography;

const LINES = ['L1', 'L2', 'L3'];

export const ReferencesTab: React.FC = () => {
  const [rates, setRates] = useState<SupportRate[]>([]);
  const [bps, setBps] = useState<BusinessProcess[]>([]);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rateForm] = Form.useForm();
  const [bpForm] = Form.useForm();
  // ТЗ v19 УК-24: сравнение «мы/рынок» — по клику, не пересчитывается фоном (рынок обновляется
  // редко, и результат зависит от того, что именно вносили в last-load costs/rates).
  const [compareOpen, setCompareOpen] = useState<{ title: string; data: BenchmarkComparison } | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, b] = await Promise.all([
        api<SupportRate[]>('/econ/rates'), api<BusinessProcess[]>('/econ/business-processes'),
      ]);
      setRates(r); setBps(b);
      const costEntries = await Promise.all(
        b.map(async (bp) => {
          try { const c = await api<BpCost | null>(`/econ/business-processes/${bp.id}/cost`); return [bp.id, c?.costPerMinBase ?? null] as const; }
          catch { return [bp.id, null] as const; }
        }),
      );
      setCosts(Object.fromEntries(costEntries));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createRate = async () => {
    try {
      const v = await rateForm.validateFields();
      setSaving(true);
      await api('/econ/rates', { method: 'POST', body: JSON.stringify(v) });
      message.success('Ставка добавлена'); setRateOpen(false); rateForm.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const createBp = async () => {
    try {
      const v = await bpForm.validateFields();
      setSaving(true);
      const { costPerMinBase, method, ...bp } = v;
      const created = await api<BusinessProcess>('/econ/business-processes', { method: 'POST', body: JSON.stringify(bp) });
      if (costPerMinBase !== undefined && costPerMinBase !== null) {
        await api(`/econ/business-processes/${created.id}/cost`, {
          method: 'PUT', body: JSON.stringify({ method: method ?? 'RESOURCE', costPerMinBase }),
        });
      }
      message.success('Бизнес-процесс добавлен'); setBpOpen(false); bpForm.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const compareRate = async (rate: SupportRate) => {
    setComparing(rate.id);
    try {
      const data = await api<BenchmarkComparison>(`/econ/rates/${rate.id}/benchmark`);
      setCompareOpen({ title: `Ставка ${rate.executorType === 'VENDOR' ? 'вендора' : 'внутренняя'} · линия ${rate.line}`, data });
    } catch (e: any) { message.error(`Ошибка сравнения: ${e.message}`); }
    finally { setComparing(null); }
  };

  const compareBp = async (bp: BusinessProcess) => {
    setComparing(bp.id);
    try {
      const data = await api<BenchmarkComparison>(`/econ/business-processes/${bp.id}/benchmark`);
      setCompareOpen({ title: `${bp.name} (${bp.code})`, data });
    } catch (e: any) { message.error(`Ошибка сравнения: ${e.message}`); }
    finally { setComparing(null); }
  };


  const rateCols: ColumnsType<SupportRate> = [
    { title: 'Линия', dataIndex: 'line', width: 80, sorter: sorterFor((r: SupportRate) => r.line) },
    {
      title: 'Исполнитель', dataIndex: 'executorType', width: 130,
      sorter: sorterFor((r: SupportRate) => r.executorType),
      render: (t: string) => <Tag color={t === 'VENDOR' ? 'volcano' : 'blue'}>{t === 'VENDOR' ? 'Вендор' : 'Внутренний'}</Tag>,
    },
    { title: 'Вендор', dataIndex: 'vendor', width: 150, sorter: sorterFor((r: SupportRate) => r.vendor), render: (v?: string) => v || '—' },
    numericColumn({ title: '₽/час', dataIndex: 'ratePerHour', width: 120, sorter: sorterFor((r: SupportRate) => r.ratePerHour), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'K веч/ночь', dataIndex: 'kEvening', width: 110, sorter: sorterFor((r: SupportRate) => r.kEvening), render: (v: number) => fmtNum(v) }),
    numericColumn({ title: 'K выходные', dataIndex: 'kWeekend', width: 110, sorter: sorterFor((r: SupportRate) => r.kWeekend), render: (v: number) => fmtNum(v) }),
    {
      title: 'Область', dataIndex: 'systemId', width: 120,
      sorter: sorterFor((r: SupportRate) => r.systemId),
      render: (s?: string | null) => <Tag>{s ? 'Для ИС' : 'Глобальная'}</Tag>,
    },
    {
      title: '', key: 'compare', width: 130, fixed: 'right',
      render: (_: unknown, r: SupportRate) => (
        <Button size="small" icon={<SwapOutlined />} loading={comparing === r.id} onClick={() => compareRate(r)}>
          С рынком
        </Button>
      ),
    },
  ];

  const bpCols: ColumnsType<BusinessProcess> = [
    { title: 'Код', dataIndex: 'code', width: 120, sorter: sorterFor((r: BusinessProcess) => r.code) },
    { title: 'Название', dataIndex: 'name', width: 220, sorter: sorterFor((r: BusinessProcess) => r.name), render: (t: string) => <Text strong>{t}</Text> },
    {
      title: 'Тип', dataIndex: 'kind', width: 200, sorter: sorterFor((r: BusinessProcess) => r.kind),
      render: (k: string) => BP_KINDS.find((x) => x.value === k)?.label ?? k,
    },
    numericColumn({
      title: 'C_мин, ₽', key: 'cost', width: 130,
      sorter: sorterFor((bp: BusinessProcess) => costs[bp.id]),
      render: (_: unknown, bp: BusinessProcess) => fmtMoney(costs[bp.id]),
    }),
    {
      title: '', key: 'compare', width: 130, fixed: 'right',
      render: (_: unknown, bp: BusinessProcess) => (
        <Button size="small" icon={<SwapOutlined />} loading={comparing === bp.id} onClick={() => compareBp(bp)}>
          С рынком
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card
        {...premiumCard('slate')}
        title="Ставки сопровождения L1–L3"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setRateOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<SupportRate>
          columns={rateCols} dataSource={rates} rowKey="id" loading={loading} size="small"
          scroll={{ x: 950 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'Ставок нет. Внутренняя = (ФОТ×K_накладных)/фонд; вендорская — из контракта.' }}
        />
      </Card>

      <Card
        {...premiumCard('sage')}
        title="Бизнес-процессы и стоимость минуты простоя"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setBpOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<BusinessProcess>
          columns={bpCols} dataSource={bps} rowKey="id" loading={loading} size="small"
          scroll={{ x: 830 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'БП нет. Стоимость минуты — атрибут процесса: фронтальные считаются транзакционно, бэк-офис ресурсно.' }}
        />
      </Card>


      <BenchmarksPanel />

      <Modal title="Новая ставка сопровождения" open={rateOpen} onOk={createRate} confirmLoading={saving}
        onCancel={() => setRateOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={rateForm} layout="vertical"
          initialValues={{ line: 'L2', executorType: 'INTERNAL', kEvening: 1.5, kWeekend: 2.0 }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="line" label={<FieldHint title="Линия поддержки (L1/L2/L3) — влияет на то, какая ставка попадёт в расчёт стоимости устранения (C_ТС) для событий этой линии.">Линия</FieldHint>} style={{ flex: 1, minWidth: 120 }}>
              <Select options={LINES.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="executorType" label={<FieldHint title="Кто фактически устраняет инциденты на этой линии — свой персонал или подрядчик.">Исполнитель</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <Select options={[{ value: 'INTERNAL', label: 'Внутренний' }, { value: 'VENDOR', label: 'Вендор' }]} />
            </Form.Item>
          </Space>
          <Form.Item name="vendor" label={<FieldHint title="Заполняйте, только если исполнитель — «Вендор»: название подрядной организации.">Вендор (если внешний)</FieldHint>}>
            <Input placeholder="Наименование поставщика" />
          </Form.Item>
          <Form.Item name="ratePerHour" label={<FieldHint title="Базовая почасовая ставка исполнителя — основа расчёта стоимости восстановления (C_восстановление) при инциденте.">Ставка, ₽/час</FieldHint>} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={500} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="kEvening" label={<FieldHint title="Множитель к базовой ставке, если устранение шло вечером/ночью.">K вечер/ночь</FieldHint>} style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={1} step={0.1} />
            </Form.Item>
            <Form.Item name="kWeekend" label={<FieldHint title="Множитель к базовой ставке, если устранение шло в выходной день.">K выходные</FieldHint>} style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={1} step={0.1} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="Новый бизнес-процесс" open={bpOpen} onOk={createBp} confirmLoading={saving}
        onCancel={() => setBpOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={bpForm} layout="vertical" initialValues={{ kind: 'BACKOFFICE', method: 'RESOURCE' }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label={<FieldHint title="Уникальный код процесса для ссылок из рисковых событий и расчёта стоимости простоя.">Код</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input placeholder="BP-001" />
            </Form.Item>
            <Form.Item name="kind" label={<FieldHint title="Тип бизнес-процесса — влияет на то, какой профиль стоимости простоя к нему применим.">Тип</FieldHint>} style={{ flex: 1, minWidth: 220 }}>
              <Select options={BP_KINDS} />
            </Form.Item>
          </Space>
          <Form.Item name="name" label={<FieldHint title="Название бизнес-процесса, который останавливается или деградирует при инциденте.">Название</FieldHint>} rules={[{ required: true }]}>
            <Input placeholder="Приём платежей" />
          </Form.Item>
          <Form.Item name="costPerMinBase" label={<FieldHint title="Сколько теряет организация за минуту простоя этого процесса — основа расчёта стоимости простоя (C_простой) при инциденте.">Стоимость минуты простоя, ₽ (базовая)</FieldHint>}>
            <InputNumber style={{ width: '100%' }} min={0} step={100} />
          </Form.Item>
        </Form>
      </Modal>


      {/* ТЗ v19 УК-24: результат сравнения «мы/рынок» — по клику из строки ставки/БП. */}
      <Modal
        title={compareOpen ? `Сравнение с рынком · ${compareOpen.title}` : ''}
        open={!!compareOpen}
        onCancel={() => setCompareOpen(null)}
        footer={<Button onClick={() => setCompareOpen(null)}>Закрыть</Button>}
      >
        {compareOpen && (
          compareOpen.data.ownValue === null ? (
            <Text type="secondary">{compareOpen.data.note}</Text>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space size="large">
                <Statistic title="У нас" value={compareOpen.data.ownValue} suffix={compareOpen.data.ownUnit} precision={2} />
                {compareOpen.data.benchmark && (
                  <Statistic title="Рынок" value={compareOpen.data.benchmark.value} suffix={compareOpen.data.benchmark.unit} precision={2} />
                )}
              </Space>
              {compareOpen.data.deltaPct != null && (
                <Text strong style={{ color: compareOpen.data.deltaPct > 0 ? RAG.bad.strong : RAG.good.strong }}>
                  {compareOpen.data.note}
                </Text>
              )}
              {compareOpen.data.deltaPct == null && <Text type="secondary">{compareOpen.data.note}</Text>}
              {compareOpen.data.benchmark && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  Источник: {compareOpen.data.benchmark.source} · на {compareOpen.data.benchmark.observedOn}
                </Text>
              )}
            </Space>
          )
        )}
      </Modal>
    </Space>
  );
};

