/**
 * TileThumbnail.tsx — миниатюрное превью плитки кокпита в каталоге карточек (CardPicker).
 *
 * Схематичная копия того, что реально рисует TileCard: рамка цветом тона, короткая жирная
 * полоса («крупная цифра»), опционально — ломаная (если у плитки есть `trend`) и стрелка
 * (если есть `delta`). Статический дескриптор на карточку, не завязан на живые данные —
 * задача превью показать ФОРМУ карточки, а не актуальное значение.
 */
import React from 'react';
import { RAG } from '../../theme/ragPalette';
import type { Tone } from './types';

const TONE_COLOR: Record<Tone, string> = {
  critical: RAG.bad.color,
  low: RAG.bad.color,
  medium: RAG.medium.color,
  high: RAG.good.color,
  neutral: RAG.muted.color,
};

export interface TileThumbnailProps {
  tone: Tone;
  hasTrend?: boolean;
  hasDelta?: boolean;
}

export const TileThumbnail: React.FC<TileThumbnailProps> = ({ tone, hasTrend, hasDelta }) => {
  const color = TONE_COLOR[tone];
  const w = 36, h = 26;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={4} fill="none" stroke={color} strokeWidth={1.5} />
      {/* «крупная цифра» */}
      <rect x={4} y={6} width={14} height={5} rx={1.5} fill={color} />
      {hasDelta && (
        <path d={`M ${w - 10} 6 L ${w - 6} 11 L ${w - 14} 11 Z`} fill={color} />
      )}
      {hasTrend && (
        <polyline
          points={`4,${h - 5} 12,${h - 9} 18,${h - 6} 26,${h - 11} 32,${h - 7}`}
          fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round"
        />
      )}
    </svg>
  );
};

export default TileThumbnail;
