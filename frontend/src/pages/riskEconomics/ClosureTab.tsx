/**
 * ClosureTab.tsx — замыкание контура: несоответствия и воронка их отработки (BL-007, §3.3).
 *
 * Несоответствие проходит стадии от «Выявлено» до «Верифицировано»; замкнутость = доля
 * доведённых до верификации. Разделение обязанностей (SoD) обеспечивает бэкенд: оценивает,
 * исполняет и верифицирует несоответствие не одно и то же лицо.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { message } from '../../theme/appMessage';
import KpiCard from '../../components/KpiCard';
import FieldHint from '../../components/FieldHint';
import { OwnerLink } from '../../components/OwnerLink';
import { premiumCard, SPACE } from '../../theme/premium';
import { numericColumn, sorterFor } from '../../theme/table';
import {
  api, fmtMoney, NC_LEVEL, NC_LEVEL_RANK, NC_STATUS,
  type ClosureFunnel, type Nonconformity,
} from './shared';

const { Text } = Typography;

export const ClosureTab: React.FC = () => {
  const [rows, setRows] = useState<Nonconformity[]>([]);
  const [funnel, setFunnel] = useState<ClosureFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [list, f] = await Promise.all([
        api<Nonconformity[]>('/nonconformities'), api<ClosureFunnel>('/nonconformities/funnel'),
      ]);
      setRows(list); setFunnel(f);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/nonconformities', { method: 'POST', body: JSON.stringify(v) });
      message.success('Несоответствие зарегистрировано'); setOpen(false); form.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const columns: ColumnsType<Nonconformity> = [
    { title: 'Система', dataIndex: 'systemName', width: 160, sorter: sorterFor((r: Nonconformity) => r.systemName), render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 190, sorter: sorterFor((r: Nonconformity) => r.subcharacteristic) },
    {
      title: 'Уровень', dataIndex: 'level', width: 150,
      sorter: sorterFor((r: Nonconformity) => NC_LEVEL_RANK[r.level] ?? -1),
      render: (l: string) => {
        const m = NC_LEVEL[l] ?? { label: l, color: 'default' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    { title: 'Владелец', dataIndex: 'owner', width: 140, sorter: sorterFor((r: Nonconformity) => r.owner),
      render: (v: string) => <OwnerLink owner={v} /> },
    numericColumn({ title: 'ALE, ₽', dataIndex: 'evaluatedAle', width: 140, sorter: sorterFor((r: Nonconformity) => r.evaluatedAle), render: (v: number) => fmtMoney(v) }),
    {
      title: 'Статус', dataIndex: 'status', width: 160, sorter: sorterFor((r: Nonconformity) => r.status),
      render: (s: string) => {
        const m = NC_STATUS[s] ?? { label: s, color: 'default' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Space size={SPACE.base} wrap>
          <KpiCard title="Всего несоответствий" value={funnel?.total ?? 0} />
          <KpiCard title="Верифицировано" value={funnel?.verified ?? 0} />
          <KpiCard title="Замкнутость контура" value={`${funnel?.closureRate ?? 0} %`} />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Зарегистрировать несоответствие
        </Button>
      </Space>

      <Alert type="info" showIcon
        message="Без замыкания — аудит ради аудита"
        description="Несоответствие обязано пройти путь Выявлено → Оценено → Решение → Мера → Исполнено → Верифицировано. «Верифицировано» ставит независимый аудитор — не тот, кто оценивал или исполнял." />

      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card {...premiumCard('terracotta')} styles={{ body: { padding: 0 } }}>
        <Table<Nonconformity>
          columns={columns} dataSource={rows} rowKey="id" loading={loading} size="small"
          scroll={{ x: 940 }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: 'Несоответствий нет. Зарегистрируйте выявленный дефект качества — у него обязателен владелец.' }}
        />
      </Card>

      <Modal title="Новое несоответствие" open={open} onOk={create} confirmLoading={saving}
        onCancel={() => setOpen(false)} okText="Сохранить" cancelText="Отмена" width={620}>
        <Form form={form} layout="vertical" initialValues={{ level: 'MAJOR' }}>
          <Form.Item name="systemName" label={<FieldHint title="ИС, в которой выявлено несоответствие требованиям качества.">Система</FieldHint>} rules={[{ required: true }]}>
            <Input placeholder="АБС Core" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="characteristic" label={<FieldHint title="Характеристика качества ГОСТ 25010, по которой выявлено несоответствие.">Характеристика</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Надёжность" />
            </Form.Item>
            <Form.Item name="subcharacteristic" label={<FieldHint title="Конкретная подхарактеристика — по ней несоответствие свяжется с оценкой и метриками.">Подхарактеристика</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Отказоустойчивость" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="owner" label={<FieldHint title="Кто ведёт несоответствие по циклу «Выявлено → … → Верифицировано» — не может сам же его верифицировать (разделение обязанностей).">Владелец</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="ФИО ответственного" />
            </Form.Item>
            <Form.Item name="level" label={<FieldHint title="Тяжесть несоответствия — влияет на срок реагирования (SLA) до автоэскалации.">Уровень</FieldHint>} style={{ flex: 1, minWidth: 180 }}>
              <Select options={Object.entries(NC_LEVEL).map(([v, m]) => ({ value: v, label: m.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="evidenceType" label={<FieldHint title="Чем подтверждается несоответствие — от инструментального измерения (самое надёжное) до экспертной оценки.">Тип доказательства</FieldHint>}>
            <Select allowClear options={[
              { value: 'A', label: 'A — инструментальное измерение' },
              { value: 'B', label: 'B — инцидентная статистика' },
              { value: 'C', label: 'C — анализ артефактов кода' },
              { value: 'D', label: 'D — документальная проверка' },
              { value: 'E', label: 'E — экспертная оценка' },
            ]} />
          </Form.Item>
          <Form.Item name="description" label={<FieldHint title="Подробности несоответствия: что именно не соответствует требованиям и как это обнаружено.">Описание</FieldHint>}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

