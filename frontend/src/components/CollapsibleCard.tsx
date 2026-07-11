/**
 * CollapsibleCard.tsx — премиальная карточка со сворачиванием/разворачиванием «в самом верху».
 *
 * Обёртка над AntD Card: в шапке — акцентный маркер, заголовок и шеврон-переключатель;
 * тело плавно сворачивается. Может работать как неуправляемо (defaultOpen), так и
 * управляемо (open + onToggle). Используется на «Плане задач» (обе карточки), может
 * переиспользоваться другими дашбордами.
 */
import React, { useState } from 'react';
import { Card, Space, Tooltip, Typography } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { premiumCard, accentDot, accentColorOf, type AccentKey } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text } = Typography;

interface Props {
  title: React.ReactNode;
  /** Правый угол шапки (фильтры, счётчики, легенда). Клики не сворачивают карточку. */
  extra?: React.ReactNode;
  /** Подзаголовок под названием (тонкий, приглушённый). */
  subtitle?: React.ReactNode;
  accent?: AccentKey;
  defaultOpen?: boolean;
  /** Управляемый режим: если задан open, состояние контролирует родитель. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  children: React.ReactNode;
}

const CollapsibleCard: React.FC<Props> = ({
  title, extra, subtitle, accent = 'ink', defaultOpen = true, open, onToggle, style, bodyStyle, children,
}) => {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInnerOpen(next);
    onToggle?.(next);
  };

  const { style: cardStyle, styles } = premiumCard(accent, style);
  const accentColor = accentColorOf(accent);

  const header = (
    <div
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', width: '100%' }}
    >
      <Tooltip title={isOpen ? 'Свернуть' : 'Развернуть'}>
        <DownOutlined
          style={{
            fontSize: 12, color: BRAND.inkSoft, transition: 'transform .25s ease',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', flex: '0 0 auto',
          }}
        />
      </Tooltip>
      {accentColor && <span style={accentDot(accentColor)} />}
      <Space direction="vertical" size={0} style={{ lineHeight: 1.2 }}>
        <span style={{ color: BRAND.ink, fontWeight: 600 }}>{title}</span>
        {subtitle && <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{subtitle}</Text>}
      </Space>
    </div>
  );

  return (
    <Card
      title={header}
      // Клики по extra не должны сворачивать карточку.
      extra={extra ? <div onClick={(e) => e.stopPropagation()}>{extra}</div> : undefined}
      style={cardStyle}
      styles={{
        header: { ...styles.header, cursor: 'pointer' },
        body: {
          ...styles.body,
          ...bodyStyle,
          // Плавное сворачивание тела без размонтирования содержимого.
          maxHeight: isOpen ? 6000 : 0,
          paddingTop: isOpen ? (styles.body.padding as number) : 0,
          paddingBottom: isOpen ? (styles.body.padding as number) : 0,
          opacity: isOpen ? 1 : 0,
          // При закрытии клипуем для анимации; при открытии — auto (горизонтальный скролл диаграмм).
          overflow: isOpen ? 'auto' : 'hidden',
          transition: 'max-height .35s ease, opacity .25s ease, padding .25s ease',
        },
      }}
    >
      {children}
    </Card>
  );
};

export default CollapsibleCard;
