/**
 * QualityDynamicsPage.tsx — вкладка менеджера по качеству «Динамика качества».
 * Сверху выбор ИС (или «Все системы»). Далее:
 *  0) карточка «Качество информационной системы» — интегральный балл по кварталам
 *     (или все системы на одной диаграмме; клик по линии — переход к системе);
 *  1) график изменения качества по ХАРАКТЕРИСТИКАМ во времени (клик по точке/линии →
 *     причины изменения относительно предыдущих оценок);
 *  2) карточки по каждой ПОДХАРАКТЕРИСТИКЕ с её трендом во времени (клик → причины);
 *  3) ввод причин изменения качества по кварталам (в модалке).
 * Аномальные изменения (|Δ| ≥ ANOMALY_THRESHOLD) подсвечиваются на графиках; во всплывашке —
 * причина от менеджера по качеству, при её отсутствии — предупреждение (и уведомление МК).
 */
import React, { useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Select, Space, Typography, Tag } from 'antd';
import { DatabaseOutlined, FundOutlined, LineChartOutlined, WarningOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import {
  MANAGER_SCALE_SYSTEMS, DYNAMICS, QUARTERS, detectAnomalies, type DynSeries,
} from '../../data/mockScaleData';
import { BRAND, ragToken } from '../../theme/ragPalette';
import Sparkline from '../../components/Sparkline';
import { DynamicsModal } from '../../components/DynamicsModal';
import { reasonKey, selectReasons } from '../../store/slices/dynamicsSlice';

const { Title, Text } = Typography;

const LINE_COLORS = ['#6F9F86', '#C9A14A', '#C06B5A', '#6E89A6', '#9DBE86', '#B98AAD', '#5B6675', '#D49479'];
const ALL_SYSTEMS = '__ALL__';
const ANOMALY_COLOR = '#C06B5A';

const lastValue = (series: number[]) => {
  for (let i = series.length - 1; i >= 0; i -= 1) if (series[i] >= 0) return series[i];
  return -1;
};

// Точки ряда с подсветкой аномалий (крупный красный маркер).
const seriesPoints = (series: number[]) => {
  const anomalies = new Set(detectAnomalies(series));
  return series.map((v, i) => ({
    value: v < 0 ? null : v,
    symbolSize: anomalies.has(i) ? 13 : 7,
    itemStyle: anomalies.has(i)
      ? { color: ANOMALY_COLOR, borderColor: '#fff', borderWidth: 2, shadowBlur: 4, shadowColor: 'rgba(192,107,90,.6)' }
      : undefined,
  }));
};

// Строка всплывашки для точки ряда: значение, Δ, причина аномалии от МК (или предупреждение).
function pointTooltip(
  systemName: string, s: DynSeries, qIdx: number,
  reasons: Record<string, string>,
): string {
  const v = s.series[qIdx];
  if (v == null || v < 0) return `${s.name}: н/д`;
  const prev = qIdx > 0 ? s.series[qIdx - 1] : -1;
  const delta = prev >= 0 ? v - prev : null;
  const deltaStr = delta == null ? '' : ` (${delta > 0 ? '+' : ''}${delta} п.п.)`;
  let line = `${s.name}: <b>${v}%</b>${deltaStr}`;
  if (detectAnomalies(s.series).includes(qIdx)) {
    const reason = reasons[reasonKey(systemName, s.key, QUARTERS[qIdx])];
    line += reason
      ? `<br/><span style="color:#6F9F86">Причина (менеджер по качеству):</span> ${reason}`
      : '<br/><span style="color:#C06B5A"><b>⚠ Аномальное изменение — причина не указана.</b> Менеджер по качеству должен заполнить причину (клик по точке).</span>';
  }
  return line;
}

const QualityDynamicsPage: React.FC = () => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const reasons = useSelector(selectReasons);
  const isLive = dataMode === 'live';
  const [systemId, setSystemId] = useState<string>(MANAGER_SCALE_SYSTEMS[0].id);
  const isAll = systemId === ALL_SYSTEMS;
  const system = useMemo(
    () => MANAGER_SCALE_SYSTEMS.find((s) => s.id === systemId) ?? MANAGER_SCALE_SYSTEMS[0],
    [systemId],
  );
  const dyn = DYNAMICS[system.name];
  const [charFilter, setCharFilter] = useState<string | undefined>();
  const [modalSeries, setModalSeries] = useState<DynSeries | null>(null);

  // 0. Карточка «Качество информационной системы»: одна ИС по кварталам или все ИС разом.
  const systemChartOption = useMemo(() => {
    if (isAll) {
      return {
        tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number) => (v == null ? 'н/д' : `${v}%`) },
        legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
        grid: { top: 16, left: 44, right: 16, bottom: 52 },
        xAxis: { type: 'category', data: QUARTERS, boundaryGap: false },
        yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
        color: LINE_COLORS,
        series: MANAGER_SCALE_SYSTEMS.map((s) => ({
          name: s.name, type: 'line', smooth: true, connectNulls: false,
          triggerLineEvent: true,
          emphasis: { focus: 'series', lineStyle: { width: 4 } },
          lineStyle: { width: 1.5 },
          data: seriesPoints(DYNAMICS[s.name].system.series),
        })),
      };
    }
    const s = dyn.system;
    return {
      tooltip: {
        trigger: 'axis', confine: true,
        formatter: (params: any[]) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `<b>${QUARTERS[p.dataIndex]}</b><br/>${pointTooltip(system.name, s, p.dataIndex, reasons)}`;
        },
      },
      grid: { top: 16, left: 44, right: 16, bottom: 28 },
      xAxis: { type: 'category', data: QUARTERS, boundaryGap: false },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
      series: [{
        name: s.name, type: 'line', smooth: true, connectNulls: false,
        triggerLineEvent: true,
        areaStyle: { opacity: 0.08 },
        lineStyle: { width: 2.5, color: LINE_COLORS[0] },
        itemStyle: { color: LINE_COLORS[0] },
        data: seriesPoints(s.series),
      }],
    };
  }, [isAll, dyn, system.name, reasons]);

  // 1. Динамика по характеристикам (+ причины аномалий во всплывашке).
  const charChartOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis', confine: true,
      formatter: (params: any[]) => {
        const list = Array.isArray(params) ? params : [params];
        const qIdx = list[0]?.dataIndex ?? 0;
        const lines = list.map((p: any) => {
          const s = dyn.chars[p.seriesIndex];
          return s ? pointTooltip(system.name, s, qIdx, reasons) : '';
        });
        return `<b>${QUARTERS[qIdx]}</b><br/>${lines.filter(Boolean).join('<br/>')}`;
      },
    },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    grid: { top: 16, left: 44, right: 16, bottom: 52 },
    xAxis: { type: 'category', data: QUARTERS, boundaryGap: false },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    color: LINE_COLORS,
    series: dyn.chars.map((c) => ({
      name: c.name, type: 'line', smooth: true, connectNulls: false,
      // Кликабельна вся ЛИНИЯ, а не только точки квартала.
      triggerLineEvent: true,
      emphasis: { focus: 'series', lineStyle: { width: 4 } },
      lineStyle: { width: 2 },
      data: seriesPoints(c.series),
    })),
  }), [dyn, system.name, reasons]);

  const subs = charFilter ? dyn.subs.filter((s) => s.char === charFilter) : dyn.subs;

  // Незаполненные причины аномалий по выбранной ИС (система + характеристики).
  const missingReasons = useMemo(() => {
    if (isAll) return 0;
    let n = 0;
    [dyn.system, ...dyn.chars].forEach((s) => {
      detectAnomalies(s.series).forEach((i) => {
        if (!reasons[reasonKey(system.name, s.key, QUARTERS[i])]) n += 1;
      });
    });
    return n;
  }, [isAll, dyn, system.name, reasons]);

  const sysCur = lastValue(dyn.system.series);

  return (
    <div style={{ padding: 24, background: BRAND.canvas, minHeight: '100%' }}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} wrap>
        <Col>
          <Title level={4} style={{ margin: 0, color: BRAND.ink }}>
            <LineChartOutlined /> Динамика качества
          </Title>
          <Text type="secondary">
            {isLive
              ? 'Режим LLM · реальные данные'
              : isAll
                ? 'Интегральное качество всех информационных систем по кварталам.'
                : `Изменение качества во времени по характеристикам и подхарактеристикам ИС «${system.name}».`}
          </Text>
        </Col>
        {!isLive && (
          <Col>
            <Space>
              <Text type="secondary"><DatabaseOutlined /> Система:</Text>
              <Select
                value={systemId}
                onChange={setSystemId}
                style={{ minWidth: 280 }}
                showSearch
                optionFilterProp="label"
                options={[
                  { value: ALL_SYSTEMS, label: '— Все системы на одной диаграмме —' },
                  ...MANAGER_SCALE_SYSTEMS.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </Space>
          </Col>
        )}
      </Row>

      {isLive ? (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="Режим LLM: демо-динамика скрыта"
          description="Динамика строится из истории периодов оценки. Заполните оценки за несколько периодов в разделе «Оценка ИС» — графики по характеристикам и подхарактеристикам появятся здесь по реальным данным."
        />
      ) : (
      <>
      {/* 0. Качество информационной системы по кварталам (интегральный показатель) */}
      <Card
        title={
          <Space>
            <FundOutlined />
            <span style={{ color: BRAND.ink }}>
              Качество информационной системы{isAll ? ' — все системы' : ` — «${system.name}»`}
            </span>
            {!isAll && sysCur >= 0 && (
              <Tag style={{ color: '#fff', border: 'none', background: ragToken(sysCur).color }}>{sysCur}%</Tag>
            )}
          </Space>
        }
        style={{ marginTop: 16, borderColor: BRAND.divider }}
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isAll ? 'клик по линии — перейти к системе' : 'клик по точке — причины изменения по кварталам'}
          </Text>
        }
      >
        {!isAll && missingReasons > 0 && (
          <Alert
            style={{ marginBottom: 12 }}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`Аномальные изменения без причины: ${missingReasons}`}
            description="На графиках подсвечены точки аномального роста/просадки. Кликните по точке и заполните причину изменения — уведомление в колокольчике не исчезнет, пока причины не заполнены."
          />
        )}
        <ReactECharts
          option={systemChartOption}
          notMerge
          style={{ height: isAll ? 420 : 260, width: '100%' }}
          onEvents={{
            click: (p: any) => {
              if (p.componentType !== 'series') return;
              if (isAll) {
                const target = MANAGER_SCALE_SYSTEMS.find((s) => s.name === p.seriesName);
                if (target) setSystemId(target.id);
              } else {
                setModalSeries(dyn.system);
              }
            },
          }}
        />
      </Card>

      {!isAll && (
      <>
      {/* 1. Динамика по характеристикам */}
      <Card
        title={<span style={{ color: BRAND.ink }}>Качество по характеристикам во времени</span>}
        style={{ marginTop: 16, borderColor: BRAND.divider }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>клик по линии или точке — причины изменения</Text>}
      >
        <ReactECharts
          option={charChartOption}
          notMerge
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
      </>
      )}
      </>
      )}

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
