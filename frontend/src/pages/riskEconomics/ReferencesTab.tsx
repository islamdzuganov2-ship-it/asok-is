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
import RatesCard from './RatesCard';
import {
  api, fmtMoney, fmtNum,
  bpCostParams, bpTimeProfile,
  type BenchmarkComparison, type BpCost, type BusinessProcess, type SupportRate,
} from './shared';

const { Text } = Typography;

export const ReferencesTab: React.FC = () => {
  const [rates, setRates] = useState<SupportRate[]>([]);
  const [bps, setBps] = useState<BusinessProcess[]>([]);
  const [costs, setCosts] = useState<Record<string, BpCost | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bpOpen, setBpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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
          try { const c = await api<BpCost | null>(`/econ/business-processes/${bp.id}/cost`); return [bp.id, c] as const; }
          catch { return [bp.id, null] as const; }
        }),
      );
      setCosts(Object.fromEntries(costEntries));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createBp = async () => {
    try {
      const v = await bpForm.validateFields();
      setSaving(true);
      const { code, name, kind } = v;
      const created = await api<BusinessProcess>('/econ/business-processes', { method: 'POST', body: JSON.stringify({ code, name, kind }) });
      // RE-02: C_мин задаётся методом и параметрами (бэкенд считает базу сам) или вручную.
      const method = v.method ?? 'RESOURCE';
      const params = bpCostParams(method, v);
      if (Object.keys(params).length || v.costPerMinBase != null) {
        await api(`/econ/business-processes/${created.id}/cost`, {
          method: 'PUT',
          body: JSON.stringify({ method, params, timeProfile: bpTimeProfile(v), costPerMinBase: v.costPerMinBase ?? null }),
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


  const bpCols: ColumnsType<BusinessProcess> = [
    { title: 'Код', dataIndex: 'code', width: 120, sorter: sorterFor((r: BusinessProcess) => r.code) },
    { title: 'Название', dataIndex: 'name', width: 220, sorter: sorterFor((r: BusinessProcess) => r.name), render: (t: string) => <Text strong>{t}</Text> },
    {
      title: 'Тип', dataIndex: 'kind', width: 200, sorter: sorterFor((r: BusinessProcess) => r.kind),
      render: (k: string) => BP_KINDS.find((x) => x.value === k)?.label ?? k,
    },
    numericColumn({
      title: 'C_мин, ₽', key: 'cost', width: 170,
      sorter: sorterFor((bp: BusinessProcess) => costs[bp.id]?.costPerMinBase ?? null),
      render: (_: unknown, bp: BusinessProcess) => {
        const c = costs[bp.id];
        if (!c) return fmtMoney(null);
        return (
          <span>
            {fmtMoney(c.costPerMinBase)}
            {c.costPerMinLow != null && c.costPerMinHigh != null && (
              <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                диапазон {fmtMoney(c.costPerMinLow)}–{fmtMoney(c.costPerMinHigh)}
              </Text>
            )}
          </span>
        );
      },
    }),
    {
      title: 'Метод', key: 'method', width: 150,
      render: (_: unknown, bp: BusinessProcess) => {
        const m = costs[bp.id]?.method;
        return m ? <Tag>{m === 'RESOURCE' ? 'ресурсный' : m === 'TRANSACTIONAL' ? 'транзакционный' : 'экспертный'}</Tag> : '—';
      },
    },
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

      <RatesCard rates={rates} loading={loading} reload={load} comparing={comparing} onCompare={compareRate} />

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
          {/* RE-02: метод хранится вместе с числом — первый вопрос CFO «как посчитано». */}
          <Form.Item name="method" label={<FieldHint title="Ресурсный — для бэк-офиса (люди простаивают); транзакционный — только для фронтальных процессов (теряется выручка); экспертный — диапазон, когда данных нет.">Метод расчёта C_мин</FieldHint>}>
            <Select options={[
              { value: 'RESOURCE', label: 'Ресурсный: сотрудники × ставка × K_простоя × K_наверстывания' },
              { value: 'TRANSACTIONAL', label: 'Транзакционный: выручка за период / минуты × доля' },
              { value: 'EXPERT', label: 'Экспертный: диапазон «от–до»' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.method !== b.method}>
            {({ getFieldValue }) => {
              const m = getFieldValue('method');
              if (m === 'TRANSACTIONAL') return (
                <Space wrap size="middle">
                  <Form.Item name="revenue_per_period" label="Выручка за период, ₽"><InputNumber min={0} step={100000} /></Form.Item>
                  <Form.Item name="minutes_per_period" label="Минут работы БП за период"><InputNumber min={1} /></Form.Item>
                  <Form.Item name="process_share" label="Доля процесса"><InputNumber min={0} max={1} step={0.05} /></Form.Item>
                </Space>
              );
              if (m === 'EXPERT') return (
                <Space wrap size="middle">
                  <Form.Item name="low" label="От, ₽/мин"><InputNumber min={0} /></Form.Item>
                  <Form.Item name="high" label="До, ₽/мин"><InputNumber min={0} /></Form.Item>
                </Space>
              );
              return (
                <Space wrap size="middle">
                  <Form.Item name="n_employees" label="Сотрудников"><InputNumber min={0} /></Form.Item>
                  <Form.Item name="hourly_rate" label="Ставка, ₽/ч"><InputNumber min={0} step={100} /></Form.Item>
                  <Form.Item name="k_idle" label="K простоя"><InputNumber min={0} max={1} step={0.1} placeholder="0,6" /></Form.Item>
                  <Form.Item name="k_catchup" label="K наверстывания"><InputNumber min={1} max={2} step={0.1} placeholder="1,3" /></Form.Item>
                </Space>
              );
            }}
          </Form.Item>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            Временной профиль (необязательно): множитель C_мин в часы пик, вне пика и в выходные.
          </Text>
          <Space wrap size="middle">
            <Form.Item name="peakFrom" label="Пик с, ч"><InputNumber min={0} max={23} placeholder="9" /></Form.Item>
            <Form.Item name="peakTo" label="до, ч"><InputNumber min={1} max={24} placeholder="18" /></Form.Item>
            <Form.Item name="peak" label="× в пик"><InputNumber min={0} step={0.1} placeholder="1" /></Form.Item>
            <Form.Item name="offpeak" label="× вне пика"><InputNumber min={0} step={0.1} /></Form.Item>
            <Form.Item name="weekend" label="× выходные"><InputNumber min={0} step={0.1} /></Form.Item>
          </Space>
          <Form.Item name="costPerMinBase" label={<FieldHint title="Если задано — используется как есть; если пусто — рассчитывается по методу и параметрам выше.">Стоимость минуты вручную, ₽ (необязательно)</FieldHint>}>
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

