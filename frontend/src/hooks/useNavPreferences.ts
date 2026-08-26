/**
 * useNavPreferences.ts — синхронизация настроек левого меню с серверными prefs (БТ-500).
 *
 * До этого порядок и скрытые разделы жили только в localStorage: на втором компьютере (или после
 * чистки кэша) пользователь получал меню по умолчанию и настраивал его заново. Теперь то же самое
 * хранится в `prefs.navOrder` / `prefs.hiddenSections` рядом с раскладками дашбордов.
 *
 * localStorage не выброшен намеренно: он рисует меню мгновенно, до ответа сети, и меню не
 * «прыгает» на первой отрисовке. Сервер догоняет и один раз за сессию приводит состояние к
 * своему — дальше правки идут в обе стороны сразу.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { hydrateNavPrefs } from '../store/slices/uiSlice';
import {
  useGetMyPreferencesQuery, usePutMyPreferencesMutation, type UserPrefs,
} from '../store/api/apiSlice';

/** Один раз за сессию применяет настройки меню с сервера поверх localStorage-кэша. */
export function useNavPrefsHydration(): void {
  const dispatch = useAppDispatch();
  const { data } = useGetMyPreferencesQuery();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !data) return;
    done.current = true;
    const { navOrder, hiddenSections, navGroups } = data.prefs ?? {};
    // Пустой ответ — не повод стирать локальную настройку: у пользователя может быть
    // localStorage-настройка, сделанная до появления серверного хранения.
    if (!navOrder && !hiddenSections && !navGroups) return;
    dispatch(hydrateNavPrefs({ navOrder, hiddenSections, navGroups }));
  }, [data, dispatch]);
}

/**
 * Возвращает функцию записи настроек меню на сервер.
 *
 * Пишем ровно те поля, которые изменились, поверх актуальных prefs — иначе параллельная правка
 * раскладки дашборда (тот же объект `prefs`) была бы затёрта.
 */
export function useSaveNavPrefs(): (patch: {
  navOrder?: string[];
  hiddenSections?: Record<string, true>;
  navGroups?: Record<string, string>;
}) => void {
  const { data } = useGetMyPreferencesQuery();
  const [putPrefs] = usePutMyPreferencesMutation();
  const navOrder = useSelector((s: RootState) => s.ui.navOrder);
  const hiddenSections = useSelector((s: RootState) => s.ui.hiddenSections);
  const navGroups = useSelector((s: RootState) => s.ui.navGroups);

  return useCallback((patch) => {
    const prefs: UserPrefs = {
      ...(data?.prefs ?? {}),
      navOrder: patch.navOrder ?? navOrder,
      hiddenSections: patch.hiddenSections ?? hiddenSections,
      navGroups: patch.navGroups ?? navGroups,
    };
    // Ошибку записи намеренно не показываем модалкой: локально настройка уже применена, а
    // навязчивое сообщение на каждое перетаскивание пункта меню раздражало бы сильнее пользы.
    putPrefs({ prefs }).unwrap().catch(() => { /* останется локальной до следующей правки */ });
  }, [data, putPrefs, navOrder, hiddenSections, navGroups]);
}
