/**
 * cockpitReturn.ts — возврат с глубокой страницы на кокпит без потери контекста
 * (ТЗ-21 §3.5, §7.4–7.5; КП-39, КП-ПР-4).
 *
 * Как это устроено. Ссылка из кокпита на L3 несёт признак `from=cockpit` (он был и раньше) и
 * `ret` — ПОЛНЫЙ адрес кокпита в момент перехода: маршрут + разрез + открытая шторка (`tile`).
 * Кнопка «← К кокпиту» просто возвращает на `ret`. Разрез кокпита специально не переливается
 * в параметры L3-страницы: у глубоких страниц свои ключи (`system` — имя ИС, `characteristic`),
 * и запись разреза поверх них (sliceToParams вычищает синонимы) сломала бы их фильтры.
 *
 * `ret` — пользовательский ввод из адресной строки, поэтому принимается только внутренний
 * путь дашборда (`/dashboard/...`): иначе параметр превратился бы в открытый редирект.
 */

/** Ключ шторки L2 в адресе кокпита (§7.4): `?tile=ceo-cost`. */
export const TILE_PARAM = 'tile';
export const RETURN_PARAM = 'ret';
const FROM_COCKPIT = 'cockpit';

/** Разрешённый адрес возврата: внутренний путь дашборда, без схемы/хоста и `//`. */
export function isSafeReturn(ret: string | null | undefined): ret is string {
  if (!ret) return false;
  if (!ret.startsWith('/dashboard/')) return false;
  if (ret.startsWith('//') || ret.includes('\\') || /^[a-z]+:/i.test(ret)) return false;
  return !ret.slice(1).includes('//');
}

/**
 * Дописать к ссылке L3 адрес возврата. Ссылки, не помеченные `from=cockpit`, не трогаются:
 * это обычные переходы, кнопка возврата у них не нужна.
 */
export function withCockpitReturn(href: string, currentLocation: string): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (params.get('from') !== FROM_COCKPIT || !isSafeReturn(currentLocation)) return href;
  params.set(RETURN_PARAM, currentLocation);
  return `${path}?${params.toString()}`;
}

/**
 * Куда ведёт «← К кокпиту» с текущей страницы. null — страница открыта не из кокпита
 * (кнопка не рисуется). Без `ret` (старая ссылка до КП-39) — посадочная роли из `role`.
 */
export function cockpitReturnTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get('from') !== FROM_COCKPIT) return null;
  const ret = params.get(RETURN_PARAM);
  if (isSafeReturn(ret)) return ret;
  const role = params.get('role');
  return role === 'ceo' || role === 'cto' ? `/dashboard/${role}` : null;
}
