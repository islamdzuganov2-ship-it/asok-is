/**
 * AiDatasetsTab.tsx — тестовые наборы данных оценки СИИ и критерий выбросов (ГОСТ Р 59898-2021,
 * разд. 9; BL-001 E3). Набор описывается объёмом, источником и репрезентативностью; выбросы
 * считает сервер по значениям признака — метод, порог, число и доля пишутся в метаданные набора,
 * чтобы проверяющий мог воспроизвести результат.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import AppTable, { type AppColumn } from '../../components/AppTable';
import { message } from '../../theme/appMessage';
import { aiApi, parseNumbers, type Dataset } from './aiE3Api';

const { Text } = Typography;
const PURPOSE: Record<string, string> = { TEST: 'тестовый', VALIDATION: 'валидационный', STRESS: 'стресс-набор' };
const HANDLING: Record<string, string> = { REMOVED: 'исключены', KEPT: 'оставлены', WINSORIZED: 'винзоризованы', FLAGGED: 'помечены' };

export const AiDatasetsTab: React.FC<{ periodId: string; onChanged: () => void }> = ({ periodId, onChanged }) => {
  const [rows, setRows] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [outlierFor, setOutlierFor] = useState<Dataset | null>(null);
  const [form] = Form.useForm();
  const [outForm] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    aiApi<Dataset[]>(`/${periodId}/datasets`).then(setRows).catch((e) => message.error(e.message)).finally(() => setLoading(false));
  }, [periodId]);
  useEffect(load, [load]);

  const create = async () => {
    const v = await form.validateFields();
    try {
      await aiApi(`/${periodId}/datasets`, { method: 'POST', body: JSON.stringify(v) });
      setOpen(false); form.resetFields(); load(); onChanged();
    } catch (e: any) { message.error(e.message); }
  };

  const checkOutliers = async () => {
    const v = await outForm.validateFields();
    const values = parseNumbers(v.values || '');
    if (values.length < 3) { message.warning('Нужно не меньше трёх числовых значений'); return; }
    try {
      const r = await aiApi<{ count: number; share: number; lower: number; upper: number }>(
        `/${periodId}/datasets/${outlierFor!.id}/outliers`,
        { method: 'POST', body: JSON.stringify({ feature: v.feature, values, method: v.method, k: v.k, handling: v.handling }) },
      );
      message.success(`Выбросов: ${r.count} (${(r.share * 100).toFixed(1)}%), границы ${r.lower} … ${r.upper}`);
      setOutlierFor(null); outForm.resetFields(); load(); onChanged();
    } catch (e: any) { message.error(e.message); }
  };

  const columns: AppColumn<Dataset>[] = [
    { title: 'Набор', dataIndex: 'name', render: (v: string, r) => <Space size={4}><Text strong>{v}</Text><Tag>{PURPOSE[r.purpose] ?? r.purpose}</Tag></Space> },
    { title: 'Записей', dataIndex: 'records', width: 100 },
    { title: 'Источник', dataIndex: 'source', ellipsis: true },
    { title: 'Критерий выбросов', dataIndex: 'outlier_method', width: 220,
      render: (m: string | null, r) => (m
        ? <Text>{m === 'IQR' ? `IQR × ${r.outlier_k}` : `|z| > ${r.outlier_k}`} · {r.outlier_feature}: {r.outliers_count} ({((r.outliers_share ?? 0) * 100).toFixed(1)}%)
            {r.outlier_handling ? ` · ${HANDLING[r.outlier_handling]}` : ''}</Text>
        : <Tag color="orange">не задан</Tag>) },
    { title: '', key: 'act', width: 170, sortable: false, render: (_: unknown, r) => (
      <Space size={4}>
        <Button size="small" icon={<SearchOutlined />} onClick={() => setOutlierFor(r)}>Выбросы</Button>
        <Popconfirm title="Удалить описание набора?" onConfirm={() => aiApi(`/${periodId}/datasets/${r.id}`, { method: 'DELETE' }).then(() => { load(); onChanged(); })}>
          <Button size="small" danger icon={<DeleteOutlined />} aria-label="Удалить набор" />
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Описать набор</Button>
        <Text type="secondary">Разд. 9: объём, происхождение, репрезентативность и критерий выбросов тестового набора.</Text>
      </Space>
      <AppTable<Dataset> tableKey="ai-datasets" rowKey="id" size="small" loading={loading} dataSource={rows} columns={columns}
        pagination={false} locale={{ emptyText: 'Тестовый набор не описан — результаты измерений невоспроизводимы' }} />

      <Modal title="Тестовый набор данных" open={open} onOk={create} onCancel={() => setOpen(false)} okText="Сохранить">
        <Form form={form} layout="vertical" initialValues={{ purpose: 'TEST' }}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input placeholder="Holdout 2026-Q2" /></Form.Item>
          <Space wrap>
            <Form.Item name="purpose" label="Назначение"><Select style={{ width: 170 }} options={Object.entries(PURPOSE).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name="records" label="Записей"><InputNumber min={1} /></Form.Item>
            <Form.Item name="collected_from" label="Период сбора"><Input placeholder="2026-Q2" /></Form.Item>
          </Space>
          <Form.Item name="source" label="Источник"><Input placeholder="откуда получен набор" /></Form.Item>
          <Form.Item name="representativeness" label="Репрезентативность">
            <Input.TextArea rows={2} placeholder="чем набор отражает эксплуатационный поток: сегменты, сезонность, доли классов" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`Выбросы: ${outlierFor?.name ?? ''}`} open={!!outlierFor} onOk={checkOutliers}
        onCancel={() => setOutlierFor(null)} okText="Проверить и записать">
        <Form form={outForm} layout="vertical" initialValues={{ method: 'IQR', handling: 'FLAGGED' }}>
          <Form.Item name="feature" label="Признак" rules={[{ required: true }]}><Input placeholder="например, сумма заявки" /></Form.Item>
          <Space wrap>
            <Form.Item name="method" label="Метод"><Select style={{ width: 200 }} options={[{ value: 'IQR', label: 'IQR (Тьюки), k = 1.5' }, { value: 'ZSCORE', label: 'z-оценка, k = 3' }]} /></Form.Item>
            <Form.Item name="k" label="Порог k (необязательно)"><InputNumber min={0.5} step={0.5} /></Form.Item>
            <Form.Item name="handling" label="Что сделано с выбросами"><Select style={{ width: 170 }} options={Object.entries(HANDLING).map(([value, label]) => ({ value, label }))} /></Form.Item>
          </Space>
          <Form.Item name="values" label="Значения признака" rules={[{ required: true }]}
            extra="Числа через пробел, «;» или с новой строки; десятичный разделитель — запятая или точка">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default AiDatasetsTab;
