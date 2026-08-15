/**
 * appMessage.ts — тосты и модалки, знающие про активную тему (ДЕФ-09).
 *
 * Проблема. Статические `message.*` / `notification.*` / `Modal.*` из antd не видят
 * `ConfigProvider`: antd честно предупреждал в консоли —
 *   «[antd: message] Static function can not consume context like dynamic theme.
 *    Please use 'App' component instead».
 * Следствие: в тёмной теме `graphite` тосты рендерились в СВЕТЛОЙ палитре поверх тёмного
 * интерфейса (нарушение БТ-442/БТ-548), и это была единственная ошибка в консоли —
 * вопреки уже закрытому правилу UI-10 «без предупреждений antd».
 *
 * Решение. Дерево обёрнуто в `<App>` antd (см. App.tsx), а компонент-мост `AppApiBridge`
 * кладёт сюда экземпляры из `App.useApp()`. Точки вызова (их больше сотни) остаются без
 * изменений — меняется только импорт: вместо `from 'antd'` → отсюда.
 *
 * До инициализации моста (ранний рендер, тесты вне React) вызовы уходят в статические
 * методы antd — поведение не теряется, максимум теряется тема на самом первом тосте.
 */
import { message as staticMessage, notification as staticNotification, Modal as StaticModal } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal';

let messageApi: MessageInstance | null = null;
let notificationApi: NotificationInstance | null = null;
let modalApi: ModalHookAPI | null = null;

/** Вызывается мостом внутри <App> — см. AppApiBridge в App.tsx. */
export const registerAppApi = (api: {
  message: MessageInstance;
  notification: NotificationInstance;
  modal: ModalHookAPI;
}): void => {
  messageApi = api.message;
  notificationApi = api.notification;
  modalApi = api.modal;
};

/** Тосты: тот же API, что у antd, но с учётом темы. */
export const message: MessageInstance = new Proxy({} as MessageInstance, {
  get: (_t, prop: string) => (messageApi ?? staticMessage)[prop as keyof MessageInstance],
});

export const notification: NotificationInstance = new Proxy({} as NotificationInstance, {
  get: (_t, prop: string) => (notificationApi ?? staticNotification)[prop as keyof NotificationInstance],
});

export const modal: ModalHookAPI = new Proxy({} as ModalHookAPI, {
  get: (_t, prop: string) => (modalApi ?? (StaticModal as unknown as ModalHookAPI))[prop as keyof ModalHookAPI],
});
