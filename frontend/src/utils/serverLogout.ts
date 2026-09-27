/**
 * serverLogout.ts — серверный выход (ИБ-12; SEC-05 в docs/SECURITY_AUDIT_RF_2026-09-08.md).
 *
 * До ИБ-12 «Выйти» только чистил localStorage: украденный access-токен продолжал работать до
 * истечения TTL. Теперь перед очисткой клиентского состояния токен отзывается на сервере
 * (`POST /auth/logout` — отзыв токена и всей его сессии).
 *
 * `keepalive` — запрос долетает, даже если страница тут же уходит на /login; ответ не ждём и
 * ошибку не показываем: сеть недоступна — локальный выход всё равно должен произойти.
 */
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export function serverLogout(token: string | null): void {
  if (!token) return;
  try {
    void fetch(`${API}/auth/logout`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  } catch {
    /* выход локально произойдёт в любом случае */
  }
}

/** Текст ошибки входа по ответу сервера: 429 (ИБ-10) — отдельное сообщение с временем ожидания. */
export function loginErrorText(status: number, retryAfter: string | null): string {
  if (status === 429) {
    const sec = Number(retryAfter);
    const wait = Number.isFinite(sec) && sec > 0 ? ` Повторите через ${Math.ceil(sec / 60)} мин.` : ' Повторите позже.';
    return `Слишком много неудачных попыток входа — вход временно заблокирован.${wait}`;
  }
  return 'Ошибка авторизации. Проверьте логин и пароль.';
}
