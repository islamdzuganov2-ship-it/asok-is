/**
 * DashboardPage.tsx — дашборд АСОК ИС.
 * Подключён к GET /api/v1/assessments/dashboard.
 * ECharts: Donut (распределение уровней) + Heatmap (ИС × характеристики).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Card, Col, Row, Skeleton, Statistic, Table, Tag, Typography, Alert,
} from 'antd';
import * as echarts from 'echarts';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

const LEVEL_COLORS: Record<string, string> = {
  'Высокий уровень':        '#52c41a',
  'Уровень выше среднего':  '#73d13d',
  'Средний уровень':        '#faad14',
  'Уровень ниже среднего':  '#fa8c16',
  'Низкий уровень':         '#f5222d',
  'Невозможно измерить':    '#d9d9d9',
};

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

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const donutRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const donutChart = useRef<echarts.ECharts | null>(null);
  const heatmapChart = useRef<echarts.ECharts | null>(null);
  const navigate = useNavigate();

  // Загрузка данных дашборда
  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('asok_access_token');
        const resp = await fetch(`${VITE_API}/assessments/dashboard`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.status === 401) {
          navigate('/login');
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: DashboardData = await resp.json();
        setData(json);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [navigate]);

  // Donut Chart
  useEffect(() => {
    if (!data || !donutRef.current) return;
    if (!donutChart.current) {
      donutChart.current = echarts.init(donutRef.current);
    }
    const seriesData = Object.entries(data.levelCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        name,
        value,
        itemStyle: { color: LEVEL_COLORS[name] ?? '#d9d9d9' },
      }));

    donutChart.current.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', left: 'left', textStyle: { fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['42%', '70%'],
        data: seriesData,
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      }],
    });

    const onResize = () => donutChart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [data]);

  // Heatmap Chart
  useEffect(() => {
    if (!data || !heatmapRef.current || !data.heatmapData.length) return;
    if (!heatmapChart.current) {
      heatmapChart.current = echarts.init(heatmapRef.current);
    }
    const levelNames = ['Невозможно измерить', 'Низкий', 'Ниже среднего', 'Средний', 'Выше среднего', 'Высокий'];

    heatmapChart.current.setOption({
      tooltip: {
        position: 'top',
        formatter: (p: any) =>
          `${data.yAxisLabels[p.value[1]] ?? ''}<br/>${data.xAxisLabels[p.value[0]] ?? ''}<br/><b>${levelNames[p.value[2]] ?? '—'}</b>`,
      },
      grid: { top: 10, bottom: 60, left: 160, right: 20 },
      xAxis: {
        type: 'category',
        data: data.xAxisLabels,
        axisLabel: { rotate: 35, fontSize: 10, interval: 0 },
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: data.yAxisLabels,
        axisLabel: { fontSize: 11 },
        splitArea: { show: true },
      },
      visualMap: {
        min: 0, max: 5,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#f5222d', '#fa8c16', '#faad14', '#73d13d', '#52c41a', '#135200'] },
        text: ['Высокий', 'Низкий'],
        textStyle: { fontSize: 11 },
      },
      series: [{
        type: 'heatmap',
        data: data.heatmapData,
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 8 } },
      }],
    });

    const onResize = () => heatmapChart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [data]);

  // Очистка charts при unmount
  useEffect(() => {
    return () => {
      donutChart.current?.dispose();
      heatmapChart.current?.dispose();
    };
  }, []);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Ошибка загрузки дашборда"
        description={`${error}. Проверьте подключение к backend.`}
        style={{ margin: 24 }}
      />
    );
  }

  const healthPct = data ? Math.round(data.globalHealthScore * 100) : 0;
  const healthColor = healthPct >= 81 ? '#52c41a' : healthPct >= 41 ? '#faad14' : '#f5222d';

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 20 }}>Дашборд качества ИС</Title>

      {/* KPI строка */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            {loading ? <Skeleton.Input active /> : (
              <Statistic
                title="Глобальный балл"
                value={healthPct}
                suffix="%"
                valueStyle={{ color: healthColor, fontWeight: 700 }}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            {loading ? <Skeleton.Input active /> : (
              <Statistic title="Всего метрик" value={data?.totalMetrics ?? 0} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            {loading ? <Skeleton.Input active /> : (
              <Statistic title="ИС в мониторинге" value={data?.yAxisLabels.length ?? 0} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            {loading ? <Skeleton.Input active /> : (
              <Statistic
                title="Низких метрик"
                value={data?.problematicSystems.reduce((s, p) => s + p.lowMetricsCount, 0) ?? 0}
                valueStyle={{ color: '#f5222d' }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* Donut */}
        <Col xs={24} lg={10}>
          <Card title="Распределение по уровням качества" style={{ height: 380 }}>
            {loading
              ? <Skeleton active paragraph={{ rows: 6 }} />
              : data?.totalMetrics === 0
                ? <Text type="secondary">Нет данных. Создайте период оценки и введите метрики.</Text>
                : <div ref={donutRef} style={{ height: 310, width: '100%' }} />
            }
          </Card>
        </Col>

        {/* Проблемные ИС */}
        <Col xs={24} lg={14}>
          <Card title="⚠️ Проблемные ИС (наибольшее число низких метрик)" style={{ height: 380 }}>
            {loading ? <Skeleton active /> : (
              <Table
                dataSource={data?.problematicSystems ?? []}
                rowKey="id"
                size="small"
                pagination={false}
                locale={{ emptyText: 'Нет проблемных систем' }}
                columns={[
                  { title: 'ИС', dataIndex: 'name', ellipsis: true },
                  {
                    title: 'Критичность',
                    dataIndex: 'criticality',
                    render: (v: string) => (
                      <Tag color={v === 'MISSION CRITICAL' ? 'red' : v === 'BUSINESS CRITICAL' ? 'orange' : 'default'}>
                        {v}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Низких метрик',
                    dataIndex: 'lowMetricsCount',
                    render: (v: number) => <Text type="danger" strong>{v}</Text>,
                    sorter: (a: any, b: any) => a.lowMetricsCount - b.lowMetricsCount,
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        {/* Heatmap */}
        <Col xs={24}>
          <Card title="Тепловая карта: ИС × Характеристики качества">
            {loading
              ? <Skeleton active paragraph={{ rows: 8 }} />
              : !data?.heatmapData.length
                ? <Text type="secondary">Нет данных для тепловой карты.</Text>
                : <div
                    ref={heatmapRef}
                    style={{ height: Math.max(300, (data?.yAxisLabels.length ?? 1) * 44 + 100), width: '100%' }}
                  />
            }
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;