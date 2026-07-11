/**
 * premium.ts — единый «private & premium» визуальный слой поверх Ant Design.
 *
 * Задача: приподнять восприятие интерфейса до уровня private-banking (дорого, спокойно,
 * с воздухом), НЕ ломая читабельность и юзабилити. Не вводит тёмную тему и не переопределяет
 * поведение AntD — только общие токены (тени, радиусы, градиенты, поверхности) и хелперы
 * стиля карточек/заголовков, которые переиспользуются всеми дашбордами.
 *
 * Держать согласованным с ragPalette.ts (BRAND/RAG — источник цвета).
 */
import type { CSSProperties } from 'react';
import { BRAND } from './ragPalette';

/** Тёплое золото — акцент «премиальности» (тонкие хайрлайны, логотип, активные грани). */
export const GOLD = {
  base: '#B99A55',
  soft: '#E9DCBE',
  line: 'rgba(185,154,85,0.35)',
  glow: 'rgba(185,154,85,0.18)',
};

export const PREMIUM = {
  radius: 16,
  radiusSm: 12,

  /** Многослойные мягкие тени — «дорогая» глубина без грязи. */
  shadow: {
    card: '0 1px 2px rgba(16,24,40,0.04), 0 10px 28px -14px rgba(16,24,40,0.14)',
    cardHover: '0 2px 6px rgba(16,24,40,0.06), 0 18px 40px -16px rgba(16,24,40,0.22)',
    raised: '0 24px 60px -28px rgba(16,24,40,0.30)',
    inset: 'inset 0 1px 0 rgba(255,255,255,0.6)',
  },

  /** Фирменные градиенты (сайдбар/акценты/полотно). */
  gradient: {
    sider: 'linear-gradient(180deg, #16222F 0%, #1E2E3F 55%, #22384C 100%)',
    canvas: 'linear-gradient(180deg, #F7F8FA 0%, #F2F4F7 100%)',
    header: 'linear-gradient(180deg, #FFFFFF 0%, #FBFCFD 100%)',
    ink: 'linear-gradient(135deg, #2B3A4B 0%, #3A4F6B 100%)',
    goldLine: `linear-gradient(90deg, ${GOLD.line}, rgba(185,154,85,0) 70%)`,
  },

  /** Хайрлайн-грань карточек (чуть теплее нейтрального дивайдера). */
  border: '#EAEBEE',
  borderStrong: '#DFE1E6',

  /** Приглушённые «стеклянные» поверхности для вложенных блоков. */
  surfaceSoft: '#FAFBFC',
  surfaceTint: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
} as const;

export type AccentKey = 'ink' | 'gold' | 'sage' | 'terracotta' | 'slate' | 'none';

const ACCENT_COLOR: Record<Exclude<AccentKey, 'none'>, string> = {
  ink: BRAND.ink,
  gold: GOLD.base,
  sage: '#6F9F86',
  terracotta: '#C06B5A',
  slate: '#6E89A6',
};

/** Цвет акцент-маркера по ключу (для `accentDot`). */
export const accentColorOf = (accent: AccentKey): string | undefined =>
  accent === 'none' ? undefined : ACCENT_COLOR[accent];

/**
 * Пропсы премиальной карточки для AntD `<Card>`: тонкая грань, мягкая многослойная тень,
 * увеличенный радиус и премиальная шапка. Возвращает ТОЛЬКО валидные пропсы Card
 * (`style`, `styles`) — безопасно расширять: `<Card {...premiumCard('gold')} title=…>`.
 * Цвет акцента для `accentDot` берётся отдельно через `accentColorOf(accent)`.
 */
export function premiumCard(accent: AccentKey = 'none', extra?: CSSProperties) {
  const style: CSSProperties = {
    borderRadius: PREMIUM.radius,
    border: `1px solid ${PREMIUM.border}`,
    boxShadow: PREMIUM.shadow.card,
    background: BRAND.surface,
    overflow: 'hidden',
    ...extra,
  };
  const styles = {
    header: {
      borderBottom: `1px solid ${PREMIUM.border}`,
      minHeight: 52,
      fontWeight: 600,
      color: BRAND.ink,
      // Тонкая тёплая подложка шапки — «дорогой» акцент.
      background: accent === 'gold'
        ? 'linear-gradient(180deg, #FCFBF6 0%, #FFFFFF 100%)'
        : PREMIUM.gradient.header,
    } as CSSProperties,
    body: { padding: 18 } as CSSProperties,
  };
  return { style, styles };
}

/** Небольшой акцентный маркер (точка/риска) перед заголовком карточки. */
export function accentDot(color: string): CSSProperties {
  return {
    display: 'inline-block',
    width: 4,
    height: 16,
    borderRadius: 3,
    background: `linear-gradient(180deg, ${color}, ${color}CC)`,
    marginRight: 10,
    verticalAlign: 'text-bottom',
    boxShadow: `0 0 0 3px ${color}14`,
  };
}

/**
 * Полотно страницы дашборда. Отступ и фон-полотно даёт общий `<Content>` (AppLayout),
 * поэтому корень страницы прозрачный и без собственного паддинга — чтобы не задваивать.
 */
export const pageContainer: CSSProperties = {
  background: 'transparent',
  minHeight: '100%',
};

/** Заголовок страницы (H4) — с воздухом и премиальным трекингом. */
export const pageTitle: CSSProperties = {
  margin: 0,
  color: BRAND.ink,
  letterSpacing: 0.2,
  fontWeight: 700,
};

/** «Стеклянная» подложка для вложенных секций/строк. */
export const softPanel: CSSProperties = {
  background: PREMIUM.surfaceTint,
  border: `1px solid ${PREMIUM.border}`,
  borderRadius: PREMIUM.radiusSm,
};
