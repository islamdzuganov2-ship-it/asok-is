import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { type ThemeName, isThemeName, DEFAULT_FONT_KEY, FONT_OPTIONS } from '../../theme/themes';

/** Источник данных дашбордов: 'mock' — демо для презентации, 'live' — реальное API + LLM. */
export type DataMode = 'mock' | 'live';

const DATA_MODE_KEY = 'asok_data_mode';
const FEATURE_KEY = 'asok_exec_features';
const ORDER_KEY = 'asok_nav_order';
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
export const NAV_SECTIONS: ReadonlyArray<{ perm: string; label: string; group: string; question: string }> = [
  { perm: 'view.dashboard.cto', label: 'Дашборд CTO', group: 'Основное', question: 'Что требует моего решения?' },
  { perm: 'view.dashboard.ceo', label: 'Дашборд CEO', group: 'Основное', question: 'Сколько нам это стоит и что требует подписи?' },
  { perm: 'view.dashboard.manager', label: 'Основное', group: 'Основное', question: 'Где просело и что предложить?' },
  { perm: 'view.dashboard.risk', label: 'Основное — риск', group: 'Основное', question: 'Что мы уже знаем о своих рисках?' },
  { perm: 'view.dashboard.analytics', label: 'Аналитический дашборд', group: 'Основное', question: 'Что показывают цифры за период?' },
  { perm: 'view.dashboard.dynamics', label: 'Динамика качества', group: 'Основное', question: 'Куда движемся?' },
  { perm: 'view.assessments', label: 'Внесение данных', group: 'Сбор и анализ данных', question: 'Откуда берутся цифры?' },
  { perm: 'view.dashboard.incidents', label: 'Аналитика сбоев', group: 'Сбор и анализ данных', question: 'Насколько мы надёжны?' },
  { perm: 'view.risks', label: 'База рисков', group: 'Сбор и анализ данных', question: 'Что мы уже знаем о своих рисках?' },
  { perm: 'view.risk_economics', label: 'Риск-экономика', group: 'Сбор и анализ данных', question: 'Во что это превращается в рублях?' },
  { perm: 'view.reports', label: 'Отчёты', group: 'Сбор и анализ данных', question: 'Что выгрузить наружу?' },
  { perm: 'view.dashboard.taskplan', label: 'План задач', group: 'Формирование техдолга', question: 'Что и когда должно быть сделано?' },
  { perm: 'view.my_tasks', label: 'Мои задачи', group: 'Формирование техдолга', question: 'Что поручено лично мне?' },
  { perm: 'view.dashboard.risk_radar', label: 'Риск-радар', group: 'Формирование техдолга', question: 'Что может произойти?' },
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
    /** Задать порядок разделов (ДЕФ-14 — перетаскивание в «Настройка»). */
    setNavOrder(state, action: PayloadAction<string[]>) {
      state.navOrder = action.payload;
      localStorage.setItem(ORDER_KEY, JSON.stringify(action.payload));
    },
    /** Сбросить персонализацию к виду по умолчанию. */
    resetPersonalization(state) {
      state.hiddenSections = {};
      state.navOrder = [];
      localStorage.removeItem(FEATURE_KEY);
      localStorage.removeItem(ORDER_KEY);
    },
  },
});

export const {
  openModal, closeModal, setGlobalLoading, setThemeName, setFontKey, setDataMode,
  setSectionVisible, setNavOrder, resetPersonalization,
} = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
