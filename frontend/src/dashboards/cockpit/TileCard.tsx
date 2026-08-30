/**
 * TileCard.tsx — плитка L1 кокпита (ТЗ v21 §2, §7.1).
 *
 * Правило подачи (§12.1): одна крупная цифра, всё остальное — вдвое мельче. §7.3 честной
 * пустоты: `value.empty` рисует ПРИЧИНУ вместо 0/«—» — плитка никогда не выдаёт цифру,
 * которой не за что поручиться.
 */
import React from 'react';
import { Card, Popover, Skeleton, Typography } from 'antd';
import { RightOutlined, QuestionCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { PREMIUM, TYPE, SPACE } from '../../theme/premium';
import { BRAND, RAG } from '../../theme/ragPalette';
import { numericText } from '../../theme/table';
import { useIsDarkTheme } from '../../theme/useThemeTokens';
import type { Tone, TileValue, TileFormula } from './types';

const { Text } = Typography;

const TONE_TOKEN: Record<Tone, { color: string; strong: string; soft: string; border: string }> = {
  critical: RAG.bad,
  low: RAG.bad,
  medium: RAG.medium,
  high: RAG.good,
  neutral: RAG.muted,
};

function MiniSparkline({ series, color }: { series: number[]; color: string }) {
  const w = 96, h = 28;
  if (series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="динамика">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Содержимое подсказки «как посчитано» — минималистично, в терминах кредит/дебет вместо
 * формульной нотации (§ТЗ по кокпиту: «условная формула», не строгая математика). Пункты
 * `credit`/`debit` необязательны: часть плиток — просто счётчик, не разность двух потоков.
 */
function FormulaContent({ formula }: { formula: TileFormula }) {
  return (
    <div style={{ maxWidth: 260 }}>
      <Text style={{ ...TYPE.bodySm, display: 'block' }}>{formula.summary}</Text>
      {(formula.credit?.length || formula.debit?.length) ? (
        <div style={{ display: 'flex', gap: SPACE.cozy, marginTop: SPACE.snug }}>
          {formula.credit?.length ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...TYPE.micro, color: RAG.good.strong, fontWeight: 600 }}>+ прибавляет</Text>
              <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                {formula.credit.map((c) => <li key={c} style={{ ...TYPE.micro, color: BRAND.inkSoft }}>{c}</li>)}
              </ul>
            </div>
          ) : null}
          {formula.debit?.length ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...TYPE.micro, color: RAG.bad.strong, fontWeight: 600 }}>− вычитает</Text>
              <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                {formula.debit.map((d) => <li key={d} style={{ ...TYPE.micro, color: BRAND.inkSoft }}>{d}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface TileCardProps {
  question: string;
  value: TileValue;
  /** Пояснение «как посчитано» — рисуется значком ⓘ рядом с вопросом, необязательно (пока
   *  плитка не считает своё честной суммой/разностью — например, плейсхолдер загрузки). */
  formula?: TileFormula;
  onClick?: () => void;
}

const TileCard: React.FC<TileCardProps> = ({ question, value, formula, onClick }) => {
  const tok = TONE_TOKEN[value.tone];
  // RAG.soft — бледная плашка, посчитанная под светлую тему (найдено живой проверкой graphite,
  // ТЗ v21 §КП-ПР-11): на тёмном фоне вместе с тематизированным текстом давала светло-серый
  // текст на светлой плашке — провал контраста. В тёмной теме держим обычную поверхность темы и
  // переносим акцент тона на рамку/цифру/спарклайн (они и так фиксированные, не var()).
  const isDark = useIsDarkTheme();

  if (value.loading) {
    return (
      <Card size="small" style={{ height: '100%', borderRadius: PREMIUM.radius, border: `1px solid ${PREMIUM.border}` }}>
        <div style={{ ...TYPE.caption, color: BRAND.inkSoft, marginBottom: SPACE.snug }}>{question}</div>
        <Skeleton.Input active block size="large" />
      </Card>
    );
  }

  return (
    <Card
      hoverable={!!onClick}
      onClick={onClick}
      style={{
        height: '100%',
        borderRadius: PREMIUM.radius,
        border: `1px solid ${value.empty ? PREMIUM.border : (isDark ? tok.color : tok.border)}`,
        background: value.empty || isDark ? BRAND.surface : tok.soft,
        boxShadow: PREMIUM.shadow.card,
        cursor: onClick ? 'pointer' : 'default',
      }}
      styles={{ body: { padding: SPACE.airy } }}
    >
      <div style={{ ...TYPE.caption, color: BRAND.inkSoft, marginBottom: SPACE.tight, minHeight: 34, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{question}</span>
        {formula && (
          <Popover content={<FormulaContent formula={formula} />} title="Как посчитано" trigger="hover">
            <InfoCircleOutlined
              style={{ flex: '0 0 auto', marginTop: 2, cursor: 'help' }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Как посчитано"
            />
          </Popover>
        )}
      </div>

      {value.empty ? (
        <div>
          <Text type="secondary" style={{ ...TYPE.bodySm, display: 'flex', alignItems: 'flex-start', gap: SPACE.tight }}>
            <QuestionCircleOutlined style={{ marginTop: 3, flex: '0 0 auto' }} />
            <span>{value.empty.reason}</span>
          </Text>
          {value.empty.fixHref && (
            <a href={value.empty.fixHref} style={{ ...TYPE.micro, display: 'block', marginTop: SPACE.tight }} onClick={(e) => e.stopPropagation()}>
              {value.empty.fixLabel ?? 'Заполнить →'}
            </a>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.cozy }}>
            <div style={{ ...TYPE.metricLg, ...numericText, color: tok.strong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {value.value}{value.unit ? <span style={{ ...TYPE.bodySm, marginLeft: 4, color: BRAND.inkSoft }}>{value.unit}</span> : null}
            </div>
            {value.trend && value.trend.length >= 2 && <MiniSparkline series={value.trend} color={tok.color} />}
          </div>
          {value.delta && (
            <div style={{ ...TYPE.caption, color: value.delta.direction === 'up' ? RAG.good.strong : RAG.bad.strong, marginTop: 2 }}>
              {value.delta.direction === 'up' ? '▲' : '▼'} {value.delta.value > 0 ? '+' : ''}{value.delta.value}{value.delta.unit}
            </div>
          )}
          <Text type="secondary" style={{ ...TYPE.micro, display: 'block', marginTop: SPACE.snug }}>
            {value.subtitle}
          </Text>
        </>
      )}

      {onClick && !value.empty && (
        <div style={{ marginTop: SPACE.snug, textAlign: 'right' }}>
          <Text type="secondary" style={{ ...TYPE.micro, fontWeight: 400 }}>
            разобрать <RightOutlined style={{ fontSize: TYPE.micro.fontSize }} />
          </Text>
        </div>
      )}
    </Card>
  );
};

export default TileCard;
