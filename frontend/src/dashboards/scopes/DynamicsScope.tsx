/**
 * DynamicsScope.tsx — общее состояние карточек «Динамики качества».
 *
 * Выбор ИС определяет всё: интегральный тренд, набор характеристик, набор подхарактеристик.
 * Фильтр по характеристике связывает вторую карточку с третьей (T-22), а модалка причин
 * изменения открывается из любой из трёх — поэтому и выбор, и модалка живут здесь.
 *
 * Расчёты перенесены как есть: волатильность (ТЗ v20 п.6), топ-2 характеристики по
 * произведению волатильности и веса ГОСТ 25010 (п.6.2), маркеры аномалий, линия «сегодня».
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Select, Space, Typography } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import {
  MANAGER_SCALE_SYSTEMS, DYNAMICS, QUARTERS, detectAnomalies, type DynSeries,
} from '../../data/mockScaleData';
import { RAG, ACCENT } from '../../theme/ragPalette';
import { TYPE } from '../../theme/premium';
import { DynamicsModal } from '../../components/DynamicsModal';
import { reasonKey, selectReasons } from '../../store/slices/dynamicsSlice';
import { useCharacteristicWeights } from '../../hooks/useCharacteristicWeights';

const { Text } = Typography;

/** Категориальные цвета линий — литералы: ECharts рисует на canvas и var() не понимает. */
export const LINE_COLORS = [RAG.good.color, RAG.medium.color, RAG.bad.color, ACCENT.slate.color, '#9DBE86', '#B98AAD', '#5B6675', '#D49479'];
export const ALL_SYSTEMS = '__ALL__';
const ANOMALY_COLOR = RAG.bad.color;

const CURRENT_QUARTER = (() => {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1}-${now.getFullYear()}`;
})();
const TODAY_QUARTER_FOUND = QUARTERS.indexOf(CURRENT_QUARTER) >= 0;
/** Общий индекс «сегодня» — и для markLine графиков, и для Sparkline мини-карточек. */
export const TODAY_QUARTER_IDX = TODAY_QUARTER_FOUND ? QUARTERS.indexOf(CURRENT_QUARTER) : QUARTERS.length - 1;

export function todayMarkLine() {
  const idx = TODAY_QUARTER_IDX;
  const found = TODAY_QUARTER_FOUND ? idx : -1;
  return {
    symbol: 'none' as const,
    silent: true,
    animation: false,
    z: 10,
    lineStyle: { color: RAG.bad.strong, type: 'dashed' as const, width: 2 },
    label: {
      formatter: found >= 0 ? 'сегодня' : 'сегодня →',
      position: 'insideEndTop' as const, color: RAG.bad.strong, fontSize: TYPE.micro.fontSize, fontWeight: 600,
    },
    data: [{ xAxis: idx }],
  };
}

export const lastValue = (series: number[]) => {
  for (let i = series.length - 1; i >= 0; i -= 1) if (series[i] >= 0) return series[i];
  return -1;
};

/** Разброс max-min по измеренным точкам — «сила колебаний», не уровень (ТЗ v20 п.6). */
const volatility = (series: number[]) => {
  const vals = series.filter((v) => v >= 0);
  return vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0;
};

export const SYSTEMS_BY_VOLATILITY = [...MANAGER_SCALE_SYSTEMS].sort(
  (a, b) => volatility(DYNAMICS[b.name].system.series) - volatility(DYNAMICS[a.name].system.series),
);

/** Точки ряда с подсветкой аномалий (крупный красный маркер). */
export const seriesPoints = (series: number[]) => {
  const anomalies = new Set(detectAnomalies(series));
  return series.map((v, i) => ({
    value: v < 0 ? null : v,
    symbolSize: anomalies.has(i) ? 13 : 7,
    itemStyle: anomalies.has(i)
      ? { color: ANOMALY_COLOR, borderColor: '#fff', borderWidth: 2, shadowBlur: 4, shadowColor: 'rgba(192,107,90,.6)' }
      : undefined,
  }));
};

/** Строка всплывашки: значение, Δ, причина аномалии от МК (или предупреждение). */
export function pointTooltip(
  systemName: string, s: DynSeries, qIdx: number, reasons: Record<string, string>,
): string {
  const v = s.series[qIdx];
  if (v == null || v < 0) return `${s.name}: н/д`;
  const prev = qIdx > 0 ? s.series[qIdx - 1] : -1;
  const delta = prev >= 0 ? v - prev : null;
  const deltaStr = delta == null ? '' : ` (${delta > 0 ? '+' : ''}${delta} п.п.)`;
  let line = `${s.name}: <b style="font-variant-numeric:tabular-nums">${v}%</b>${deltaStr}`;
  if (detectAnomalies(s.series).includes(qIdx)) {
    const reason = reasons[reasonKey(systemName, s.key, QUARTERS[qIdx])];
    line += reason
      ? `<br/><span style="color:${RAG.good.strong}">Причина (менеджер по качеству):</span> ${reason}`
      : `<br/><span style="color:${RAG.bad.strong}"><b>⚠ Аномальное изменение — причина не указана.</b> Менеджер по качеству должен заполнить причину (клик по точке).</span>`;
  }
  return line;
}

type Dyn = (typeof DYNAMICS)[string];

interface DynamicsScopeValue {
  isLive: boolean;
  isAll: boolean;
  systemId: string;
  setSystemId: (id: string) => void;
  system: (typeof MANAGER_SCALE_SYSTEMS)[number];
  dyn: Dyn;
  reasons: Record<string, string>;
  charFilter?: string;
  setCharFilter: (v?: string) => void;
  charDynSelection: string[];
  setCharDynSelection: (v: string[]) => void;
  shownDynChars: string[];
  openSeries: (s: DynSeries) => void;
}

const Ctx = createContext<DynamicsScopeValue | null>(null);

export function useDynamicsScope(): DynamicsScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка «Динамики качества» отрисована вне DynamicsScope');
  return v;
}

export const DynamicsScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const reasons = useSelector(selectReasons);
  const isLive = dataMode === 'live';
  // ТЗ v20 п.6.1: по умолчанию — ИС с самыми сильными колебаниями, а не первая в списке.
  const [systemId, setSystemId] = useState<string>(SYSTEMS_BY_VOLATILITY[0].id);
  const isAll = systemId === ALL_SYSTEMS;
  const system = useMemo(
    () => MANAGER_SCALE_SYSTEMS.find((s) => s.id === systemId) ?? MANAGER_SCALE_SYSTEMS[0],
    [systemId],
  );
  const dyn = DYNAMICS[system.name];
  const { weights: charWeights } = useCharacteristicWeights();
  const [charFilter, setCharFilter] = useState<string | undefined>();
  const [modalSeries, setModalSeries] = useState<DynSeries | null>(null);
  const [charDynSelection, setCharDynSelection] = useState<string[]>([]);

  const defaultDynChars = useMemo(
    () => [...dyn.chars]
      .sort((a, b) => (volatility(b.series) * (charWeights[b.name] ?? 0)) - (volatility(a.series) * (charWeights[a.name] ?? 0)))
      .slice(0, 2)
      .map((c) => c.char),
    [dyn, charWeights],
  );
  const shownDynChars = charDynSelection.length > 0 ? charDynSelection : defaultDynChars;

  const value: DynamicsScopeValue = {
    isLive, isAll, systemId, setSystemId, system, dyn, reasons,
    charFilter, setCharFilter, charDynSelection, setCharDynSelection, shownDynChars,
    openSeries: setModalSeries,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <DynamicsModal
        open={!!modalSeries}
        system={system.name}
        series={modalSeries}
        onClose={() => setModalSeries(null)}
      />
    </Ctx.Provider>
  );
};

export const DynamicsScopeToolbar: React.FC = () => {
  const v = useContext(Ctx);
  // В LLM-режиме демо-динамика скрыта целиком — выбирать нечего.
  if (!v || v.isLive) return null;
  return (
    <Space wrap size={12}>
      <Text type="secondary"><DatabaseOutlined /> Система (динамика):</Text>
      <Select
        value={v.systemId}
        onChange={v.setSystemId}
        style={{ width: 280, maxWidth: '100%' }}
        showSearch
        optionFilterProp="label"
        options={[
          { value: ALL_SYSTEMS, label: '— Все системы на одной диаграмме —' },
          ...MANAGER_SCALE_SYSTEMS.map((s) => ({ value: s.id, label: s.name })),
        ]}
      />
    </Space>
  );
};
