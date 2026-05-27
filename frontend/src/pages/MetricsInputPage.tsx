/**
 * MetricsInputPage.tsx — ввод val_a/val_b для тест-аналитика.
 * Подключён к GET/PUT /api/v1/assessments/{id}/metrics.
 * RAG цветовая индикация. Валидация val_b > 0.
 * Excel upload через ExcelUploadBlock.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Alert, Button, InputNumber, Space, Spin, Table,
  Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SaveOutlined, SendOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import ExcelUploadBlock from '../components/ExcelUploadBlock';

const { Text, Title } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface MetricRow {
  id: string;
  name: string;
  description: string;
  val_a: number | null;
  val_b: number | null;
  expert_comment: string;
  // После сохранения — расчётные поля
  calculatedX?: number | null;
  qualityLevel?: string | null;
}

const LEVEL_TAG_COLOR: Record<string, string> = {
  'Высокий уровень':        'green',
  'Уровень выше среднего':  'cyan',
  'Средний уровень':        'gold',
  'Уровень ниже среднего':  'orange',
  'Низкий уровень':         'red',
  'Невозможно измерить':    'default',
};

const MetricsInputPage: React.FC = () => {
  const { id: periodId } = useParams<{ id: string }>();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отслеживаем изменённые строки (для подсветки)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const token = localStorage.getItem('asok_access_token');
  const headers = token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };

  // Загрузка метрик
  const fetchMetrics = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${VITE_API}/assessments/${periodId}/metrics`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const data: MetricRow[] = await resp.json();
      setMetrics(data);
      setDirtyIds(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  // Обновление ячейки в локальном state
  const handleCellChange = useCallback(
    (id: string, field: 'val_a' | 'val_b' | 'expert_comment', value: number | string | null) => {
      setMetrics((prev) =>
        prev.map((m) => m.id === id ? { ...m, [field]: value } : m)
      );
      setDirtyIds((prev) => new Set(prev).add(id));
    },
    [],
  );

  // Сохранение всех изменений
  const handleSaveAll = async () => {
    if (!periodId || dirtyIds.size === 0) return;
    setSaving(true);
    try {
      const dirtyMetrics = metrics.filter((m) => dirtyIds.has(m.id));
      const resp = await fetch(`${VITE_API}/assessments/${periodId}/metrics`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(dirtyMetrics),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const result = await resp.json();
      message.success(`Сохранено: ${result.updated} метрик. Backend пересчитал X.`);
      // Перечитываем — получаем calculated_x и quality_level
      await fetchMetrics();
    } catch (e: any) {
      message.error(`Ошибка сохранения: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<MetricRow> = [
    {
      title: '№',
      key: 'num',
      width: 48,
      render: (_: unknown, __: MetricRow, idx: number) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{idx + 1}</Text>
      ),
    },
    {
      title: 'Метрика',
      dataIndex: 'name',
      ellipsis: true,
      render: (name: string, rec: MetricRow) => (
        <Tooltip title={rec.description}>
          <Text style={{ fontSize: 12 }}>{name}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'val_a (факт)',
      dataIndex: 'val_a',
      width: 120,
      render: (_: unknown, rec: MetricRow) => (
        <InputNumber
          size="small"
          min={0}
          value={rec.val_a ?? undefined}
          onChange={(v) => handleCellChange(rec.id, 'val_a', v)}
          style={{ width: '100%' }}
          precision={2}
        />
      ),
    },
    {
      title: 'val_b (план)',
      dataIndex: 'val_b',
      width: 120,
      render: (_: unknown, rec: MetricRow) => {
        const isZero = rec.val_b === 0;
        return (
          <Tooltip
            title={isZero ? 'val_b = 0: введите причину в комментарии' : ''}
            color="red"
            open={isZero || undefined}
          >
            <InputNumber
              size="small"
              min={0}
              value={rec.val_b ?? undefined}
              onChange={(v) => handleCellChange(rec.id, 'val_b', v)}
              style={{ width: '100%' }}
              status={isZero ? 'error' : ''}
              precision={2}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'X',
      dataIndex: 'calculatedX',
      width: 72,
      render: (x: number | null | undefined) =>
        x != null ? <Text strong>{x.toFixed(4)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Уровень',
      dataIndex: 'qualityLevel',
      width: 180,
      render: (level: string | null | undefined) =>
        level
          ? <Tag color={LEVEL_TAG_COLOR[level] ?? 'default'} style={{ fontSize: 11 }}>{level}</Tag>
          : <Text type="secondary">—</Text>,
    },
    {
      title: 'Изм.',
      key: 'dirty',
      width: 44,
      render: (_: unknown, rec: MetricRow) =>
        dirtyIds.has(rec.id)
          ? <Tag color="orange" style={{ fontSize: 10 }}>●</Tag>
          : null,
    },
  ];

  if (!periodId) {
    return <Alert type="error" message="period_id не указан в URL" />;
  }

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={4} style={{ marginBottom: 0 }}>
            Ввод метрик — период {periodId}
          </Title>
          <Space>
            <Button
              icon={<SaveOutlined />}
              type="primary"
              loading={saving}
              disabled={dirtyIds.size === 0}
              onClick={handleSaveAll}
            >
              Сохранить {dirtyIds.size > 0 ? `(${dirtyIds.size})` : ''}
            </Button>
          </Space>
        </Space>

        {error && (
          <Alert
            type="error"
            showIcon
            message="Ошибка загрузки метрик"
            description={error}
            closable
          />
        )}

        {/* Excel Upload блок */}
        <ExcelUploadBlock periodId={periodId} onImported={fetchMetrics} />

        {loading
          ? <Spin size="large" style={{ display: 'block', marginTop: 40 }} />
          : (
            <Table<MetricRow>
              columns={columns}
              dataSource={metrics}
              rowKey="id"
              size="small"
              bordered
              scroll={{ x: 700 }}
              pagination={{ pageSize: 30, hideOnSinglePage: true }}
              rowClassName={(rec) =>
                dirtyIds.has(rec.id) ? 'ant-table-row-selected' : ''
              }
              locale={{ emptyText: 'Нет метрик. Создайте период и seed данные.' }}
            />
          )
        }
      </Space>
    </div>
  );
};

export default MetricsInputPage;