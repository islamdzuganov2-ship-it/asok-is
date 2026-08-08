/**
 * useThemeTokens.ts — доступ к активной теме в компонентах.
 *
 * DOM-слой перекрашивается CSS-переменными (см. ThemeVarsBridge), но ECharts рисует на canvas и
 * не понимает var() — графикам нужны КОНКРЕТНЫЕ цвета. Этот хук возвращает пресет активной темы;
 * в опциях ECharts берём `chart.ink` / `chart.axis` / `chart.split` вместо BRAND.ink.
 *
 * Добавляйте `themeName` (или `chart`) в зависимости useMemo опций графика, чтобы при смене темы
 * график перекрашивался.
 */
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { THEMES, type ChartTokens, type ThemePreset, type ThemeName } from './themes';

export function useThemeName(): ThemeName {
  return useSelector((s: RootState) => s.ui.themeName);
}

export function useThemePreset(): ThemePreset {
  return THEMES[useThemeName()];
}

/** Конкретные цвета для ECharts по активной теме. */
export function useChartTokens(): ChartTokens {
  return useThemePreset().chart;
}

export function useIsDarkTheme(): boolean {
  return useThemePreset().dark;
}
