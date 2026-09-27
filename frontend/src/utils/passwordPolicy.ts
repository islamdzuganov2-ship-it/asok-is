/**
 * passwordPolicy.ts — клиентская сторона парольной политики (ИБ-11).
 *
 * Решает сервер (`backend/app/modules/iam/password_policy.py`): здесь только мгновенная
 * подсказка в форме, чтобы не гонять заведомо короткий пароль на сервер. Формулировки правил
 * экран берёт с `GET /auth/password-policy`; RULES_FALLBACK — на случай, если запрос не прошёл.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const RULES_FALLBACK: string[] = [
    `не короче ${MIN_PASSWORD_LENGTH} символов`,
    'символы минимум трёх групп из четырёх: строчные буквы, прописные буквы, цифры, спецсимволы',
    'не содержит логин',
    'не основан на распространённом слове или клавиатурной последовательности',
    'не совпадает ни с одним из 5 последних паролей',
];

/** Код ответа сервера: токен временного пароля, сначала — смена пароля. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

function classCount(password: string): number {
    const groups = [
        /\p{Ll}/u.test(password),
        /\p{Lu}/u.test(password),
        /\p{Nd}/u.test(password),
        /[^\p{L}\p{Nd}]/u.test(password),
    ];
    return groups.filter(Boolean).length;
}

/** Нарушения, которые видны без сервера (длина, группы символов, логин). Пусто — отправлять. */
export function clientPasswordIssues(password: string, username?: string | null): string[] {
    const issues: string[] = [];
    if (password.length < MIN_PASSWORD_LENGTH) issues.push(RULES_FALLBACK[0]);
    if (classCount(password) < 3) issues.push(RULES_FALLBACK[1]);
    if (username && username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
        issues.push(RULES_FALLBACK[2]);
    }
    return issues;
}

/** Ответ API — «сначала смените временный пароль» (403 PASSWORD_CHANGE_REQUIRED). */
export function isPasswordChangeRequired(status: unknown, data: unknown): boolean {
    return status === 403
        && typeof data === 'object' && data !== null
        && (data as { detail?: unknown }).detail === PASSWORD_CHANGE_REQUIRED;
}
