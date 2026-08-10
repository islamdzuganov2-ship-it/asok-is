/**
 * RiskEconomicsPage.tsx — риск-экономический контур (BL-007).
 *
 * Единая рабочая область: рисковые события с числовым ALE, справочники экономики (ставки
 * сопровождения, бизнес-процессы + стоимость минуты простоя) и воронка замыкания несоответствий.
 * Подключено к /api/v1/{risk-events,econ,nonconformities}. Ввод — ручной (пилот идёт от ручного
 * ввода, не от автовыгрузки ITSM). Расчёты (C_ТС, ALE, ROSI) считает бэкенд; здесь — ввод и подача.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic,
  Switch, Table, Tabs, Tag, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, InboxOutlined } from '@ant-design/icons';
import KpiCard from '../components/KpiCard';
import { premiumCard, accentDot, accentColorOf, pageContainer, pageTitle, GOLD, PREMIUM, SPACE, TYPE } from '../theme/premium';
import { numericColumn, numericText } from '../theme/table';
import { BRAND } from '../theme/ragPalette';

const { Title, Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// ─── DTO контура (camelCase — контракт бэкенда) ───
interface RiskEvent {
  id: string; code: string; title: string; description?: string | null; category?: string | null;
  owner?: string | null; aro?: number | null; aroIsExpert: boolean; sleExpert?: number | null;
  aleAvg?: number | null; aleP90?: number | null; maxSle?: number | null;
  riskAppetite?: number | null; regulatory: boolean; status: string;
}
interface SupportRate {
  id: string; systemId?: string | null; line: string; executorType: string; vendor?: string | null;
  mode?: string | null; ratePerHour: number; kEvening: number; kWeekend: number; isActive: boolean;
}
interface BusinessProcess {
  id: string; code: string; name: string; kind: string; owner?: string | null; isActive: boolean;
}
interface BpCost { id: string; businessProcessId: string; method: string; costPerMinBase?: number | null }
interface Nonconformity {
  id: string; code?: string | null; systemName: string; characteristic: string;
  subcharacteristic: string; level: string; status: string; owner: string;
  evaluatedAle?: number | null; evidenceType?: string | null; isBlocking: boolean;
}
interface FunnelStage { status: string; count: number }
interface ClosureFunnel { total: number; verified: number; closureRate: number; stages: FunnelStage[] }
interface AleResult { incidentsCounted: number; incidentsCosted: number; aro?: number | null; aleAvg?: number | null }
interface TopRisk { code: string; title: string; owner?: string | null; system?: string | null; aleAvg: number; regulatory: boolean }
interface HeatCell { system: string; subcharacteristic: string; ale: number }
interface CostDashboard {
  portfolioAle: number; risksCount: number; degradationTotal: number;
  nonconformitiesTotal: number; verified: number; closureRate: number; blockingCount: number;
  verdict: { eliminate: number; compensate: number; accept: number };
  topRisks: TopRisk[]; bySystem: { system: string; ale: number }[]; heatmap: HeatCell[];
}

// ─── Подача ───
const fmtMoney = (v?: number | null): string =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`;
const fmtNum = (v?: number | null, digits = 2): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);

const RISK_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'Активен', color: 'blue' }, archived: { label: 'В архиве', color: 'default' },
};
const NC_STATUS: Record<string, { label: string; color: string }> = {
  IDENTIFIED: { label: 'Выявлено', color: 'default' },
  EVALUATED: { label: 'Оценено', color: 'gold' },
  DECIDED: { label: 'Решение принято', color: 'geekblue' },
  MEASURE_ASSIGNED: { label: 'Мера назначена', color: 'cyan' },
  IN_PROGRESS: { label: 'В работе', color: 'processing' },
  EXECUTED: { label: 'Исполнено', color: 'blue' },
  VERIFIED: { label: 'Верифицировано', color: 'green' },
};
const NC_LEVEL: Record<string, { label: string; color: string }> = {
  MINOR: { label: 'Незначительное', color: 'gold' },
  MAJOR: { label: 'Существенное', color: 'orange' },
  CRITICAL: { label: 'Критическое', color: 'red' },
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('token');
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
    : { 'Content-Type': 'application/json' };
}
async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(`${VITE_API}${path}`, { headers: authHeaders(), ...opts });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail; } catch { /* без тела */ }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return (resp.status === 204 ? undefined : await resp.json()) as T;
}

const RiskEconomicsPage: React.FC = () => {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={pageContainer}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4} style={pageTitle}>
            <span style={accentDot(GOLD.base)} />Риск-экономический контур
          </Title>
          <Text type="secondary">
            Диагноз ставится в процентах, решение принимается по деньгам: рисковые события с годовой
            стоимостью (ALE), справочники экономики и замыкание несоответствий.
          </Text>
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'dashboard', label: 'Дашборд стоимости', children: <DashboardTab /> },
            { key: 'risks', label: 'Рисковые события', children: <RiskEventsTab /> },
            { key: 'refs', label: 'Справочники', children: <ReferencesTab /> },
            { key: 'closure', label: 'Замыкание контура', children: <ClosureTab /> },
            { key: 'managers', label: 'Эффективность руководителей', children: <ManagersTab /> },
          ]}
        />
      </Space>
    </div>
  );
};

// ════════════════════════ Дашборд стоимости (§5) ════════════════════════
const fmtMln = (v: number): string =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
    : new Intl.NumberFormat('ru-RU').format(Math.round(v));

const DashboardTab: React.FC = () => {
  const [d, setD] = useState<CostDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api<CostDashboard>('/econ/dashboard')
      .then((r) => { if (alive) setD(r); })
      .catch((e: any) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const topCols: ColumnsType<TopRisk> = [
    { title: 'Код', dataIndex: 'code', width: 130 },
    {
      title: 'Риск', dataIndex: 'title',
      render: (t: string, r: TopRisk) => (
        <Space size={4}>{r.regulatory && <Tag color="volcano">рег.</Tag>}<Text strong>{t}</Text></Space>
      ),
    },
    { title: 'ИС', dataIndex: 'system', width: 140, render: (s?: string) => s || '—' },
    { title: 'Владелец', dataIndex: 'owner', width: 160, render: (o?: string) => o || '—' },
    numericColumn({ title: 'ALE, ₽/год', dataIndex: 'aleAvg', width: 150, render: (v: number) => fmtMoney(v) }),
  ];

  // Пивот тепловой карты: ИС (строки) × подхарактеристика (столбцы).
  const heat = d?.heatmap ?? [];
  const systems = Array.from(new Set(heat.map((h) => h.system)));
  const subchars = Array.from(new Set(heat.map((h) => h.subcharacteristic)));
  const maxAle = Math.max(1, ...heat.map((h) => h.ale));
  const cellAle = (s: string, sub: string) => heat.find((h) => h.system === s && h.subcharacteristic === sub)?.ale ?? 0;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="Ошибка загрузки дашборда" description={error} closable />}

      {/* KPI-ряд — «одна цифра, которую CEO уносит с совещания» */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: SPACE.base }}>
        <KpiCard loading={loading} title="Портфельный ALE, ₽/год" value={d ? fmtMoney(d.portfolioAle) : '—'}
          hint={d ? `${d.risksCount} рисковых событий` : undefined} />
        <KpiCard loading={loading} title="Замкнутость контура" value={d ? `${d.closureRate}%` : '—'}
          hint={d ? `${d.verified} из ${d.nonconformitiesTotal} верифицировано` : undefined} />
        <KpiCard loading={loading} title="Накопленная деградация, ₽" value={d ? fmtMoney(d.degradationTotal) : '—'}
          hint="сверх учтённых простоев" />
        <KpiCard loading={loading} title="Блокирующие дефекты" value={d ? d.blockingCount : '—'}
          color={d && d.blockingCount > 0 ? accentColorOf('terracotta') : undefined} hint="критические, не закрыты" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: SPACE.base }}>
        <Card {...premiumCard('sage')} title="Решения по несоответствиям">
          <Space size="large" style={{ width: '100%', justifyContent: 'space-around' }}>
            <Statistic title="Устранить" value={d?.verdict.eliminate ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
            <Statistic title="Компенсировать" value={d?.verdict.compensate ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
            <Statistic title="Принять" value={d?.verdict.accept ?? 0} valueStyle={{ ...TYPE.metricSm, color: BRAND.ink }} />
          </Space>
        </Card>
        <Card {...premiumCard('slate')} title="ALE по системам" styles={{ body: { padding: SPACE.airy } }}>
          {(d?.bySystem ?? []).slice(0, 5).map((s) => (
            <div key={s.system} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: SPACE.snug }}>
              <Text>{s.system}</Text><Text strong style={numericText}>{fmtMoney(s.ale)}</Text>
            </div>
          ))}
          {(!d || d.bySystem.length === 0) && <Text type="secondary">Нет данных</Text>}
        </Card>
      </div>

      {/* Тепловая карта концентрации риска (§5, виджет 2) */}
      <Card {...premiumCard('gold')} title="Тепловая карта риска: ИС × подхарактеристика (ALE)"
        styles={{ body: { padding: SPACE.airy } }}>
        {systems.length === 0 ? (
          <Text type="secondary">Нет привязок рисков к подхарактеристикам — добавьте связи на вкладке «Рисковые события».</Text>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `minmax(140px, 1.4fr) repeat(${subchars.length}, minmax(96px, 1fr))`, gap: 4 }}>
              <div />
              {subchars.map((sc) => (
                <div key={sc} style={{ ...TYPE.micro, color: BRAND.inkSoft, textAlign: 'center', padding: SPACE.tight }}>{sc}</div>
              ))}
              {systems.map((s) => (
                <React.Fragment key={s}>
                  <div style={{ ...TYPE.captionStrong, color: BRAND.ink, display: 'flex', alignItems: 'center' }}>{s}</div>
                  {subchars.map((sc) => {
                    const v = cellAle(s, sc);
                    const a = v / maxAle;
                    return (
                      <div key={sc} title={v > 0 ? fmtMoney(v) : undefined} style={{
                        background: v > 0 ? `rgba(185,154,85,${(0.15 + a * 0.75).toFixed(2)})` : PREMIUM.surfaceSoft,
                        borderRadius: PREMIUM.radiusSm, padding: SPACE.snug, textAlign: 'center',
                        ...TYPE.caption, ...numericText, color: BRAND.ink,
                      }}>
                        {v > 0 ? fmtMln(v) : '·'}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Топ рисков по стоимости (§5, виджет 3) */}
      <Card {...premiumCard('terracotta')} title="Топ рисков по стоимости" styles={{ body: { padding: 0 } }}>
        <Table<TopRisk>
          columns={topCols} dataSource={d?.topRisks ?? []} rowKey="code" loading={loading} size="small"
          pagination={false} scroll={{ x: 780 }}
          locale={{ emptyText: 'Нет рисковых событий с посчитанным ALE.' }}
        />
      </Card>
    </Space>
  );
};

// ════════════════════════ Рисковые события ════════════════════════
const RiskEventsTab: React.FC = () => {
  const [rows, setRows] = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await api<RiskEvent[]>('/risk-events')); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const portfolioAle = useMemo(
    () => rows.reduce((s, r) => s + (r.aleAvg ?? 0), 0), [rows],
  );

  const create = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      await api('/risk-events', { method: 'POST', body: JSON.stringify(v) });
      message.success('Рисковое событие создано');
      setOpen(false); form.resetFields(); await load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(`Не удалось сохранить: ${e.message}`);
    } finally { setSaving(false); }
  };

  const recompute = async (id: string) => {
    setBusyId(id);
    try {
      const r = await api<AleResult>(`/risk-events/${id}/recompute-ale`, { method: 'POST' });
      message.success(`ALE пересчитан: ТС ${r.incidentsCounted}, с ценой ${r.incidentsCosted}, ARO ${fmtNum(r.aro)}`);
      await load();
    } catch (e: any) { message.error(`Пересчёт не удался: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const columns: ColumnsType<RiskEvent> = [
    { title: 'Код', dataIndex: 'code', width: 130 },
    { title: 'Название', dataIndex: 'title', width: 220, render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Владелец', dataIndex: 'owner', width: 150, render: (o?: string) => o || '—' },
    numericColumn({ title: 'ARO', dataIndex: 'aro', width: 90, render: (v: number) => fmtNum(v) }),
    numericColumn({ title: 'ALE средний', dataIndex: 'aleAvg', width: 140, render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'ALE P90', dataIndex: 'aleP90', width: 140, render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'MaxSLE', dataIndex: 'maxSle', width: 140, render: (v: number) => fmtMoney(v) }),
    {
      title: 'Статус', dataIndex: 'status', width: 120,
      render: (s: string) => {
        const m = RISK_STATUS[s] ?? { label: s, color: 'default' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '', key: 'actions', width: 150, fixed: 'right',
      render: (_: unknown, r: RiskEvent) => (
        <Button size="small" icon={<ReloadOutlined />} loading={busyId === r.id} onClick={() => recompute(r.id)}>
          Пересчитать ALE
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <KpiCard
          title="Портфельный ALE (сумма средних)"
          value={`${Math.round(portfolioAle).toLocaleString('ru-RU')} ₽`}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Добавить рисковое событие
        </Button>
      </Space>

      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card {...premiumCard('slate')} styles={{ body: { padding: 0 } }}>
        <Table<RiskEvent>
          columns={columns} dataSource={rows} rowKey="id" loading={loading} size="small"
          scroll={{ x: 1180 }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: 'Нет рисковых событий. Добавьте первое и привяжите к нему техсбои для расчёта ALE.' }}
        />
      </Card>

      <Modal title="Новое рисковое событие" open={open} onOk={create} confirmLoading={saving}
        onCancel={() => setOpen(false)} okText="Сохранить" cancelText="Отмена" width={640}>
        <Form form={form} layout="vertical" initialValues={{ aroIsExpert: false, regulatory: false }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label="Код" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="RE-2026-001" />
            </Form.Item>
            <Form.Item name="category" label="Категория" style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="отказоустойчивость" />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Отказ узла кластера → простой" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="owner" label="Владелец риска" style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="ФИО риск-менеджера" />
            </Form.Item>
            <Form.Item name="aro" label="ARO (частота/год)" style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="sleExpert" label="SLE экспертный, ₽" style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
            <Form.Item name="riskAppetite" label="Риск-аппетит, ₽/год" style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="aroIsExpert" label="ARO задан экспертно" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="regulatory" label="Регуляторное вето" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
};

// ════════════════════════ Справочники ════════════════════════
const LINES = ['L1', 'L2', 'L3'];
const BP_KINDS = [
  { value: 'FRONTAL', label: 'Фронтальный (выручкообразующий)' },
  { value: 'BACKOFFICE', label: 'Бэк-офис' },
  { value: 'BACKGROUND', label: 'Фоновый/интеграционный' },
];

const ReferencesTab: React.FC = () => {
  const [rates, setRates] = useState<SupportRate[]>([]);
  const [bps, setBps] = useState<BusinessProcess[]>([]);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rateForm] = Form.useForm();
  const [bpForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, b] = await Promise.all([
        api<SupportRate[]>('/econ/rates'), api<BusinessProcess[]>('/econ/business-processes'),
      ]);
      setRates(r); setBps(b);
      const costEntries = await Promise.all(
        b.map(async (bp) => {
          try { const c = await api<BpCost | null>(`/econ/business-processes/${bp.id}/cost`); return [bp.id, c?.costPerMinBase ?? null] as const; }
          catch { return [bp.id, null] as const; }
        }),
      );
      setCosts(Object.fromEntries(costEntries));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createRate = async () => {
    try {
      const v = await rateForm.validateFields();
      setSaving(true);
      await api('/econ/rates', { method: 'POST', body: JSON.stringify(v) });
      message.success('Ставка добавлена'); setRateOpen(false); rateForm.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const createBp = async () => {
    try {
      const v = await bpForm.validateFields();
      setSaving(true);
      const { costPerMinBase, method, ...bp } = v;
      const created = await api<BusinessProcess>('/econ/business-processes', { method: 'POST', body: JSON.stringify(bp) });
      if (costPerMinBase !== undefined && costPerMinBase !== null) {
        await api(`/econ/business-processes/${created.id}/cost`, {
          method: 'PUT', body: JSON.stringify({ method: method ?? 'RESOURCE', costPerMinBase }),
        });
      }
      message.success('Бизнес-процесс добавлен'); setBpOpen(false); bpForm.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const rateCols: ColumnsType<SupportRate> = [
    { title: 'Линия', dataIndex: 'line', width: 80 },
    {
      title: 'Исполнитель', dataIndex: 'executorType', width: 130,
      render: (t: string) => <Tag color={t === 'VENDOR' ? 'volcano' : 'blue'}>{t === 'VENDOR' ? 'Вендор' : 'Внутренний'}</Tag>,
    },
    { title: 'Вендор', dataIndex: 'vendor', width: 150, render: (v?: string) => v || '—' },
    numericColumn({ title: '₽/час', dataIndex: 'ratePerHour', width: 120, render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'K веч/ночь', dataIndex: 'kEvening', width: 110, render: (v: number) => fmtNum(v) }),
    numericColumn({ title: 'K выходные', dataIndex: 'kWeekend', width: 110, render: (v: number) => fmtNum(v) }),
    {
      title: 'Область', dataIndex: 'systemId', width: 120,
      render: (s?: string | null) => <Tag>{s ? 'Для ИС' : 'Глобальная'}</Tag>,
    },
  ];

  const bpCols: ColumnsType<BusinessProcess> = [
    { title: 'Код', dataIndex: 'code', width: 120 },
    { title: 'Название', dataIndex: 'name', width: 220, render: (t: string) => <Text strong>{t}</Text> },
    {
      title: 'Тип', dataIndex: 'kind', width: 200,
      render: (k: string) => BP_KINDS.find((x) => x.value === k)?.label ?? k,
    },
    numericColumn({
      title: 'C_мин, ₽', key: 'cost', width: 130,
      render: (_: unknown, bp: BusinessProcess) => fmtMoney(costs[bp.id]),
    }),
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card
        {...premiumCard('slate')}
        title="Ставки сопровождения L1–L3"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setRateOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<SupportRate>
          columns={rateCols} dataSource={rates} rowKey="id" loading={loading} size="small"
          scroll={{ x: 820 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'Ставок нет. Внутренняя = (ФОТ×K_накладных)/фонд; вендорская — из контракта.' }}
        />
      </Card>

      <Card
        {...premiumCard('sage')}
        title="Бизнес-процессы и стоимость минуты простоя"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setBpOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<BusinessProcess>
          columns={bpCols} dataSource={bps} rowKey="id" loading={loading} size="small"
          scroll={{ x: 700 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'БП нет. Стоимость минуты — атрибут процесса: фронтальные считаются транзакционно, бэк-офис ресурсно.' }}
        />
      </Card>

      <Modal title="Новая ставка сопровождения" open={rateOpen} onOk={createRate} confirmLoading={saving}
        onCancel={() => setRateOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={rateForm} layout="vertical"
          initialValues={{ line: 'L2', executorType: 'INTERNAL', kEvening: 1.5, kWeekend: 2.0 }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="line" label="Линия" style={{ flex: 1, minWidth: 120 }}>
              <Select options={LINES.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="executorType" label="Исполнитель" style={{ flex: 1, minWidth: 160 }}>
              <Select options={[{ value: 'INTERNAL', label: 'Внутренний' }, { value: 'VENDOR', label: 'Вендор' }]} />
            </Form.Item>
          </Space>
          <Form.Item name="vendor" label="Вендор (если внешний)">
            <Input placeholder="Наименование поставщика" />
          </Form.Item>
          <Form.Item name="ratePerHour" label="Ставка, ₽/час" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={500} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="kEvening" label="K вечер/ночь" style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={1} step={0.1} />
            </Form.Item>
            <Form.Item name="kWeekend" label="K выходные" style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={1} step={0.1} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="Новый бизнес-процесс" open={bpOpen} onOk={createBp} confirmLoading={saving}
        onCancel={() => setBpOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={bpForm} layout="vertical" initialValues={{ kind: 'BACKOFFICE', method: 'RESOURCE' }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label="Код" rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input placeholder="BP-001" />
            </Form.Item>
            <Form.Item name="kind" label="Тип" style={{ flex: 1, minWidth: 220 }}>
              <Select options={BP_KINDS} />
            </Form.Item>
          </Space>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Приём платежей" />
          </Form.Item>
          <Form.Item name="costPerMinBase" label="Стоимость минуты простоя, ₽ (базовая)">
            <InputNumber style={{ width: '100%' }} min={0} step={100} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

// ════════════════════════ Замыкание контура ════════════════════════
const ClosureTab: React.FC = () => {
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
    { title: 'Система', dataIndex: 'systemName', width: 160, render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 190 },
    {
      title: 'Уровень', dataIndex: 'level', width: 150,
      render: (l: string) => {
        const m = NC_LEVEL[l] ?? { label: l, color: 'default' };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    { title: 'Владелец', dataIndex: 'owner', width: 140 },
    numericColumn({ title: 'ALE, ₽', dataIndex: 'evaluatedAle', width: 140, render: (v: number) => fmtMoney(v) }),
    {
      title: 'Статус', dataIndex: 'status', width: 160,
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
          <Form.Item name="systemName" label="Система" rules={[{ required: true }]}>
            <Input placeholder="АБС Core" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="characteristic" label="Характеристика" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Надёжность" />
            </Form.Item>
            <Form.Item name="subcharacteristic" label="Подхарактеристика" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Отказоустойчивость" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="owner" label="Владелец" rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="ФИО ответственного" />
            </Form.Item>
            <Form.Item name="level" label="Уровень" style={{ flex: 1, minWidth: 180 }}>
              <Select options={Object.entries(NC_LEVEL).map(([v, m]) => ({ value: v, label: m.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="evidenceType" label="Тип доказательства">
            <Select allowClear options={[
              { value: 'A', label: 'A — инструментальное измерение' },
              { value: 'B', label: 'B — инцидентная статистика' },
              { value: 'C', label: 'C — анализ артефактов кода' },
              { value: 'D', label: 'D — документальная проверка' },
              { value: 'E', label: 'E — экспертная оценка' },
            ]} />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default RiskEconomicsPage;
