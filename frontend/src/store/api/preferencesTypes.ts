/**
 * preferencesTypes.ts — контракт персональных настроек пользователя (`/iam/me/preferences`).
 *
 * На сервере это свободный JSONB (одна строка на пользователя), поэтому форма поля живёт здесь,
 * а не в схемах бэкенда: добавление новой настройки не требует миграции, но требует честного
 * описания версии формата.
 *
 * Раскладки дашбордов:
 *   v1 (BL-008, Фаза 4) — `widgets`: список вкл/выкл с порядком, одна колонка.
 *   v2 (ТЗ v22, БТ-500) — `layout`: позиция и размер каждой карточки в 12-колоночной сетке.
 * Читаются оба: v1 конвертируется в v2 на лету (useDashboardLayout.layoutFromWidgets),
 * пишется всегда v2.
 */
export interface WidgetPref { id: string; enabled: boolean; order: number }
export interface CardLayoutPref { i: string; x: number; y: number; w: number; h: number }
export interface DashboardPrefs { widgets?: WidgetPref[]; layout?: CardLayoutPref[]; v?: number }

export interface UserPrefs {
  dashboards?: Record<string, DashboardPrefs>;
  /** Порядок пунктов левого меню (ключи прав). Раньше жил только в localStorage — переехал
   *  на сервер, чтобы настройка ехала за пользователем между устройствами (БТ-500). */
  navOrder?: string[];
  /** Скрытые пользователем разделы меню (ключи прав). */
  hiddenSections?: Record<string, true>;
  /** Пункты, перенесённые в другую группу меню: { <право>: <название группы> }. */
  navGroups?: Record<string, string>;
  [k: string]: unknown;
}

export interface PreferencesResponse { prefs: UserPrefs }
