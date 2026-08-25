/**
 * cockpitJargon.test.ts — текст кокпита не должен просачивать инженерный жаргон (ТЗ v21 §КП-ПР-12).
 *
 * Список терминов зеркалит `backend/app/modules/llm/style_guide.py::FORBIDDEN_ENGINEERING_TERMS` —
 * не импортируется напрямую (frontend и backend собираются раздельно), но должен обновляться
 * синхронно при правке источника истины. Проверяются два статических источника C-level текста:
 * заголовки-вопросы плиток (CEO_TILES/CTO_TILES) и детерминированные формулировки CockpitInsight
 * (ceoFallback/ctoFallback) — то, что видно мгновенно, без ожидания LLM.
 */
import { describe, it, expect } from 'vitest';
import { CEO_TILES } from '../dashboards/cockpit/ceoTiles';
import { CTO_TILES } from '../dashboards/cockpit/ctoTiles';
import { ceoFallback, ctoFallback } from '../dashboards/cockpit/CockpitInsight';
import type { CockpitBundle } from '../dashboards/cockpit/apiTypes';

const FORBIDDEN_JARGON_TERMS = [
  'grounding', 'Grounding',
  'fallback', 'Fallback',
  'LLM-вывод',
  'отбракован',
  'движок', 'движк',
  'детерминирован',
  'трасс',
];

function assertClean(label: string, text: string) {
  const hit = FORBIDDEN_JARGON_TERMS.find((term) => text.includes(term));
  expect(hit, `${label} содержит инженерный жаргон «${hit}»: "${text}"`).toBeUndefined();
}

const emptyBundle: CockpitBundle = {
  role: 'CEO',
  generatedAt: '2026-08-25T00:00:00Z',
  costDashboard: null,
  acceptanceQueue: null,
  portfolioSummary: null,
  effectCurve: null,
  overdueSummary: null,
  portfolioTrendScore: null,
  incidentAnalytics: null,
  triggeredRisks: null,
  managerMetrics: null,
};

describe('кокпит: текст без инженерного жаргона', () => {
  it('вопросы плиток CEO/CTO не содержат жаргон', () => {
    [...CEO_TILES, ...CTO_TILES].forEach((t) => assertClean(`CockpitTile.question (${t.id})`, t.question));
  });

  it('ceoFallback: пустой бандл', () => {
    assertClean('ceoFallback(empty)', ceoFallback(emptyBundle).text);
  });

  it('ceoFallback: блокирующие несоответствия', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      costDashboard: {
        portfolioAle: 1_000_000, risksCount: 5, nonconformitiesTotal: 10, verified: 8,
        closureRate: 80, blockingCount: 2,
        verdict: { eliminate: 1, compensate: 1, accept: 0 }, bySystem: [],
      },
    };
    assertClean('ceoFallback(blocking)', ceoFallback(b).text);
  });

  it('ceoFallback: просроченные меры', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      costDashboard: {
        portfolioAle: 1_000_000, risksCount: 5, nonconformitiesTotal: 10, verified: 10,
        closureRate: 100, blockingCount: 0,
        verdict: { eliminate: 0, compensate: 0, accept: 0 }, bySystem: [],
      },
      overdueSummary: {
        overdueCount: 3, ownersAffected: 2, totalPriceCurrent: 500_000, totalPriceSnapshot: 400_000,
        byOwner: [], items: [],
      },
    };
    assertClean('ceoFallback(overdue)', ceoFallback(b).text);
  });

  it('ceoFallback: устойчивый портфель (ветка по умолчанию)', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      costDashboard: {
        portfolioAle: 200_000, risksCount: 3, nonconformitiesTotal: 4, verified: 4,
        closureRate: 100, blockingCount: 0,
        verdict: { eliminate: 0, compensate: 0, accept: 4 }, bySystem: [],
      },
    };
    assertClean('ceoFallback(default)', ceoFallback(b).text);
  });

  it('ctoFallback: пустой бандл', () => {
    assertClean('ctoFallback(empty)', ctoFallback(emptyBundle).text);
  });

  it('ctoFallback: аномалия балла', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      portfolioTrendScore: {
        metric: 'score', points: [], deltaAbsolute: -12, deltaRelative: -0.2,
        anomaly: true, emptyReason: null,
      },
    };
    assertClean('ctoFallback(anomaly)', ctoFallback(b).text);
  });

  it('ctoFallback: массовое срабатывание риск-триггеров', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      triggeredRisks: [1, 2, 3, 4].map((i) => ({
        id: String(i), code: `R-0${i}`, title: `Риск ${i}`, triggeredBy: 'частые техсбои',
      })),
    };
    assertClean('ctoFallback(triggered)', ctoFallback(b).text);
  });

  it('ctoFallback: доступность/MTTR', () => {
    const b: CockpitBundle = {
      ...emptyBundle,
      incidentAnalytics: {
        total: 10, openCount: 1, resolvedCount: 9, avgMttrHours: 4.5,
        windowHours: 720, mtbfHours: 100, availabilityPct: 99.9, byCategory: [],
      },
    };
    assertClean('ctoFallback(availability)', ctoFallback(b).text);
  });
});
