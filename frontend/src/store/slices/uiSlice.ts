import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { type ThemeName, isThemeName, DEFAULT_FONT_KEY, FONT_OPTIONS } from '../../theme/themes';
import { normalizeNavGroups } from '../../constants/navOrderMath';

/** Источник данных дашбордов: 'mock' — демо для презентации, 'live' — реальное API + LLM. */
export type DataMode = 'mock' | 'live';

const DATA_MODE_KEY = 'asok_data_mode';
const FEATURE_KEY = 'asok_exec_features';
const ORDER_KEY = 'asok_nav_order';
/** Переносы пунктов между группами меню (без ТЗ, ТЗ-23 §5): { <право>: <название группы> }. */
const GROUPS_KEY = 'asok_nav_groups';
const THEME_KEY = 'asok_theme';
const FONT_KEY = 'asok_font';

function loadDataMode(): DataMode {
  return localStorage.getItem(DATA_MODE_KEY) === 'live' ? 'live' : 'mock';
}

function loadThemeName(): ThemeName {
  const v = localStorage.getItem(THEME_KEY);
  return isThemeName(v) ? v : 'premium';
}

function loadFontKey(): string {
  const v = localStorage.getItem(FONT_KEY);
  return FONT_OPTIONS.some((f) => f.key === v) ? (v as string) : DEFAULT_FONT_KEY;
}

/**
 * Разделы меню, доступные для персонализации (ДЕФ-12/ДЕФ-14, БТ-444/БТ-445).
 *
 * Раньше флагов было четыре на девять дашбордов, и действовали они ТОЛЬКО для ADMIN/CTO/CEO:
 * менеджер по качеству видел тумблеры в «Настройка», щёлкал — и ничего не происходило.
 * Требование заказчика (2026-08-08) — «настроить дашборды под себя, перетаскивать по
 * странице»: флаг и позиция у КАЖДОГО раздела и для КАЖДОЙ роли.
 *
 * Персонализация — предпочтение ПОВЕРХ RBAC, а не право: скрыть можно только то, что и так
 * доступно по матрице. Ключ раздела совпадает с ключом права — связь «право → тумблер»
 * видна без отдельной таблицы соответствий.
 */
/**
 * `question` (ТЗ v21 §8.1, КП-36) — вопрос, на который отвечает раздел. Названия разделов
 * описывают артефакт («База рисков»), а руководитель ищет ответ («что мы уже знаем о рисках»).
 * Поле используется командной строкой Ctrl+K как второй ключ поиска — раздел находится и по
 * вопросу тоже.
 *
 * `group` (ТЗ-21 §8.2, КП-37) — группа по глубине раскрытия, см. NAV_GROUPS в navOrderMath.ts.
 * Прежние группы «Основное / Сбор и анализ данных / Формирование техдолга» делили меню по типу
 * артефакта: кокпит CEO стоял в одном ряду с аналитическим дашбордом, «Мои задачи» — рядом с
 * риск-радаром. Сохранённые пользователями переносы старых групп переводятся при чтении
 * (normalizeNavGroups), а не теряются.
 */
export const NAV_SECTIONS: ReadonlyArray<{ perm: string; label: string; group: string; question: string }> = [
  // Моя картина — посадочные экраны ролей (L1). «Мой дашборд» первым: к личному набору возвращаются чаще всего.
  { perm: 'view.my_dashboard', label: 'Мой дашборд', group: 'Моя картина', question: 'Что я собрал под себя?' },
  { perm: 'view.dashboard.cto', label: 'Дашборд CTO', group: 'Моя картина', question: 'Что требует моего решения?' },
  { perm: 'view.dashboard.ceo', label: 'Дашборд CEO', group: 'Моя картина', question: 'Сколько нам это стоит и что требует подписи?' },
  { perm: 'view.dashboard.manager', label: 'Основное', group: 'Моя картина', question: 'Где просело и что предложить?' },
  { perm: 'view.dashboard.risk', label: 'Основное — риск', group: 'Моя картина', question: 'Что мы уже знаем о своих рисках?' },
  { perm: 'view.my_tasks', label: 'Мои задачи', group: 'Моя картина', question: 'Что поручено лично мне?' },

  // Разрезы — аналитика «почему так» (L2).
  { perm: 'view.dashboard.analytics', label: 'Аналитический дашборд', group: 'Разрезы', question: 'Что показывают цифры за период?' },
  { perm: 'view.dashboard.dynamics', label: 'Динамика качества', group: 'Разрезы', question: 'Куда движемся?' },
  { perm: 'view.dashboard.incidents', label: 'Аналитика сбоев', group: 'Разрезы', question: 'Насколько мы надёжны?' },
  { perm: 'view.dashboard.risk_radar', label: 'Риск-радар', group: 'Разрезы', question: 'Что может рвануть?' },
  { perm: 'view.dashboard.taskplan', label: 'План задач', group: 'Разрезы', question: 'Что и когда должно быть сделано?' },

  // Работа с данными — первичные записи и выгрузки (L3).
  { perm: 'view.assessments', label: 'Внесение данных', group: 'Работа с данными', question: 'Откуда берутся цифры?' },
  { perm: 'view.risks', label: 'База рисков', group: 'Работа с данными', question: 'Что может произойти?' },
  { perm: 'view.risk_economics', label: 'Риск-экономика', group: 'Работа с данными', question: 'Во что это превращается в рублях?' },
  { perm: 'view.reports', label: 'Отчёты', group: 'Работа с данными', question: 'Что выгрузить наружу?' },
];

/** Скрытые пользователем разделы. Храним именно СКРЫТЫЕ, чтобы новый раздел из релиза
 *  появлялся сам, а не оставался невидимым до ручного включения. */
type HiddenMap = Record<string, true>;

/** Экспортируется для тестов: initialState вычисляется один раз при загрузке модуля,
 *  поэтому контракт «что попадёт в стор из localStorage» проверяется на самих загрузчиках. */
export function loadHidden(): HiddenMap {
  try {
    const raw = JSON.parse(localStorage.getItem(FEATURE_KEY) || '{}');
    // Обратная совместимость с прежним форматом {execAnalytics: false} (ТЗ v17).
    const LEGACY: Record<string, string> = {
      execAnalytics: 'view.dashboard.analytics',
      execDynamics: 'view.dashboard.dynamics',
      execTaskPlan: 'view.dashboard.taskplan',
      execIncidents: 'view.dashboard.incidents',
      execRiskRadar: 'view.dashboard.risk_radar',
    };
    const hidden: HiddenMap = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key in LEGACY) {
        if (value === false) hidden[LEGACY[key]] = true;
      } else if (value === true) {
        hidden[key] = true;
      }
    }
    return hidden;
  } catch {
    return {};
  }
}

export function loadOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Переносы пунктов между группами меню. Пусто = пункт остаётся в своей группе из NAV_SECTIONS. */
export function loadNavGroups(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const strings = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
    // КП-37: переносы в группы со старыми названиями переводятся, а не теряются.
    return normalizeNavGroups(strings, NAV_SECTIONS);
  } catch {
    return {};
  }
}

interface UiState {
  activeModal: string | null;
  globalLoading: boolean;
  /** Активная тема оформления (ТЗ v17): premium · classic (Windows) · graphite (тёмная). */
  themeName: ThemeName;
  /** Ключ выбранного шрифта (theme/themes.ts FONT_OPTIONS). */
  fontKey: string;
  dataMode: DataMode;
  /** Разделы, скрытые пользователем (ДЕФ-12). */
  hiddenSections: HiddenMap;
  /** Порядок разделов (ДЕФ-14). Ключи вне списка идут следом в исходном порядке. */
  navOrder: string[];
  /** Пункты, перенесённые пользователем в другую группу меню (без ТЗ, ТЗ-23 §5). */
  navGroups: Record<string, string>;
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    activeModal: null,
    globalLoading: false,
    themeName: loadThemeName(),
    fontKey: loadFontKey(),
    dataMode: loadDataMode(),
    hiddenSections: loadHidden(),
    navOrder: loadOrder(),
    navGroups: loadNavGroups(),
  } as UiState,
  reducers: {
    openModal(state, action: PayloadAction<string>) { state.activeModal = action.payload; },
    closeModal(state) { state.activeModal = null; },
    setGlobalLoading(state, action: PayloadAction<boolean>) { state.globalLoading = action.payload; },
    setThemeName(state, action: PayloadAction<ThemeName>) {
      state.themeName = action.payload;
      localStorage.setItem(THEME_KEY, action.payload);
    },
    setFontKey(state, action: PayloadAction<string>) {
      state.fontKey = action.payload;
      localStorage.setItem(FONT_KEY, action.payload);
    },
    setDataMode(state, action: PayloadAction<DataMode>) {
      state.dataMode = action.payload;
      localStorage.setItem(DATA_MODE_KEY, action.payload);
    },
    /** Показать/скрыть раздел меню (ДЕФ-12). */
    setSectionVisible(state, action: PayloadAction<{ perm: string; visible: boolean }>) {
      const { perm, visible } = action.payload;
      if (visible) delete state.hiddenSections[perm];
      else state.hiddenSections[perm] = true;
      localStorage.setItem(FEATURE_KEY, JSON.stringify(state.hiddenSections));
    },
    /** Задать порядок разделов (ДЕФ-14 — перетаскивание в «Настройка» и в самом сайдбаре). */
    setNavOrder(state, action: PayloadAction<string[]>) {
      state.navOrder = action.payload;
      localStorage.setItem(ORDER_KEY, JSON.stringify(action.payload));
    },
    /** Перенести пункт в другую группу меню (без ТЗ, ТЗ-23 §5). */
    setNavGroup(state, action: PayloadAction<{ perm: string; group: string | null }>) {
      const { perm, group } = action.payload;
      if (group === null) delete state.navGroups[perm];
      else state.navGroups[perm] = group;
      localStorage.setItem(GROUPS_KEY, JSON.stringify(state.navGroups));
    },
    /**
     * Применить настройки меню, пришедшие с сервера (без ТЗ, ТЗ-23 §5).
     *
     * localStorage остаётся быстрым кэшем — он рисует меню до ответа сети и не даёт ему
     * «прыгнуть» при загрузке. Источник истины — серверные prefs: они переносят настройку между
     * устройствами. Гидратация происходит один раз за сессию (см. useNavPrefsHydration), поэтому
     * правки пользователя не затираются приходящим позже ответом.
     */
    hydrateNavPrefs(
      state,
      action: PayloadAction<{ navOrder?: string[]; hiddenSections?: HiddenMap; navGroups?: Record<string, string> }>,
    ) {
      const { navOrder, hiddenSections, navGroups } = action.payload;
      if (navOrder) {
        state.navOrder = navOrder;
        localStorage.setItem(ORDER_KEY, JSON.stringify(navOrder));
      }
      if (hiddenSections) {
        state.hiddenSections = hiddenSections;
        localStorage.setItem(FEATURE_KEY, JSON.stringify(hiddenSections));
      }
      if (navGroups) {
        // Серверные prefs могли быть сохранены до КП-37 — со старыми названиями групп.
        state.navGroups = normalizeNavGroups(navGroups, NAV_SECTIONS);
        localStorage.setItem(GROUPS_KEY, JSON.stringify(state.navGroups));
      }
    },
    /** Сбросить персонализацию к виду по умолчанию. */
    resetPersonalization(state) {
      state.hiddenSections = {};
      state.navOrder = [];
      state.navGroups = {};
      localStorage.removeItem(FEATURE_KEY);
      localStorage.removeItem(ORDER_KEY);
      localStorage.removeItem(GROUPS_KEY);
    },
  },
});

export const {
  openModal, closeModal, setGlobalLoading, setThemeName, setFontKey, setDataMode,
  setSectionVisible, setNavOrder, setNavGroup, hydrateNavPrefs, resetPersonalization,
} = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
