/**
 * assessmentWorkflow.test.ts — юнит-тесты вкладок «Внесение данных» (ТЗ v16):
 * корректировка завершённой оценки (T-47) и внесение проф. суждения (T-48).
 *
 * Проверяется приёмка ТЗ на уровне чистых правил (constants/assessmentWorkflow) и
 * согласованность демо-набора (data/mockAssessments), который питает вкладки в режиме 'mock':
 *   • завершённая оценка закрыта на правку, пересчёт X/уровня повторяет методику;
 *   • список «без суждения» содержит только непокрытые пары и после внесения запись уходит.
 */
import { describe, expect, it } from 'vitest';
import {
  PERIOD_STATUS,
  computeX,
  groupJudgmentsByPeriod,
  isPeriodComplete,
  isPeriodLocked,
  pendingJudgmentKey,
  recalcMetricRow,
  rowsMissingReason,
  withoutJudged,
} from '../constants/assessmentWorkflow';
import {
  DEMO_LATEST_QUARTER,
  DEMO_PENDING_JUDGMENTS,
  DEMO_PERIOD_SUMMARIES,
  demoMetricsOf,
} from '../data/mockAssessments';
import { QUALITY_PAIRS, TOTAL_SUBS } from '../constants/qualityModel';
import type { EditableMetric, PendingJudgment } from '../store/api/apiSlice';

const metric = (over: Partial<EditableMetric> = {}): EditableMetric => ({
  id: 'v-1',
  name: 'Надёжность / Доступность (uptime)',
  characteristic: 'Надёжность',
  subcharacteristic: 'Доступность (uptime)',   // DIRECT
  metric_id: 1,
  description: '',
  val_a: 80,
  val_b: 100,
  expert_comment: '',
  unmeasurable: false,
  calculatedX: 0.8,
  qualityLevel: 'Выше среднего',
  ...over,
});

// ─── T-47: блокировка завершённой оценки и пересчёт значений ───

describe('T-47: правило блокировки завершённой оценки', () => {
  it('COMPLETE закрыт на правку, остальные статусы открыты', () => {
    expect(isPeriodLocked(PERIOD_STATUS.COMPLETE)).toBe(true);
    expect(isPeriodLocked(PERIOD_STATUS.CALCULATED)).toBe(false);
    expect(isPeriodLocked(PERIOD_STATUS.DRAFT)).toBe(false);
    expect(isPeriodLocked(undefined)).toBe(false);
  });

  it('разблокировка (reopen) снимает замок: COMPLETE → CALCULATED', () => {
    // Зеркало POST /assessments/{id}/reopen: период возвращается в расчёт и становится правимым.
    const afterReopen = PERIOD_STATUS.CALCULATED;
    expect(isPeriodLocked(afterReopen)).toBe(false);
  });

  it('завершённость считается по полноте подхарактеристик модели', () => {
    expect(isPeriodComplete(TOTAL_SUBS, TOTAL_SUBS)).toBe(true);
    expect(isPeriodComplete(TOTAL_SUBS - 1, TOTAL_SUBS)).toBe(false);
    expect(isPeriodComplete(0, 0)).toBe(false);
  });
});

describe('T-47: пересчёт X и уровня при правке (методика ГОСТ)', () => {
  it('прямая метрика: X = A/B', () => {
    expect(computeX(80, 100, 'DIRECT')).toBe(0.8);
  });

  it('обратная метрика: X = 1 − A/B', () => {
    expect(computeX(22, 222, 'INVERSE')).toBe(0.9009);
  });

  it('X не считается без базы измерения (B = 0 или пусто)', () => {
    expect(computeX(10, 0, 'DIRECT')).toBeNull();
    expect(computeX(null, 100, 'DIRECT')).toBeNull();
    expect(computeX(10, null, 'DIRECT')).toBeNull();
  });

  it('X зажимается в [0,1] (A больше базы не даёт «больше 100%»)', () => {
    expect(computeX(150, 100, 'DIRECT')).toBe(1);
    expect(computeX(150, 100, 'INVERSE')).toBe(0);
  });

  it('правка A/B пересчитывает X и уровень (по типу формулы из модели)', () => {
    // «Доступность (uptime)» — DIRECT: 25/100 → 0.25 → «Ниже среднего» (как на бэкенде).
    const row = recalcMetricRow(metric(), { val_a: 25 });
    expect(row.calculatedX).toBe(0.25);
    expect(row.qualityLevel).toBe('Ниже среднего');
  });

  it('обратная подхарактеристика пересчитывается по своей формуле', () => {
    const row = recalcMetricRow(
      metric({
        characteristic: 'Функциональная пригодность',
        subcharacteristic: 'Функциональная полнота',   // INVERSE
        val_a: 175, val_b: 222,
      }),
      { val_a: 22 },
    );
    expect(row.calculatedX).toBe(0.9009);
    expect(row.qualityLevel).toBe('Высокий уровень');
  });

  it('«Невозможно измерить» обнуляет A/B и отменяет расчёт', () => {
    const row = recalcMetricRow(metric(), { unmeasurable: true });
    expect(row.val_a).toBeNull();
    expect(row.val_b).toBeNull();
    expect(row.calculatedX).toBeNull();
    expect(row.qualityLevel).toBe('Невозможно измерить');
  });

  it('строка без правки возвращается как есть (той же ссылкой)', () => {
    const row = metric();
    expect(recalcMetricRow(row, undefined)).toBe(row);
  });

  it('неполная пара A/B оставляет X пустым', () => {
    const row = recalcMetricRow(metric(), { val_b: null });
    expect(row.calculatedX).toBeNull();
    expect(row.qualityLevel).toBeNull();
  });

  it('«Невозможно измерить» без причины не проходит сохранение (T-55)', () => {
    const rows = [
      recalcMetricRow(metric({ id: 'a' }), { unmeasurable: true }),
      recalcMetricRow(metric({ id: 'b', expert_comment: 'нет источника данных' }), { unmeasurable: true }),
      recalcMetricRow(metric({ id: 'c' }), { val_a: 10 }),
    ];
    expect(rowsMissingReason(rows).map((r) => r.id)).toEqual(['a']);
  });
});

describe('T-47: демо-набор завершённых оценок', () => {
  it('в списке только полностью заполненные оценки (31/31)', () => {
    expect(DEMO_PERIOD_SUMMARIES.length).toBeGreaterThan(0);
    for (const p of DEMO_PERIOD_SUMMARIES) {
      expect(p.total).toBe(TOTAL_SUBS);
      expect(p.filled).toBe(TOTAL_SUBS);
      expect(p.complete).toBe(true);
    }
  });

  it('представлены оба статуса: завершённые и открытые на корректировку', () => {
    const statuses = new Set(DEMO_PERIOD_SUMMARIES.map((p) => p.status));
    expect(statuses).toEqual(new Set([PERIOD_STATUS.COMPLETE, PERIOD_STATUS.CALCULATED]));
    expect(DEMO_PERIOD_SUMMARIES.some((p) => isPeriodLocked(p.status))).toBe(true);
  });

  it('идентификаторы периодов уникальны', () => {
    const ids = DEMO_PERIOD_SUMMARIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('значения периода — все пары модели, X согласован с A/B и типом формулы', () => {
    const rows = demoMetricsOf(DEMO_PERIOD_SUMMARIES[0].id);
    expect(rows).toHaveLength(TOTAL_SUBS);
    expect(rows.map((r) => `${r.characteristic}|${r.subcharacteristic}`).sort())
      .toEqual(QUALITY_PAIRS.map((p) => `${p.characteristic}|${p.subcharacteristic}`).sort());

    for (const row of rows) {
      if (row.unmeasurable) {
        expect(row.val_a).toBeNull();
        expect(row.val_b).toBeNull();
        expect(row.calculatedX).toBeNull();
        expect((row.expert_comment || '').trim()).not.toBe('');  // причина обязательна
      } else {
        const pair = QUALITY_PAIRS.find((p) => p.subcharacteristic === row.subcharacteristic)!;
        expect(row.calculatedX).toBeCloseTo(computeX(row.val_a, row.val_b, pair.formula)!, 3);
      }
    }
  });

  it('неизвестный период даёт пустой список значений', () => {
    expect(demoMetricsOf('нет-такого-периода')).toEqual([]);
  });
});

// ─── T-48: метрики без профессионального суждения ───

const pending = (over: Partial<PendingJudgment> = {}): PendingJudgment => ({
  period_id: 'p-1',
  system_id: 's-1',
  system_name: 'АБС «Ядро»',
  period: 'Q2-2026',
  characteristic: 'Надёжность',
  subcharacteristic: 'Доступность (uptime)',
  score_pct: 42,
  quality_level: 'Средний уровень',
  expert_comment: null,
  ...over,
});

describe('T-48: список «без суждения» и внесение', () => {
  it('ключ строки — связка «период ↔ пара модели»', () => {
    expect(pendingJudgmentKey(pending())).toBe('p-1|||Надёжность|||Доступность (uptime)');
    // Одна и та же пара в разных периодах — разные строки (связка с оценкой периода).
    expect(pendingJudgmentKey(pending({ period_id: 'p-2' })))
      .not.toBe(pendingJudgmentKey(pending()));
  });

  it('после внесения суждения строка уходит из списка (приёмка T-48)', () => {
    const rows = [
      pending({ subcharacteristic: 'Доступность (uptime)' }),
      pending({ subcharacteristic: 'Отказоустойчивость' }),
      pending({ period_id: 'p-2', subcharacteristic: 'Доступность (uptime)' }),
    ];
    const judged = new Set([pendingJudgmentKey(rows[0])]);
    const left = withoutJudged(rows, judged);

    expect(left).toHaveLength(2);
    expect(left.map(pendingJudgmentKey)).not.toContain(pendingJudgmentKey(rows[0]));
    // Та же подхарактеристика в другом периоде остаётся — суждение внесено не по ней.
    expect(left.map((r) => r.period_id)).toContain('p-2');
  });

  it('без внесённых суждений список не меняется', () => {
    const rows = [pending()];
    expect(withoutJudged(rows, new Set())).toEqual(rows);
  });

  it('черновики группируются в один запрос на период', () => {
    const drafts = {
      'p-1|||Надёжность|||Доступность (uptime)': ' есть просадка ',
      'p-1|||Надёжность|||Отказоустойчивость': 'резерв не проверялся',
      'p-2|||Защищённость|||Целостность': 'контроль целостности не настроен',
    };
    const byPeriod = groupJudgmentsByPeriod(drafts);

    expect([...byPeriod.keys()].sort()).toEqual(['p-1', 'p-2']);
    expect(byPeriod.get('p-1')).toHaveLength(2);
    expect(byPeriod.get('p-1')![0]).toEqual({
      characteristic: 'Надёжность',
      subcharacteristic: 'Доступность (uptime)',
      judgment_text: 'есть просадка',   // текст обрезается по краям
    });
  });

  it('пустые и пробельные черновики не отправляются', () => {
    const byPeriod = groupJudgmentsByPeriod({
      'p-1|||Надёжность|||Доступность (uptime)': '   ',
      'p-1|||Надёжность|||Отказоустойчивость': '',
      'p-2|||Защищённость|||Целостность': 'по делу',
    });
    expect([...byPeriod.keys()]).toEqual(['p-2']);
  });
});

describe('T-48: демо-набор метрик без суждения', () => {
  it('строки уникальны и относятся к последнему периоду ИС (DEF-14)', () => {
    expect(DEMO_PENDING_JUDGMENTS.length).toBeGreaterThan(0);
    const keys = DEMO_PENDING_JUDGMENTS.map(pendingJudgmentKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(DEMO_PENDING_JUDGMENTS.map((r) => r.period))).toEqual(new Set([DEMO_LATEST_QUARTER]));
  });

  it('порядок — худший балл первым, «невозможно измерить» (-1) в начале', () => {
    const scores = DEMO_PENDING_JUDGMENTS.map((r) => r.score_pct);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores[0]).toBe(-1);
  });

  it('все пары — из модели качества, у неизмеримых заполнена причина', () => {
    const model = new Set(QUALITY_PAIRS.map((p) => `${p.characteristic}|${p.subcharacteristic}`));
    for (const r of DEMO_PENDING_JUDGMENTS) {
      expect(model.has(`${r.characteristic}|${r.subcharacteristic}`)).toBe(true);
      if (r.score_pct < 0) {
        expect(r.quality_level).toBe('Невозможно измерить');
        expect((r.expert_comment || '').trim()).not.toBe('');
      }
    }
  });

  it('внесение суждений по одной ИС убирает только её строки', () => {
    const system = DEMO_PENDING_JUDGMENTS[0].system_name;
    const ofSystem = DEMO_PENDING_JUDGMENTS.filter((r) => r.system_name === system);
    const judged = new Set(ofSystem.map(pendingJudgmentKey));
    const left = withoutJudged(DEMO_PENDING_JUDGMENTS, judged);

    expect(left).toHaveLength(DEMO_PENDING_JUDGMENTS.length - ofSystem.length);
    expect(left.some((r) => r.system_name === system)).toBe(false);
  });
});
