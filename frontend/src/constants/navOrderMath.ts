/**
 * navOrderMath.ts — чистые операции над порядком и группировкой пунктов левого меню.
 *
 * Вынесено из SidebarNavEditor: правила «куда встанет перетащенный пункт» не зависят от React,
 * а сломать их легко — порядок хранится плоским списком, тогда как на экране пункты разложены
 * по трём группам.
 */

/** Раздел меню в том виде, в каком его знает NAV_SECTIONS. */
export interface NavSection { perm: string; group: string }

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

/** Группа пункта: переопределение пользователя, иначе штатная из NAV_SECTIONS. */
export function groupOfPerm(
  perm: string,
  sections: readonly NavSection[],
  navGroups: Readonly<Record<string, string>>,
  fallback = 'Основное',
): string {
  return navGroups[perm] ?? sections.find((s) => s.perm === perm)?.group ?? fallback;
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
