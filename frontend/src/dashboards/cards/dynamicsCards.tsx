/**
 * dynamicsCards.tsx — карточки «Динамики качества».
 *
 * Демо-динамика строится на моках; в режиме LLM её честно нет (истории периодов в БД может не
 * быть вовсе). На странице это решалось одним Alert вместо всего содержимого — в сетке каждая
 * карточка сообщает об этом сама, иначе на дашборде остались бы три пустые рамки без объяснения.
 */
import React, { useMemo } from 'react';
import { Alert, Button, Card, Select, Space, Tag, Typography } from 'antd';
import { EyeOutlined, FundOutlined } from '@ant-design/icons';
import { MANAGER_SCALE_SYSTEMS, DYNAMICS, QUARTERS, detectAnomalies } from '../../data/mockScaleData';
import { BRAND, ragToken, solidTagStyle, ACCENT } from '../../theme/ragPalette';
import { GOLD, TYPE, SPACE } from '../../theme/premium';
import { useChartBase } from '../../theme/useThemeTokens';
import Sparkline from '../../components/Sparkline';
import {
  useDynamicsScope, LINE_COLORS, SYSTEMS_BY_VOLATILITY, TODAY_QUARTER_IDX,
  todayMarkLine, seriesPoints, pointTooltip, lastValue,
} from '../scopes/DynamicsScope';
import GridCard from '../GridCard';
import AutoChart from '../AutoChart';

const { Text } = Typography;

const LIVE_NOTE = (
  <Alert
    type="info"
    showIcon
    message="Режим LLM: демо-динамика скрыта"
    description="Динамика строится из истории периодов оценки. Заполните оценки за несколько периодов в разделе «Внесение данных» — графики появятся здесь по реальным данным."
  />
);

// ─────────────────── Качество ИС по кварталам ───────────────────

export const DynamicsSystemCard: React.FC = () => {
  const { isLive, isAll, dyn, system, reasons, setSystemId, openSeries } = useDynamicsScope();
  const cbase = useChartBase();
  const sysCur = lastValue(dyn.system.series);

  const option = useMemo(() => {
    if (isAll) {
      return {
        tooltip: {
          trigger: 'axis', confine: true,
          formatter: (params: any[]) => {
            const list = Array.isArray(params) ? params : [params];
            const qIdx = list[0]?.dataIndex ?? 0;
            const lines = list.map((p: any) => {
              const ser = DYNAMICS[p.seriesName]?.system;
              return ser && detectAnomalies(ser.series).includes(qIdx)
                ? pointTooltip(p.seriesName, ser, qIdx, reasons) : '';
            }).filter(Boolean);
            return lines.length ? `<b>${QUARTERS[qIdx]}</b><br/>${lines.join('<br/>')}` : '';
          },
        },
        textStyle: cbase.textStyle,
        legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: TYPE.micro.fontSize, color: cbase.axisLabel.color } },
        grid: { top: 16, left: 44, right: 16, bottom: 52 },
        xAxis: { type: 'category', data: QUARTERS, boundaryGap: false, axisLabel: cbase.axisLabel, axisLine: cbase.axisLine },
        yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: cbase.axisLabel.color }, splitLine: cbase.splitLine },
        color: LINE_COLORS,
        series: SYSTEMS_BY_VOLATILITY.map((s, i) => ({
          name: s.name, type: 'line', smooth: true, connectNulls: false,
          triggerLineEvent: true,
          emphasis: { focus: 'series', lineStyle: { width: 4 } },
          lineStyle: { width: 1.5 },
          data: seriesPoints(DYNAMICS[s.name].system.series),
          ...(i === 0 ? { markLine: todayMarkLine() } : {}),
        })),
      };
    }
    const s = dyn.system;
    return {
      tooltip: {
        trigger: 'axis', confine: true,
        formatter: (params: any[]) => {
          const p = Array.isArray(params) ? params[0] : params;
          if (!detectAnomalies(s.series).includes(p.dataIndex)) return '';
          return `<b>${QUARTERS[p.dataIndex]}</b><br/>${pointTooltip(system.name, s, p.dataIndex, reasons)}`;
        },
      },
      textStyle: cbase.textStyle,
      grid: { top: 16, left: 44, right: 16, bottom: 28 },
      xAxis: { type: 'category', data: QUARTERS, boundaryGap: false, axisLabel: cbase.axisLabel, axisLine: cbase.axisLine },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: cbase.axisLabel.color }, splitLine: cbase.splitLine },
      series: [{
        name: s.name, type: 'line', smooth: true, connectNulls: false,
        triggerLineEvent: true,
        areaStyle: { opacity: 0.08 },
        lineStyle: { width: 2.5, color: LINE_COLORS[0] },
        itemStyle: { color: LINE_COLORS[0] },
        data: seriesPoints(s.series),
        markLine: todayMarkLine(),
      }],
    };
  }, [isAll, dyn, system.name, reasons, cbase]);

  return (
    <GridCard
      accent="gold"
      dotColor={GOLD.base}
      title={
        <Space wrap>
          <FundOutlined style={{ color: BRAND.inkSoft }} />
          <span>Качество информационной системы{isAll ? ' — все системы' : ` — «${system.name}»`}</span>
          {!isAll && sysCur >= 0 && <Tag style={solidTagStyle(ragToken(sysCur).strong)}>{sysCur}%</Tag>}
        </Space>
      }
      hint={isAll ? 'клик по линии — перейти к системе' : 'клик по точке — причины изменения'}
    >
      {isLive ? LIVE_NOTE : (
        <div style={{ display: 'flex', height: '100%', minHeight: 220 }}>
          <AutoChart
            option={option}
            notMerge
            minHeight={220}
            onEvents={{
              click: (p: any) => {
                if (p.componentType !== 'series') return;
                if (isAll) {
                  const target = MANAGER_SCALE_SYSTEMS.find((s) => s.name === p.seriesName);
                  if (target) setSystemId(target.id);
                } else {
                  openSeries(dyn.system);
                }
              },
            }}
          />
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Качество по характеристикам во времени ───────────────────

export const DynamicsCharsCard: React.FC = () => {
  const { isLive, isAll, dyn, charDynSelection, setCharDynSelection, shownDynChars, openSeries } = useDynamicsScope();
  const cbase = useChartBase();

  const option = useMemo(() => ({
    // Всплывашка отключена намеренно (по требованию МК): аномалии видны маркерами,
    // причины открываются кликом.
    tooltip: { show: false },
    textStyle: cbase.textStyle,
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: TYPE.micro.fontSize, color: cbase.axisLabel.color } },
    grid: { top: 16, left: 44, right: 16, bottom: 52 },
    xAxis: { type: 'category', data: QUARTERS, boundaryGap: false, axisLabel: cbase.axisLabel, axisLine: cbase.axisLine },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: cbase.axisLabel.color }, splitLine: cbase.splitLine },
    color: LINE_COLORS,
    series: dyn.chars.filter((c) => shownDynChars.includes(c.char)).map((c, i) => ({
      name: c.name, type: 'line', smooth: true, connectNulls: false,
      triggerLineEvent: true,
      emphasis: { focus: 'series', lineStyle: { width: 4 } },
      lineStyle: { width: 2 },
      data: seriesPoints(c.series),
      ...(i === 0 ? { markLine: todayMarkLine() } : {}),
    })),
  }), [dyn, cbase, shownDynChars]);

  return (
    <GridCard
      accent="slate"
      dotColor={ACCENT.slate.color}
      title="Качество по характеристикам во времени"
      hint={charDynSelection.length === 0 ? '(по умолчанию — топ-2 по колебаниям с учётом веса ГОСТ 25010)' : undefined}
      extra={!isLive && !isAll ? (
        <Space size={8} wrap>
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="Топ-2 по колебаниям (по умолчанию)"
            style={{ minWidth: 200 }}
            value={charDynSelection}
            onChange={setCharDynSelection}
            options={dyn.chars.map((c) => ({ value: c.char, label: c.name }))}
          />
          <Button size="small" onClick={() => setCharDynSelection(dyn.chars.map((c) => c.char))}>Показать все</Button>
        </Space>
      ) : undefined}
    >
      {isLive ? LIVE_NOTE : isAll ? (
        <Text type="secondary">Выберите конкретную ИС — разрез по характеристикам считается по одной системе.</Text>
      ) : (
        <div style={{ display: 'flex', height: '100%', minHeight: 240 }}>
          <AutoChart
            option={option}
            notMerge
            minHeight={240}
            onEvents={{
              click: (p: any) => {
                if (p.componentType !== 'series') return;
                // Серии отфильтрованы — ищем по имени, индекс серии больше не совпадает с dyn.chars.
                const target = dyn.chars.find((c) => c.name === p.seriesName);
                if (target) openSeries(target);
              },
            }}
          />
        </div>
      )}
    </GridCard>
  );
};

// ─────────────────── Качество по подхарактеристикам ───────────────────

export const DynamicsSubsCard: React.FC = () => {
  const { isLive, isAll, dyn, charFilter, setCharFilter, openSeries } = useDynamicsScope();
  const subs = charFilter ? dyn.subs.filter((s) => s.char === charFilter) : dyn.subs;
  const charName = charFilter ? dyn.chars.find((c) => c.char === charFilter)?.name : undefined;

  return (
    <GridCard
      accent="sage"
      title={
        <Space wrap>
          <span>Качество по подхарактеристикам во времени</span>
          <Text type="secondary" style={{ fontWeight: 400 }}>({subs.length})</Text>
          {charName && <Tag color="blue">{charName}</Tag>}
        </Space>
      }
      extra={!isLive && !isAll ? (
        <Select
          allowClear
          placeholder="Все характеристики"
          style={{ width: 200 }}
          value={charFilter}
          onChange={setCharFilter}
          suffixIcon={<EyeOutlined />}
          options={dyn.chars.map((c) => ({ value: c.char, label: c.name }))}
        />
      ) : undefined}
    >
      {isLive ? LIVE_NOTE : isAll ? (
        <Text type="secondary">Выберите конкретную ИС — подхарактеристики считаются по одной системе.</Text>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: SPACE.cozy }}>
          {subs.map((s) => {
            const cur = lastValue(s.series);
            return (
              <Card
                key={s.key + s.char}
                size="small" hoverable onClick={() => openSeries(s)}
                style={{ borderColor: BRAND.divider, height: '100%', borderRadius: 12 }}
                styles={{ body: { padding: 12 } }}
              >
                <Text style={{ ...TYPE.captionStrong, display: 'block', minHeight: 32 }}>{s.name}</Text>
                <Space style={{ justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
                  <Tag style={{ ...solidTagStyle(ragToken(cur).strong), marginInlineEnd: 0 }}>
                    {cur < 0 ? 'н/д' : `${cur}%`}
                  </Tag>
                  <Text type="secondary" style={TYPE.micro}>{s.char}</Text>
                </Space>
                <div style={{ marginTop: SPACE.snug }}><Sparkline series={s.series} todayIndex={TODAY_QUARTER_IDX} /></div>
              </Card>
            );
          })}
        </div>
      )}
    </GridCard>
  );
};
