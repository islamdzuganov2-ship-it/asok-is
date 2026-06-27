/**
 * RiskBasePage.tsx — сквозная база рисков (накопительная, источник знаний для LLM).
 *
 * Отличается от вкладки «Отчёты и реестры»: там риски привязаны к периоду оценки,
 * здесь — единый пополняемый реестр, который LLM использует для обоснования
 * рекомендаций (grounding). Подключено к /api/v1/risks (CRUD + поиск).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, InboxOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface Risk {
  id: string;
  code: string;
  title: string;
  category: string;
  characteristic?: string | null;
  subcharacteristic?: string | null;
  description: string;
  consequence?: string | null;
  mitigation?: string | null;
  severity: string;
  likelihood: string;
  source: string;
  status: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  low: 'green', medium: 'gold', high: 'orange', critical: 'red',
};

const RiskBasePage: React.FC = () => {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const headers = useMemo(() => {
    const token = localStorage.getItem('token');
    return token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' };
  }, []);

  const fetchRisks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${VITE_API}/risks`);
      if (search) url.searchParams.set('q', search);
      const resp = await fetch(url.toString(), { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setRisks(await resp.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, headers]);

  useEffect(() => { fetchRisks(); }, [fetchRisks]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const resp = await fetch(`${VITE_API}/risks`, {
        method: 'POST', headers, body: JSON.stringify(values),
      });
      if (!resp.ok) throw new Error((await resp.json()).detail || `HTTP ${resp.status}`);
      message.success('Риск добавлен в базу');
      setModalOpen(false);
      form.resetFields();
      await fetchRisks();
    } catch (e: any) {
      if (e?.errorFields) return; // ошибки валидации формы
      message.error(`Не удалось сохранить: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string) => {
    try {
      const resp = await fetch(`${VITE_API}/risks/${id}/archive`, { method: 'POST', headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      message.success('Риск архивирован');
      await fetchRisks();
    } catch (e: any) {
      message.error(`Ошибка: ${e.message}`);
    }
  };

  const columns: ColumnsType<Risk> = [
    { title: 'Код', dataIndex: 'code', width: 130 },
    { title: 'Название', dataIndex: 'title', width: 220, render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Категория', dataIndex: 'category', width: 150 },
    { title: 'Характеристика', dataIndex: 'characteristic', width: 160 },
    {
      title: 'Критичность', dataIndex: 'severity', width: 120,
      render: (s: string) => <Tag color={SEVERITY_COLOR[s] ?? 'default'}>{s}</Tag>,
    },
    { title: 'Меры минимизации', dataIndex: 'mitigation', ellipsis: true },
    {
      title: 'Источник', dataIndex: 'source', width: 110,
      render: (s: string) => <Tag>{s}</Tag>,
    },
    {
      title: '', key: 'actions', width: 110,
      render: (_: unknown, rec: Risk) => (
        <Button size="small" icon={<InboxOutlined />} onClick={() => handleArchive(rec.id)}>
          В архив
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Title level={3} style={{ margin: 0, color: '#1F3864' }}>База рисков</Title>
          <Text type="secondary">
            Накопительный реестр знаний о рисках. Используется LLM для обоснования рекомендаций.
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Добавить риск
        </Button>
      </Space>

      <Input.Search
        placeholder="Поиск по названию, описанию, коду, ключевым словам…"
        allowClear
        style={{ maxWidth: 480 }}
        onSearch={setSearch}
      />

      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Table<Risk>
        columns={columns}
        dataSource={risks}
        rowKey="id"
        loading={loading}
        size="small"
        bordered
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        locale={{ emptyText: 'База пуста. Добавьте риск или импортируйте из периода оценки.' }}
      />

      <Modal
        title="Новый риск в базу"
        open={modalOpen}
        onOk={handleCreate}
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        okText="Сохранить"
        cancelText="Отмена"
        width={640}
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Заполните карточку риска. Поля «Ключевые слова» и «Меры минимизации» используются LLM.
        </Paragraph>
        <Form form={form} layout="vertical" initialValues={{ severity: 'medium', likelihood: 'medium', category: 'общее' }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label="Код" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="R-TEST-001" />
            </Form.Item>
            <Form.Item name="category" label="Категория" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="тестируемость" />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Недостаточное покрытие автотестами" />
          </Form.Item>
          <Form.Item name="characteristic" label="Характеристика (ISO 25010 / МК_8.1)">
            <Input placeholder="Сопровождаемость" />
          </Form.Item>
          <Form.Item name="description" label="Описание риска" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="consequence" label="Последствие">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="mitigation" label="Меры минимизации">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="severity" label="Критичность" style={{ flex: 1, minWidth: 160 }}>
              <Select options={['low', 'medium', 'high', 'critical'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="likelihood" label="Вероятность" style={{ flex: 1, minWidth: 160 }}>
              <Select options={['low', 'medium', 'high'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Space>
          <Form.Item name="keywords" label="Ключевые слова (через запятую, для LLM)">
            <Input placeholder="автотесты, регресс, покрытие" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default RiskBasePage;
