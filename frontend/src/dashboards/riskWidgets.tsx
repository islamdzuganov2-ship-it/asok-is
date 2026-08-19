/**
 * riskWidgets.tsx (BL-008, Фаза 4) — реестр виджетов дашборда владельца риска (dashboardKey="risk").
 * Каждый виджет самодостаточен (сам тянет данные через RTK Query; запросы дедуплицируются).
 * Используется DashboardShell: пользователь включает/выключает и переставляет их под себя.
 */
import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Typography, Tag, List, Statistic, Empty, Spin, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SafetyCertificateOutlined, ThunderboltOutlined, AlertOutlined, AppstoreOutlined, PartitionOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  useGetIncidentAnalyticsQuery, useGetTriggeredRisksQuery,
  type IncidentCategoryStat, type IncidentSystemStat,
} from '../store/api/apiSlice';
import type { RootState } from '../store';
import { MOCK_INCIDENTS, computeIncidentAnalytics, computeTriggeredRisks } from '../data/mockIncidents';
import { RAG, BRAND, ACCENT, solidTagStyle } from '../theme/ragPalette';
import { premiumCard, accentDot, GOLD, TYPE, SPACE } from '../theme/premium';
import { numericColumn, sorterFor } from '../theme/table';
import { fmtMoney } from '../utils/money';
import type { WidgetDef } from './DashboardShell';

const { Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

// Те же подписи первопричины, что на «Аналитике сбоев» (IncidentsAnalyticsPage.tsx) — раньше
// здесь показывались сырые коды RELEASE/INFRASTRUCTURE/… без перевода.
const CATEGORY_LABEL: Record<string, string> = {
  RELEASE: 'Привнесено релизом', INFRASTRUCTURE: 'Инфраструктура', PERFORMANCE: 'Производительность',
  NETWORK: 'Сеть', POWER: 'Электроснабжение', OTHER: 'Другое',
};
const CATEGORY_TAG_COLOR: Record<string, string> = {
  RELEASE: ACCENT.violet.color, INFRASTRUCTURE: ACCENT.slate.strong, PERFORMANCE: '#947125',
  NETWORK: '#4C8165', POWER: '#C0553F', OTHER: '#667797',
};

/**
 * Аналитика сбоев с учётом переключателя Демо/LLM (BL-006) — как на «Аналитике сбоев»,
 * управленческом и других дашбордах. До этого виджеты дашборда владельца риска всегда ходили
 * в реальную БД напрямую и оставались пустыми в демо-режиме (дефолтном), даже когда остальной
 * АСОК ИС уже показывал сценарные демо-данные — выглядело так, будто аналитика сбоев «не тянется».
 */
function useIncidentAnalytics() {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';
  const live = useGetIncidentAnalyticsQuery(undefined, { skip: !isLive });
  const data = isLive ? live.data : computeIncidentAnalytics(MOCK_INCIDENTS);
  return { data, isLoading: isLive && live.isLoading };
}

/** Тот же принцип для риск-триггеров (T-16) — раньше RiskTriggersWidget тоже всегда ходил в
 * реальную БД независимо от переключателя Демо/LLM. */
function useTriggeredRisks() {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';
  const live = useGetTriggeredRisksQuery(undefined, { skip: !isLive });
  const data = isLive ? (live.data ?? []) : computeTriggeredRisks(MOCK_INCIDENTS);
  return { data, isLoading: isLive && live.isLoading };
}

const sevToken = (s: string) => {
  const v = (s || '').toUpperCase();
  if (v.includes('HIGH') || v.includes('CRIT') || v.includes('ВЫС') || v.includes('КРИТ')) return RAG.bad;
  if (v.includes('MED') || v.includes('СРЕД')) return RAG.medium;
  if (v.includes('LOW') || v.includes('НИЗ')) return RAG.good;
  return RAG.muted;
};

const RiskKpiWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data: a, isLoading } = useIncidentAnalytics();
  if (isLoading) return <div><Spin /> <Text type="secondary">Загрузка показателей…</Text></div>;
  // Найдено при проверке п.12: releaseInducedShare уже в процентах (0..100, см.
  // computeIncidentAnalytics/backend service.analytics — как на «Аналитике сбоев»,
  // IncidentsAnalyticsPage.tsx показывает то же поле без домножения). Здесь было лишнее
  // «* 100» — тайл «Доля релизных, %» показывал 2220% вместо 22.2%, причём и в live-режиме
  // тоже (виджет тянул реальную БД и до этой правки, просто в демо оставался пустым).
  const releaseShare = a ? Math.round(a.releaseInducedShare || 0) : 0;
  // П.2 (второй заход): плитки теперь кликабельны — ведут на «Аналитику сбоев», «Доля
  // релизных» — сразу с фильтром по первопричине RELEASE.
  const tile = (title: string, value: React.ReactNode, icon: React.ReactNode, tone: string, to?: string) => (
    <Col xs={12} md={6}>
      <Card
        {...premiumCard('ink')}
        hoverable={!!to}
        onClick={to ? () => navigate(to) : undefined}
        styles={{ body: { padding: SPACE.base, cursor: to ? 'pointer' : undefined } }}
      >
        <Space align="center" size={SPACE.cozy}>
          <span style={{
            width: 38, height: 38, borderRadius: 10, background: `${tone}1A`, color: tone,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: '0 0 auto',
          }}>{icon}</span>
          <Statistic title={<Text type="secondary" style={TYPE.caption}>{title}</Text>} value={value as any}
            valueStyle={{ color: BRAND.ink, fontSize: TYPE.metricSm.fontSize, fontWeight: 700 }} />
        </Space>
      </Card>
    </Col>
  );
  return (
    <Row gutter={[16, 16]}>
      {tile('Всего техсбоев', a?.total ?? 0, <ThunderboltOutlined />, RAG.medium.color, '/dashboard/incidents')}
      {tile('Открытые', a?.openCount ?? 0, <AlertOutlined />, RAG.bad.color, '/dashboard/incidents')}
      {tile('Средн. MTTR, ч', a?.avgMttrHours != null ? a.avgMttrHours.toFixed(1) : '—', <SafetyCertificateOutlined />, RAG.good.color, '/dashboard/incidents')}
      {tile('Доля релизных, %', releaseShare, <ThunderboltOutlined />, RAG.medium.color, '/dashboard/incidents?category=RELEASE')}
    </Row>
  );
};

const RiskTriggersWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data: triggered, isLoading } = useTriggeredRisks();
  const top = (triggered ?? []).slice(0, 6);
  return (
    <Card
      {...premiumCard('gold')}
      title={<Space><span style={accentDot(GOLD.base)} /><span style={{ color: BRAND.ink }}>Проактивные риск-триггеры</span></Space>}
      extra={<Text type="secondary" style={TYPE.caption}>риски по текущему состоянию (техсбои / просевшие характеристики)</Text>}
    >
      {isLoading ? (
        <div><Spin /> <Text type="secondary">Загрузка триггеров…</Text></div>
      ) : top.length === 0 ? (
        <Empty description="Активных риск-триггеров нет" />
      ) : (
        <List
          dataSource={top}
          renderItem={(r) => {
            const tok = sevToken(r.severity);
            return (
              <List.Item onClick={() => navigate('/dashboard/risk-radar')} style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap>
                    <Text strong>{r.title}</Text>
                    <Tag style={solidTagStyle(tok.strong)}>{r.severity}</Tag>
                    {r.characteristic && <Tag>{r.characteristic}</Tag>}
                  </Space>
                  <Text type="secondary" style={TYPE.caption}>Повод: {r.triggered_by}</Text>
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};

const IncidentsByCategoryWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data: a, isLoading } = useIncidentAnalytics();
  // П.1/2 (второй заход): раньше — сырые коды категорий (RELEASE/INFRASTRUCTURE/…) без
  // перевода и без numericColumn (цифры не выровнены по единому инварианту вправо+табличные
  // цифры). Плюс строка теперь кликабельна — ведёт на «Аналитику сбоев» с фильтром.
  const cols: ColumnsType<IncidentCategoryStat> = [
    { title: 'Первопричина', dataIndex: 'category', key: 'category',
      sorter: sorterFor((r: IncidentCategoryStat) => CATEGORY_LABEL[r.category] ?? r.category),
      render: (c: string) => <Tag style={solidTagStyle(CATEGORY_TAG_COLOR[c] ?? RAG.muted.strong)}>{CATEGORY_LABEL[c] ?? c}</Tag> },
    numericColumn<IncidentCategoryStat>({ title: 'Сбоев', dataIndex: 'count', key: 'count', width: 90,
      sorter: sorterFor((r: IncidentCategoryStat) => r.count) }),
    numericColumn<IncidentCategoryStat>({ title: 'Открытых', dataIndex: 'openCount', key: 'openCount', width: 100,
      sorter: sorterFor((r: IncidentCategoryStat) => r.openCount) }),
    numericColumn<IncidentCategoryStat>({ title: 'MTTR, ч', dataIndex: 'avgMttrHours', key: 'mttr', width: 100,
      sorter: sorterFor((r: IncidentCategoryStat) => r.avgMttrHours),
      render: (v: number | null) => (v != null ? v.toFixed(1) : '—') }),
  ];
  return (
    <Card {...premiumCard('ink')} title={<Space><PartitionOutlined style={{ color: GOLD.base }} /><span style={{ color: BRAND.ink }}>Сбои по первопричинам</span></Space>}>
      {isLoading ? <Spin /> : (
        <Table<IncidentCategoryStat> size="small" rowKey="category" pagination={false}
          dataSource={a?.byCategory ?? []} columns={cols}
          onRow={(r) => ({
            onClick: () => navigate(`/dashboard/incidents?category=${encodeURIComponent(r.category)}`),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: <Empty description="Нет данных по сбоям" /> }} />
      )}
    </Card>
  );
};

interface TopRiskLite { code: string; title: string; owner: string | null; system: string | null; aleAvg: number; regulatory: boolean }
interface CostDashboardLite { portfolioAle: number; risksCount: number; topRisks: TopRiskLite[] }

/**
 * П.3/4 (фидбэк по «Основное — владелец риска», второй заход): «в карточках с мерами нет связи
 * с экономикой» / «нет простого способа посмотреть связь между техсбоями и экономикой».
 *
 * Проверено (см. риск/econ модели): RiskBase (качественный риск-триггер) и RiskEvent (денежный
 * ALE) связаны НЕОБЯЗАТЕЛЬНОЙ FK (risk_base_id) — так решил заказчик специально, чтобы не путать
 * знаниевый каталог с числовым слоем. Навешивать ₽ на конкретную карточку триггера значит либо
 * часто показывать пусто (связка не проставлена), либо матчить по characteristic и складывать
 * ALE чужих событий — то есть по факту выдумывать цифру. Вместо этого — честный портфельный
 * ALE («одна цифра для CEO», см. econ/schemas.py) с топ-5 самых дорогих рисковых событий: это
 * и есть прямой мост «техсбои → характеристика → деньги» без обмана данными.
 */
function useCostDashboard() {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const isLive = dataMode === 'live';
  const [data, setData] = useState<CostDashboardLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!isLive) { setData(null); setError(false); return; }
    let alive = true;
    setLoading(true); setError(false);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/econ/dashboard`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CostDashboardLite) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isLive]);
  return { data, isLoading: isLive && loading, error: isLive && error, isLive };
}

const EconomicImpactWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error, isLive } = useCostDashboard();
  return (
    <Card
      {...premiumCard('gold')}
      title={<Space><span style={accentDot(GOLD.base)} /><DollarOutlined style={{ color: GOLD.base }} /><span style={{ color: BRAND.ink }}>Экономическое влияние</span></Space>}
      extra={<a onClick={() => navigate('/risk-economics')} style={{ cursor: 'pointer' }}>Риск-экономика →</a>}
    >
      {!isLive ? (
        <Text type="secondary" style={{ fontSize: TYPE.caption.fontSize }}>
          Портфельный ALE считается по реестру рисковых событий (риск-экономика, не по мок-сценарию) — доступен в режиме LLM.
        </Text>
      ) : isLoading ? (
        <div><Spin /> <Text type="secondary">Загрузка…</Text></div>
      ) : error || !data ? (
        <Text type="secondary">Не удалось получить данные риск-экономики.</Text>
      ) : (
        <>
          <Space size="large" wrap style={{ marginBottom: SPACE.cozy }}>
            <Statistic title={<Text type="secondary" style={TYPE.caption}>Портфельный ALE, ₽/год</Text>}
              value={fmtMoney(data.portfolioAle)}
              valueStyle={{ color: RAG.bad.strong, fontSize: TYPE.metricSm.fontSize, fontWeight: 700 }} />
            <Statistic title={<Text type="secondary" style={TYPE.caption}>Активных рисковых событий</Text>}
              value={data.risksCount}
              valueStyle={{ color: BRAND.ink, fontSize: TYPE.metricSm.fontSize, fontWeight: 700 }} />
          </Space>
          {data.topRisks.length > 0 && (
            <List
              size="small"
              header={<Text type="secondary" style={TYPE.caption}>Топ по стоимости</Text>}
              dataSource={data.topRisks.slice(0, 5)}
              renderItem={(r) => (
                <List.Item onClick={() => navigate('/risk-economics')} style={{ cursor: 'pointer', padding: '6px 0' }}>
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Space wrap>
                      <Text strong>{r.title}</Text>
                      {r.system && <Tag>{r.system}</Tag>}
                    </Space>
                    <Text type="secondary" style={TYPE.caption}>
                      {r.code} · ALE {fmtMoney(r.aleAvg)}/год{r.owner ? ` · ${r.owner}` : ''}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Card>
  );
};

const TopSystemsWidget: React.FC = () => {
  const navigate = useNavigate();
  const { data: a, isLoading } = useIncidentAnalytics();
  return (
    <Card {...premiumCard('terracotta')} title={<Space><AppstoreOutlined style={{ color: GOLD.base }} /><span style={{ color: BRAND.ink }}>Нестабильные ИС (по числу сбоев)</span></Space>}>
      {isLoading ? <Spin /> : (
        <List
          dataSource={(a?.topSystems ?? []) as IncidentSystemStat[]}
          locale={{ emptyText: <Empty description="Нет данных" /> }}
          renderItem={(s) => (
            <List.Item
              onClick={() => navigate(`/dashboard/incidents?system=${encodeURIComponent(s.systemName)}`)}
              style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px' }}
            >
              <Text strong>{s.systemName}</Text>
              <Space>
                <Tag style={solidTagStyle(RAG.medium.strong)}>сбоев: {s.count}</Tag>
                {s.openCount > 0 && <Tag style={solidTagStyle(RAG.bad.strong)}>открытых: {s.openCount}</Tag>}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
};

export const RISK_WIDGETS: WidgetDef[] = [
  { id: 'kpi', title: 'Ключевые показатели (техсбои)', defaultEnabled: true, Component: RiskKpiWidget },
  { id: 'triggers', title: 'Проактивные риск-триггеры', defaultEnabled: true, Component: RiskTriggersWidget },
  { id: 'economicImpact', title: 'Экономическое влияние', defaultEnabled: true, Component: EconomicImpactWidget },
  { id: 'byCategory', title: 'Сбои по первопричинам', defaultEnabled: true, Component: IncidentsByCategoryWidget },
  { id: 'topSystems', title: 'Нестабильные ИС', defaultEnabled: false, Component: TopSystemsWidget },
];
