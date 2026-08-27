/**
 * MeasureEconomicsBlock.tsx — денежная часть карточки меры: CAPEX/OPEX, ΔALE, ROSI, окупаемость.
 *
 * Вынесено из MeasureDecisionModal: блок читается сам по себе и ни от чего в модалке не зависит,
 * кроме самой меры и параметров горизонта ROSI.
 *
 * Горизонт и ставка дисконтирования — параметры контура (меняются без релиза), поэтому они
 * приходят пропсом и явно подписаны под цифрами: ROSI без указания горизонта — просто число,
 * по которому нельзя принять решение.
 */
import React from 'react';
import { Space, Tag, Typography } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import type { Proposal } from '../store/slices/governanceTypes';
import { BRAND, RAG, ACCENT } from '../theme/ragPalette';
import { PREMIUM, TYPE } from '../theme/premium';

const { Text } = Typography;

const MEASURE_TYPE_LABEL: Record<string, string> = {
  ELIMINATING: 'Устраняющая', COMPENSATING: 'Компенсирующая', PREVENTIVE: 'Предупреждающая',
};
const VERDICT_LABEL: Record<string, { label: string; color: string }> = {
  ELIMINATE: { label: 'Устранить', color: 'green' },
  COMPENSATE: { label: 'Компенсировать', color: 'gold' },
  ACCEPT: { label: 'Принять риск', color: 'default' },
};

interface Props {
  p: Proposal;
  /** Суммарный ΔALE (касса + отложенная + высвобожденная мощность). */
  totalDeltaAle: number;
  /** Горизонт расчёта ROSI: месяцы и ставка дисконтирования (доля, не проценты). */
  horizon: { months: number; rate: number } | null;
  paybackYears: number | null;
  fmtMoney: (v?: number | null) => string;
  fmtNum: (v?: number | null, digits?: number) => string;
}

const Metric: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <Text type="secondary" style={{ ...TYPE.micro, display: 'block' }}>{title}</Text>
    {children}
  </div>
);

export const MeasureEconomicsBlock: React.FC<Props> = ({
  p, totalDeltaAle, horizon, paybackYears, fmtMoney, fmtNum,
}) => {
  const hasDeltaAle = p.deltaAleCash != null || p.deltaAleDeferred != null || p.deltaAleCapacity != null;
  return (
    <div style={{ background: BRAND.surfaceSoft, borderRadius: PREMIUM.radiusSm, padding: 12, marginBottom: 12 }}>
      <Text type="secondary" style={TYPE.caption}>
        <DollarOutlined /> Экономика меры
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
        {p.capex != null && <Metric title="CAPEX"><Text strong>{fmtMoney(p.capex)}</Text></Metric>}
        {p.opexPerYear != null && <Metric title="OPEX/год"><Text strong>{fmtMoney(p.opexPerYear)}</Text></Metric>}
        {hasDeltaAle && (
          <Metric title="ΔALE/год (снижение риска)">
            <Text strong style={{ color: RAG.good.strong }}>{fmtMoney(totalDeltaAle)}</Text>
          </Metric>
        )}
        {p.rosi != null && (
          <Metric title={`ROSI${horizon ? ` за ${Math.round(horizon.months / 12 * 10) / 10} г.` : ''}`}>
            <Text strong style={{ color: p.rosi >= 0 ? RAG.good.strong : RAG.bad.strong }}>{fmtNum(p.rosi, 2)}</Text>
          </Metric>
        )}
        {paybackYears != null && (
          <Metric title="Окупаемость"><Text strong>{fmtNum(paybackYears, 1)} лет</Text></Metric>
        )}
      </div>
      {p.rosi != null && horizon && (
        <Text type="secondary" style={{ ...TYPE.micro, display: 'block', marginTop: 4 }}>
          ROSI и окупаемость — за горизонт {horizon.months} мес. под ставку дисконтирования {Math.round(horizon.rate * 100)}%/год
          (параметр контура, меняется без релиза)
        </Text>
      )}
      {hasDeltaAle && (
        <Text type="secondary" style={{ ...TYPE.caption, display: 'block', marginTop: 6 }}>
          из них: касса {fmtMoney(p.deltaAleCash)} · отложенная {fmtMoney(p.deltaAleDeferred)} · высвобожденная мощность {fmtMoney(p.deltaAleCapacity)}
        </Text>
      )}
      <Space wrap style={{ marginTop: 8 }}>
        {p.measureType && <Tag color={ACCENT.slate.color}>{MEASURE_TYPE_LABEL[p.measureType] ?? p.measureType}</Tag>}
        {p.verdict && VERDICT_LABEL[p.verdict] && (
          <Tag color={VERDICT_LABEL[p.verdict].color}>Вердикт: {VERDICT_LABEL[p.verdict].label}</Tag>
        )}
        {!p.verdict && p.recommendedVerdict && VERDICT_LABEL[p.recommendedVerdict] && (
          <Tag>Рекомендовано: {VERDICT_LABEL[p.recommendedVerdict].label}</Tag>
        )}
      </Space>
    </div>
  );
};

export default MeasureEconomicsBlock;
