/**
 * QualityDynamicsPage.tsx — вкладка менеджера по качеству «Динамика качества».
 * Сверху выбор ИС. Далее:
 *  1) график изменения качества по ХАРАКТЕРИСТИКАМ во времени (клик по точке/линии →
 *     причины изменения относительно предыдущих оценок);
 *  2) карточки по каждой ПОДХАРАКТЕРИСТИКЕ с её трендом во времени (клик → причины);
 *  3) ввод причин изменения качества по кварталам (в модалке).
 */
import React, { useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Typography, Tag } from 'antd';
import { DatabaseOutlined, LineChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { MANAGER_SCALE_SYSTEMS } from '../../data/mockScaleData';
import { DYNAMICS, QUARTERS, type DynSeries } from '../../data/mockScaleData';
import { BRAND, ragToken } from '../../theme/ragPalette';
import Sparkline from '../../components/Sparkline';
import { DynamicsModal } from '../../components/DynamicsModal';

const { Title, Text } = Typography;

const LINE_COLORS = ['#6F9F86', '#C9A14A', '#C06B5A', '#6E89A6', '#9DBE86', '#B98AAD', '#5B6675', '#D49479'];

const lastValue = (series: number[]) => {
  for (let i = series.length - 1; i >= 0; i -= 1) if (series[i] >= 0) return series[i];
  return -1;
};

const QualityDynamicsPage: React.FC = () => {
  const [systemId, setSystemId] = useState(MANAGER_SCALE_SYSTEMS[0].id);
  const system = useMemo(
    () => MANAGER_SCALE_SYSTEMS.find((s) => s.id === systemId) ?? MANAGER_SCALE_SYSTEMS[0],
    [systemId],
  );
  const dyn = DYNAMICS[system.name];
  const [charFilter, setCharFilter] = useState<string | undefined>();
  const [modalSeries, setModalSeries] = useState<DynSeries | null>(null);

  const charChartOption = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => (v == null ? 'н/д' : `${v}%`) },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    grid: { top: 16, left: 44, right: 16, bottom: 52 },
    xAxis: { type: 'category', data: QUARTERS, boundaryGap: false },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    color: LINE_COLORS,
    series: dyn.chars.map((c) => ({
      name: c.name, type: 'line', smooth: true, symbolSize: 7, connectNulls: false,
      data: c.series.map((v) => (v < 0 ? null : v)),
    })),
  }), [dyn]);

  const subs = charFilter ? dyn.subs.filter((s) => s.char === charFilter) : dyn.subs;

  return (
    <div style={{ padding: 24, background: BRAND.canvas, minHeight: '100%' }}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={{ margin: 0, color: BRAND.ink }}>
            <LineChartOutlined /> Динамика качества
          </Title>
          <Text type="secondary">Изменение качества во времени по характеристикам и подхарактеристикам ИС «{system.name}».</Text>
        </Col>
        <Col>
          <Space>
            <Text type="secondary"><DatabaseOutlined /> Система:</Text>
            <Select
              value={systemId}
              onChange={setSystemId}
              style={{ minWidth: 280 }}
              showSearch
              optionFilterProp="label"
              options={MANAGER_SCALE_SYSTEMS.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Space>
        </Col>
      </Row>

      {/* 1. Динамика по характеристикам */}
      <Card
        title={<span style={{ color: BRAND.ink }}>Качество по характеристикам во времени</span>}
        style={{ marginTop: 16, borderColor: BRAND.divider }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>клик по точке — причины изменения</Text>}
      >
        <ReactECharts
          option={charChartOption}
          style={{ height: 340, width: '100%' }}
          onEvents={{
            click: (p: any) => {
              if (p.componentType === 'series' && dyn.chars[p.seriesIndex]) {
                setModalSeries(dyn.chars[p.seriesIndex]);
              }
            },
          }}
        />
      </Card>

      {/* 2. Динамика по подхарактеристикам */}
      <Card
        title={<span style={{ color: BRAND.ink }}>Качество по подхарактеристикам во времени ({subs.length})</span>}
        style={{ marginTop: 16, borderColor: BRAND.divider }}
        extra={
          <Select
            allowClear
            placeholder="Все характеристики"
            style={{ width: 240 }}
            value={charFilter}
            onChange={setCharFilter}
            options={dyn.chars.map((c) => ({ value: c.char, label: c.name }))}
          />
        }
      >
        <Row gutter={[12, 12]}>
          {subs.map((s) => {
            const cur = lastValue(s.series);
            return (
              <Col xs={24} sm={12} md={8} lg={6} key={s.key + s.char}>
                <Card
                  size="small" hoverable onClick={() => setModalSeries(s)}
                  style={{ borderColor: BRAND.divider, height: '100%' }}
                  styles={{ body: { padding: 12 } }}
                >
                  <Text strong style={{ fontSize: 12, display: 'block', minHeight: 32 }}>{s.name}</Text>
                  <Space style={{ justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
                    <Tag style={{ marginInlineEnd: 0, color: '#fff', border: 'none', background: cur < 0 ? '#9AA0A6' : ragToken(cur).color }}>
                      {cur < 0 ? 'н/д' : `${cur}%`}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 10 }}>{s.char}</Text>
                  </Space>
                  <div style={{ marginTop: 6 }}><Sparkline series={s.series} /></div>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      <DynamicsModal
        open={!!modalSeries}
        system={system.name}
        series={modalSeries}
        onClose={() => setModalSeries(null)}
      />
    </div>
  );
};

export default QualityDynamicsPage;
