/**
 * dynamics.test.ts — юнит-тесты динамики качества (ТЗ v14 §1–3):
 * детектор аномалий, интегральный ряд «Качество информационной системы»,
 * предзаполненные причины МК и их сцепка с ключами dynamicsSlice.
 */
import { describe, expect, it } from 'vitest';
import {
  ANOMALY_THRESHOLD, DYNAMICS, DYNAMICS_REASONS, MANAGER_SCALE_SYSTEMS, QUARTERS,
  detectAnomalies,
} from '../data/mockScaleData';
import { reasonKey } from '../store/slices/dynamicsSlice';

describe('detectAnomalies', () => {
  it('находит рост и просадку ≥ порога', () => {
    expect(detectAnomalies([50, 70, 70, 50, 50, 50])).toEqual([1, 3]);
  });

  it('игнорирует изменения ниже порога и неизмеренные точки', () => {
    expect(detectAnomalies([50, 55, 60, 58, 60, 61])).toEqual([]);
    // -1 = «невозможно измерить»: скачок через н/д не считается аномалией.
    expect(detectAnomalies([50, -1, 90, 90, 90, 90])).toEqual([]);
  });

  it('порог по умолчанию — ANOMALY_THRESHOLD', () => {
    const delta = ANOMALY_THRESHOLD;
    expect(detectAnomalies([50, 50 + delta])).toEqual([1]);
    expect(detectAnomalies([50, 50 + delta - 1])).toEqual([]);
  });
});

describe('DYNAMICS: интегральный ряд системы', () => {
  it('есть у каждой системы и покрывает все кварталы', () => {
    for (const s of MANAGER_SCALE_SYSTEMS) {
      const dyn = DYNAMICS[s.name];
      expect(dyn, s.name).toBeDefined();
      expect(dyn.system.series).toHaveLength(QUARTERS.length);
      expect(dyn.system.key).toBe('system');
    }
  });

  it('равен среднему измеримых характеристик в каждом квартале (сквозная согласованность)', () => {
    const dyn = DYNAMICS[MANAGER_SCALE_SYSTEMS[0].name];
    QUARTERS.forEach((_, q) => {
      const vals = dyn.chars.map((c) => c.series[q]).filter((v) => v >= 0);
      const expected = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : -1;
      expect(dyn.system.series[q]).toBe(expected);
    });
  });

  it('содержит сценарные аномалии (есть что показать CIO/CTO)', () => {
    const anomalousSystems = Object.values(DYNAMICS).filter(
      (d) => [d.system, ...d.chars].some((s) => detectAnomalies(s.series).length > 0),
    );
    expect(anomalousSystems.length).toBeGreaterThan(0);
  });
});

describe('DYNAMICS_REASONS: причины МК', () => {
  it('ключи в формате dynamicsSlice.reasonKey и указывают на реальные ряды', () => {
    const keys = Object.keys(DYNAMICS_REASONS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [sysName, seriesKey, quarter] = key.split('|');
      expect(reasonKey(sysName, seriesKey, quarter)).toBe(key);
      expect(QUARTERS).toContain(quarter);
      const dyn = DYNAMICS[sysName];
      expect(dyn, sysName).toBeDefined();
      const found = seriesKey === 'system' || dyn.chars.some((c) => c.key === seriesKey);
      expect(found, `${sysName}: ${seriesKey}`).toBe(true);
    }
  });

  it('часть аномалий намеренно БЕЗ причины — для уведомлений МК', () => {
    let missing = 0;
    for (const dyn of Object.values(DYNAMICS)) {
      for (const s of [dyn.system, ...dyn.chars]) {
        for (const i of detectAnomalies(s.series)) {
          if (!DYNAMICS_REASONS[reasonKey(dyn.name, s.key, QUARTERS[i])]) missing += 1;
        }
      }
    }
    expect(missing).toBeGreaterThan(0);
  });
});
