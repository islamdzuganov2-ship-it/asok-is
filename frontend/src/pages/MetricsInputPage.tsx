/**
 * MetricsInputPage.tsx — ввод val_a/val_b для тест-аналитика.
 * Подключён к GET/PUT /api/v1/assessments/{id}/metrics.
 * RAG цветовая индикация. Валидация val_b > 0.
 * Excel upload через ExcelUploadBlock.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { message } from '../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { SaveOutlined, ArrowLeftOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import ExcelUploadBlock from '../components/ExcelUploadBlock';
import { subDescription, subArtifacts } from '../constants/subDescriptions';
import { SPACE, TYPE } from '../theme/premium';
import { numericColumn, sorterFor } from '../theme/table';
import { apiSlice } from '../store/api/apiSlice';

const { Text, Title } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface MetricRow {
  id: string;
  name: string;
  characteristic?: string;
  subcharacteristic?: string;
  description: string;
  val_a: number | null;
  val_b: number | null;
  expert_comment: string;
  // «Невозможно измерить» (нет возможности собрать данные) — комментарий обязателен.
  unmeasurable?: boolean;
  // После сохранения — расчётные поля
  calculatedX?: number | null;
  qualityLevel?: string | null;
}

const LEVEL_TAG_COLOR: Record<string, string> = {
  'Высокий уровень':        'green',
  'Выше среднего':          'cyan',
  'Средний уровень':        'gold',
  'Ниже среднего':          'orange',
  'Низкий уровень':         'red',
  'Невозможно измерить':    'default',
};
// Порядок значимости уровня для сортировки — от лучшего к худшему, не алфавитный.
const LEVEL_RANK: Record<string, number> = Object.fromEntries(
  Object.keys(LEVEL_TAG_COLOR).map((k, i) => [k, i]),
);

const MetricsInputPage: React.FC = () => {
  const { id: periodId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отслеживаем изменённые строки (для подсветки)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const token = localStorage.getItem('token');
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

  // «Невозможно измерить»: при включении очищаем val_a/val_b (расчёт не делается),
  // комментарий становится обязательным (проверяется при сохранении).
  const handleUnmeasurable = useCallback((id: string, checked: boolean) => {
    setMetrics((prev) => prev.map((m) =>
      m.id === id
        ? { ...m, unmeasurable: checked, ...(checked ? { val_a: null, val_b: null } : {}) }
        : m));
    setDirtyIds((prev) => new Set(prev).add(id));
  }, []);

  // Сохранение всех изменений
  const handleSaveAll = async () => {
    if (!periodId || dirtyIds.size === 0) return;
    const dirtyMetrics = metrics.filter((m) => dirtyIds.has(m.id));
    // «Невозможно измерить» требует обязательной причины (T-55). Проф. суждение и мера —
    // тоже обязательны, но вносятся в других разделах; их наличие проверяет финализация на бэкенде.
    const missingComment = dirtyMetrics.filter((m) => m.unmeasurable && !(m.expert_comment || '').trim());
    if (missingComment.length > 0) {
      message.error(
        `Для «Невозможно измерить» обязательна причина (строк: ${missingComment.length}). `
        + 'Опишите, почему нет возможности собрать данные. Также потребуются проф. суждение и мера.',
      );
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`${VITE_API}/assessments/${periodId}/metrics`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(dirtyMetrics),
      });
      if (!resp.ok) {
        // Достаём читаемый текст ошибки бэкенда: при 409 (период завершён и закрыт на правку,
        // T-47) тело — JSON {detail}. Без разбора пользователь увидел бы сырой JSON вместо
        // подсказки «откройте на корректировку».
        const body = await resp.text();
        let detail = body;
        try { detail = JSON.parse(body).detail ?? body; } catch { /* тело не JSON */ }
        throw new Error(detail);
      }
      const result = await resp.json();
      message.success(`Сохранено: ${result.updated} метрик. Backend пересчитал X.`);
      // Перечитываем локальную таблицу — получаем calculated_x и quality_level.
      await fetchMetrics();
      // Сохранение идёт «сырым» fetch мимо RTK Query, поэтому вручную инвалидируем кэш —
      // иначе сводки/результаты/дашборды («Новая оценка», summary, executive-dashboard),
      // которые читаются через RTK Query, показывали бы старые данные до перезагрузки страницы.
      // Автоматический пересчёт и обновление зависимых представлений — без обновления страницы.
      dispatch(apiSlice.util.invalidateTags(['Metrics', 'Assessment', 'Dashboard']));
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
        <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize }}>{idx + 1}</Text>
      ),
    },
    {
      title: 'Метрика',
      dataIndex: 'name',
      ellipsis: true,
      sorter: sorterFor((r: MetricRow) => r.name),
      render: (name: string, rec: MetricRow) => {
        const sub = rec.subcharacteristic || name.split(' / ')[1];
        return (
          <Tooltip
            title={(
              <div style={{ maxWidth: 340 }}>
                <div>{subDescription(rec.characteristic, sub)}</div>
                <div style={{ marginTop: SPACE.snug, opacity: 0.85 }}>{subArtifacts(sub)}</div>
              </div>
            )}
          >
            <Text style={{ fontSize: TYPE.caption.fontSize }}>{name} <InfoCircleOutlined style={{ color: '#bbb' }} /></Text>
          </Tooltip>
        );
      },
    },
    {
      title: <Tooltip title="A — фактически достигнутое значение показателя (числитель). Итог: прямая X=A/B, обратная X=1−A/B.">val_a (факт) <InfoCircleOutlined style={{ color: '#bbb' }} /></Tooltip>,
      dataIndex: 'val_a',
      width: 120,
      sorter: sorterFor((r: MetricRow) => r.val_a),
      render: (_: unknown, rec: MetricRow) => (
        <InputNumber
          size="small"
          min={0}
          value={rec.val_a ?? undefined}
          onChange={(v) => handleCellChange(rec.id, 'val_a', v)}
          style={{ width: '100%' }}
          precision={2}
          disabled={rec.unmeasurable}
        />
      ),
    },
    {
      title: <Tooltip title="B — базовое/плановое значение (знаменатель). Должно быть > 0; при B=0 отметьте «Невозможно измерить».">val_b (база) <InfoCircleOutlined style={{ color: '#bbb' }} /></Tooltip>,
      dataIndex: 'val_b',
      width: 120,
      sorter: sorterFor((r: MetricRow) => r.val_b),
      render: (_: unknown, rec: MetricRow) => {
        const isZero = rec.val_b === 0 && !rec.unmeasurable;
        return (
          <Tooltip
            title={isZero ? 'val_b = 0: отметьте «Невозможно измерить» и укажите причину' : ''}
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
              disabled={rec.unmeasurable}
            />
          </Tooltip>
        );
      },
    },
    {
      title: <Tooltip title="Нет возможности собрать данные. Требует обязательного комментария.">Невозм. изм.</Tooltip>,
      dataIndex: 'unmeasurable',
      width: 92,
      align: 'center' as const,
      sorter: sorterFor((r: MetricRow) => (r.unmeasurable ? 1 : 0)),
      render: (_: unknown, rec: MetricRow) => (
        <Checkbox
          checked={!!rec.unmeasurable}
          onChange={(e) => handleUnmeasurable(rec.id, e.target.checked)}
        />
      ),
    },
    {
      title: 'Комментарий',
      dataIndex: 'expert_comment',
      width: 220,
      sorter: sorterFor((r: MetricRow) => r.expert_comment),
      render: (_: unknown, rec: MetricRow) => {
        const required = !!rec.unmeasurable && !(rec.expert_comment || '').trim();
        return (
          <Input
            size="small"
            value={rec.expert_comment}
            onChange={(e) => handleCellChange(rec.id, 'expert_comment', e.target.value)}
            placeholder={rec.unmeasurable ? 'Причина: почему нельзя измерить (обязательно)' : 'Комментарий (необязательно)'}
            status={required ? 'error' : ''}
          />
        );
      },
    },
    numericColumn({
      title: 'X',
      dataIndex: 'calculatedX',
      width: 72,
      sorter: sorterFor((r: MetricRow) => r.calculatedX),
      render: (x: number | null | undefined) =>
        x != null ? <Text strong>{x.toFixed(4)}</Text> : <Text type="secondary">—</Text>,
    }),
    {
      title: 'Уровень',
      dataIndex: 'qualityLevel',
      width: 180,
      sorter: sorterFor((r: MetricRow) => LEVEL_RANK[r.qualityLevel ?? ''] ?? -1),
      render: (level: string | null | undefined) =>
        level
          ? <Tag color={LEVEL_TAG_COLOR[level] ?? 'default'} style={{ fontSize: TYPE.micro.fontSize }}>{level}</Tag>
          : <Text type="secondary">—</Text>,
    },
    {
      title: 'Изм.',
      key: 'dirty',
      width: 44,
      render: (_: unknown, rec: MetricRow) =>
        dirtyIds.has(rec.id)
          ? <Tag color="orange" style={{ fontSize: TYPE.micro.fontSize }}>●</Tag>
          : null,
    },
  ];

  if (!periodId) {
    return <Alert type="error" message="period_id не указан в URL" />;
  }

  // T-55: неизмеримые метрики — обязательный разбор (причина + проф. суждение + мера).
  const unmeasurable = metrics.filter((m) => m.unmeasurable);
  const unmeasurableNoCause = unmeasurable.filter((m) => !(m.expert_comment || '').trim());

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/assessments/new')}>
              Назад к оценке
            </Button>
            <Title level={4} style={{ marginBottom: 0 }}>Табличный ввод оценки</Title>
          </Space>
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

        {/* T-55: обязательный разбор неизмеримых метрик (причина + проф. суждение + мера). */}
        {unmeasurable.length > 0 && (
          <Alert
            type={unmeasurableNoCause.length ? 'error' : 'warning'}
            showIcon
            message={`Неизмеримых метрик: ${unmeasurable.length} — обязательный разбор`}
            description={(
              <div>
                Каждая метрика «Невозможно измерить» обязана иметь три условия:{' '}
                <b>причину</b> (комментарий в этой таблице —{' '}
                {unmeasurableNoCause.length
                  ? <Text type="danger">не заполнена у {unmeasurableNoCause.length}</Text>
                  : <Text type="success">заполнена у всех</Text>}),{' '}
                <b>профессиональное суждение</b> и <b>меру</b> (вносятся в разделах «Экспертиза» и «Основное»).
                Без всех трёх период <b>нельзя финализировать</b> — проверка выполняется на бэкенде.
              </div>
            )}
          />
        )}

        {loading
          ? <Spin size="large" style={{ display: 'block', marginTop: 40 }} />
          : (
            <Table<MetricRow>
              columns={columns}
              dataSource={metrics}
              rowKey="id"
              size="small"
              bordered
              sticky
              scroll={{ x: 1040, y: 'calc(100vh - 360px)' }}
              pagination={false}
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