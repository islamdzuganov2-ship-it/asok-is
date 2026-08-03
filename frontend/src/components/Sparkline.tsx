/**
 * Sparkline.tsx — лёгкий SVG-график тренда (без ECharts) для карточек подхарактеристик.
 * Пропуски (значение -1 = «невозможно измерить») не рисуются. Цвет — по тренду.
 */
import React from 'react';
import { BRAND, RAG } from '../theme/ragPalette';
import { TYPE } from '../theme/premium';

interface Props { series: number[]; width?: number; height?: number }

const Sparkline: React.FC<Props> = ({ series, width = 132, height = 38 }) => {
  const valid = series.map((v, i) => ({ v, i })).filter((p) => p.v >= 0);
  if (valid.length < 2) {
    return <span style={{ ...TYPE.micro, color: BRAND.inkSoft }}>нет данных</span>;
  }
  const n = series.length;
  const x = (i: number) => (i / (n - 1)) * (width - 6) + 3;
  const y = (v: number) => height - 3 - (v / 100) * (height - 6);
  const pts = valid.map((p) => `${x(p.i)},${y(p.v)}`).join(' ');
  const first = valid[0].v;
  const last = valid[valid.length - 1].v;
  // Линия тренда — графика: держим ≥3:1 с белым (у прежнего золота #C9A14A было 2.42:1).
  const color = last > first ? RAG.good.color : last < first ? RAG.bad.color : RAG.medium.color;
  return (
    <svg width={width} height={height} role="img" aria-label="тренд качества">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {valid.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={1.8} fill={color} />)}
    </svg>
  );
};

export default Sparkline;
