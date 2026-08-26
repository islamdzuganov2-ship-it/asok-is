/**
 * GridCard.tsx — карточка внутри сетки конструктора.
 *
 * Отличие от обычной `<Card {...premiumCard()}>`: в сетке высота задана ЯЧЕЙКОЙ, а не контентом.
 * Значит, карточка обязана (а) занимать 100% высоты ячейки и (б) скроллить содержимое внутри
 * себя. Иначе таблица на 30 строк либо вылезает поверх соседей, либо режется без возможности
 * досмотреть — обе беды видны сразу, стоит уменьшить карточку мышью.
 *
 * Акцент, шапка и радиусы берутся у premiumCard — премиум-слой (T-21…T-31) не переопределяется.
 */
import React from 'react';
import { Card, Space, Typography } from 'antd';
import { premiumCard, accentColorOf, accentDot, SPACE, TYPE, type AccentKey } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text } = Typography;

interface GridCardProps {
  title: React.ReactNode;
  /** Акцент шапки — тот же, что был у карточки в исходной вёрстке дашборда. */
  accent?: AccentKey;
  /** Цвет акцентной риски, если он динамический (например, RAG выбранной характеристики). */
  dotColor?: string;
  extra?: React.ReactNode;
  /** Подпись под заголовком — короткая, вместо `extra` на узких карточках. */
  hint?: React.ReactNode;
  /** Убрать внутренний паддинг тела (для графиков во всю карточку). */
  flush?: boolean;
  children: React.ReactNode;
}

export const GridCard: React.FC<GridCardProps> = ({
  title, accent = 'none', dotColor, extra, hint, flush, children,
}) => {
  const base = premiumCard(accent);
  const dot = dotColor ?? accentColorOf(accent);
  return (
    <Card
      {...base}
      style={{ ...base.style, height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{
        ...base.styles,
        header: { ...base.styles.header, flex: '0 0 auto' },
        body: {
          ...base.styles.body,
          padding: flush ? 0 : SPACE.airy,
          // min-height: 0 обязателен: без него flex-ребёнок не сжимается ниже своего контента
          // и внутренний скролл не включается — карточка распирает ячейку сетки.
          flex: '1 1 auto', minHeight: 0, overflow: 'auto',
        },
      }}
      title={
        <Space wrap size={4} style={{ padding: `${SPACE.tight}px 0` }}>
          {dot && <span style={accentDot(dot)} />}
          <span style={{ color: BRAND.ink }}>{title}</span>
          {hint && <Text type="secondary" style={TYPE.caption}>{hint}</Text>}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
};

export default GridCard;
