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

// ТЗ v17 (темизация): цвета/градиенты/тени переведены на CSS-переменные (проставляет
// ThemeVarsBridge по выбранной теме, дефолты — styles/themes.css). Радиусы/тайминги — статичны.
export const PREMIUM = {
  radius: 16,
  radiusSm: 12,

  /** Многослойные мягкие тени — «дорогая» глубина без грязи. `cardHover` подключён глобально
   *  в ui.css (`.ant-card-hoverable:hover`) — раньше был объявлен, но нигде не использовался,
   *  из-за чего интерактивные карточки визуально не отвечали на наведение. */
  shadow: {
    card: 'var(--shadow-card)',
    cardHover: 'var(--shadow-card-hover)',
    raised: '0 24px 60px -28px rgba(16,24,40,0.30)',
    inset: 'inset 0 1px 0 rgba(255,255,255,0.6)',
  },

  /** Фирменные градиенты (сайдбар/акценты/полотно) — по теме. */
  gradient: {
    sider: 'var(--sider-grad)',
    canvas: 'var(--canvas-grad)',
    header: 'var(--header-grad)',
    ink: 'var(--ink-grad)',
    goldLine: 'var(--gold-line)',
  },

  /** Хайрлайн-грань карточек (чуть теплее нейтрального дивайдера). */
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',

  /** Приглушённые «стеклянные» поверхности для вложенных блоков. */
  surfaceSoft: 'var(--surface-soft)',
  surfaceTint: 'var(--surface-tint)',
} as const;

/**
 * Модульная сетка отступов (T-59). База — 4px, основной шаг между блоками — 16px.
 *
 * Сетка не выдумана: по коду и так преобладали 8 / 12 / 16 / 24. Чинился дрейф — рядом с ними
 * жили 5, 6, 9, 11, 14, 18, из-за чего одинаковые по смыслу зазоры отличались на 1–2px и ряд
 * «плыл». Такие значения сняты на ближайшую ступень.
 *
 * ЧТО НЕ ЯВЛЯЕТСЯ дрейфом и на сетку НЕ снимается:
 *  · оптическая подгонка иконки под базовую линию текста (`marginTop: 2…3` рядом с иконкой) —
 *    сетка здесь именно РАСКОСИТ иконку;
 *  · графические зазоры внутри визуализаций (например `padding: 2` между ячейками теплокарты —
 *    это плотность мозаики, а не отступ макета).
 * Правило: сетка управляет РАСКЛАДКОЙ, а не оптикой и не графикой.
 */
export const GRID = 4;

/** Отступ в шагах сетки: `space(4)` → 16px. */
export const space = (steps: number): number => steps * GRID;

export const SPACE = {
  /** 4 — внутри строки: иконка↔подпись, чип↔чип. */
  tight: space(1),
  /** 8 — между связанными элементами одного блока. */
  snug: space(2),
  /** 12 — внутри карточки: заголовок↔содержимое. */
  cozy: space(3),
  /** 16 — ОСНОВНОЙ шаг: между карточками и секциями. */
  base: space(4),
  /** 20 — «воздух» premium-карточки (padding тела). */
  airy: space(5),
  /** 24 — поля страницы, крупные разделители. */
  page: space(6),
} as const;

/**
 * Типографическая шкала (T-58) — единственный источник размеров текста.
 *
 * Ступени взяты из того, что уже отрисовывалось на дашбордах (20/16/14/13/12), а не придуманы
 * заново: лестница заголовков была связной. Чинилось другое — дрейф и разнобой:
 *  · по коду разошлись 14 размеров, включая 9 / 9.5 / 10 / 10.5 / 15 / 17 — шаг меньше пункта
 *    не читается как иерархия, только как небрежность;
 *  · на ОДНОЙ ступени встречались три интерлиньяжа (14/400 → 22px, 30px, normal), из-за чего
 *    строки в соседних карточках стояли по-разному.
 * Поэтому у каждой ступени `lineHeight` задан явно.
 *
 * Правило: новый текст берёт ступень отсюда. Нужен размер, которого нет, — сначала спросить,
 * действительно ли это новая роль, и только тогда добавлять ступень.
 *
 * `metric*` — числовые показатели (центры диаграмм, счётчики карточек). В ECharts CSS-токен
 * не передать (там `lineHeight` — число), поэтому в графиках берутся поля: `TYPE.metricLg.fontSize`.
 */
export const TYPE = {
  /** Заголовок страницы. Совпадает с antd `Title level={4}`. */
  pageTitle: { fontSize: 20, fontWeight: 700, lineHeight: '28px', letterSpacing: -0.3 },
  /** Заголовок карточки. Совпадает с antd Card title (fontSizeLG). */
  cardTitle: { fontSize: 16, fontWeight: 600, lineHeight: '24px', letterSpacing: -0.1 },
  /** Подзаголовок внутри карточки, «шапки» блоков. */
  subTitle: { fontSize: 14, fontWeight: 600, lineHeight: '22px' },
  /** Основной текст. */
  body: { fontSize: 14, fontWeight: 400, lineHeight: '22px' },
  /** Плотный текст: описания в списках, вторая строка строки таблицы. */
  bodySm: { fontSize: 13, fontWeight: 400, lineHeight: '20px' },
  /** Подписи, сноски, пояснения под графиками. */
  caption: { fontSize: 12, fontWeight: 400, lineHeight: '18px' },
  /** Подпись-заголовок: имя плитки, шапка мини-блока. Отдельная ступень, а не `strong` поверх
   *  `caption` — иначе вес пришлось бы дописывать в каждом месте (их 30+). */
  captionStrong: { fontSize: 12, fontWeight: 600, lineHeight: '18px' },
  /** Легенды графиков, метки осей, служебные метки. Мельче 11px не опускаемся. */
  micro: { fontSize: 11, fontWeight: 500, lineHeight: '16px' },

  // Отрицательный трекинг на крупных цифрах/заголовках — Inter Variable без него на больших
  // кеглях выглядит рыхло (унаследовано от системных шрифтов, под которые исходно не считалось).
  metricLg: { fontSize: 28, fontWeight: 800, lineHeight: '34px', letterSpacing: -0.6 },
  metricMd: { fontSize: 24, fontWeight: 700, lineHeight: '30px', letterSpacing: -0.4 },
  metricSm: { fontSize: 18, fontWeight: 700, lineHeight: '24px', letterSpacing: -0.2 },
} as const satisfies Record<string, CSSProperties>;

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
 *
 * ВНИМАНИЕ: `accent` красит ШАПКУ. У карточки без `title` шапки нет — и акцент не даёт
 * ничего вообще (поймано скриншотом на форме входа). Если акцент нужен на карточке без
 * заголовка, задавайте грань явно: `premiumCard('gold', { borderTop: '2px solid ' + GOLD.base })`.
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
      // Ступень задаём явно, чтобы заголовок карточки не «плыл» вслед за токенами antd.
      ...TYPE.cardTitle,
      color: BRAND.ink,
      // Тонкая тёплая подложка шапки — «дорогой» акцент (по теме).
      background: accent === 'gold' ? 'var(--card-header-gold)' : PREMIUM.gradient.header,
    } as CSSProperties,
    body: { padding: SPACE.airy } as CSSProperties,
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
    marginRight: SPACE.snug,
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
  ...TYPE.pageTitle,
  margin: 0,
  color: BRAND.ink,
  letterSpacing: 0.2,
};

/** «Стеклянная» подложка для вложенных секций/строк. */
export const softPanel: CSSProperties = {
  background: PREMIUM.surfaceTint,
  border: `1px solid ${PREMIUM.border}`,
  borderRadius: PREMIUM.radiusSm,
};
