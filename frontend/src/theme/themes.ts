/**
 * themes.ts — рантайм-темы оформления (ТЗ v17: выбор темы и шрифта в «Настройка»).
 *
 * Три темы:
 *   • premium  — исходный «private banking» светлый слой (графит + золото);
 *   • classic  — классический Windows: бело-голубой, плоские скругления, синий сайдбар;
 *   • graphite — премиальный тёмный: графит/тёмно-серый, МЯГКИЙ читаемый светлый текст (не «резкий»).
 *
 * Механика применения (см. App.tsx / ThemeVarsBridge):
 *   1) antd — через ConfigProvider (algorithm + token) с cssVar: перекрашивает ВСЕ компоненты antd;
 *   2) кастомный «хром» и инлайн-текст дашбордов — через CSS-переменные (--ink, --surface, градиенты
 *      сайдбара/полотна/шапки), которые проставляет ThemeVarsBridge на <html> по выбранной теме.
 *      Значения токенов BRAND/PREMIUM переведены на эти переменные (theme/premium.ts, ragPalette.ts),
 *      поэтому весь DOM-слой перекрашивается без правок по местам.
 *   3) ECharts (canvas) не понимает var() — графики берут КОНКРЕТНЫЕ цвета из preset.chart через
 *      useThemeTokens() (theme/useThemeTokens.ts).
 *
 * RAG-палитра (статусы red/amber/green) НЕ темизируется — это семантика, одинаковая во всех темах.
 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

export type ThemeName = 'premium' | 'classic' | 'graphite';

/** Конкретные цвета для ECharts (canvas не понимает CSS-переменные). */
export interface ChartTokens {
  ink: string;
  inkSoft: string;
  axis: string;
  split: string;
}

export interface ThemePreset {
  name: ThemeName;
  label: string;
  hint: string;
  dark: boolean;
  /** Токены antd (перекрывают дефолт). algorithm выбирается по dark. */
  antd: NonNullable<ThemeConfig['token']>;
  /** CSS-переменные кастомного слоя (проставляются на :root). */
  vars: Record<string, string>;
  /** Конкретные цвета для графиков. */
  chart: ChartTokens;
}

// ── premium (по умолчанию) — сегодняшний светлый вид ──
const PREMIUM_PRESET: ThemePreset = {
  name: 'premium',
  label: 'Премиум (по умолчанию)',
  hint: 'Спокойный светлый графит с золотым акцентом',
  dark: false,
  antd: {
    colorPrimary: '#3A4F6B', colorInfo: '#6E89A6',
    colorText: '#2B3A4B', colorTextSecondary: '#5B6675',
    colorBgContainer: '#FFFFFF', colorBgLayout: '#F5F6F8', colorBgElevated: '#FFFFFF',
    colorBorder: '#DFE1E6', colorBorderSecondary: '#EAEBEE',
    // Контраст ссылок (T-57): colorInfo #6E89A6 как ссылка = 3.63:1 — поднимаем.
    colorLink: '#50749B', colorLinkHover: '#3F5F82', colorLinkActive: '#33506F',
  },
  vars: {
    '--ink': '#2B3A4B', '--ink-soft': '#5B6675',
    '--surface': '#FFFFFF', '--canvas': '#F5F6F8', '--divider': '#E8EAED',
    '--border': '#EAEBEE', '--border-strong': '#DFE1E6',
    '--surface-soft': '#FAFBFC', '--divider-soft': '#F0F1F3', '--divider-alt': '#EEF0F2', '--border-soft': '#D5DAE0',
    '--surface-tint': 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
    '--sider-grad': 'linear-gradient(180deg, #16222F 0%, #1E2E3F 55%, #22384C 100%)',
    '--header-grad': 'linear-gradient(180deg, #FFFFFF 0%, #FBFCFD 100%)',
    '--canvas-grad': 'linear-gradient(180deg, #F7F8FA 0%, #F2F4F7 100%)',
    '--ink-grad': 'linear-gradient(135deg, #2B3A4B 0%, #3A4F6B 100%)',
    '--gold-line': 'linear-gradient(90deg, rgba(185,154,85,0.35), rgba(185,154,85,0) 70%)',
    '--card-header-grad': 'linear-gradient(180deg, #FFFFFF 0%, #FBFCFD 100%)',
    '--card-header-gold': 'linear-gradient(180deg, #FCFBF6 0%, #FFFFFF 100%)',
    '--shadow-card': '0 1px 2px rgba(16,24,40,0.04), 0 10px 28px -14px rgba(16,24,40,0.14)',
  },
  chart: { ink: '#2B3A4B', inkSoft: '#5B6675', axis: '#5B6675', split: '#EAECEF' },
};

// ── classic — классический Windows «бело-голубой» ──
const CLASSIC_PRESET: ThemePreset = {
  name: 'classic',
  label: 'Классический Windows',
  hint: 'Бело-голубой, плоские скругления, синий сайдбар',
  dark: false,
  antd: {
    colorPrimary: '#1B5FB3', colorInfo: '#1B5FB3', colorLink: '#1B5FB3',
    colorText: '#17324D', colorTextSecondary: '#4A6076',
    colorBgContainer: '#FFFFFF', colorBgLayout: '#E9EFF7', colorBgElevated: '#FFFFFF',
    colorBorder: '#AEC4E0', colorBorderSecondary: '#CBD9EA',
    borderRadius: 4,
  },
  vars: {
    '--ink': '#17324D', '--ink-soft': '#4A6076',
    '--surface': '#FFFFFF', '--canvas': '#E9EFF7', '--divider': '#CBD9EA',
    '--border': '#C6D6EA', '--border-strong': '#AEC4E0',
    '--surface-soft': '#F2F6FC', '--divider-soft': '#EAF0F8', '--divider-alt': '#E4ECF7', '--border-soft': '#AEC4E0',
    '--surface-tint': 'linear-gradient(180deg, #FFFFFF 0%, #F0F5FC 100%)',
    '--sider-grad': 'linear-gradient(180deg, #1F5FB0 0%, #1A5299 60%, #164A8A 100%)',
    '--header-grad': 'linear-gradient(180deg, #F4F8FD 0%, #E9F1FB 100%)',
    '--canvas-grad': 'linear-gradient(180deg, #EEF3FA 0%, #E4ECF7 100%)',
    '--ink-grad': 'linear-gradient(135deg, #17324D 0%, #1B5FB3 100%)',
    '--gold-line': 'linear-gradient(90deg, rgba(27,95,179,0.40), rgba(27,95,179,0) 70%)',
    '--card-header-grad': 'linear-gradient(180deg, #F5F9FE 0%, #FFFFFF 100%)',
    '--card-header-gold': 'linear-gradient(180deg, #EEF4FC 0%, #FFFFFF 100%)',
    '--shadow-card': '0 1px 2px rgba(23,50,77,0.06), 0 8px 20px -12px rgba(23,50,77,0.18)',
  },
  chart: { ink: '#17324D', inkSoft: '#4A6076', axis: '#4A6076', split: '#DCE7F3' },
};

// ── graphite — премиальный тёмный (графит/тёмно-серый), мягкий читаемый текст ──
const GRAPHITE_PRESET: ThemePreset = {
  name: 'graphite',
  label: 'Премиальный графит (тёмный)',
  hint: 'Графит и тёмно-серый, мягкий читаемый светлый текст',
  dark: true,
  antd: {
    colorPrimary: '#8EA6C4', colorInfo: '#8EA6C4', colorLink: '#9DB4D2',
    // ДЕФ-08. На тёмном полотне светло-синий акцент читается как графика (6.00:1 на карточке),
    // но текст ПОВЕРХ него antd по умолчанию рисует белым — это давало 2.50:1 на первичной
    // кнопке и выбранном пункте меню при норме 4.5:1. В тёмной теме текст на светлой заливке
    // должен быть ТЁМНЫМ: #16202C на #8EA6C4 = 6.58:1. Так сохраняется и акцент, и контраст.
    colorTextLightSolid: '#16202C',
    // Мягкий светлый текст — читаемый, не «резкий» (не чистый белый).
    colorText: '#C9CFD8', colorTextSecondary: '#98A2AE',
    colorBgContainer: '#23272E', colorBgLayout: '#191C21', colorBgElevated: '#262B33',
    colorBorder: '#3C434E', colorBorderSecondary: '#313742',
  },
  vars: {
    '--ink': '#C9CFD8', '--ink-soft': '#98A2AE',
    '--surface': '#23272E', '--canvas': '#191C21', '--divider': '#313742',
    '--border': '#313742', '--border-strong': '#3C434E',
    '--surface-soft': '#1E2228', '--divider-soft': '#242932', '--divider-alt': '#2A2F37', '--border-soft': '#3C434E',
    '--surface-tint': 'linear-gradient(180deg, #262B33 0%, #20242B 100%)',
    '--sider-grad': 'linear-gradient(180deg, #15181D 0%, #1B1F25 55%, #20252C 100%)',
    '--header-grad': 'linear-gradient(180deg, #23272E 0%, #1E2228 100%)',
    '--canvas-grad': 'linear-gradient(180deg, #191C21 0%, #15181D 100%)',
    '--ink-grad': 'linear-gradient(135deg, #2B3A4B 0%, #3A4F6B 100%)',
    '--gold-line': 'linear-gradient(90deg, rgba(185,154,85,0.40), rgba(185,154,85,0) 70%)',
    '--card-header-grad': 'linear-gradient(180deg, #262B33 0%, #23272E 100%)',
    '--card-header-gold': 'linear-gradient(180deg, #2A2A26 0%, #23272E 100%)',
    '--shadow-card': '0 1px 2px rgba(0,0,0,0.35), 0 12px 30px -16px rgba(0,0,0,0.55)',
  },
  chart: { ink: '#C9CFD8', inkSoft: '#98A2AE', axis: '#98A2AE', split: '#313742' },
};

export const THEMES: Record<ThemeName, ThemePreset> = {
  premium: PREMIUM_PRESET,
  classic: CLASSIC_PRESET,
  graphite: GRAPHITE_PRESET,
};

export const THEME_ORDER: ThemeName[] = ['premium', 'classic', 'graphite'];

export function isThemeName(v: unknown): v is ThemeName {
  return v === 'premium' || v === 'classic' || v === 'graphite';
}

// ── Шрифты: только веб-безопасные стеки (без внешней загрузки — работает офлайн в Docker) ──
export interface FontOption { key: string; label: string; stack: string; }

export const FONT_OPTIONS: FontOption[] = [
  { key: 'system', label: 'Системный (по умолчанию)', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { key: 'segoe', label: 'Segoe UI (Windows)', stack: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" },
  { key: 'roboto', label: 'Roboto / Arial', stack: "Roboto, Arial, 'Helvetica Neue', sans-serif" },
  { key: 'georgia', label: 'Georgia (с засечками)', stack: "Georgia, 'Times New Roman', 'PT Serif', serif" },
];

export const DEFAULT_FONT_KEY = 'system';

export function fontStackOf(key: string): string {
  return (FONT_OPTIONS.find((f) => f.key === key) ?? FONT_OPTIONS[0]).stack;
}

/** Собрать конфиг темы antd из пресета + выбранного шрифта. cssVar включает CSS-переменные antd. */
export function antdThemeOf(preset: ThemePreset, fontKey: string): ThemeConfig {
  // Светлые темы наследуют точечные контраст-правки T-57 (плейсхолдер, фон info-Alert);
  // в тёмной их считает darkAlgorithm.
  const lightExtras = preset.dark ? {} : { colorTextPlaceholder: '#6E7787', colorInfoBg: '#EAF0F4' };
  return {
    cssVar: true,
    hashed: false,
    algorithm: preset.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // Семантические статусы (спокойная RAG-палитра) — единые во всех темах.
      colorSuccess: '#6F9F86', colorWarning: '#C9A14A', colorError: '#C06B5A',
      ...lightExtras,
      ...preset.antd,
      fontFamily: fontStackOf(fontKey),
      // T-57: описание/вторичный текст держим на читаемом тоне темы.
      colorTextDescription: preset.antd.colorTextSecondary,
    },
    components: {
      // ДЕФ-08. Сайдбар — всегда тёмная менюшка (theme="dark") на градиенте --sider-grad,
      // независимо от темы приложения, а заливки у выбранного пункта нет: текст лежит прямо
      // на градиенте. Цвет текста задаём ЯВНО, иначе antd берёт его из colorTextLightSolid —
      // и после правки graphite (тёмный текст на светлой заливке) выбранный пункт стал бы
      // тёмным на тёмном фоне. Пара «белый на самом светлом стопе градиента» = 12.08:1
      // проверяется в check-contrast.mjs («Сайдбар: пункт меню antd dark»).
      Menu: {
        darkItemSelectedColor: '#FFFFFF',
        darkItemHoverColor: '#FFFFFF',
      },
    },
  };
}
