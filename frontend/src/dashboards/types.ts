/**
 * types.ts — контракт конструктора дашбордов (ТЗ v22, БТ-500).
 *
 * Задача: пользователь собирает ЛЮБОЙ дашборд из ЛЮБЫХ доступных ему карточек, двигает их по
 * сетке и меняет размеры. Отсюда три сущности:
 *
 *  • CardDef      — карточка в общесистемном каталоге. Знает, откуда родом (`source`), каким
 *                   правом закрыта (`perm`) и какой «скоуп» ей нужен, чтобы работать в отрыве
 *                   от родного дашборда (`scope`).
 *  • DashboardDef — штатный дашборд: ключ, право, заголовок и ДЕФОЛТНАЯ раскладка. Пока
 *                   пользователь ничего не трогал, дашборд выглядит ровно как раньше.
 *  • CardLayout   — позиция и размер карточки в 12-колоночной сетке (формат react-grid-layout).
 *
 * ВАЖНО про RBAC: каталог — предпочтение ПОВЕРХ прав, а не право. Карточку, чей `perm` не выдан
 * пользователю, нельзя ни увидеть в каталоге, ни отрисовать из сохранённой раскладки (ситуация
 * реальна: админ забрал право уже после того, как пользователь собрал дашборд).
 */
import type React from 'react';

/** Ключ «скоупа» — общего состояния и данных, которые карточка делит с соседями по происхождению.
 *  Карточки менеджера, например, живут вокруг выбранной ИС → характеристики → подхарактеристики;
 *  вырванная на «Мой дашборд» карточка тащит этот скоуп с собой. */
export type ScopeKey =
  | 'manager' | 'exec' | 'incidents' | 'taskplan' | 'dynamics' | 'analytics' | 'econ' | 'mytasks'
  | 'cockpit'
  /** Карточка самодостаточна: сама тянет данные и держит своё состояние. */
  | 'none';

/** Позиция карточки в сетке. Совпадает по форме с Layout из react-grid-layout. */
export interface CardLayout {
  /** id карточки из каталога. Имя поля `i` — требование react-grid-layout. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardDef {
  /** Глобально уникальный id. Формат `<source>.<name>` — читаемо в prefs и в отладке. */
  id: string;
  /** Заголовок в каталоге и в шапке карточки в режиме редактирования. */
  title: string;
  /** Дашборд-источник: группирует каталог («откуда эта карточка»). */
  source: DashboardKey;
  /** Право (или любое из списка), без которого карточка недоступна. Совпадает с правом
   *  дашборда-источника. Список нужен управленческим карточкам: один и тот же дашборд открыт
   *  и по `view.dashboard.cto`, и по `view.dashboard.ceo`. */
  perm: string | string[];
  /** Что подмешать в дерево, чтобы карточка работала вне родного дашборда. */
  scope: ScopeKey;
  /** Дефолтный размер и минимумы. x/y при добавлении вычисляются автоматически. */
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  /** Короткое пояснение в каталоге — что именно показывает карточка. */
  hint?: string;
  /** Миниатюрное превью формы карточки в каталоге (см. CardPicker) — необязательно. */
  thumbnail?: React.ReactNode;
  Component: React.FC;
}

/** Доступна ли карточка пользователю с такими правами (любое из перечисленных). */
export const cardAllowed = (def: Pick<CardDef, 'perm'>, permissions: readonly string[]): boolean => {
  const need = Array.isArray(def.perm) ? def.perm : [def.perm];
  return need.some((p) => permissions.includes(p));
};

export type DashboardKey =
  | 'exec' | 'manager' | 'analytics' | 'dynamics' | 'incidents'
  | 'taskplan' | 'risk' | 'radar' | 'econ' | 'mytasks' | 'my'
  | 'ceoCockpit' | 'ctoCockpit';

export interface DashboardDef {
  key: DashboardKey;
  /** Заголовок страницы и подпись группы в каталоге. */
  label: string;
  /** Право на сам дашборд. */
  perm: string;
  /** Дефолтная раскладка — «как было до конструктора». */
  defaultLayout: CardLayout[];
}

/** 12 колонок — как в antd Row/Col, чтобы дефолтные раскладки переносились из старой вёрстки
 *  один-в-один: `<Col lg={15}>` → w: 7.5 ≈ 8, `<Col lg={9}>` → w: 4.5 ≈ 4. */
export const GRID_COLS = 12;
/** Высота строки сетки в px. Подобрана так, чтобы KPI-плитка (h=4) была ~168px, а таблица
 *  (h=12) — ~536px: формула react-grid-layout height = h*ROW + (h-1)*MARGIN. */
export const GRID_ROW_HEIGHT = 30;
export const GRID_MARGIN: [number, number] = [16, 16];

/** Пиксельная высота карточки по её `h` — нужна для карточек, которые считают размер графика. */
export const cardPixelHeight = (h: number): number => h * GRID_ROW_HEIGHT + (h - 1) * GRID_MARGIN[1];
