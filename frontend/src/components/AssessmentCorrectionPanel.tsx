/**
 * AssessmentCorrectionPanel.tsx — вкладка «Корректировка оценки» (ТЗ v16, T-47).
 *
 * Список ЗАВЕРШЁННЫХ оценок (период заполнен по всем 31 подхарактеристике) с открытием
 * периода на правку значений и комментариев:
 *   • завершённая оценка (COMPLETE) закрыта на правку — сначала «Открыть на корректировку»
 *     (POST /assessments/{id}/reopen), иначе цифры дашбордов менялись бы задним числом;
 *   • после разблокировки значения правятся и сохраняются (PUT /assessments/{id}/metrics),
 *     X и уровень пересчитывает бэкенд; RTK Query инвалидирует Dashboard → дашборды
 *     переотражают правку без перезагрузки страницы;
 *   • затем оценку завершают заново (POST /assessments/{id}/finalize).
 *
 * Источник данных по режиму (эталон — IncidentsAnalyticsPage): 'live' — API, 'mock' — демо-набор
 * (mockAssessments). В демо правки живут в состоянии вкладки и в БД не пишутся — об этом честно
 * говорит подпись и сообщение при сохранении.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Input, InputNumber, Progress, Select, Space, Table, Tag, Tooltip,
  Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined, EditOutlined, ReloadOutlined, SaveOutlined, UnlockOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import {
  useFinalizeAssessmentMutation,
  useGetAssessmentMetricsQuery,
  useGetPeriodSummariesQuery,
  useReopenAssessmentMutation,
  useSaveAssessmentMetricsMutation,
  type EditableMetric,
  type PeriodSummary,
} from '../store/api/apiSlice';
import { DEMO_PERIOD_SUMMARIES, computeX, demoMetricsOf } from '../data/mockAssessments';
import { formulaFor, TOTAL_SUBS } from '../constants/qualityModel';
import { levelLabel } from '../theme/ragPalette';
import { SPACE } from '../theme/premium';

const { Title, Text } = Typography;

const LEVEL_COLOR: Record<string, string> = {
  'Высокий уровень': 'green',
  'Выше среднего': 'cyan',
  'Средний уровень': 'gold',
  'Ниже среднего': 'orange',
  'Низкий уровень': 'red',
  'Невозможно измерить': 'default',
};

/** COMPLETE — завершена и закрыта на правку; иначе период открыт (в т.ч. после разблокировки). */
const isLocked = (status?: string) => status === 'COMPLETE';

const AssessmentCorrectionPanel: React.FC = () => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';

  const live = useGetPeriodSummariesQuery(undefined, { skip: !isLive });
  const [reopen, { isLoading: reopening }] = useReopenAssessmentMutation();
  const [saveMetrics, { isLoading: saving }] = useSaveAssessmentMetricsMutation();
  const [finalize, { isLoading: finalizing }] = useFinalizeAssessmentMutation();

  // Демо-режим: правки и разблокировки живут в состоянии вкладки (в БД не пишутся).
  const [demoRows, setDemoRows] = useState<Record<string, EditableMetric[]>>({});
  const [demoStatus, setDemoStatus] = useState<Record<string, string>>({});

  const [systemFilter, setSystemFilter] = useState<string | undefined>();
  const [periodFilter, setPeriodFilter] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // Незасохранённые правки строк: id значения → изменённые поля.
  const [edits, setEdits] = useState<Record<string, Partial<EditableMetric>>>({});

  const allPeriods: PeriodSummary[] = useMemo(() => {
    const rows = isLive ? (live.data ?? []) : DEMO_PERIOD_SUMMARIES;
    // Завершённая оценка = заполнены все подхарактеристики модели (в т.ч. открытая на правку).
    return rows
      .filter((p) => p.complete || p.filled >= TOTAL_SUBS)
      .map((p) => (isLive ? p : { ...p, status: demoStatus[p.id] ?? p.status }));
  }, [isLive, live.data, demoStatus]);

  const systemOptions = useMemo(
    () => Array.from(new Set(allPeriods.map((p) => p.system_name))).sort((a, b) => a.localeCompare(b)),
    [allPeriods],
  );
  const periodOptions = useMemo(
    () => Array.from(new Set(allPeriods.map((p) => p.period))).sort().reverse(),
    [allPeriods],
  );

  const rows = useMemo(
    () => allPeriods.filter((p) => (!systemFilter || p.system_name === systemFilter)
      && (!periodFilter || p.period === periodFilter)),
    [allPeriods, systemFilter, periodFilter],
  );

  const selected = useMemo(() => allPeriods.find((p) => p.id === selectedId), [allPeriods, selectedId]);
  const locked = isLocked(selected?.status);

  const liveMetrics = useGetAssessmentMetricsQuery(selectedId ?? '', { skip: !isLive || !selectedId });
  const baseMetrics: EditableMetric[] = useMemo(() => {
    if (!selectedId) return [];
    if (isLive) return liveMetrics.data ?? [];
    return demoRows[selectedId] ?? demoMetricsOf(selectedId);
  }, [isLive, liveMetrics.data, selectedId, demoRows]);

  // Строки таблицы = сохранённые значения + текущие правки; X/уровень пересчитываются сразу
  // по методике (прямая A/B, обратная 1 − A/B) — пользователь видит эффект до сохранения.
  const metricRows: EditableMetric[] = useMemo(
    () => baseMetrics.map((row) => {
      const patch = edits[row.id];
      if (!patch) return row;
      const merged = { ...row, ...patch };
      if (merged.unmeasurable) {
        return { ...merged, val_a: null, val_b: null, calculatedX: null, qualityLevel: 'Невозможно измерить' };
      }
      const x = computeX(
        merged.val_a,
        merged.val_b,
        formulaFor(merged.characteristic || '', merged.subcharacteristic || ''),
      );
      return { ...merged, calculatedX: x, qualityLevel: x == null ? null : levelLabel(Math.round(x * 100)) };
    }),
    [baseMetrics, edits],
  );

  useEffect(() => { setEdits({}); }, [selectedId]);

  const dirtyIds = Object.keys(edits);
  const patchRow = (id: string, patch: Partial<EditableMetric>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleReopen = async () => {
    if (!selectedId) return;
    if (!isLive) {
      setDemoStatus((prev) => ({ ...prev, [selectedId]: 'CALCULATED' }));
      message.success('Оценка открыта на корректировку (демо-режим)');
      return;
    }
    try {
      await reopen(selectedId).unwrap();
      message.success('Оценка открыта на корректировку — значения можно править');
    } catch (e: any) {
      message.error(e?.status === 403
        ? 'Недостаточно прав: разблокировка доступна аналитику, менеджеру по качеству и администратору'
        : (e?.data?.detail || 'Не удалось открыть оценку на корректировку'));
    }
  };

  const handleSave = async () => {
    if (!selectedId || !dirtyIds.length) return;
    const changed = metricRows.filter((r) => edits[r.id]);
    const missingReason = changed.filter((r) => r.unmeasurable && !(r.expert_comment || '').trim());
    if (missingReason.length) {
      message.error(`Для «Невозможно измерить» обязательна причина (строк: ${missingReason.length})`);
      return;
    }
    if (!isLive) {
      setDemoRows((prev) => ({ ...prev, [selectedId]: metricRows }));
      setEdits({});
      message.success(`Демо-режим: правки применены локально (${changed.length}); в БД не записываются`);
      return;
    }
    try {
      await saveMetrics({ id: selectedId, metrics: changed }).unwrap();
      setEdits({});
      message.success(`Сохранено значений: ${changed.length}. Дашборды пересчитаны.`);
    } catch (e: any) {
      message.error(e?.data?.detail || 'Не удалось сохранить правки');
    }
  };

  const handleFinalize = async () => {
    if (!selectedId) return;
    if (!isLive) {
      setDemoStatus((prev) => ({ ...prev, [selectedId]: 'COMPLETE' }));
      message.success('Оценка завершена заново (демо-режим)');
      return;
    }
    try {
      await finalize(selectedId).unwrap();
      message.success('Оценка завершена заново и учтена');
    } catch (e: any) {
      message.error(e?.data?.detail || 'Не удалось завершить оценку');
    }
  };

  const periodColumns: ColumnsType<PeriodSummary> = [
    { title: 'Информационная система', dataIndex: 'system_name', ellipsis: true },
    { title: 'Период', dataIndex: 'period', width: 110 },
    {
      title: 'Заполнено', key: 'filled', width: 180,
      render: (_, rec) => (
        <Progress
          percent={Math.round((rec.filled / (rec.total || TOTAL_SUBS)) * 100)}
          size="small"
          status="success"
          format={() => `${rec.filled}/${rec.total}`}
        />
      ),
    },
    {
      title: 'Статус', key: 'status', width: 190,
      render: (_, rec) => (isLocked(rec.status)
        ? <Tag color="green" icon={<CheckCircleOutlined />}>Завершена (закрыта)</Tag>
        : <Tag color="gold" icon={<UnlockOutlined />}>Открыта на корректировку</Tag>),
    },
    {
      title: '', key: 'action', width: 120,
      render: (_, rec) => (
        <Button
          size="small"
          type={rec.id === selectedId ? 'primary' : 'default'}
          icon={<EditOutlined />}
          onClick={() => setSelectedId(rec.id)}
        >
          {rec.id === selectedId ? 'Открыта' : 'Открыть'}
        </Button>
      ),
    },
  ];

  const metricColumns: ColumnsType<EditableMetric> = [
    { title: 'Характеристика', dataIndex: 'characteristic', width: 200, ellipsis: true },
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 220, ellipsis: true },
    {
      title: <Tooltip title="A — фактически достигнутое значение (числитель)">A (факт)</Tooltip>,
      dataIndex: 'val_a', width: 110,
      render: (_, rec) => (
        <InputNumber
          size="small" min={0} precision={2} style={{ width: '100%' }}
          value={rec.val_a ?? undefined}
          disabled={locked || rec.unmeasurable}
          onChange={(v) => patchRow(rec.id, { val_a: v as number | null })}
        />
      ),
    },
    {
      title: <Tooltip title="B — база сравнения (знаменатель), B > 0">B (база)</Tooltip>,
      dataIndex: 'val_b', width: 110,
      render: (_, rec) => (
        <InputNumber
          size="small" min={0} precision={2} style={{ width: '100%' }}
          value={rec.val_b ?? undefined}
          status={rec.val_b === 0 && !rec.unmeasurable ? 'error' : ''}
          disabled={locked || rec.unmeasurable}
          onChange={(v) => patchRow(rec.id, { val_b: v as number | null })}
        />
      ),
    },
    {
      title: <Tooltip title="Нет возможности собрать данные. Требует комментарий с причиной.">Невозм. изм.</Tooltip>,
      dataIndex: 'unmeasurable', width: 96, align: 'center',
      render: (_, rec) => (
        <Checkbox
          checked={!!rec.unmeasurable}
          disabled={locked}
          onChange={(e) => patchRow(rec.id, e.target.checked
            ? { unmeasurable: true, val_a: null, val_b: null }
            : { unmeasurable: false })}
        />
      ),
    },
    {
      title: 'Комментарий', dataIndex: 'expert_comment', width: 240,
      render: (_, rec) => (
        <Input
          size="small"
          value={rec.expert_comment}
          disabled={locked}
          status={rec.unmeasurable && !(rec.expert_comment || '').trim() ? 'error' : ''}
          placeholder={rec.unmeasurable ? 'Причина: почему нельзя измерить (обязательно)' : 'Комментарий'}
          onChange={(e) => patchRow(rec.id, { expert_comment: e.target.value })}
        />
      ),
    },
    {
      title: 'X', dataIndex: 'calculatedX', width: 74,
      render: (x: number | null | undefined) =>
        (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Уровень', dataIndex: 'qualityLevel', width: 170,
      render: (level: string | null | undefined) => (level
        ? <Tag color={LEVEL_COLOR[level] ?? 'default'} style={{ fontSize: 11 }}>{level}</Tag>
        : <Text type="secondary">—</Text>),
    },
    {
      title: 'Изм.', key: 'dirty', width: 48, align: 'center',
      render: (_, rec) => (edits[rec.id] ? <Tag color="orange" style={{ fontSize: 10 }}>●</Tag> : null),
    },
  ];

  return (
    <div>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <div>
          <Title level={4} style={{ marginTop: 0, marginBottom: 2 }}>Корректировка оценки</Title>
          <Text type="secondary">
            Завершённые оценки ({TOTAL_SUBS} из {TOTAL_SUBS} подхарактеристик) с открытием периода на правку
            значений и комментариев · {isLive ? 'реальная БД' : 'демо-данные'}
          </Text>
        </div>
        <Space wrap>
          <Select
            allowClear showSearch style={{ width: 260 }} placeholder="Все системы"
            value={systemFilter} onChange={setSystemFilter}
            options={systemOptions.map((s) => ({ value: s, label: s }))}
          />
          <Select
            allowClear style={{ width: 150 }} placeholder="Все периоды"
            value={periodFilter} onChange={setPeriodFilter}
            options={periodOptions.map((p) => ({ value: p, label: p }))}
          />
          {isLive && (
            <Button icon={<ReloadOutlined />} onClick={() => live.refetch()} loading={live.isFetching}>
              Обновить
            </Button>
          )}
        </Space>
      </Space>

      {isLive && live.isError && (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message="Не удалось загрузить список оценок" />
      )}

      <Table<PeriodSummary>
        style={{ marginTop: 12 }}
        columns={periodColumns}
        dataSource={rows}
        rowKey="id"
        size="small"
        bordered
        loading={isLive && live.isFetching}
        pagination={{ pageSize: 8, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: 'Завершённых оценок нет: оценка попадает сюда после заполнения всех подхарактеристик.' }}
      />

      {selected && (
        <div style={{ marginTop: 16 }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 2 }}>
                {selected.system_name} · {selected.period}
              </Title>
              <Text type="secondary">
                {locked
                  ? 'Оценка завершена — значения закрыты на правку.'
                  : 'Оценка открыта на корректировку: правьте значения и комментарии, затем сохраните.'}
              </Text>
            </div>
            <Space wrap>
              {locked ? (
                <Button type="primary" icon={<UnlockOutlined />} loading={reopening} onClick={handleReopen}>
                  Открыть на корректировку
                </Button>
              ) : (
                <>
                  <Button
                    type="primary" icon={<SaveOutlined />} loading={saving}
                    disabled={!dirtyIds.length} onClick={handleSave}
                  >
                    Сохранить {dirtyIds.length ? `(${dirtyIds.length})` : ''}
                  </Button>
                  <Tooltip title={dirtyIds.length ? 'Сначала сохраните правки' : 'Вернуть оценку в завершённые'}>
                    <Button
                      icon={<CheckCircleOutlined />} loading={finalizing}
                      disabled={!!dirtyIds.length} onClick={handleFinalize}
                    >
                      Завершить заново
                    </Button>
                  </Tooltip>
                </>
              )}
            </Space>
          </Space>

          <Alert
            style={{ marginTop: SPACE.cozy }}
            type={locked ? 'info' : 'warning'}
            showIcon
            message={locked
              ? 'Завершённая оценка закрыта на правку'
              : 'Оценка открыта на корректировку — изменения повлияют на дашборды'}
            description={locked
              ? 'Нажмите «Открыть на корректировку»: период вернётся в статус «расчёт», значения станут доступны для правки. После правок завершите оценку заново.'
              : (isLive
                ? 'После сохранения бэкенд пересчитывает X и уровень, а дашборды («Основное», аналитика, динамика) обновляются без перезагрузки страницы.'
                : 'Демо-режим: правки применяются локально во вкладке и в базу данных не записываются.')}
          />

          <Table<EditableMetric>
            style={{ marginTop: SPACE.cozy }}
            columns={metricColumns}
            dataSource={metricRows}
            rowKey="id"
            size="small"
            bordered
            sticky
            loading={isLive && liveMetrics.isFetching}
            pagination={false}
            scroll={{ x: 1180, y: 420 }}
            rowClassName={(rec) => (edits[rec.id] ? 'ant-table-row-selected' : '')}
            locale={{ emptyText: 'Нет значений по этому периоду' }}
          />
        </div>
      )}
    </div>
  );
};

export default AssessmentCorrectionPanel;
