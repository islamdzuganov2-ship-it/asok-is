/**
 * navOrderMath.ts — чистые операции над порядком и группировкой пунктов левого меню.
 *
 * Вынесено из SidebarNavEditor: правила «куда встанет перетащенный пункт» не зависят от React,
 * а сломать их легко — порядок хранится плоским списком, тогда как на экране пункты разложены
 * по трём группам (NAV_GROUPS).
 */

/** Раздел меню в том виде, в каком его знает NAV_SECTIONS. */
export interface NavSection { perm: string; group: string }

/**
 * Группы меню по ГЛУБИНЕ раскрытия (ТЗ-21 §8.2, КП-37), а не по типу артефакта:
 *  • «Моя картина»      — посадочные экраны роли: сюда приходят каждый день (L1);
 *  • «Разрезы»          — аналитика «почему так»: динамика, сбои, радар, план (L2);
 *  • «Работа с данными» — первичные записи: ввод, база рисков, деньги, выгрузки (L3).
 * Отличие от буквы ТЗ: «Мои задачи» и «Основное — риск» стоят в «Моей картине», а не в
 * «Работе с данными» — для исполнителя и владельца риска это и есть посадочный экран.
 * Единственный источник названий: меню, режим «Порядок» и экран «Настройка» читают его.
 */
export const NAV_GROUPS = ['Моя картина', 'Разрезы', 'Работа с данными'] as const;
export type NavGroup = typeof NAV_GROUPS[number];

/**
 * Прежние названия групп (ДЕФ-11) → новые. Пользовательские переносы (`navGroups` в prefs и
 * localStorage) хранят НАЗВАНИЕ группы: без перевода пункт, перенесённый в «Основное», после
 * релиза ссылался бы на несуществующую группу и молча пропадал из меню.
 */
export const LEGACY_NAV_GROUPS: Readonly<Record<string, NavGroup>> = {
  'Основное': 'Моя картина',
  'Сбор и анализ данных': 'Работа с данными',
  'Формирование техдолга': 'Разрезы',
};

/**
 * Нормализация пользовательских переносов: старые названия переводятся, неизвестные группы
 * отбрасываются (пункт возвращается в штатную), перенос «в свою же группу» удаляется —
 * в prefs не копится мусор, переживающий следующее переименование.
 */
export function normalizeNavGroups(
  raw: Readonly<Record<string, string>>,
  sections: readonly NavSection[],
): Record<string, string> {
  const known = new Set<string>(NAV_GROUPS);
  const out: Record<string, string> = {};
  for (const [perm, value] of Object.entries(raw)) {
    const group = LEGACY_NAV_GROUPS[value] ?? value;
    if (!known.has(group)) continue;
    const home = sections.find((s) => s.perm === perm)?.group;
    if (group !== home) out[perm] = group;
  }
  return out;
}

/**
 * Плоский порядок всех разделов: приоритет — сохранённый пользовательский порядок, при равенстве
 * (раздел появился в релизе и в navOrder его ещё нет) — исходный порядок NAV_SECTIONS.
 * Новый пункт из релиза так оказывается на своём штатном месте, а не в конце списка молча.
 */
export function fullNavOrder(sections: readonly NavSection[], navOrder: readonly string[]): string[] {
  const baseIndex = new Map(sections.map((s, i) => [s.perm, i]));
  const orderIndex = (perm: string) => {
    const i = navOrder.indexOf(perm);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return sections.map((s) => s.perm).sort((a, b) => {
    const d = orderIndex(a) - orderIndex(b);
    return d !== 0 ? d : (baseIndex.get(a)! - baseIndex.get(b)!);
  });
}

/** Группа пункта: переопределение пользователя (если такая группа есть), иначе штатная. */
export function groupOfPerm(
  perm: string,
  sections: readonly NavSection[],
  navGroups: Readonly<Record<string, string>>,
  fallback: string = NAV_GROUPS[0],
): string {
  const override = navGroups[perm];
  const mapped = override !== undefined ? (LEGACY_NAV_GROUPS[override] ?? override) : undefined;
  if (mapped && (NAV_GROUPS as readonly string[]).includes(mapped)) return mapped;
  return sections.find((s) => s.perm === perm)?.group ?? fallback;
}

export interface NavMoveResult {
  navOrder: string[];
  navGroups: Record<string, string>;
}

/**
 * Переставить `perm` в группу `targetGroup` перед пунктом `beforePerm` (или в конец группы,
 * если `beforePerm` = null — дроп на пустое место группы).
 *
 * Возврат в родную группу удаляет переопределение, а не пишет его равным штатному: иначе после
 * пары перетаскиваний в prefs копился бы мусор, который пережил бы даже переименование группы
 * в следующем релизе.
 */
export function moveNavItem(
  perm: string,
  targetGroup: string,
  beforePerm: string | null,
  sections: readonly NavSection[],
  navOrder: readonly string[],
  navGroups: Readonly<Record<string, string>>,
): NavMoveResult {
  const order = fullNavOrder(sections, navOrder).filter((p) => p !== perm);
  const at = beforePerm ? order.indexOf(beforePerm) : -1;
  if (at < 0) order.push(perm); else order.splice(at, 0, perm);

  const home = sections.find((s) => s.perm === perm)?.group;
  const groups = { ...navGroups };
  if (targetGroup === home) delete groups[perm];
  else groups[perm] = targetGroup;

  return { navOrder: order, navGroups: groups };
}
