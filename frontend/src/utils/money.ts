/**
 * money.ts — денежная и числовая подача (₽, форматирование под ru-RU).
 *
 * До ТЗ v19 fmtMoney дублировался как минимум в RiskEconomicsPage.tsx и ActionInsightModal.tsx —
 * здесь общая версия для нового кода (экономика меры, п.7/11). Существующие копии не трогаем
 * без нужды: поведение идентично (null/undefined → «—»), рефактор рабочего кода вне объёма задачи.
 */
export function fmtMoney(v?: number | null): string {
  return v === null || v === undefined ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(v))} ₽`;
}

export function fmtNum(v?: number | null, digits = 2): string {
  return v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);
}
