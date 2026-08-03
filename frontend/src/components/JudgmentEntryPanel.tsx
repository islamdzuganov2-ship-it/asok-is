/**
 * JudgmentEntryPanel.tsx — вкладка «Внесение профессионального суждения» (ТЗ v16, T-48).
 *
 * Показывает ТОЛЬКО метрики, по которым суждение НЕ внесено (GET /assessments/judgments-pending):
 * строка = пара «характеристика × подхарактеристика» периода, у которой есть оценка (рассчитан X
 * либо «невозможно измерить»), но нет записи в professional_judgments. Ввод идёт той же моделью,
 * что и в ProfessionalJudgmentsPanel — PUT /assessments/{period_id}/judgments (upsert по паре),
 * поэтому связка «оценка ↔ суждение» сохраняется, а внесённая строка уходит из списка.
 *
 * Сортировка — худший балл первым («невозможно измерить» в начале): менеджер по качеству
 * начинает с проблемных зон. Источник данных по режиму: 'live' — API, 'mock' — демо-набор.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Empty, Input, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CommentOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import {
  useGetPendingJudgmentsQuery,
  useSaveJudgmentsMutation,
  type JudgmentItem,
  type PendingJudgment,
} from '../store/api/apiSlice';
import { DEMO_PENDING_JUDGMENTS } from '../data/mockAssessments';
import { CHARACTERISTICS } from '../constants/qualityModel';
import { ragToken } from '../theme/ragPalette';

const { Title, Text } = Typography;

const rowKeyOf = (r: PendingJudgment) => `${r.period_id}|||${r.characteristic}|||${r.subcharacteristic}`;

const JudgmentEntryPanel: React.FC = () => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const isLive = dataMode === 'live';
  const canEdit = ['QUALITY_MANAGER', 'ADMIN'].includes(role);

  const [allPeriods, setAllPeriods] = useState(false);
  const live = useGetPendingJudgmentsQuery(allPeriods ? { all_periods: true } : undefined, { skip: !isLive });
  const [saveJudgments, { isLoading: saving }] = useSaveJudgmentsMutation();

  const [systemFilter, setSystemFilter] = useState<string | undefined>();
  const [charFilter, setCharFilter] = useState<string | undefined>();
  // Черновики суждений: ключ строки → текст. Сохранённые в демо-режиме строки прячем локально.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [demoDone, setDemoDone] = useState<Set<string>>(new Set());

  const source: PendingJudgment[] = isLive ? (live.data ?? []) : DEMO_PENDING_JUDGMENTS;
  const pending = useMemo(
    () => source.filter((r) => !demoDone.has(rowKeyOf(r))),
    [source, demoDone],
  );

  const systemOptions = useMemo(
    () => Array.from(new Set(pending.map((r) => r.system_name))).sort((a, b) => a.localeCompare(b)),
    [pending],
  );
  const rows = useMemo(
    () => pending.filter((r) => (!systemFilter || r.system_name === systemFilter)
      && (!charFilter || r.characteristic === charFilter)),
    [pending, systemFilter, charFilter],
  );

  const filledDrafts = Object.entries(drafts).filter(([, v]) => (v || '').trim().length > 0);

  const handleSave = async () => {
    if (!filledDrafts.length) { message.info('Нет введённых суждений'); return; }
    // Один PUT на период: эндпоинт принимает пачку пар (upsert по «характеристика + подхарактеристика»).
    const byPeriod = new Map<string, JudgmentItem[]>();
    filledDrafts.forEach(([key, text]) => {
      const [periodId, characteristic, subcharacteristic] = key.split('|||');
      const items = byPeriod.get(periodId) ?? [];
      items.push({ characteristic, subcharacteristic, judgment_text: text.trim() });
      byPeriod.set(periodId, items);
    });

    if (!isLive) {
      setDemoDone((prev) => new Set([...prev, ...filledDrafts.map(([k]) => k)]));
      setDrafts({});
      message.success(`Демо-режим: внесено суждений — ${filledDrafts.length}; строки ушли из списка`);
      return;
    }
    try {
      for (const [periodId, items] of byPeriod) {
        await saveJudgments({ id: periodId, items }).unwrap();
      }
      setDrafts({});
      message.success(`Внесено профессиональных суждений: ${filledDrafts.length}`);
    } catch (e: any) {
      message.error(e?.status === 403
        ? 'Суждения вносит менеджер по качеству'
        : (e?.data?.detail || 'Не удалось сохранить суждения'));
    }
  };

  const columns: ColumnsType<PendingJudgment> = [
    { title: 'Информационная система', dataIndex: 'system_name', width: 200, ellipsis: true },
    { title: 'Период', dataIndex: 'period', width: 92 },
    { title: 'Характеристика', dataIndex: 'characteristic', width: 190, ellipsis: true },
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 200, ellipsis: true },
    {
      title: 'Балл', dataIndex: 'score_pct', width: 110,
      sorter: (a, b) => a.score_pct - b.score_pct,
      render: (score: number, rec) => {
        const t = ragToken(score);
        return score < 0
          ? (
            <Tooltip title={rec.expert_comment || 'Нет возможности собрать данные'}>
              <Tag style={{ background: t.soft, color: t.strong, borderColor: t.border }}>Невозможно измерить</Tag>
            </Tooltip>
          )
          : (
            <Tooltip title={rec.quality_level || ''}>
              <Tag style={{ background: t.soft, color: t.strong, borderColor: t.border }}>{score}%</Tag>
            </Tooltip>
          );
      },
    },
    {
      title: 'Профессиональное суждение', key: 'judgment',
      render: (_, rec) => {
        const key = rowKeyOf(rec);
        return (
          <Input.TextArea
            rows={2}
            value={drafts[key] ?? ''}
            disabled={!canEdit}
            placeholder={rec.score_pct < 0
              ? 'Почему метрика не измеряется, чем это грозит, что делаем для восстановления измеримости…'
              : 'Что по сути с этой подхарактеристикой: факт → причина → влияние → мера и ответственный…'}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        );
      },
    },
  ];

  return (
    <div>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <div>
          <Title level={4} style={{ marginTop: 0, marginBottom: 2 }}>
            <CommentOutlined /> Внесение профессионального суждения
          </Title>
          <Text type="secondary">
            Только метрики <b>без внесённого</b> суждения · худшие первыми · {isLive ? 'реальная БД' : 'демо-данные'}
          </Text>
        </div>
        <Space wrap>
          <Select
            allowClear showSearch style={{ width: 240 }} placeholder="Все системы"
            value={systemFilter} onChange={setSystemFilter}
            options={systemOptions.map((s) => ({ value: s, label: s }))}
          />
          <Select
            allowClear showSearch style={{ width: 220 }} placeholder="Все характеристики"
            value={charFilter} onChange={setCharFilter}
            options={CHARACTERISTICS.map((c) => ({ value: c, label: c }))}
          />
          {isLive && (
            <Button icon={<ReloadOutlined />} onClick={() => live.refetch()} loading={live.isFetching}>
              Обновить
            </Button>
          )}
          <Button
            type="primary" icon={<SaveOutlined />} loading={saving}
            disabled={!canEdit || !filledDrafts.length} onClick={handleSave}
          >
            Сохранить {filledDrafts.length ? `(${filledDrafts.length})` : ''}
          </Button>
        </Space>
      </Space>

      <Alert
        style={{ marginTop: 12 }}
        type={rows.length ? 'warning' : 'success'}
        showIcon
        message={rows.length
          ? `Ждут профессионального суждения: ${rows.length} метрик${pending.length !== rows.length ? ` (всего ${pending.length})` : ''}`
          : 'Суждения внесены по всем метрикам в выборке'}
        description={(
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>
              Суждение обязательно по каждой подхарактеристике оценки. Внесённая запись сразу уходит
              из списка — связка «оценка ↔ суждение» сохраняется в периоде оценки.
            </Text>
            {isLive && (
              <Checkbox checked={allPeriods} onChange={(e) => setAllPeriods(e.target.checked)}>
                Включая прошлые периоды (по умолчанию — только последняя оценка каждой ИС)
              </Checkbox>
            )}
            {!canEdit && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Внесение суждений доступно менеджеру по качеству и администратору — поля только для чтения.
              </Text>
            )}
          </Space>
        )}
      />

      {isLive && live.isError && (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message="Не удалось загрузить список метрик без суждения" />
      )}

      <Table<PendingJudgment>
        style={{ marginTop: 12 }}
        columns={columns}
        dataSource={rows}
        rowKey={rowKeyOf}
        size="small"
        bordered
        loading={isLive && live.isFetching}
        pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `Всего: ${t}` }}
        scroll={{ x: 1120 }}
        locale={{ emptyText: <Empty description="Метрик без профессионального суждения нет" /> }}
      />
    </div>
  );
};

export default JudgmentEntryPanel;
