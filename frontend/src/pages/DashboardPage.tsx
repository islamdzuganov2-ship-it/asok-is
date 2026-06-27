/**
 * DashboardPage.tsx — аналитический дашборд АСОК ИС.
 * Donut (распределение уровней, ECharts) + HTML-тепловая карта с липкой шапкой.
 * KPI-карточки кликабельны: раскрывают модальное окно с тем, что в них входит.
 * Подключён к GET /api/v1/assessments/dashboard, при недоступности — демо-набор.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Col, Row, Skeleton, Statistic, Table, Tag, Typography, Alert, Modal,
} from 'antd';
import { RightOutlined } from '@ant-design/icons';
import * as echarts from 'echarts';
import { useNavigate } from 'react-router-dom';
import { ANALYTICS_SCALE } from '../data/mockScaleData';
import LevelHeatmap, { LEVEL_COLORS } from '../components/LevelHeatmap';
import { critTagStyle } from '../theme/ragPalette';

const { Title, Text } = Typography;

const LEVEL_ORDER = [
  'Высокий уровень', 'Уровень выше среднего', 'Средний уровень',
  'Уровень ниже среднего', 'Низкий уровень', 'Невозможно измерить',
];

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface DashboardData {
  globalHealthScore: number;
  levelCounts: Record<string, number>;
  heatmapData: [number, number, number][];
  xAxisLabels: string[];
  yAxisLabels: string[];
  problematicSystems: { id: string; name: string; criticality: string; lowMetricsCount: number }[];
  totalMetrics: number;
}

type DetailKey = 'global' | 'metrics' | 'systems' | 'low';

const DETAIL_TITLE: Record<DetailKey, string> = {
  global: 'Глобальный балл — из чего складывается',
  metrics: 'Все метрики по уровням качества',
  systems: 'ИС в мониторинге',
  low: 'Низкие метрики по системам',
};

const critTag = (v: string) => <Tag style={critTagStyle(v)}>{v}</Tag>;

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const donutRef = useRef<HTMLDivElement>(null);
  const donutChart = useRef<echarts.ECharts | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${VITE_API}/assessments/dashboard`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.status === 401) { navigate('/login'); return; }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: DashboardData = await resp.json();
        if (!json || !json.totalMetrics) { setData(ANALYTICS_SCALE as DashboardData); setIsMock(true); }
        else { setData(json); setIsMock(false); }
      } catch {
        setData(ANALYTICS_SCALE as DashboardData);
        setIsMock(true);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [navigate]);

  // Donut Chart
  useEffect(() => {
    if (!data || !donutRef.current) return;
    if (!donutChart.current) donutChart.current = echarts.init(donutRef.current);
    const seriesData = Object.entries(data.levelCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, itemStyle: { color: LEVEL_COLORS[name] ?? '#d9d9d9' } }));
    donutChart.current.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', left: 'left', textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['42%', '70%'], data: seriesData,
        label: { show: false }, emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      }],
    });
    const onResize = () => donutChart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [data]);

  useEffect(() => () => { donutChart.current?.dispose(); }, []);

  // matrix[y][x] = bucket для HTML-теплокарты
  const matrix = useMemo(() => {
    if (!data) return [];
    const m: (number | null)[][] = data.yAxisLabels.map(() => data.xAxisLabels.map(() => null));
    data.heatmapData.forEach(([x, y, v]) => { if (m[y] && x < m[y].length) m[y][x] = v; });
    return m;
  }, [data]);

  if (error) {
    return <Alert type="error" showIcon message="Ошибка загрузки дашборда"
      description={`${error}. Проверьте подключение к backend.`} style={{ margin: 24 }} />;
  }

  const healthPct = data ? Math.round(data.globalHealthScore * 100) : 0;
  const healthColor = healthPct >= 81 ? '#7FA98C' : healthPct >= 41 ? '#D8BE7E' : '#CC8B81';
  const lowTotal = data?.problematicSystems.reduce((s, p) => s + p.lowMetricsCount, 0) ?? 0;

  const levelDist = data
    ? LEVEL_ORDER
        .map((lvl) => ({ level: lvl, count: data.levelCounts[lvl] ?? 0 }))
        .filter((r) => r.count > 0)
        .map((r) => ({ ...r, pct: data.totalMetrics ? Math.round((r.count / data.totalMetrics) * 100) : 0 }))
    : [];

  const KpiCard: React.FC<{ k: DetailKey; title: string; value: React.ReactNode; color?: string }> =
    ({ k, title, value, color }) => (
      <Card size="small" hoverable onClick={() => setDetail(k)} style={{ cursor: 'pointer' }}>
        {loading ? <Skeleton.Input active /> : (
          <>
            <Statistic title={title} value={value as any} valueStyle={color ? { color, fontWeight: 700 } : undefined} />
            <Text type="secondary" style={{ fontSize: 11 }}>раскрыть <RightOutlined style={{ fontSize: 9 }} /></Text>
          </>
        )}
      </Card>
    );

  const renderDetail = () => {
    if (!data || !detail) return null;
    if (detail === 'global' || detail === 'metrics') {
      return (
        <>
          {detail === 'global' && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Глобальный балл {healthPct}% — среднее по {data.totalMetrics} метрикам {data.yAxisLabels.length} ИС.
              Ниже — распределение метрик по уровням качества (методика МК 8.1).
            </Text>
          )}
          <Table
            dataSource={levelDist} rowKey="level" size="small" pagination={false}
            columns={[
              { title: 'Уровень', dataIndex: 'level',
                render: (v: string) => <Tag color={LEVEL_COLORS[v]} style={{ color: '#fff', border: 'none' }}>{v}</Tag> },
              { title: 'Метрик', dataIndex: 'count' },
              { title: 'Доля', dataIndex: 'pct', render: (v: number) => `${v}%` },
            ]}
          />
        </>
      );
    }
    const rows = detail === 'low'
      ? [...data.problematicSystems].sort((a, b) => b.lowMetricsCount - a.lowMetricsCount)
      : data.problematicSystems;
    return (
      <>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {detail === 'systems'
            ? `Всего ИС в мониторинге: ${data.yAxisLabels.length}. Ниже — системы с наибольшим числом низких метрик.`
            : `Всего низких метрик: ${lowTotal} по ${rows.length} системам.`}
        </Text>
        <Table
          dataSource={rows} rowKey="id" size="small" pagination={false}
          columns={[
            { title: 'ИС', dataIndex: 'name', ellipsis: true },
            { title: 'Критичность', dataIndex: 'criticality', render: critTag },
            { title: 'Низких метрик', dataIndex: 'lowMetricsCount',
              render: (v: number) => <Text type="danger" strong>{v}</Text> },
          ]}
        />
      </>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 4 }}>
        Аналитический дашборд качества ИС{' '}
        <Tag color={isMock ? 'gold' : 'green'}>{isMock ? 'Демо-данные' : 'Live из БД'}</Tag>
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        {isMock
          ? 'Backend/БД недоступны или пусты — показан демонстрационный набор (30 ИС). Запустите backend и заполните оценки для live-данных.'
          : 'Детальный операционный взгляд (live из БД): распределение по уровням, метрики, полная тепловая карта по всем ИС.'}
      </Text>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}><KpiCard k="global" title="Глобальный балл" value={`${healthPct}%`} color={healthColor} /></Col>
        <Col xs={12} sm={6}><KpiCard k="metrics" title="Всего метрик" value={data?.totalMetrics ?? 0} /></Col>
        <Col xs={12} sm={6}><KpiCard k="systems" title="ИС в мониторинге" value={data?.yAxisLabels.length ?? 0} /></Col>
        <Col xs={12} sm={6}><KpiCard k="low" title="Низких метрик" value={lowTotal} color="#f5222d" /></Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Распределение по уровням качества" style={{ height: 380 }}>
            {loading ? <Skeleton active paragraph={{ rows: 6 }} />
              : data?.totalMetrics === 0
                ? <Text type="secondary">Нет данных. Создайте период оценки и введите метрики.</Text>
                : <div ref={donutRef} style={{ height: 310, width: '100%' }} />}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title="Проблемные ИС (наибольшее число низких метрик)" style={{ height: 380 }}>
            {loading ? <Skeleton active /> : (
              <Table
                dataSource={data?.problematicSystems ?? []} rowKey="id" size="small" pagination={false}
                locale={{ emptyText: 'Нет проблемных систем' }}
                columns={[
                  { title: 'ИС', dataIndex: 'name', ellipsis: true },
                  { title: 'Критичность', dataIndex: 'criticality', render: critTag },
                  { title: 'Низких метрик', dataIndex: 'lowMetricsCount',
                    render: (v: number) => <Text type="danger" strong>{v}</Text>,
                    sorter: (a: any, b: any) => a.lowMetricsCount - b.lowMetricsCount },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24}>
          <Card title="Тепловая карта: ИС × характеристики качества"
            styles={{ body: { paddingTop: 12 } }}>
            {loading ? <Skeleton active paragraph={{ rows: 8 }} />
              : !data || !data.heatmapData.length
                ? <Text type="secondary">Нет данных для тепловой карты.</Text>
                : (
                  <>
                    <LevelHeatmap xLabels={data.xAxisLabels} yLabels={data.yAxisLabels} matrix={matrix} />
                    <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
                      {LEVEL_ORDER.map((lvl) => (
                        <span key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5B6675' }}>
                          <span style={{ width: 11, height: 11, borderRadius: 3, background: LEVEL_COLORS[lvl], display: 'inline-block' }} />
                          {lvl}
                        </span>
                      ))}
                    </div>
                  </>
                )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!detail}
        title={detail ? DETAIL_TITLE[detail] : ''}
        onCancel={() => setDetail(null)}
        footer={null}
        width={620}
      >
        {renderDetail()}
      </Modal>
    </div>
  );
};

export default DashboardPage;
