/**
 * KpiCard.tsx — единая плитка ключевого показателя (UI-12).
 *
 * Зачем компонент, а не «оформить по месту»: KPI-плитки стоят в ряд на трёх разных экранах и
 * были собраны тремя разными способами — свой `Card` со `Statistic`, голый `<div>` с разлитым
 * `premiumCard()` и третий вариант. В ряду это читается как «собрано из разных кусков»,
 * а именно ряд KPI — первое, что видит пользователь на дашборде.
 *
 * Правила подачи:
 *  · число и подпись ЦЕНТРИРОВАНЫ — в ряду плиток разной ширины левое выравнивание
 *    даёт рваный ритм, глазу не за что зацепиться;
 *  · цифры табличные (`numericText`) — иначе при обновлении данных число «дёргается»;
 *  · тень мягкая и почти незаметная (`PREMIUM.shadow.card`), при наведении чуть глубже —
 *    подсказка «кликабельно» без визуального шума;
 *  · размеры — только ступени шкалы `TYPE`.
 */
import React from 'react';
import { Card, Skeleton, Typography } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { PREMIUM, TYPE, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';
import { numericText } from '../theme/table';

const { Text } = Typography;

export interface KpiCardProps {
  /** Подпись показателя. */
  title: React.ReactNode;
  /** Значение. Число, процент, «—». */
  value: React.ReactNode;
  /** Смысловой цвет значения (RAG `strong`). По умолчанию — графит бренда. */
  color?: string;
  /** Клик по плитке: показывает «раскрыть» и включает hover-состояние. */
  onClick?: () => void;
  /** Скелет вместо содержимого, пока грузятся данные. */
  loading?: boolean;
  /** Приписка под значением (единицы, уточнение периода). */
  hint?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, color, onClick, loading, hint }) => (
  <Card
    size="small"
    hoverable={!!onClick}
    onClick={onClick}
    style={{
      height: '100%',
      borderRadius: PREMIUM.radiusSm,
      border: `1px solid ${PREMIUM.border}`,
      boxShadow: PREMIUM.shadow.card,
      background: BRAND.surface,
      cursor: onClick ? 'pointer' : 'default',
    }}
    styles={{ body: { padding: SPACE.base, textAlign: 'center' } }}
  >
    {loading ? (
      <Skeleton.Input active block size="small" />
    ) : (
      <>
        <div style={{ ...TYPE.caption, color: BRAND.inkSoft }}>{title}</div>
        <div style={{
          ...TYPE.metricMd,
          ...numericText,
          color: color || BRAND.ink,
          marginTop: SPACE.tight,
          // Длинное значение не должно ломать ряд: ужимаем, а не переносим.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {value}
        </div>
        {hint && <div style={{ ...TYPE.micro, fontWeight: 400, color: BRAND.inkSoft }}>{hint}</div>}
        {onClick && (
          <div style={{ marginTop: SPACE.snug }}>
            <Text type="secondary" style={{ ...TYPE.micro, fontWeight: 400 }}>
              раскрыть <RightOutlined style={{ fontSize: TYPE.micro.fontSize }} />
            </Text>
          </div>
        )}
      </>
    )}
  </Card>
);

export default KpiCard;
