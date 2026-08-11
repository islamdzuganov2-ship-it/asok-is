/**
 * designSystem.test.ts — регресс визуальных инвариантов на уровне источника истины.
 *
 * Делит зону ответственности со статическим аудитом:
 *   • `npm run check:ui` ловит НАРУШЕНИЯ В МЕСТАХ ВЫЗОВА (карточка мимо слоя, число без выравнивания);
 *   • эти тесты защищают САМУ СИСТЕМУ — палитру, шкалу, сетку, хелперы. Если кто-то «поправит»
 *     оттенок в ragPalette или добавит ступень мимо сетки, это упадёт здесь, а не в проде.
 *
 * Контраст дублируется с `check:contrast` намеренно: скрипт держит числа для CI и ревью,
 * тест — для тех, кто гоняет только `npm test`.
 */
import { describe, expect, it } from 'vitest';
import {
  LEVEL_COLORS, LEVEL_TAG_COLORS, RAG, ragByScore, ragToken, solidTagStyle,
} from '../theme/ragPalette';
import { GRID, SPACE, TYPE, space } from '../theme/premium';
import { THEMES, THEME_ORDER } from '../theme/themes';
import { numericColumn } from '../theme/table';
import { BUCKET_LEVEL } from '../components/LevelHeatmap';

// ТЗ v17 (темизация): BRAND.ink/inkSoft теперь CSS-переменные (var(--ink)…), конкретные значения
// живут в реестре тем. Контраст проверяем по конкретным цветам темы; PREMIUM — тема по умолчанию
// (её значения = прежние BRAND.ink/BRAND.inkSoft).
const PREMIUM_INK = THEMES.premium.vars['--ink'];

// --- контраст (WCAG 2.1) ---
const hex2rgb = (h: string) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const luminance = (hex: string) => {
  const [r, g, b] = hex2rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE = '#FFFFFF';

describe('палитра RAG: разделение «графика / текст»', () => {
  it('strong читается как текст на белом и на своей заливке (AA ≥ 4.5)', () => {
    for (const [key, token] of Object.entries(RAG)) {
      expect(contrast(token.strong, WHITE), `RAG.${key}.strong на белом`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token.strong, token.soft), `RAG.${key}.strong на soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('color пригоден только для графики (≥ 3:1) и НЕ выдаётся за текстовый тон', () => {
    for (const [key, token] of Object.entries(RAG)) {
      expect(contrast(token.color, WHITE), `RAG.${key}.color на белом`).toBeGreaterThanOrEqual(3);
      // Инвариант разделения: графический тон светлее текстового, иначе они схлопнулись бы в один.
      expect(luminance(token.color), `RAG.${key}: color должен быть светлее strong`)
        .toBeGreaterThan(luminance(token.strong));
    }
  });

  it('текст бренда проходит AA во всех темах (на поверхности и на полотне)', () => {
    // Инвариант темизации (ТЗ v17): в КАЖДОЙ теме основной и вторичный текст читаемы (AA ≥ 4.5)
    // на своей поверхности карточек и на полотне — включая тёмную «графит».
    for (const name of THEME_ORDER) {
      const v = THEMES[name].vars;
      expect(contrast(v['--ink'], v['--surface']), `${name}: ink на surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--ink-soft'], v['--surface']), `${name}: inkSoft на surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--ink-soft'], v['--canvas']), `${name}: inkSoft на canvas`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('шкала уровней качества', () => {
  it('обе карты покрывают один и тот же словарь уровней', () => {
    expect(Object.keys(LEVEL_TAG_COLORS).sort()).toEqual(Object.keys(LEVEL_COLORS).sort());
  });

  it('словарь совпадает с вокабуляром теплокарты (mock и live читают одни ключи)', () => {
    for (const level of BUCKET_LEVEL) {
      expect(LEVEL_COLORS, `уровень «${level}» отсутствует в палитре`).toHaveProperty(level);
    }
  });

  it('фон ячейки держит тёмный текст, плашка — белый', () => {
    for (const level of Object.keys(LEVEL_COLORS)) {
      expect(contrast(LEVEL_COLORS[level], PREMIUM_INK), `ячейка «${level}»`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LEVEL_TAG_COLORS[level], WHITE), `плашка «${level}»`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('solidTagStyle', () => {
  it('всегда даёт белый текст без рамки', () => {
    const style = solidTagStyle(RAG.bad.strong);
    expect(style.color).toBe('#FFFFFF');
    expect(style.border).toBe('none');
    expect(style.background).toBe(RAG.bad.strong);
  });

  it('на любом strong-тоне палитры белый текст проходит AA', () => {
    for (const token of Object.values(RAG)) {
      const bg = String(solidTagStyle(token.strong).background);
      expect(contrast(WHITE, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('типографическая шкала', () => {
  it('у каждой ступени задан явный интерлиньяж', () => {
    for (const [name, step] of Object.entries(TYPE)) {
      expect(step, `ступень ${name}`).toHaveProperty('lineHeight');
      expect(String(step.lineHeight), `ступень ${name}: интерлиньяж в px`).toMatch(/^\d+px$/);
    }
  });

  it('интерлиньяж не меньше размера шрифта', () => {
    for (const [name, step] of Object.entries(TYPE)) {
      const lh = parseFloat(String(step.lineHeight));
      expect(lh, `ступень ${name}`).toBeGreaterThanOrEqual(step.fontSize);
    }
  });

  it('иерархия убывает: страница > карточка > подзаголовок ≥ текст > подпись > микро', () => {
    expect(TYPE.pageTitle.fontSize).toBeGreaterThan(TYPE.cardTitle.fontSize);
    expect(TYPE.cardTitle.fontSize).toBeGreaterThan(TYPE.subTitle.fontSize);
    expect(TYPE.subTitle.fontSize).toBeGreaterThanOrEqual(TYPE.body.fontSize);
    expect(TYPE.body.fontSize).toBeGreaterThan(TYPE.caption.fontSize);
    expect(TYPE.caption.fontSize).toBeGreaterThan(TYPE.micro.fontSize);
  });

  it('мельче 11px не опускаемся — предел читаемости', () => {
    for (const [name, step] of Object.entries(TYPE)) {
      expect(step.fontSize, `ступень ${name}`).toBeGreaterThanOrEqual(11);
    }
  });

  it('caption и captionStrong различаются только весом', () => {
    expect(TYPE.captionStrong.fontSize).toBe(TYPE.caption.fontSize);
    expect(TYPE.captionStrong.lineHeight).toBe(TYPE.caption.lineHeight);
    expect(TYPE.captionStrong.fontWeight).toBeGreaterThan(TYPE.caption.fontWeight);
  });
});

describe('сетка отступов', () => {
  it('каждая ступень кратна базе 4px', () => {
    for (const [name, value] of Object.entries(SPACE)) {
      expect(value % GRID, `ступень ${name} = ${value}`).toBe(0);
    }
  });

  it('space() считает шаги от базы', () => {
    expect(space(1)).toBe(GRID);
    expect(space(4)).toBe(16);
    expect(SPACE.base).toBe(space(4));
  });

  it('ступени идут по возрастанию', () => {
    const values = [SPACE.tight, SPACE.snug, SPACE.cozy, SPACE.base, SPACE.airy, SPACE.page];
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size, 'ступени не должны дублироваться').toBe(values.length);
  });
});

describe('числовая колонка таблицы', () => {
  it('выравнивается вправо и получает табличные цифры', () => {
    const col = numericColumn({ title: 'Балл', dataIndex: 'score' });
    expect(col.align).toBe('right');
    expect(col.className).toBe('num');
  });

  it('класс проставляется и заголовку — иначе шапка съезжает относительно данных', () => {
    const col = numericColumn({ title: 'Балл', dataIndex: 'score' });
    const header = (col.onHeaderCell as () => { className?: string })();
    expect(header.className).toBe('num');
  });

  it('не затирает переданные свойства колонки', () => {
    const col = numericColumn({ title: 'Доля', dataIndex: 'pct', width: 90, align: 'center' });
    expect(col.width).toBe(90);
    expect(col.align, 'явное align в аргументе имеет приоритет').toBe('center');
  });
});

describe('ragToken по баллу', () => {
  it('пороги совпадают с бэкендом (>=81 / 41–80 / <41), отрицательный — «не измерено»', () => {
    expect(ragByScore(90)).toBe('good');
    expect(ragByScore(81)).toBe('good');
    expect(ragByScore(80)).toBe('medium');
    expect(ragByScore(41)).toBe('medium');
    expect(ragByScore(40)).toBe('bad');
    expect(ragByScore(-1)).toBe('muted');
  });

  it('отрицательный балл отдаёт muted-токен без отдельного «серого» литерала', () => {
    expect(ragToken(-1)).toBe(RAG.muted);
  });
});
