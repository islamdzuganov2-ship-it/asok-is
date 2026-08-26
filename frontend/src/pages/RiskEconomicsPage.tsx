/**
 * RiskEconomicsPage.tsx — риск-экономический контур (BL-007).
 *
 * Единая рабочая область: рисковые события с числовым ALE, справочники экономики (ставки
 * сопровождения, бизнес-процессы + стоимость минуты простоя) и воронка замыкания несоответствий.
 * Подключено к /api/v1/{risk-events,econ,nonconformities}. Ввод — ручной (пилот идёт от ручного
 * ввода, не от автовыгрузки ITSM). Расчёты (C_ТС, ALE, ROSI) считает бэкенд; здесь — ввод и подача.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Spin, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { message } from '../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, InboxOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KpiCard from '../components/KpiCard';
import { premiumCard, accentDot, accentColorOf, pageContainer, pageTitle, GOLD, PREMIUM, SPACE, TYPE } from '../theme/premium';
import { numericColumn, numericText, sorterFor } from '../theme/table';
import FieldHint from '../components/FieldHint';
import { BRAND, RAG } from '../theme/ragPalette';
import { OwnerLink } from '../components/OwnerLink';
import { EconScopeProvider } from '../dashboards/scopes/EconScope';
import RiskEventLinksPanel from '../components/RiskEventLinksPanel';
import {
  EconKpiCard, EconNonconformityCard, EconAleBySystemCard, EconHeatmapCard,
  EconTopRisksCard, EconPortfolioSummaryCard, EconRiskMeasureEffectCard, EconQuarterlyEffectCard,
} from '../dashboards/cards/econCards';
import { EconManagersCard } from '../dashboards/cards/econManagersCard';

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
// ТЗ v19 п.9-10, В-30а: структура рыночных бенчмарков — source/observedOn обязательны на бэкенде
// (пустая строка/отсутствие даты отклоняются валидацией), таблица пуста, пока источники не согласованы.
interface MarketBenchmark {
  id: string; kind: string; dimension: string; companySizeClass?: string | null;
  value: number; unit: string; source: string; observedOn: string; note?: string | null;
}
// ТЗ v19 п.9-10 (УК-24): сравнение «мы/рынок» — бэкенд считает (econ/service.py compare_business_process/
// compare_support_rate), эндпоинты уже были, просто не вызывались с фронта.
interface BenchmarkComparison {
  ownValue: number | null; ownUnit: string; benchmark?: MarketBenchmark | null;
  deltaPct?: number | null; note: string;
}
interface Nonconformity {
  id: string; code?: string | null; systemName: string; characteristic: string;
  subcharacteristic: string; level: string; status: string; owner: string;
  evaluatedAle?: number | null; evidenceType?: string | null; isBlocking: boolean;
}
interface FunnelStage { status: string; count: number }
interface ClosureFunnel { total: number; verified: number; closureRate: number; stages: FunnelStage[] }
interface AleResult { incidentsCounted: number; incidentsCosted: number; aro?: number | null; aleAvg?: number | null }
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
// Порядок значимости для сортировки «Уровня» — не алфавитный (MINOR < MAJOR < CRITICAL).
const NC_LEVEL_RANK: Record<string, number> = Object.fromEntries(
  Object.keys(NC_LEVEL).map((k, i) => [k, i]),
);

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
// Виджеты вкладки живут в общем каталоге карточек (dashboards/cards/econCards.tsx): те же
// карточки пользователь может положить на «Мой дашборд» или на любой другой доступный ему
// дашборд. Здесь они собраны в штатный порядок вкладки — один источник вёрстки, без копии.
const DashboardTab: React.FC = () => (
  <EconScopeProvider>
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <EconKpiCard />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: SPACE.base }}>
        <EconNonconformityCard />
        <EconAleBySystemCard />
      </div>
      <EconHeatmapCard />
      <EconTopRisksCard />
      <EconPortfolioSummaryCard />
      <EconRiskMeasureEffectCard />
      <EconQuarterlyEffectCard />
    </Space>
  </EconScopeProvider>
);

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
    { title: 'Код', dataIndex: 'code', width: 130, sorter: sorterFor((r: RiskEvent) => r.code) },
    { title: 'Название', dataIndex: 'title', width: 220, sorter: sorterFor((r: RiskEvent) => r.title), render: (t: string) => <Text strong>{t}</Text> },
    { title: 'Владелец', dataIndex: 'owner', width: 150, sorter: sorterFor((r: RiskEvent) => r.owner), render: (o?: string) => <OwnerLink owner={o} fallback="—" /> },
    numericColumn({ title: 'ARO', dataIndex: 'aro', width: 90, sorter: sorterFor((r: RiskEvent) => r.aro), render: (v: number) => fmtNum(v) }),
    numericColumn({ title: 'ALE средний', dataIndex: 'aleAvg', width: 140, sorter: sorterFor((r: RiskEvent) => r.aleAvg), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'ALE P90', dataIndex: 'aleP90', width: 140, sorter: sorterFor((r: RiskEvent) => r.aleP90), render: (v: number) => fmtMoney(v) }),
    numericColumn({ title: 'MaxSLE', dataIndex: 'maxSle', width: 140, sorter: sorterFor((r: RiskEvent) => r.maxSle), render: (v: number) => fmtMoney(v) }),
    {
      title: 'Статус', dataIndex: 'status', width: 120, sorter: sorterFor((r: RiskEvent) => r.status),
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
          expandable={{
            expandedRowRender: (r: RiskEvent) => <RiskEventLinksPanel event={r} onChanged={load} />,
          }}
        />
      </Card>

      <Modal title="Новое рисковое событие" open={open} onOk={create} confirmLoading={saving}
        onCancel={() => setOpen(false)} okText="Сохранить" cancelText="Отмена" width={640}>
        <Form form={form} layout="vertical" initialValues={{ aroIsExpert: false, regulatory: false }}>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="code" label={<FieldHint title="Уникальный код рискового события для ссылок из мер, отчётов и цепочки «риск → мера → эффект».">Код</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="RE-2026-001" />
            </Form.Item>
            <Form.Item name="category" label={<FieldHint title="Смысловая группа события — для фильтрации и группировки в реестре и на дашборде стоимости.">Категория</FieldHint>} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="отказоустойчивость" />
            </Form.Item>
          </Space>
          <Form.Item name="title" label={<FieldHint title="Краткая формулировка события: что происходит и к чему приводит.">Название</FieldHint>} rules={[{ required: true }]}>
            <Input placeholder="Отказ узла кластера → простой" />
          </Form.Item>
          <Form.Item name="description" label={<FieldHint title="Подробности события: условия возникновения, затронутые компоненты, что уже известно.">Описание</FieldHint>}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="owner" label={<FieldHint title="Кто отвечает за это рисковое событие — ведёт его в реестре и согласовывает меры по нему.">Владелец риска</FieldHint>} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="ФИО риск-менеджера" />
            </Form.Item>
            <Form.Item name="aro" label={<FieldHint title="Annualized Rate of Occurrence — сколько раз в год ожидается реализация события. Можно оставить пустым и посчитать по истории техсбоев (кнопка «Пересчитать ALE»).">ARO (частота/год)</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="sleExpert" label={<FieldHint title="Single Loss Expectancy — ущерб от одной реализации события в рублях, если задаёте его экспертно (не по формуле восстановления/простоя). Используется вместо расчётного SLE, когда указан.">SLE экспертный, ₽</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
            <Form.Item name="riskAppetite" label={<FieldHint title="Порог ALE в рублях в год, выше которого риск считается неприемлемым для организации — используется для приоритизации мер.">Риск-аппетит, ₽/год</FieldHint>} style={{ flex: 1, minWidth: 160 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="aroIsExpert" label={<FieldHint title="Включите, если ARO выше задано экспертной оценкой, а не рассчитано по истории инцидентов — влияет на то, что покажет «Пересчитать ALE».">ARO задан экспертно</FieldHint>} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="regulatory" label={<FieldHint title="Пометьте, если риск связан с обязательным регуляторным требованием — такие риски нельзя закрыть решением «Принять», только устранить или компенсировать.">Регуляторное вето</FieldHint>} valuePropName="checked">
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
// ТЗ v19 п.9-10: рыночные бенчмарки — два измеримых показателя, разрез («dimension») зависит
// от выбранного показателя (типы БП для C_мин, типы исполнителя для ставки).
const BENCHMARK_KINDS = [
  { value: 'BP_COST_PER_MIN', label: 'C_мин бизнес-процесса (₽/мин)' },
  { value: 'SUPPORT_RATE_PER_HOUR', label: 'Ставка сопровождения (₽/час)' },
];
const BENCHMARK_KIND_LABEL: Record<string, string> = Object.fromEntries(BENCHMARK_KINDS.map((k) => [k.value, k.label]));
const BENCHMARK_DIMENSIONS: Record<string, { value: string; label: string }[]> = {
  BP_COST_PER_MIN: BP_KINDS,
  SUPPORT_RATE_PER_HOUR: [{ value: 'INTERNAL', label: 'Внутренний' }, { value: 'VENDOR', label: 'Вендор' }],
};
const COMPANY_SIZE_CLASSES = [
  { value: 'MICRO', label: 'Микро' }, { value: 'SMALL', label: 'Малое' },
  { value: 'MEDIUM', label: 'Среднее' }, { value: 'LARGE', label: 'Крупное' },
];

const ReferencesTab: React.FC = () => {
  const [rates, setRates] = useState<SupportRate[]>([]);
  const [bps, setBps] = useState<BusinessProcess[]>([]);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [benchmarks, setBenchmarks] = useState<MarketBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rateForm] = Form.useForm();
  const [bpForm] = Form.useForm();
  const [benchmarkForm] = Form.useForm();
  // ТЗ v19 УК-24: сравнение «мы/рынок» — по клику, не пересчитывается фоном (рынок обновляется
  // редко, и результат зависит от того, что именно вносили в last-load costs/rates).
  const [compareOpen, setCompareOpen] = useState<{ title: string; data: BenchmarkComparison } | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, b, bench] = await Promise.all([
        api<SupportRate[]>('/econ/rates'), api<BusinessProcess[]>('/econ/business-processes'),
        api<MarketBenchmark[]>('/econ/benchmarks'),
      ]);
      setRates(r); setBps(b); setBenchmarks(bench);
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

  const createBenchmark = async () => {
    try {
      const v = await benchmarkForm.validateFields();
      setSaving(true);
      await api('/econ/benchmarks', {
        method: 'POST',
        body: JSON.stringify({ ...v, observedOn: v.observedOn.format('YYYY-MM-DD') }),
      });
      message.success('Бенчмарк добавлен'); setBenchmarkOpen(false); benchmarkForm.resetFields(); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(`Ошибка: ${e.message}`); }
    finally { setSaving(false); }
  };

  const rateCols: ColumnsType<SupportRate> = [
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

  const bpCols: ColumnsType<BusinessProcess> = [
    { title: 'Код', dataIndex: 'code', width: 120, sorter: sorterFor((r: BusinessProcess) => r.code) },
    { title: 'Название', dataIndex: 'name', width: 220, sorter: sorterFor((r: BusinessProcess) => r.name), render: (t: string) => <Text strong>{t}</Text> },
    {
      title: 'Тип', dataIndex: 'kind', width: 200, sorter: sorterFor((r: BusinessProcess) => r.kind),
      render: (k: string) => BP_KINDS.find((x) => x.value === k)?.label ?? k,
    },
    numericColumn({
      title: 'C_мин, ₽', key: 'cost', width: 130,
      sorter: sorterFor((bp: BusinessProcess) => costs[bp.id]),
      render: (_: unknown, bp: BusinessProcess) => fmtMoney(costs[bp.id]),
    }),
    {
      title: '', key: 'compare', width: 130, fixed: 'right',
      render: (_: unknown, bp: BusinessProcess) => (
        <Button size="small" icon={<SwapOutlined />} loading={comparing === bp.id} onClick={() => compareBp(bp)}>
          С рынком
        </Button>
      ),
    },
  ];

  const benchmarkCols: ColumnsType<MarketBenchmark> = [
    { title: 'Показатель', dataIndex: 'kind', width: 190, sorter: sorterFor((r: MarketBenchmark) => r.kind),
      render: (k: string) => BENCHMARK_KIND_LABEL[k] ?? k },
    { title: 'Разрез', dataIndex: 'dimension', width: 140, sorter: sorterFor((r: MarketBenchmark) => r.dimension) },
    { title: 'Размер компании', dataIndex: 'companySizeClass', width: 140,
      sorter: sorterFor((r: MarketBenchmark) => r.companySizeClass),
      render: (v?: string | null) => v || <Text type="secondary">любой</Text> },
    numericColumn({ title: 'Значение', dataIndex: 'value', width: 120,
      sorter: sorterFor((r: MarketBenchmark) => r.value),
      render: (v: number, r: MarketBenchmark) => `${fmtNum(v)} ${r.unit}` }),
    { title: 'Источник', dataIndex: 'source', sorter: sorterFor((r: MarketBenchmark) => r.source) },
    { title: 'На дату', dataIndex: 'observedOn', width: 110, sorter: sorterFor((r: MarketBenchmark) => r.observedOn) },
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
          scroll={{ x: 950 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
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
          scroll={{ x: 830 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'БП нет. Стоимость минуты — атрибут процесса: фронтальные считаются транзакционно, бэк-офис ресурсно.' }}
        />
      </Card>

      <Card
        {...premiumCard('terracotta')}
        title="Рыночные бенчмарки"
        extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setBenchmarkOpen(true)}>Добавить</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Table<MarketBenchmark>
          columns={benchmarkCols} dataSource={benchmarks} rowKey="id" loading={loading} size="small"
          scroll={{ x: 780 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: 'Бенчмарков нет: источники для рыночных цифр заказчиком пока не согласованы (В-30а). Занести можно в любой момент — источник и дата обязательны.' }}
        />
      </Card>

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
          <Form.Item name="ratePerHour" label={<FieldHint title="Базовая почасовая ставка исполнителя — основа расчёта стоимости восстановления (C_восстановление) при инциденте.">Ставка, ₽/час</FieldHint>} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={500} />
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
          <Form.Item name="costPerMinBase" label={<FieldHint title="Сколько теряет организация за минуту простоя этого процесса — основа расчёта стоимости простоя (C_простой) при инциденте.">Стоимость минуты простоя, ₽ (базовая)</FieldHint>}>
            <InputNumber style={{ width: '100%' }} min={0} step={100} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Новый рыночный бенчмарк" open={benchmarkOpen} onOk={createBenchmark} confirmLoading={saving}
        onCancel={() => setBenchmarkOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={benchmarkForm} layout="vertical" initialValues={{ kind: 'BP_COST_PER_MIN' }}
          onValuesChange={(changed) => { if (changed.kind) benchmarkForm.setFieldValue('dimension', undefined); }}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Источник и дата обязательны — без них рыночная цифра неотличима от выдуманной." />
          <Form.Item name="kind" label={<FieldHint title="Какой именно рыночный показатель вносите — ставку сопровождения или стоимость простоя процесса.">Показатель</FieldHint>} rules={[{ required: true }]}>
            <Select options={BENCHMARK_KINDS} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
            {({ getFieldValue }) => (
              <Form.Item name="dimension" label={<FieldHint title="К какому конкретно разрезу относится значение (линия поддержки, тип процесса и т.п.) — по нему бенчмарк сравнивается со «своим» значением.">Разрез</FieldHint>} rules={[{ required: true }]}>
                <Select options={BENCHMARK_DIMENSIONS[getFieldValue('kind') ?? 'BP_COST_PER_MIN']} />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="companySizeClass" label={<FieldHint title="Сегмент компаний, к которому относится рыночное значение — сравнение точнее, когда размер совпадает с вашей организацией. Необязательно.">Размер компании (для ставок — п.10; необязательно)</FieldHint>}>
            <Select allowClear options={COMPANY_SIZE_CLASSES} placeholder="Любой размер" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="value" label={<FieldHint title="Числовое значение рыночного бенчмарка в выбранной единице.">Значение</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={10} />
            </Form.Item>
            <Form.Item name="unit" label={<FieldHint title="Единица измерения значения — должна совпадать по смыслу со «своим» показателем, с которым будет сравниваться.">Единица</FieldHint>} rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input placeholder="₽/мин или ₽/час" />
            </Form.Item>
          </Space>
          <Form.Item name="source" label={<FieldHint title="Название или ссылка на открытый источник данных — обязательно: без источника рыночная цифра неотличима от выдуманной.">Источник</FieldHint>} rules={[{ required: true, message: 'Источник обязателен' }]}>
            <Input.TextArea rows={2} placeholder="Название/ссылка на открытый источник" />
          </Form.Item>
          <Form.Item name="observedOn" label={<FieldHint title="На какую дату действительно это рыночное значение — источники устаревают, дата нужна для актуальности сравнения.">Актуально на дату</FieldHint>} rules={[{ required: true, message: 'Дата обязательна' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" defaultPickerValue={dayjs()} />
          </Form.Item>
          <Form.Item name="note" label={<FieldHint title="Любой дополнительный контекст по значению — оговорки источника, методика расчёта и т.п.">Примечание (необязательно)</FieldHint>}>
            <Input.TextArea rows={2} />
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

// ════════════ Эффективность руководителей (задача 12, §7.1) — ДИАГНОСТИКА ════════════
// Та же карточка, что и в каталоге: рейтинг доступен и как элемент любого дашборда.
const ManagersTab: React.FC = () => (
  <EconScopeProvider>
    <EconManagersCard />
  </EconScopeProvider>
);


export default RiskEconomicsPage;
