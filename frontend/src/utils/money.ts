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

/**
 * Компактный денежный формат для плиток кокпита (ТЗ v21 §9.3): «12,4 млн ₽», не «12 437 118 ₽».
 * Точное значение показывается на L2/в подсказке — на первом экране важен порядок, не копейки.
 */
export function fmtMoneyCompact(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${fmtNum(abs / 1_000_000_000, 1)} млрд ₽`;
  if (abs >= 1_000_000) return `${sign}${fmtNum(abs / 1_000_000, 1)} млн ₽`;
  if (abs >= 1_000) return `${sign}${fmtNum(abs / 1_000, 0)} тыс ₽`;
  return fmtMoney(v);
}
