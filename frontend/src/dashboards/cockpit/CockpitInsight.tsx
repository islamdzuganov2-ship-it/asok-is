/**
 * CockpitInsight.tsx — одна строка управленческого вывода под заголовком кокпита (ТЗ v21 §9.2).
 *
 * Правило: НИКОГДА не задерживает L1 ожиданием генерации. Детерминированная формулировка
 * считается мгновенно из уже загруженного бандла (без сети) и показывается сразу; живой вызов
 * модели идёт в фоне, и если он вернул честный (grounded, без жаргона) текст — строка тихо
 * заменяется на него с маркером «✓ вывод ИИ». 12B на CPU (см. docs/LLM_SETUP.md) может отвечать
 * минуты — до ответа или при отказе пользователь просто не видит разницы: строка уже корректна.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Typography, Tooltip } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useGetCockpitInsightMutation } from '../../store/api/apiSlice';
import type { CockpitBundle } from './apiTypes';
import { fmtMoneyCompact } from '../../utils/money';
import { TYPE } from '../../theme/premium';
import { BRAND } from '../../theme/ragPalette';

const { Text } = Typography;

// Экспортированы только для теста на инженерный жаргон (cockpitJargon.test.ts, ТЗ v21 §КП-ПР-12) —
// сама CockpitInsight их не переиспользует снаружи.
export function ceoFallback(b: CockpitBundle): { text: string; facts: Record<string, string> } {
  const d = b.costDashboard;
  const ov = b.overdueSummary;
  const facts: Record<string, string> = {};
  if (!d || !d.risksCount) {
    return { text: 'Портфельная стоимость риска пока не рассчитана — справочники econ не заполнены.', facts };
  }
  facts['ALE портфеля'] = fmtMoneyCompact(d.portfolioAle);
  facts['Активных рисков'] = `${d.risksCount} шт.`;
  facts['Замкнутость контура'] = `${d.closureRate}%`;
  if (d.blockingCount > 0) {
    facts['Блокирующих несоответствий'] = `${d.blockingCount} шт.`;
    return {
      text: `Портфель под риском на ${fmtMoneyCompact(d.portfolioAle)}: ${d.blockingCount} блокирующих несоответствий не закрыты.`,
      facts,
    };
  }
  if (ov && ov.overdueCount > 0) {
    facts['Просрочено мер'] = `${ov.overdueCount} шт.`;
    facts['Цена неисполнения'] = fmtMoneyCompact(ov.totalPriceCurrent);
    return {
      text: `Портфель под риском на ${fmtMoneyCompact(d.portfolioAle)}: просрочено ${ov.overdueCount} мер на ${fmtMoneyCompact(ov.totalPriceCurrent)}.`,
      facts,
    };
  }
  return {
    text: `Портфель под риском на ${fmtMoneyCompact(d.portfolioAle)} по ${d.risksCount} событиям, замкнутость контура ${d.closureRate}%.`,
    facts,
  };
}

export function ctoFallback(b: CockpitBundle): { text: string; facts: Record<string, string> } {
  const facts: Record<string, string> = {};
  const inc = b.incidentAnalytics;
  const trend = b.portfolioTrendScore;
  const triggered = b.triggeredRisks ?? [];
  if (trend && trend.anomaly) {
    facts['Δ балла'] = `${trend.deltaAbsolute} п.п.`;
    return { text: `Аномальное изменение балла портфеля — ${trend.deltaAbsolute} п.п. за период, требует причины.`, facts };
  }
  if (triggered.length > 3) {
    facts['Сработавших триггеров'] = `${triggered.length} шт.`;
    return { text: `Сработало ${triggered.length} риск-триггеров — стоит просмотреть радар рисков.`, facts };
  }
  if (inc && inc.availabilityPct !== null) {
    facts['Доступность'] = `${inc.availabilityPct}%`;
    facts['MTTR'] = `${inc.avgMttrHours ?? '—'} ч`;
    return { text: `Доступность портфеля ${inc.availabilityPct}%, MTTR ${inc.avgMttrHours ?? '—'} ч.`, facts };
  }
  return { text: 'Существенных отклонений в надёжности и динамике качества не обнаружено.', facts };
}

interface Props {
  role: 'CEO' | 'CTO';
  bundle: CockpitBundle | undefined;
}

const CockpitInsight: React.FC<Props> = ({ role, bundle }) => {
  const [text, setText] = useState<string | null>(null);
  const [isLlm, setIsLlm] = useState(false);
  const [getInsight] = useGetCockpitInsightMutation();
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!bundle) return;
    const { text: fallback, facts } = role === 'CEO' ? ceoFallback(bundle) : ctoFallback(bundle);
    setText(fallback);
    setIsLlm(false);
    // Один живой запрос на бандл (не на каждый ре-рендер) — ключ по времени генерации бандла.
    const key = bundle.generatedAt + role;
    if (requestedFor.current === key) return;
    requestedFor.current = key;
    getInsight({ role, facts, fallback }).unwrap()
      .then((res) => { if (requestedFor.current === key) { setText(res.text); setIsLlm(res.llm); } })
      .catch(() => { /* уже показан честный fallback — молча остаёмся на нём */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.generatedAt, role]);

  if (!text) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 4 }}>
      <Tooltip title={isLlm ? 'Сгенерировано локальной моделью' : 'Сформулировано по формальным правилам — модель недоступна или ответ не прошёл проверку на достоверность'}>
        <RobotOutlined style={{ color: isLlm ? BRAND.ink : BRAND.inkSoft, marginTop: 3, flex: '0 0 auto' }} />
      </Tooltip>
      <Text style={{ ...TYPE.bodySm, color: BRAND.ink }}>{text}</Text>
    </div>
  );
};

export default CockpitInsight;
