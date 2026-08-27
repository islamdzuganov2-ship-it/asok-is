/**
 * useDashboardLayout.ts — персональная раскладка дашборда: чтение, слияние с дефолтом, запись.
 *
 * Хранилище — серверное (`GET/PUT /iam/me/preferences`, свободный JSONB), поэтому раскладка
 * едет за пользователем между устройствами. Формат:
 *
 *   prefs.dashboards["<key>"] = { layout: [{ i, x, y, w, h }], v: 2 }
 *
 * Слияние с дефолтом — не «что сохранено, то и рисуем», а три правила:
 *  1) карточки, которых больше нет в каталоге (переименовали/убрали в релизе), выкидываются;
 *  2) карточки без права у ЭТОГО пользователя выкидываются (админ мог забрать право после того,
 *     как дашборд был собран) — RBAC остаётся верхней границей;
 *  3) если пользователь дашборд не трогал, берётся дефолтная раскладка — вид «как раньше».
 *
 * Обратная совместимость: до конструктора «Владелец риска» хранил `{widgets:[{id,enabled,order}]}`
 * (BL-008, Фаза 4). Такие prefs читаются и конвертируются в раскладку на лету — пользователи,
 * успевшие настроить виджеты, ничего не теряют.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import {
  useGetMyPreferencesQuery,
  usePutMyPreferencesMutation,
  type UserPrefs,
} from '../store/api/apiSlice';
import { cardById } from './registry';
import {
  layoutFromWidgets, sanitize, nextFreeRow, geometryOf, type CardLookup,
} from './layoutMath';
import type { CardLayout, DashboardKey } from './types';

/** Справочник карточек для чистых операций над раскладкой (layoutMath). */
const lookup: CardLookup = cardById;

interface UseDashboardLayoutResult {
  /** Что рисовать сейчас (в режиме редактирования — черновик). */
  layout: CardLayout[];
  /** Раскладка отличается от сохранённой. */
  dirty: boolean;
  saving: boolean;
  /** Пользователь уже настраивал этот дашборд (значит, «Сбросить» имеет смысл). */
  customized: boolean;
  setLayout: (next: CardLayout[]) => void;
  addCard: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  save: () => Promise<boolean>;
  /** Откатить черновик к сохранённому состоянию (кнопка «Отмена»). */
  revert: () => void;
  /** Вернуться к штатной раскладке дашборда (кнопка «Сбросить»). */
  resetToDefault: () => void;
}

export function useDashboardLayout(
  dashboardKey: DashboardKey,
  defaultLayout: CardLayout[],
  /** Открыт ли режим редактирования — пока открыт, черновик не перетирается ответом сервера. */
  editing: boolean,
): UseDashboardLayoutResult {
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const { data: prefsData } = useGetMyPreferencesQuery();
  const [putPrefs, putState] = usePutMyPreferencesMutation();

  const saved = prefsData?.prefs?.dashboards?.[dashboardKey];
  const customized = !!saved;

  // Сохранённое (или дефолт) → уже очищенное от недоступных карточек.
  const effective = useMemo(() => {
    const base = saved?.layout
      ? saved.layout
      : saved?.widgets
        ? layoutFromWidgets(saved.widgets, dashboardKey, lookup)
        : defaultLayout;
    return sanitize(base, permissions, lookup);
  }, [saved, defaultLayout, permissions, dashboardKey]);

  const [draft, setDraft] = useState<CardLayout[]>(effective);
  /**
   * Синхронизация черновика с сервером — ТОЛЬКО вне режима редактирования.
   *
   * Сервер остаётся источником истины (раскладку могли поменять на другом устройстве), но
   * забирать его ответ посреди правки нельзя: `prefsData` приходит новым объектом на каждом
   * рефетче — а он случается сам по себе, потому что в apiSlice включён `refetchOnFocus`, плюс
   * инвалидация тега после собственного сохранения. Без этой проверки такой рефетч посреди
   * перетаскивания молча вернул бы карточку на прежнее место.
   */
  useEffect(() => { if (!editing) setDraft(effective); }, [effective, editing]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(effective), [draft, effective]);

  const addCard = useCallback((cardId: string) => {
    const def = cardById(cardId);
    if (!def) return;
    setDraft((prev) => {
      if (prev.some((r) => r.i === cardId)) return prev;
      return [...prev, { i: cardId, x: 0, y: nextFreeRow(prev), w: def.w, h: def.h }];
    });
  }, []);

  const removeCard = useCallback((cardId: string) => {
    setDraft((prev) => prev.filter((r) => r.i !== cardId));
  }, []);

  const save = useCallback(async () => {
    const prefs: UserPrefs = { ...(prefsData?.prefs ?? {}) };
    prefs.dashboards = { ...(prefs.dashboards ?? {}) };
    // Пишем только геометрию: лишние поля, которые react-grid-layout навешивает на Layout
    // (static, moved, isDraggable…), в prefs не нужны и мешают сравнению на dirty.
    prefs.dashboards[dashboardKey] = {
      v: 2,
      layout: geometryOf(draft),
    };
    try {
      await putPrefs({ prefs }).unwrap();
      return true;
    } catch {
      return false;
    }
  }, [draft, prefsData, putPrefs, dashboardKey]);

  const revert = useCallback(() => setDraft(effective), [effective]);

  const resetToDefault = useCallback(() => {
    setDraft(sanitize(defaultLayout, permissions, lookup));
  }, [defaultLayout, permissions]);

  return {
    layout: draft,
    dirty,
    saving: putState.isLoading,
    customized,
    setLayout: setDraft,
    addCard,
    removeCard,
    save,
    revert,
    resetToDefault,
  };
}
