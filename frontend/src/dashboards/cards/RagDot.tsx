/**
 * RagDot.tsx — точка RAG-индикации для теплокарт управленческого дашборда.
 *
 * `titleIsComplete` — денежный режим теплокарты (УК-11) передаёт готовый заголовок с реальными
 * деньгами, а `score` там — только внутренняя интенсивность цвета (0..100, нормировано к
 * максимуму грида), не показатель для пользователя. Поэтому обычный суффикс «: score%»,
 * уместный для баллов ГОСТ 25010, в этом режиме не добавляется.
 */
import React from 'react';
import { ragToken } from '../../theme/ragPalette';

interface RagDotProps {
  score: number;
  size?: number;
  label?: string;
  titleIsComplete?: boolean;
}

export const RagDot: React.FC<RagDotProps> = ({ score, size = 14, label, titleIsComplete }) => (
  <span
    title={titleIsComplete ? (label ?? '') : `${label ? label + ': ' : ''}${score < 0 ? 'н/д' : score + '%'}`}
    style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: ragToken(score).color, boxShadow: `0 0 0 3px ${ragToken(score).soft}`,
    }}
  />
);

export default RagDot;
