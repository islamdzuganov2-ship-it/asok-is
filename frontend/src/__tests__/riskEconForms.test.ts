/**
 * riskEconForms.test.ts — сборка тел запросов форм риск-экономики (BL-007 RE-02, RE-06).
 *
 * Формы собирают параметры метода C_мин, временной профиль и входы расчёта K деградации из
 * плоских полей. Ошибка здесь не видна глазами: бэкенд молча посчитает «не рассчитано» или
 * возьмёт K вручную, и цифра на карточке окажется не той, что ввёл аналитик.
 */
import { describe, it, expect } from 'vitest';
import { bpCostParams, bpTimeProfile } from '../pages/riskEconomics/shared';
import { degradationInputsFrom } from '../components/IncidentEconomicsPanel';

describe('C_мин: параметры метода (RE-02)', () => {
  it('берутся только поля выбранного метода', () => {
    const v = { n_employees: 30, hourly_rate: 1200, revenue_per_period: 1e6, low: 1 };
    expect(bpCostParams('RESOURCE', v)).toEqual({ n_employees: 30, hourly_rate: 1200 });
    expect(bpCostParams('TRANSACTIONAL', v)).toEqual({ revenue_per_period: 1e6 });
    expect(bpCostParams('EXPERT', { low: 10, high: 30 })).toEqual({ low: 10, high: 30 });
  });

  it('временной профиль: пусто — без профиля; выходные по умолчанию как «вне пика»', () => {
    expect(bpTimeProfile({})).toBeNull();
    expect(bpTimeProfile({ offpeak: 0.5 })).toEqual({ peak_hours: [9, 18], peak: 1, offpeak: 0.5, weekend: 0.5 });
  });
});

describe('деградация: входы расчёта K (RE-06)', () => {
  it('полный набор входов типа → объект; неполный → null (K тогда вручную)', () => {
    expect(degradationInputsFrom('PERFORMANCE', { response_ratio: 3 })).toEqual({ response_ratio: 3 });
    expect(degradationInputsFrom('FUNCTIONAL', { unavailable_weight: 3 })).toBeNull();
    expect(degradationInputsFrom('THROUGHPUT', { actual: 40, required: 100 })).toEqual({ actual: 40, required: 100 });
    expect(degradationInputsFrom(undefined, { response_ratio: 3 })).toBeNull();
  });
});
