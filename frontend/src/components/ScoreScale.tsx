/**
 * ScoreScale.tsx — «как читать цифру» рядом с интегральным баллом (ТЗ v19 п.1, УК-03).
 *
 * Цветовая полоса с порогами (те же 21/41/61/81, что у уровня метрики), отметка цифры и цели,
 * уровень словами и дельта к прошлому периоду. Дельта считается бэкендом по ОДНИМ И ТЕМ ЖЕ ИС
 * (у которых есть прошлый период) — поэтому рядом всегда подпись «по N из M ИС»: новая система
 * в портфеле не должна выглядеть как рост или падение.
 */
import React from 'react';
import { Space, Tooltip, Typography } from 'antd';
import { ragToken, BRAND } from '../theme/ragPalette';
import { TYPE } from '../theme/premium';

const { Text } = Typography;

export interface ScoreScaleData {
  score: number | null;
  level: string;
  bands: { from: number; to: number; label: string }[];
  target: number | null;
  gapToTarget: number | null;
  previous: number | null;
  comparableCurrent: number | null;
  delta: number | null;
  comparedSystems: number;
  totalSystems: number;
}

export const DEFAULT_BANDS: ScoreScaleData['bands'] = [
  { from: 0, to: 21, label: 'Низкий уровень' },
  { from: 21, to: 41, label: 'Ниже среднего' },
  { from: 41, to: 61, label: 'Средний уровень' },
  { from: 61, to: 81, label: 'Выше среднего' },
  { from: 81, to: 100, label: 'Высокий уровень' },
];

/** Уровень словами — та же шкала, что на бэкенде (quality.scoring.reading_level). */
export const levelOf = (score: number | null | undefined, bands = DEFAULT_BANDS): string => {
  if (score == null) return 'Нет данных';
  return [...bands].reverse().find((b) => score >= b.from)?.label ?? bands[0].label;
};

/** Шкала без данных бэкенда (демо-режим): уровень и цель по умолчанию, без дельты. */
export const localScale = (score: number): ScoreScaleData => ({
  score, level: levelOf(score), bands: DEFAULT_BANDS, target: 81, gapToTarget: Math.round((score - 81) * 10) / 10,
  previous: null, comparableCurrent: null, delta: null, comparedSystems: 0, totalSystems: 0,
});

export const deltaText = (s: ScoreScaleData): string | null => {
  if (s.delta == null) return null;
  const sign = s.delta > 0 ? '+' : '';
  return `${sign}${s.delta.toFixed(1)} п.п. к прошлому периоду (по ${s.comparedSystems} из ${s.totalSystems} ИС)`;
};

/** `hideLevel` — когда уровень словами уже стоит рядом с цифрой (заголовок карточки индекса). */
export const ScoreScale: React.FC<{ data: ScoreScaleData; hideLevel?: boolean }> = ({ data, hideLevel }) => {
  const pos = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  const delta = deltaText(data);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: 'relative', height: 10, display: 'flex', borderRadius: 5, overflow: 'visible' }}>
        {data.bands.map((b) => (
          <Tooltip key={b.label} title={`${b.label}: ${b.from}–${b.to}%`}>
            <div style={{ width: `${b.to - b.from}%`, background: ragToken((b.from + b.to) / 2).color, opacity: 0.55 }} />
          </Tooltip>
        ))}
        {data.target != null && (
          <Tooltip title={`Цель: ${data.target}%`}>
            <div aria-label="цель" style={{ position: 'absolute', left: pos(data.target), top: -4, width: 2, height: 18, background: BRAND.ink }} />
          </Tooltip>
        )}
        {data.score != null && (
          <div aria-label="текущее значение" style={{
            position: 'absolute', left: `calc(${pos(data.score)} - 6px)`, top: -3, width: 12, height: 16,
            borderRadius: 3, background: ragToken(data.score).strong, border: `2px solid ${BRAND.surface}`,
          }} />
        )}
      </div>
      <Space size={12} wrap style={{ marginTop: 6 }}>
        {!hideLevel && <Text strong style={{ color: data.score != null ? ragToken(data.score).strong : undefined }}>{data.level}</Text>}
        {delta && (
          <Text type="secondary" style={TYPE.caption}>{delta}</Text>
        )}
        {data.gapToTarget != null && data.target != null && (
          <Text type="secondary" style={TYPE.caption}>
            {data.gapToTarget >= 0 ? `цель ${data.target}% достигнута` : `до цели ${data.target}%: ${Math.abs(data.gapToTarget).toFixed(1)} п.п.`}
          </Text>
        )}
      </Space>
    </div>
  );
};

export default ScoreScale;
