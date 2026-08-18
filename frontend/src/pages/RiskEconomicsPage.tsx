/**
 * RiskEconomicsPage.tsx — риск-экономический контур (BL-007).
 *
 * Единая рабочая область: рисковые события с числовым ALE, справочники экономики (ставки
 * сопровождения, бизнес-процессы + стоимость минуты простоя) и воронка замыкания несоответствий.
 * Подключено к /api/v1/{risk-events,econ,nonconformities}. Ввод — ручной (пилот идёт от ручного
 * ввода, не от автовыгрузки ITSM). Расчёты (C_ТС, ALE, ROSI) считает бэкенд; здесь — ввод и подача.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { message } from '../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, InboxOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KpiCard from '../components/KpiCard';
import { premiumCard, accentDot, accentColorOf, pageContainer, pageTitle, GOLD, PREMIUM, SPACE, TYPE } from '../theme/premium';
import { numericColumn, numericText, sorterFor } from '../theme/table';
import { BRAND, RAG } from '../theme/ragPalette';
import { OwnerLink } from '../components/OwnerLink';

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
// Эффективность руководителей (задача 12, §7.1) — диагностика без привязки к мотивации.
interface ManagerMetricRow {
  owner: string; openCount: number; overdueCount: number; completedCount: number;
  avgAgeDays: number | null; deltaAleManaged: number; acceptShare: number; compensatingShare: number;
  // ТЗ v19 п.13 (В-41): взвешенная нагрузка по открытым мерам — экран загрузки/балансировки.
  weightedLoad: number; hoursEstimated: number;
  measuresWithEstimate: number; measuresWithoutEstimate: number;
}
interface ManagerMetrics { mode: string; note: string; generatedAt: string; rows: ManagerMetricRow[] }
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
// ТЗ v19 п.7 (УК-19/20): сквозная цепочка риск → мера → эффект + портфельный итог.
interface PortfolioRiskSummary {
  totalAtRisk: number; coveredByDoneMeasures: number; residualRisk: number;
  requiredInvestment: number; expectedEffect: number; risksCount: number; measuresCount: number;
}
interface RiskMeasureChainMeasure {
  proposalId: string; title: string; status: string; execution: string | null;
  capex: number | null; opexPerYear: number | null; aleReductionShare: number | null;
  deltaAleCash: number | null; deltaAleDeferred: number | null; deltaAleCapacity: number | null;
  rosi: number | null; verdict: string | null; paybackMonths: number | null;
}
interface RiskMeasureChainRow {
  riskId: string; riskCode: string; riskTitle: string; systemName: string | null;
  aleAvg: number | null; measures: RiskMeasureChainMeasure[];
}
// ТЗ v19 п.15 (УК-37): портфельная кривая эффекта во времени — «когда реально придут деньги».
interface QuarterPortfolioPoint { quarterLabel: string; netCash: number; cumulative: number }
interface PortfolioEffectCurve {
  points: QuarterPortfolioPoint[]; measuresIncluded: number; measuresExcludedNoStartDate: number;
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
const fmtMln = (v: number): string =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
    : new Intl.NumberFormat('ru-RU').format(Math.round(v));

const DashboardTab: React.FC = () => {
  const [d, setD] = useState<CostDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ТЗ v19 п.7 (УК-19/20): портфельный итог + сквозная цепочка риск → мера → эффект.
  const [summary, setSummary] = useState<PortfolioRiskSummary | null>(null);
  const [chain, setChain] = useState<RiskMeasureChainRow[]>([]);
  const [chainLoading, setChainLoading] = useState(true);
  // ТЗ v19 п.15 (УК-37): портфельная кривая эффекта — суммарно по всем одобренным мерам.
  const [curve, setCurve] = useState<PortfolioEffectCurve | null>(null);
  const [curveLoading, setCurveLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api<CostDashboard>('/econ/dashboard')
      .then((r) => { if (alive) setD(r); })
      .catch((e: any) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setChainLoading(true);
    Promise.all([
      api<PortfolioRiskSummary>('/risk-events/portfolio-summary'),
      api<RiskMeasureChainRow[]>('/risk-events/chain'),
    ])
      .then(([s, c]) => { if (alive) { setSummary(s); setChain(c); } })
      .catch(() => { if (alive) { setSummary(null); setChain([]); } })
      .finally(() => { if (alive) setChainLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setCurveLoading(true);
    api<PortfolioEffectCurve>('/governance/proposals/effect-curve')
      .then((r) => { if (alive) setCurve(r); })
      .catch(() => { if (alive) setCurve(null); })
      .finally(() => { if (alive) setCurveLoading(false); });
    return () => { alive = false; };
  }, []);

  const topCols: ColumnsType<TopRisk> = [
    { title: 'Код', dataIndex: 'code', width: 130, sorter: sorterFor((r: TopRisk) => r.code) },
    {
      title: 'Риск', dataIndex: 'title', sorter: sorterFor((r: TopRisk) => r.title),
      render: (t: string, r: TopRisk) => (
        <Space size={4}>{r.regulatory && <Tag color="volcano">рег.</Tag>}<Text strong>{t}</Text></Space>
      ),
    },
    { title: 'ИС', dataIndex: 'system', width: 140, sorter: sorterFor((r: TopRisk) => r.system), render: (s?: string) => s || '—' },
    { title: 'Владелец', dataIndex: 'owner', width: 160, sorter: sorterFor((r: TopRisk) => r.owner), render: (o?: string) => <OwnerLink owner={o} fallback="—" /> },
    numericColumn({ title: 'ALE, ₽/год', dataIndex: 'aleAvg', width: 150, sorter: sorterFor((r: TopRisk) => r.aleAvg), render: (v: number) => fmtMoney(v) }),
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

      {/* ТЗ v19 п.7 (УК-20): портфельный итог — «под риском / покрыто / остаточный / вложения / эффект» */}
      <div>
        <Title level={5} style={{ margin: '0 0 8px' }}>Портфельный итог по мерам</Title>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: SPACE.base }}>
          <KpiCard loading={chainLoading} title="Всего под риском, ₽/год" value={summary ? fmtMoney(summary.totalAtRisk) : '—'}
            hint={summary ? `${summary.risksCount} рисковых событий` : undefined} />
          <KpiCard loading={chainLoading} title="Покрыто выполненными мерами, ₽/год" value={summary ? fmtMoney(summary.coveredByDoneMeasures) : '—'}
            color={summary && summary.coveredByDoneMeasures > 0 ? accentColorOf('sage') : undefined} />
          <KpiCard loading={chainLoading} title="Остаточный риск, ₽/год" value={summary ? fmtMoney(summary.residualRisk) : '—'}
            color={summary && summary.residualRisk > 0 ? accentColorOf('terracotta') : undefined} />
          <KpiCard loading={chainLoading} title="Требуемые вложения, ₽" value={summary ? fmtMoney(summary.requiredInvestment) : '—'}
            hint={summary ? `${summary.measuresCount} мер` : undefined} />
          <KpiCard loading={chainLoading} title="Ожидаемый эффект, ₽/год" value={summary ? fmtMoney(summary.expectedEffect) : '—'}
            hint="одобрены, ещё не выполнены" />
        </div>
      </div>

      {/* ТЗ v19 п.7 (УК-19): сквозная таблица риск → мера → эффект, разворот по клику на риск */}
      <Card {...premiumCard('ink')} title="Риск → мера → эффект" styles={{ body: { padding: 0 } }}>
        <Table<RiskMeasureChainRow>
          rowKey="riskId" loading={chainLoading} size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }}
          dataSource={chain}
          locale={{ emptyText: 'Нет активных рисковых событий.' }}
          expandable={{
            rowExpandable: (r) => r.measures.length > 0,
            expandedRowRender: (r) => (
              <Table<RiskMeasureChainMeasure>
                rowKey="proposalId" size="small" pagination={false} dataSource={r.measures}
                columns={[
                  { title: 'Мера', dataIndex: 'title' },
                  { title: 'Статус', dataIndex: 'status', width: 130,
                    render: (s: string, m) => (
                      <Space size={4}>
                        <Tag>{s}</Tag>
                        {m.execution && <Tag color={m.execution === 'DONE' ? 'green' : 'red'}>{m.execution === 'DONE' ? 'выполнено' : 'не выполнено'}</Tag>}
                      </Space>
                    ) },
                  numericColumn({ title: 'Доля снятия', dataIndex: 'aleReductionShare', width: 100,
                    render: (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%` }),
                  numericColumn({ title: 'ΔALE (деньги)', dataIndex: 'deltaAleCash', width: 130, render: (v: number | null) => fmtMoney(v) }),
                  numericColumn({ title: 'CAPEX', dataIndex: 'capex', width: 120, render: (v: number | null) => fmtMoney(v) }),
                  numericColumn({ title: 'OPEX/год', dataIndex: 'opexPerYear', width: 120, render: (v: number | null) => fmtMoney(v) }),
                  numericColumn({ title: 'ROSI', dataIndex: 'rosi', width: 90, render: (v: number | null) => v == null ? '—' : fmtNum(v) }),
                  numericColumn({ title: 'Окупаемость, мес.', dataIndex: 'paybackMonths', width: 130,
                    render: (v: number | null) => v == null ? '—' : fmtNum(v, 1) }),
                  { title: 'Вердикт', dataIndex: 'verdict', width: 110, render: (v: string | null) => v || '—' },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Риск', dataIndex: 'riskTitle', sorter: sorterFor((r: RiskMeasureChainRow) => r.riskTitle),
              render: (t: string, r) => <Space size={4}><Text type="secondary" style={{ fontSize: 12 }}>{r.riskCode}</Text><Text strong>{t}</Text></Space> },
            { title: 'ИС', dataIndex: 'systemName', width: 160, render: (s: string | null) => s || '—' },
            numericColumn({ title: 'ALE, ₽/год', dataIndex: 'aleAvg', width: 150,
              sorter: sorterFor((r: RiskMeasureChainRow) => r.aleAvg), render: (v: number | null) => fmtMoney(v) }),
            numericColumn({ title: 'Мер привязано', key: 'measuresCount', width: 130,
              sorter: sorterFor((r: RiskMeasureChainRow) => r.measures.length),
              render: (_: unknown, r) => r.measures.length || <Text type="secondary">0</Text> }),
          ]}
        />
      </Card>

      {/* ТЗ v19 п.15 (УК-37): портфельная кривая эффекта — «когда реально придут деньги»
          по одобренным мерам, с учётом лага внедрения. Меры без решения (decided_at) не входят —
          honestly считать для них нечего. */}
      <Card {...premiumCard('sage')} title="Когда придут деньги: портфельный эффект по кварталам"
        styles={{ body: { padding: SPACE.airy } }}>
        {curveLoading ? (
          <Text type="secondary">Загрузка…</Text>
        ) : !curve || curve.points.length === 0 ? (
          <Text type="secondary">Нет одобренных мер с посчитанной экономикой — кривую строить не из чего.</Text>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {curve.points.map((pt) => (
                <div key={pt.quarterLabel} style={{
                  minWidth: 100, padding: '6px 8px', borderRadius: 6, background: '#fff', border: '1px solid #E5E7EB',
                }}>
                  <Text style={{ fontSize: TYPE.micro.fontSize, display: 'block' }} type="secondary">{pt.quarterLabel}</Text>
                  <Text style={{ fontSize: 12, display: 'block', color: pt.netCash > 0 ? RAG.good.strong : pt.netCash < 0 ? RAG.bad.strong : undefined }}>
                    {pt.netCash > 0 ? '+' : ''}{fmtMoney(pt.netCash)}
                  </Text>
                  <Text style={{ fontSize: 12, display: 'block', color: pt.cumulative >= 0 ? RAG.good.strong : RAG.bad.strong }}>
                    Σ {fmtMoney(pt.cumulative)}
                  </Text>
                </div>
              ))}
            </div>
            <Text type="secondary" style={{ fontSize: TYPE.micro.fontSize, display: 'block', marginTop: 8 }}>
              Учтено мер: {curve.measuresIncluded}
              {curve.measuresExcludedNoStartDate > 0 && <> · без решения (не входят в расчёт): {curve.measuresExcludedNoStartDate}</>}
            </Text>
          </>
        )}
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

      <Modal title="Новый рыночный бенчмарк" open={benchmarkOpen} onOk={createBenchmark} confirmLoading={saving}
        onCancel={() => setBenchmarkOpen(false)} okText="Сохранить" cancelText="Отмена">
        <Form form={benchmarkForm} layout="vertical" initialValues={{ kind: 'BP_COST_PER_MIN' }}
          onValuesChange={(changed) => { if (changed.kind) benchmarkForm.setFieldValue('dimension', undefined); }}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Источник и дата обязательны — без них рыночная цифра неотличима от выдуманной." />
          <Form.Item name="kind" label="Показатель" rules={[{ required: true }]}>
            <Select options={BENCHMARK_KINDS} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
            {({ getFieldValue }) => (
              <Form.Item name="dimension" label="Разрез" rules={[{ required: true }]}>
                <Select options={BENCHMARK_DIMENSIONS[getFieldValue('kind') ?? 'BP_COST_PER_MIN']} />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="companySizeClass" label="Размер компании (для ставок — п.10; необязательно)">
            <Select allowClear options={COMPANY_SIZE_CLASSES} placeholder="Любой размер" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="value" label="Значение" rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={10} />
            </Form.Item>
            <Form.Item name="unit" label="Единица" rules={[{ required: true }]} style={{ flex: 1, minWidth: 140 }}>
              <Input placeholder="₽/мин или ₽/час" />
            </Form.Item>
          </Space>
          <Form.Item name="source" label="Источник" rules={[{ required: true, message: 'Источник обязателен' }]}>
            <Input.TextArea rows={2} placeholder="Название/ссылка на открытый источник" />
          </Form.Item>
          <Form.Item name="observedOn" label="Актуально на дату" rules={[{ required: true, message: 'Дата обязательна' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" defaultPickerValue={dayjs()} />
          </Form.Item>
          <Form.Item name="note" label="Примечание (необязательно)">
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

// ════════════ Эффективность руководителей (задача 12, §7.1) — ДИАГНОСТИКА ════════════
const ManagersTab: React.FC = () => {
  const [d, setD] = useState<ManagerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api<ManagerMetrics>('/econ/manager-metrics')
      .then((r) => { if (alive) setD(r); })
      .catch((e: any) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const rows = d?.rows ?? [];
  const totals = useMemo(() => ({
    owners: rows.length,
    open: rows.reduce((s, r) => s + r.openCount, 0),
    overdue: rows.reduce((s, r) => s + r.overdueCount, 0),
    delta: rows.reduce((s, r) => s + r.deltaAleManaged, 0),
    // ТЗ v19 п.13 (В-41): сколько мер вообще без оценки часов — видно ДО таблицы, чтобы не
    // спутать «мало нагрузки» с «нагрузку никто не оценил» (не ноль молча).
    withoutEstimate: rows.reduce((s, r) => s + r.measuresWithoutEstimate, 0),
  }), [rows]);

  const columns: ColumnsType<ManagerMetricRow> = [
    { title: 'Владелец', dataIndex: 'owner', width: 200, sorter: sorterFor((r: ManagerMetricRow) => r.owner), render: (o: string) => <Text strong>{o}</Text> },
    numericColumn({ title: 'Нагрузка', dataIndex: 'openCount', width: 110, sorter: sorterFor((r: ManagerMetricRow) => r.openCount) }),
    numericColumn({
      title: 'Просрочено', dataIndex: 'overdueCount', width: 120,
      sorter: sorterFor((r: ManagerMetricRow) => r.overdueCount),
      render: (v: number) => (
        <Text style={{ color: v > 0 ? RAG.bad.strong : BRAND.inkSoft }}>{v}</Text>
      ),
    }),
    numericColumn({
      title: 'Выполнено', dataIndex: 'completedCount', width: 120,
      sorter: sorterFor((r: ManagerMetricRow) => r.completedCount),
      render: (v: number) => (
        <Text style={{ color: v > 0 ? RAG.good.strong : BRAND.inkSoft }}>{v}</Text>
      ),
    }),
    numericColumn({
      title: 'Средний возраст, дн', dataIndex: 'avgAgeDays', width: 170,
      sorter: sorterFor((r: ManagerMetricRow) => r.avgAgeDays),
      render: (v: number | null) => fmtNum(v, 1),
    }),
    numericColumn({
      title: 'Δ ALE под управлением', dataIndex: 'deltaAleManaged', width: 200,
      sorter: sorterFor((r: ManagerMetricRow) => r.deltaAleManaged),
      render: (v: number) => fmtMoney(v),
    }),
    numericColumn({
      title: 'Доля «принять», %', dataIndex: 'acceptShare', width: 160,
      sorter: sorterFor((r: ManagerMetricRow) => r.acceptShare),
      // Высокая доля «принять» — сигнал: проблемы прячут вместо решения (§7.1).
      render: (v: number) => (
        <Text style={{ color: v >= 50 ? RAG.medium.strong : BRAND.inkSoft }}>{fmtNum(v, 1)}</Text>
      ),
    }),
    numericColumn({
      title: 'Доля компенсирующих, %', dataIndex: 'compensatingShare', width: 200,
      sorter: sorterFor((r: ManagerMetricRow) => r.compensatingShare),
      // Много компенсирующих — лечение симптомов вместо причин (§7.1).
      render: (v: number) => (
        <Text style={{ color: v >= 50 ? RAG.medium.strong : BRAND.inkSoft }}>{fmtNum(v, 1)}</Text>
      ),
    }),
    numericColumn({
      title: 'Взвеш. нагрузка', dataIndex: 'weightedLoad', width: 150,
      sorter: sorterFor((r: ManagerMetricRow) => r.weightedLoad),
      // ТЗ v19 п.13: характеристика × критичность ИС × часы — «5 сложных» не равны «15 лёгким».
      render: (v: number) => fmtNum(v, 0),
    }),
    numericColumn({
      title: 'Часы (оценено)', dataIndex: 'hoursEstimated', width: 140,
      sorter: sorterFor((r: ManagerMetricRow) => r.hoursEstimated),
      render: (v: number) => `${fmtNum(v, 1)} ч`,
    }),
    numericColumn({
      title: 'Мер без оценки часов', dataIndex: 'measuresWithoutEstimate', width: 180,
      sorter: sorterFor((r: ManagerMetricRow) => r.measuresWithoutEstimate),
      // Отдельный счётчик (В-41): не ноль молча — иначе неоценённая нагрузка выглядит «свободной».
      render: (v: number) => (
        <Text style={{ color: v > 0 ? RAG.medium.strong : BRAND.inkSoft }}>{v}</Text>
      ),
    }),
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space size="middle" wrap>
        <KpiCard title="Руководителей" value={totals.owners} loading={loading} />
        <KpiCard title="Открытых задач" value={totals.open} loading={loading} />
        <KpiCard title="Просрочено" value={totals.overdue} loading={loading}
          color={totals.overdue > 0 ? RAG.bad.strong : undefined} />
        <KpiCard title="Δ ALE под управлением" value={fmtMln(totals.delta)} hint="₽/год"
          loading={loading} />
        <KpiCard title="Мер без оценки часов" value={totals.withoutEstimate} loading={loading}
          color={totals.withoutEstimate > 0 ? RAG.medium.strong : undefined}
          hint="не входят во взвешенную нагрузку" />
      </Space>

      <Alert type="info" showIcon
        message="Диагностический режим — без привязки к мотивации"
        description={d?.note ?? 'Метрики выводятся пакетом, не по одной: при прямой привязке к премии любая из них ломается (дробление мер, срок с запасом, завышение исходной оценки риска). Первые 2 квартала — наблюдение и калибровка порогов.'} />

      {error && <Alert type="error" showIcon message="Ошибка загрузки" description={error} closable />}

      <Card {...premiumCard('slate')} styles={{ body: { padding: 0 } }}>
        <Table<ManagerMetricRow>
          columns={columns} dataSource={rows} rowKey="owner" loading={loading} size="small"
          scroll={{ x: 1750 }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: 'Нет данных: метрики появятся, когда у несоответствий и мер будут указаны владельцы.' }}
        />
      </Card>
    </Space>
  );
};

export default RiskEconomicsPage;
