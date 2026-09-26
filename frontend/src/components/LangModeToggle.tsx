/**
 * LangModeToggle.tsx — язык карточек «технический / управленческий» (ТЗ v19 п.14, УК-34).
 *
 * По умолчанию — по роли (В-45): топ-менеджмент видит управленческий язык, остальные —
 * технический. Ручной выбор запоминается и действует на всех карточках. Технический режим
 * ничего не удаляет — управленческий только СКРЫВАЕТ формулы, метрики и служебные термины
 * стандарта, оставляя следствия для бизнеса (записка по мере, деньги, срок, ответственный).
 */
import React from 'react';
import { Segmented, Tooltip } from 'antd';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { setLangMode, type LangMode } from '../store/slices/uiSlice';

/** Роли, для которых по умолчанию включён управленческий язык. */
export const EXECUTIVE_LANG_ROLES = ['CEO', 'CTO', 'CIO', 'EXECUTIVE'];

export const langModeFor = (explicit: LangMode | null, role: string | null | undefined): LangMode =>
  explicit ?? (EXECUTIVE_LANG_ROLES.includes(role || '') ? 'executive' : 'technical');

export const useLangMode = (): LangMode => {
  const explicit = useSelector((s: RootState) => s.ui.langMode);
  const role = useSelector((s: RootState) => s.auth.role);
  return langModeFor(explicit, role);
};

export const LangModeToggle: React.FC = () => {
  const dispatch = useAppDispatch();
  const mode = useLangMode();
  return (
    <Tooltip title="Управленческий язык скрывает формулы и термины стандарта; технический показывает всё">
      <Segmented
        size="small"
        value={mode}
        onChange={(v) => dispatch(setLangMode(v as LangMode))}
        options={[{ label: 'Управл.', value: 'executive' }, { label: 'Техн.', value: 'technical' }]}
      />
    </Tooltip>
  );
};

export default LangModeToggle;
