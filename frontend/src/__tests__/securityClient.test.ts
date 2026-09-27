/**
 * securityClient.test.ts — клиентская часть ИБ-Ф1: сообщение о блокировке входа (ИБ-10).
 *
 * Пользователь, упёршийся в анти-брутфорс, должен понять, что это не «неверный пароль», а
 * временная блокировка, и сколько ждать — иначе он продолжит подбирать и продлит блокировку.
 */
import { describe, it, expect } from 'vitest';
import { loginErrorText } from '../utils/serverLogout';

describe('текст ошибки входа', () => {
  it('429 — блокировка с временем ожидания в минутах', () => {
    const t = loginErrorText(429, '900');
    expect(t).toMatch(/заблокирован/);
    expect(t).toMatch(/15 мин/);
  });

  it('429 без Retry-After — без выдуманного времени', () => {
    expect(loginErrorText(429, null)).toMatch(/Повторите позже/);
  });

  it('401 и прочее — прежний общий текст, без подсказки «логин верный»', () => {
    expect(loginErrorText(401, null)).toBe('Ошибка авторизации. Проверьте логин и пароль.');
  });
});

// ═══════════════ ИБ-11: парольная политика и обязательная смена пароля ═══════════════
import {
  clientPasswordIssues, isPasswordChangeRequired, PASSWORD_CHANGE_REQUIRED, RULES_FALLBACK,
} from '../utils/passwordPolicy';
import authReducer, { passwordChanged, requirePasswordChange, setCredentials, logout } from '../store/slices/authSlice';

describe('клиентская проверка пароля (ИБ-11)', () => {
  it('короткий и однообразный пароль не отправляется на сервер', () => {
    const issues = clientPasswordIssues('abc');
    expect(issues).toContain(RULES_FALLBACK[0]);
    expect(issues).toContain(RULES_FALLBACK[1]);
  });

  it('пароль с логином отклоняется, регистр не важен', () => {
    expect(clientPasswordIssues('Petrov-Secure-77x', 'PETROV')).toContain(RULES_FALLBACK[2]);
  });

  it('надёжный пароль (и кириллица) проходит клиентскую проверку', () => {
    expect(clientPasswordIssues('Correct-Horse-9x', 'ivan')).toEqual([]);
    expect(clientPasswordIssues('Горный-ветер-7-Луна')).toEqual([]);
  });

  it('403 PASSWORD_CHANGE_REQUIRED отличается от обычного отказа в праве', () => {
    expect(isPasswordChangeRequired(403, { detail: PASSWORD_CHANGE_REQUIRED })).toBe(true);
    expect(isPasswordChangeRequired(403, { detail: 'Missing permission: view.reports' })).toBe(false);
    expect(isPasswordChangeRequired(401, { detail: PASSWORD_CHANGE_REQUIRED })).toBe(false);
  });
});

describe('состояние входа с временным паролем (ИБ-11)', () => {
  const login = (must: boolean) => authReducer(undefined, setCredentials({
    token: 't1', role: 'QUALITY_MANAGER', fullName: 'Иван', mustChangePassword: must,
  }));

  it('вход временным паролем запоминает требование смены (переживает перезагрузку)', () => {
    const s = login(true);
    expect(s.mustChangePassword).toBe(true);
    expect(localStorage.getItem('must_change_password')).toBe('1');
  });

  it('смена пароля снимает требование и подменяет токен', () => {
    const s = authReducer(login(true), passwordChanged({ token: 't2' }));
    expect(s.mustChangePassword).toBe(false);
    expect(s.token).toBe('t2');
    expect(localStorage.getItem('token')).toBe('t2');
    expect(localStorage.getItem('must_change_password')).toBeNull();
  });

  it('403 от сервера включает требование и у обычного входа', () => {
    expect(authReducer(login(false), requirePasswordChange()).mustChangePassword).toBe(true);
  });

  it('выход сбрасывает требование', () => {
    expect(authReducer(login(true), logout()).mustChangePassword).toBe(false);
  });
});
