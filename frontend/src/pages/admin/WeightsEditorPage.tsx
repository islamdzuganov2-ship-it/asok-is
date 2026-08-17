/**
 * WeightsEditorPage.tsx — ТЗ v19 УК-07: редактор весов ГОСТ 25010.
 *
 * Трёхуровневая свёртка (УК-04): u (характеристика → интегральный балл ИС) × w (подхарактеристика
 * ВНУТРИ своей характеристики) — «v» (метрика → подхарактеристика) не редактируется: в этой модели
 * данных на подхарактеристику всегда ровно одна метрика, v тождественно равно 1 (см. weights.py).
 * По профилям критичности (УК-05) — минимум 3, независимо редактируемых. Правки применяются
 * НЕМЕДЛЕННО к Score всех измеренных ИС этого профиля — только SUPER_ADMIN (В-9).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, InputNumber, Row, Segmented, Space, Table, Tag, Typography } from 'antd';
import { message } from '../../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, HistoryOutlined, SaveOutlined, SlidersOutlined } from '@ant-design/icons';
import { QUALITY_MODEL } from '../../constants/qualityModel';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, SPACE, TYPE } from '../../theme/premium';
import { BRAND, RAG } from '../../theme/ragPalette';
import { sorterFor } from '../../theme/table';

const { Title, Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const PROFILES = ['MISSION CRITICAL', 'BUSINESS CRITICAL', 'BUSINESS OPERATIONAL'] as const;
type Profile = typeof PROFILES[number];
const PROFILE_LABEL: Record<Profile, string> = {
  'MISSION CRITICAL': 'Mission Critical',
  'BUSINESS CRITICAL': 'Business Critical',
  'BUSINESS OPERATIONAL': 'Business Operational',
};

interface CharWeightRow { characteristic: string; weight: number }
interface SubcharWithinRow { characteristic: string; subcharacteristic: string; weight: number }
interface WeightEditorOut {
  profile: string; activeVersionId: string; activeVersionLabel: string;
  charWeights: CharWeightRow[]; subcharWithin: SubcharWithinRow[];
}
interface PeriodScoreDelta { systemName: string; period: string; previousScore: number | null; newScore: number | null; delta: number | null }
interface RecomputeReport {
  applied: boolean; weightVersionId: string; periodsScored: number; unchangedCount: number;
  changed: PeriodScoreDelta[]; newlyScored: PeriodScoreDelta[];
}
interface WeightVersionSummary {
  id: string; label: string; isActive: boolean; createdBy: string | null; createdAt: string; note: string | null;
}

// Домен quality/router.py смонтирован на /api/v1/metrics (историческое имя пути, ТЗ v13) —
// не /quality, хотя модуль называется quality. См. api/v1/api.py: metrics_router, prefix="/metrics".
async function qualityApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const resp = await fetch(`${VITE_API}/metrics${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail; } catch { /* без тела */ }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return (resp.status === 204 ? undefined : await resp.json()) as T;
}

const SumTag: React.FC<{ sum: number }> = ({ sum }) => {
  const ok = Math.abs(sum - 100) < 0.05;
  return (
    <Tag color={ok ? 'green' : 'red'} style={{ fontVariantNumeric: 'tabular-nums' }}>
      Σ = {sum.toFixed(2)}{ok ? '' : ' (должно быть 100)'}
    </Tag>
  );
};

const WeightsEditorPage: React.FC = () => {
  const [profile, setProfile] = useState<Profile>('MISSION CRITICAL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');

  const [charWeights, setCharWeights] = useState<Record<string, number>>({});
  const [subcharWithin, setSubcharWithin] = useState<Record<string, number>>({});
  const [selectedChar, setSelectedChar] = useState<string>(QUALITY_MODEL[0].title);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<RecomputeReport | null>(null);
  const [history, setHistory] = useState<WeightVersionSummary[]>([]);

  const keyOf = (c: string, s: string) => `${c}|${s}`;

  const load = async (p: Profile) => {
    setLoading(true);
    setPreview(null);
    try {
      const data = await qualityApi<WeightEditorOut>(`/weights/editor?profile=${encodeURIComponent(p)}`);
      setCharWeights(Object.fromEntries(data.charWeights.map((r) => [r.characteristic, r.weight])));
      setSubcharWithin(Object.fromEntries(data.subcharWithin.map((r) => [keyOf(r.characteristic, r.subcharacteristic), r.weight])));
      setVersionLabel(data.activeVersionLabel);
    } catch {
      message.error('Не удалось загрузить веса');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const data = await qualityApi<WeightVersionSummary[]>('/weights/versions');
      setHistory(data);
    } catch { /* история — необязательная секция, без неё редактор всё равно работает */ }
  };

  useEffect(() => { load(profile); }, [profile]);
  useEffect(() => { loadHistory(); }, []);

  const charSum = useMemo(() => Object.values(charWeights).reduce((a, b) => a + (b || 0), 0), [charWeights]);
  const subSumByChar = useMemo(() => {
    const sums: Record<string, number> = {};
    QUALITY_MODEL.forEach((c) => {
      sums[c.title] = c.subs.reduce((a, s) => a + (subcharWithin[keyOf(c.title, s.name)] || 0), 0);
    });
    return sums;
  }, [subcharWithin]);

  const charRows: CharWeightRow[] = QUALITY_MODEL.map((c) => ({ characteristic: c.title, weight: charWeights[c.title] ?? 0 }));
  const selectedSubs = QUALITY_MODEL.find((c) => c.title === selectedChar)?.subs ?? [];
  const subRows: SubcharWithinRow[] = selectedSubs.map((s) => ({
    characteristic: selectedChar, subcharacteristic: s.name, weight: subcharWithin[keyOf(selectedChar, s.name)] ?? 0,
  }));

  const buildPayload = () => ({
    profile,
    charWeights: Object.entries(charWeights).map(([characteristic, weight]) => ({ characteristic, weight })),
    subcharWithin: QUALITY_MODEL.flatMap((c) => c.subs.map((s) => ({
      characteristic: c.title, subcharacteristic: s.name, weight: subcharWithin[keyOf(c.title, s.name)] ?? 0,
    }))),
  });

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const report = await qualityApi<RecomputeReport>('/weights/editor/preview', {
        method: 'POST', body: JSON.stringify(buildPayload()),
      });
      setPreview(report);
    } catch (e: any) {
      message.error(`Ошибка предпросмотра: ${e.message}`);
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await qualityApi<WeightEditorOut>('/weights/editor', {
        method: 'PUT', body: JSON.stringify({ ...buildPayload(), note: note.trim() || undefined }),
      });
      message.success(`Веса профиля «${PROFILE_LABEL[profile]}» сохранены`);
      setNote('');
      await load(profile);
      await loadHistory();
    } catch (e: any) {
      message.error(`Отказ сохранения: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const charColumns: ColumnsType<CharWeightRow> = [
    { title: 'Характеристика (u)', dataIndex: 'characteristic',
      render: (v: string) => (
        <Text
          strong={v === selectedChar}
          style={{ color: v === selectedChar ? GOLD.base : BRAND.ink, cursor: 'pointer' }}
          onClick={() => setSelectedChar(v)}
        >
          {v}
        </Text>
      ) },
    { title: 'Вес', dataIndex: 'weight', width: 140,
      render: (v: number, r) => (
        <InputNumber
          value={v} min={0} max={100} step={0.5} style={{ width: '100%' }}
          onChange={(val) => setCharWeights((prev) => ({ ...prev, [r.characteristic]: val ?? 0 }))}
        />
      ) },
    { title: 'Σ подхар.', key: 'subsum', width: 90, align: 'center',
      render: (_: unknown, r) => {
        const ok = Math.abs((subSumByChar[r.characteristic] ?? 0) - 100) < 0.05;
        return <Tag color={ok ? 'green' : 'red'} style={{ fontSize: TYPE.micro.fontSize }}>{(subSumByChar[r.characteristic] ?? 0).toFixed(1)}</Tag>;
      } },
  ];

  const subColumns: ColumnsType<SubcharWithinRow> = [
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic' },
    { title: 'Вес внутри характеристики (w)', dataIndex: 'weight', width: 220,
      render: (v: number, r) => (
        <InputNumber
          value={v} min={0} max={100} step={0.5} style={{ width: '100%' }}
          onChange={(val) => setSubcharWithin((prev) => ({ ...prev, [keyOf(r.characteristic, r.subcharacteristic)]: val ?? 0 }))}
        />
      ) },
  ];

  const historyColumns: ColumnsType<WeightVersionSummary> = [
    { title: 'Версия', dataIndex: 'label', ellipsis: true, sorter: sorterFor((r: WeightVersionSummary) => r.label) },
    { title: 'Активна', dataIndex: 'isActive', width: 90, align: 'center',
      render: (v: boolean) => (v ? <Tag color="green">да</Tag> : <Text type="secondary">—</Text>) },
    { title: 'Когда', dataIndex: 'createdAt', width: 170,
      sorter: sorterFor((r: WeightVersionSummary) => r.createdAt),
      render: (v: string) => new Date(v).toLocaleString('ru-RU') },
    { title: 'Примечание', dataIndex: 'note', ellipsis: true, render: (v: string | null) => v || <Text type="secondary">—</Text> },
  ];

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Веса ГОСТ 25010</Title>
      <Text type="secondary">
        Правка немедленно влияет на Score всех оценённых ИС выбранного профиля критичности —
        без пересчёта истории задним числом (версия применяется с текущего момента).
      </Text>

      <Alert
        style={{ margin: `${SPACE.cozy}px 0` }}
        type="warning"
        showIcon
        message="Только SUPER_ADMIN"
        description="Право на правку исключительное и не выдаётся через конструктор прав (решение по открытому вопросу В-9 ТЗ v19)."
      />

      <Segmented
        value={profile}
        onChange={(v) => setProfile(v as Profile)}
        options={PROFILES.map((p) => ({ value: p, label: PROFILE_LABEL[p] }))}
        style={{ marginBottom: SPACE.cozy }}
      />
      {versionLabel && (
        <Text type="secondary" style={{ display: 'block', marginBottom: SPACE.cozy, fontSize: TYPE.caption.fontSize }}>
          Текущая версия: {versionLabel}
        </Text>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={11}>
          <Card {...premiumCard('slate')} title={<Space><SlidersOutlined />u — вес характеристики</Space>}
            styles={{ body: { padding: 0 } }}>
            <Table<CharWeightRow>
              rowKey="characteristic" columns={charColumns} dataSource={charRows}
              loading={loading} pagination={false} size="small"
              onRow={(r) => ({ onClick: () => setSelectedChar(r.characteristic), style: { cursor: 'pointer' } })}
            />
            <div style={{ padding: SPACE.cozy }}><SumTag sum={charSum} /></div>
          </Card>
        </Col>
        <Col xs={24} lg={13}>
          <Card {...premiumCard('sage')} title={<Space><SlidersOutlined />w — «{selectedChar}», вес внутри характеристики</Space>}
            styles={{ body: { padding: 0 } }}>
            <Table<SubcharWithinRow>
              rowKey="subcharacteristic" columns={subColumns} dataSource={subRows}
              loading={loading} pagination={false} size="small"
            />
            <div style={{ padding: SPACE.cozy }}><SumTag sum={subSumByChar[selectedChar] ?? 0} /></div>
          </Card>
        </Col>
      </Row>

      <Card {...premiumCard('terracotta', { marginTop: 16 })} title="Сохранение">
        <Space direction="vertical" style={{ width: '100%' }} size={SPACE.cozy}>
          <Input.TextArea
            rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Примечание к правке (необязательно) — попадёт в историю версий"
          />
          <Space wrap>
            <Button icon={<EyeOutlined />} loading={previewing} onClick={runPreview}>
              Предпросмотр эффекта на балл
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              Сохранить профиль «{PROFILE_LABEL[profile]}»
            </Button>
          </Space>

          {preview && (
            <Alert
              type={preview.changed.length ? 'warning' : 'info'}
              showIcon
              message={`Изменится баллов: ${preview.changed.length} из ${preview.periodsScored} (систем/периодов этого профиля)`}
              description={
                preview.changed.length === 0 ? 'На измеренные системы правка не повлияет.' : (
                  <Table<PeriodScoreDelta>
                    size="small" pagination={false} rowKey={(r) => `${r.systemName}|${r.period}`}
                    dataSource={preview.changed}
                    columns={[
                      { title: 'ИС', dataIndex: 'systemName' },
                      { title: 'Период', dataIndex: 'period', width: 100 },
                      { title: 'Было', dataIndex: 'previousScore', width: 90,
                        render: (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%` },
                      { title: 'Станет', dataIndex: 'newScore', width: 90,
                        render: (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%` },
                      { title: 'Δ', dataIndex: 'delta', width: 90,
                        render: (v: number | null) => v == null ? '—' : (
                          <Text style={{ color: v > 0 ? RAG.good.strong : RAG.bad.strong }}>{v > 0 ? '+' : ''}{v.toFixed(1)}</Text>
                        ) },
                    ]}
                  />
                )
              }
            />
          )}
        </Space>
      </Card>

      <Card {...premiumCard('ink', { marginTop: 16 })} title={<Space><HistoryOutlined />История версий</Space>}
        styles={{ body: { padding: 0 } }}>
        <Table<WeightVersionSummary>
          rowKey="id" columns={historyColumns} dataSource={history}
          pagination={{ pageSize: 8, hideOnSinglePage: true }} size="small"
          locale={{ emptyText: 'Версий ещё нет' }}
        />
      </Card>
    </div>
  );
};

export default WeightsEditorPage;
