/**
 * BenchmarksPanel.tsx — справочник рыночных бенчмарков (ТЗ v19 п.9-10, В-30а).
 *
 * Самостоятельный реестр: своя загрузка, своя форма ввода. Вынесен из ReferencesTab, где рядом
 * живут ставки сопровождения и бизнес-процессы — три независимых справочника в одном файле
 * читались плохо.
 *
 * Источник и дата наблюдения обязательны на бэкенде: без них рыночная цифра неотличима от
 * выдуманной, а на неё опирается сравнение «мы/рынок» (УК-24).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { PlusOutlined } from '@ant-design/icons';
import { message } from '../../theme/appMessage';
import FieldHint from '../../components/FieldHint';
import { premiumCard } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import { api, fmtNum, type MarketBenchmark } from './shared';
import { BP_KINDS } from './bpKinds';

const { Text } = Typography;

// ТЗ v19 п.9-10: рыночные бенчмарки — два измеримых показателя, разрез («dimension») зависит
// от выбранного показателя (типы БП для C_мин, типы исполнителя для ставки).
const BENCHMARK_KINDS = [
  { value: 'BP_COST_PER_MIN', label: 'C_мин бизнес-процесса (₽/мин)' },
  { value: 'SUPPORT_RATE_PER_HOUR', label: 'Ставка сопровождения (₽/час)' },
];
const BENCHMARK_KIND_LABEL: Record<string, string> = Object.fromEntries(BENCHMARK_KINDS.map((k) => [k.value, k.label]));
const BENCHMARK_DIMENSIONS: Record<string, { value: string; label: string }[]> = {
  BP_COST_PER_MIN: BP_KINDS,
  SUPPORT_RATE_PER_HOUR: [{ value: 'INTERNAL', label: 'Внутренний' }, { value: 'VENDOR', label: 'Вендор' }],
};
const COMPANY_SIZE_CLASSES = [
  { value: 'MICRO', label: 'Микро' }, { value: 'SMALL', label: 'Малое' },
  { value: 'MEDIUM', label: 'Среднее' }, { value: 'LARGE', label: 'Крупное' },
];

export const BenchmarksPanel: React.FC = () => {
  const [benchmarks, setBenchmarks] = useState<MarketBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setBenchmarks(await api<MarketBenchmark[]>('/econ/benchmarks'));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/econ/benchmarks', {
        method: 'POST',
        body: JSON.stringify({ ...v, observedOn: v.observedOn.format('YYYY-MM-DD') }),
      });
      message.success('Бенчмарк добавлен'); setOpen(false); form.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const cols: ColumnsType<MarketBenchmark> = [
    { title: 'Показатель', dataIndex: 'kind', width: 190, sorter: sorterFor((r: MarketBenchmark) => r.kind),
      render: (k: string) => BENCHMARK_KIND_LABEL[k] ?? k },
    { title: 'Разрез', dataIndex: 'dimension', width: 140, sorter: sorterFor((r: MarketBenchmark) => r.dimension) },
    { title: 'Размер компании', dataIndex: 'companySizeClass', width: 140,
      sorter: sorterFor((r: MarketBenchmark) => r.companySizeClass),
      render: (v?: string | null) => v || <Text type="secondary">любой</Text> },
    numericColumn({ title: 'Значение', dataIndex: 'value', width: 120,
      sorter: sorterFor((r: MarketBenchmark) => r.value),
      render: (v: number, r: MarketBenchmark) => `${fmtNum(v)} ${r.unit}` }),
    { title: 'Источник', dataIndex: 'source', sorter: sorterFor((r: MarketBenchmark) => r.source) },
    { title: 'На дату', dataIndex: 'observedOn', width: 110, sorter: sorterFor((r: MarketBenchmark) => r.observedOn) },
  ];


  return (
    <>
      {error && <Alert type="error" showIcon message="Ошибка загрузки бенчмарков" description={error} closable style={{ marginBottom: 12 }} />}
      <Card
        {...premiumCard('terracotta')}
        title="Рыночные бенчмарки"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<MarketBenchmark>
          columns={cols} dataSource={benchmarks} rowKey="id" loading={loading} size="small"
          scroll={{ x: 780 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'Бенчмарков нет: источники для рыночных цифр заказчиком пока не согласованы (В-30а). Занести можно в любой момент — источник и дата обязательны.' }}
        />
      </Card>
      <Modal title="Новый рыночный бенчмарк" open={open} onOk={create} confirmLoading={saving}
        onCancel={() => setOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={form} layout="vertical" initialValues={{ kind: 'BP_COST_PER_MIN' }}
          onValuesChange={(changed) => { if (changed.kind) form.setFieldValue('dimension', undefined); }}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Источник и дата обязательны — без них рыночная цифра неотличима от выдуманной." />
          <Form.Item name="kind" label={<FieldHint title="Какой именно рыночный показатель вносите — ставку сопровождения или стоимость простоя процесса.">Показатель</FieldHint>} rules={[{ required: true }]}>
            <Select options={BENCHMARK_KINDS} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
            {({ getFieldValue }) => (
              <Form.Item name="dimension" label={<FieldHint title="К какому конкретно разрезу относится значение (линия поддержки, тип процесса и т.п.) — по нему бенчмарк сравнивается со «своим» значением.">Разрез</FieldHint>} rules={[{ required: true }]}>
                <Select options={BENCHMARK_DIMENSIONS[getFieldValue('kind') ?? 'BP_COST_PER_MIN']} />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="companySizeClass" label={<FieldHint title="Сегмент компаний, к которому относится рыночное значение — сравнение точнее, когда размер совпадает с вашей организацией. Необязательно.">Размер компании (для ставок — п.10; необязательно)</FieldHint>}>
            <Select allowClear options={COMPANY_SIZE_CLASSES} placeholder="Любой размер" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="value" label={<FieldHint title="Числовое значение рыночного бенчмарка в выбранной единице.">Значение</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={10} />
            </Form.Item>
            <Form.Item name="unit" label={<FieldHint title="Единица измерения значения — должна совпадать по смыслу со «своим» показателем, с которым будет сравниваться.">Единица</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input placeholder="₽/мин или ₽/час" />
            </Form.Item>
          </Space>
          <Form.Item name="source" label={<FieldHint title="Название или ссылка на открытый источник данных — обязательно: без источника рыночная цифра неотличима от выдуманной.">Источник</FieldHint>} rules={[{ required: true, message: 'Источник обязателен' }]}>
            <Input.TextArea rows={2} placeholder="Название/ссылка на открытый источник" />
          </Form.Item>
          <Form.Item name="observedOn" label={<FieldHint title="На какую дату действительно это рыночное значение — источники устаревают, дата нужна для актуальности сравнения.">Актуально на дату</FieldHint>} rules={[{ required: true, message: 'Дата обязательна' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" defaultPickerValue={dayjs()} />
          </Form.Item>
          <Form.Item name="note" label={<FieldHint title="Любой дополнительный контекст по значению — оговорки источника, методика расчёта и т.п.">Примечание (необязательно)</FieldHint>}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default BenchmarksPanel;
