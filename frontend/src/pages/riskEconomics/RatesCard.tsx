/**
 * RatesCard.tsx — ставки сопровождения L1–L3 (BL-007 RE-03; ТЗ v19 п.10, УК-25, УК-26).
 *
 * Вынесено из ReferencesTab (потолок размера модуля). Кроме списка и ввода ставок:
 *  • УК-25 — «Подставить типовые»: вместо ввода с нуля ставки берутся из справочника типовых
 *    (размер предприятия × отрасль × линия), помечаются «по справочнику, не подтверждена» до
 *    подтверждения или ручной правки; подтверждённые подстановка не перезаписывает;
 *  • УК-26 — отчёт «ставки, отличающиеся от типовых более чем на N%» и ставки без типовой.
 */
import React, { useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import { CheckOutlined, PlusOutlined, SwapOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { message } from '../../theme/appMessage';
import FieldHint from '../../components/FieldHint';
import AppTable, { type AppColumn } from '../../components/AppTable';
import { premiumCard } from '../../theme/premium';
import { RAG } from '../../theme/ragPalette';
import { numericColumn, sorterFor } from '../../theme/table';
import {
  useConfirmRateMutation, useFillDefaultRatesMutation, useGetRateDeviationsQuery, type RateDeviation,
} from '../../store/api/controlApi';
import { api, fmtMoney, fmtNum, type SupportRate } from './shared';

const { Text } = Typography;
const LINES = ['L1', 'L2', 'L3'];

interface Props {
  rates: SupportRate[];
  loading: boolean;
  reload: () => Promise<void>;
  comparing: string | null;
  onCompare: (r: SupportRate) => void;
}

const RateDeviationsCard: React.FC = () => {
  const [threshold, setThreshold] = useState<number | null>(null);
  const { data, isFetching } = useGetRateDeviationsQuery(threshold);
  const columns: AppColumn<RateDeviation>[] = [
    { title: 'Линия', dataIndex: 'line', width: 80 },
    { title: 'Исполнитель', dataIndex: 'executorType', width: 120, render: (t: string) => (t === 'VENDOR' ? 'Вендор' : 'Внутренний') },
    { title: 'Вендор', dataIndex: 'vendor', width: 150, render: (v: string | null) => v || '—' },
    numericColumn({ title: 'Ставка', dataIndex: 'ratePerHour', width: 120, render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'Типовая', dataIndex: 'typicalRate', width: 120, render: (v: number | null) => fmtMoney(v) }),
    numericColumn({ title: 'Отклонение, %', dataIndex: 'deviationPct', width: 130,
      render: (v: number | null) => (v == null ? '—' : <Text style={{ color: v > 0 ? RAG.bad.strong : RAG.good.strong }}>{v > 0 ? '+' : ''}{fmtNum(v, 1)}</Text>) }),
    { title: 'Вывод', dataIndex: 'note' },
  ];
  return (
    <Card {...premiumCard('terracotta')} title="Отклонения от типовых ставок"
      extra={<Space size={4}><Text type="secondary">порог, %</Text>
        <InputNumber size="small" min={1} max={500} value={threshold ?? data?.thresholdPct} onChange={(v) => setThreshold(v)} style={{ width: 80 }} /></Space>}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        Повод проверить данные или начать переговоры с вендором. Без типовой ставки в справочнике: {data?.withoutReference ?? 0}.
      </Text>
      <AppTable<RateDeviation> tableKey="rate-deviations" exportName="otkloneniya-stavok" rowKey="rateId" size="small"
        loading={isFetching} dataSource={data?.rows ?? []} columns={columns} pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: 'Все ставки в пределах порога от типовых' }} />
    </Card>
  );
};

export const RatesCard: React.FC<Props> = ({ rates, loading, reload, comparing, onCompare }) => {
  const canEdit = useSelector((s: RootState) => s.auth.permissions.includes('econ.ref.edit'));
  const [rateOpen, setRateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rateForm] = Form.useForm();
  const [fillDefaults, { isLoading: filling }] = useFillDefaultRatesMutation();
  const [confirmRate] = useConfirmRateMutation();
  const compareRate = onCompare;

  const confirm = async (r: SupportRate) => {
    try { await confirmRate(r.id).unwrap(); message.success('Ставка подтверждена'); await reload(); }
    catch { message.error('Не удалось подтвердить ставку'); }
  };

  const fill = async () => {
    try {
      const res = await fillDefaults({ executorType: 'INTERNAL' }).unwrap();
      message.success(`Подставлено: ${res.created}` + (res.skippedNoReference.length
        ? `; нет типовой для ${res.skippedNoReference.join(', ')}` : ''));
      await reload();
    } catch { message.error('Не удалось подставить типовые ставки'); }
  };

  const createRate = async () => {
    try {
      const v = await rateForm.validateFields();
      setSaving(true);
      // RE-03: если ставка не введена, бэкенд считает её из ФОТ × K_накладных / фонд времени.
      await api('/econ/rates', { method: 'POST', body: JSON.stringify(v) });
      message.success('Ставка добавлена'); setRateOpen(false); rateForm.resetFields(); await reload();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };


  const rateCols: AppColumn<SupportRate>[] = [
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
      title: 'Контракт', key: 'contract', width: 190,
      render: (_: unknown, r: SupportRate) => (r.executorType === 'VENDOR'
        ? <Text type="secondary" style={{ fontSize: 12 }}>
            {r.packageHours != null ? `пакет ${fmtNum(r.packageHours, 0)} ч, сверх ${fmtMoney(r.overlimitRate)}` : 'без пакета'}
            {` · квант ${r.billingQuantumMin ?? 60} мин`}
          </Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>по факту времени</Text>),
    },
    // УК-25: ставка из справочника визуально отличается от подтверждённой вручную.
    {
      title: 'Источник', dataIndex: 'source', width: 200,
      sorter: sorterFor((r: SupportRate) => (r.source === 'REFERENCE' && !r.confirmedAt ? 0 : 1)),
      render: (_: unknown, r: SupportRate) => (r.source === 'REFERENCE' && !r.confirmedAt ? (
        <Space size={4}>
          <Tag color="orange">по справочнику, не подтверждена</Tag>
          {canEdit && <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => confirm(r)}>Подтвердить</Button>}
        </Space>
      ) : <Tag color="green">{r.source === 'REFERENCE' ? 'справочник, подтверждена' : 'введена вручную'}</Tag>),
    },
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


  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        {...premiumCard('slate')}
        title="Ставки сопровождения L1–L3"
        extra={canEdit && (
          <Space size={4}>
            <Button size="small" icon={<ThunderboltOutlined />} loading={filling} onClick={fill}>Подставить типовые</Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setRateOpen(true)}>Добавить</Button>
          </Space>
        )}
        styles={{ body: { padding: 0 } }}
      >
        <AppTable<SupportRate>
          tableKey="support-rates" exportName="stavki-soprovozhdeniya"
          columns={rateCols} dataSource={rates} rowKey="id" loading={loading} size="small"
          scroll={{ x: 1150 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'Ставок нет. «Подставить типовые» — из справочника; или внутренняя = (ФОТ×K_накладных)/фонд.' }}
        />
      </Card>
      <RateDeviationsCard />
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
          <Form.Item name="ratePerHour" label={<FieldHint title="Базовая почасовая ставка исполнителя — основа расчёта стоимости восстановления (C_восстановление) при инциденте. Для внутренней команды можно не вводить — посчитается из ФОТ.">Ставка, ₽/час</FieldHint>}>
            <InputNumber style={{ width: '100%' }} min={0} step={500} />
          </Form.Item>
          {/* RE-03: внутренняя ставка = (ФОТ × K_накладных) / фонд рабочего времени. */}
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="fotMonthly" label={<FieldHint title="Фонд оплаты труда линии за месяц — если ставка не введена, бэкенд посчитает её с коэффициентом накладных из финпараметров.">ФОТ в месяц, ₽</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
            <Form.Item name="fundHoursMonthly" label="Фонд времени, ч/мес" style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={1} step={8} />
            </Form.Item>
          </Space>
          <Form.Item noStyle shouldUpdate={(a, b) => a.executorType !== b.executorType}>
            {({ getFieldValue }) => getFieldValue('executorType') === 'VENDOR' && (
              <Space style={{ width: '100%' }} size="middle">
                <Form.Item name="packageHours" label={<FieldHint title="Часы, оплаченные абонентской платой в месяц: сверх них — сверхлимитный тариф.">Пакет, ч/мес</FieldHint>} style={{ flex: 1 }}>
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
                <Form.Item name="overlimitRate" label="Сверхлимит, ₽/ч" style={{ flex: 1 }}>
                  <InputNumber style={{ width: '100%' }} min={0} step={500} />
                </Form.Item>
                <Form.Item name="billingQuantumMin" label={<FieldHint title="Минимальная единица оплаты: 20 минут работы при кванте 60 оплачиваются как час.">Квант, мин</FieldHint>} style={{ flex: 1 }}>
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Space>
            )}
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
    </Space>
  );
};

export default RatesCard;
