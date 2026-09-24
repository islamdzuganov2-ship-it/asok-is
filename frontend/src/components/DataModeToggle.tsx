/**
 * DataModeToggle.tsx — переключатель источника данных дашбордов «Демо ↔ LLM» и плашка
 * демо-данных над кокпитом (ТЗ-21 §9.1, КП-43).
 *
 * Почему тумблер вынесен из шапки кокпита: на кокпите CEO рядом с ним стоит сумма в рублях,
 * а случайное переключение во время демонстрации правлению молча меняет картину на соседних
 * экранах. На кокпитах тумблер в шапке видят только административные роли; остальным
 * переключение доступно из «Настройка» (карточка ниже переиспользует тот же компонент).
 */
import React from 'react';
import { Alert, Badge, Switch, Tooltip, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { setDataMode } from '../store/slices/uiSlice';
import { useGetLlmStatusQuery, type LlmStatusOut } from '../store/api/apiSlice';
import { BRAND } from '../theme/ragPalette';
import { SPACE, TYPE } from '../theme/premium';

const { Text } = Typography;

/** Маршруты кокпитов (КП-43): здесь тумблер из шапки убирается для неадминистративных ролей. */
export const COCKPIT_ROUTES = ['/dashboard/ceo', '/dashboard/cto'] as const;
const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/** Показывать ли тумблер в шапке: вне кокпита — всем, на кокпите — только администраторам. */
export function headerToggleVisible(pathname: string, role: string | null | undefined): boolean {
  const onCockpit = COCKPIT_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  return !onCockpit || ADMIN_ROLES.has(role ?? '');
}

export function llmStatusView(status: LlmStatusOut | undefined, isError: boolean): { color: string; text: string } {
  if (isError) return { color: 'gold', text: 'LLM не загружена — будет честный fallback' };
  if (!status) return { color: 'default', text: 'Проверка LLM…' };
  const prof = status.profile;
  const modelDesc = prof
    ? `${prof.name || prof.file_name}${prof.architecture ? ` · ${prof.architecture}` : ''} · ${prof.n_gpu_layers ? 'GPU' : 'CPU'}`
    : '';
  return status.available
    ? { color: 'green', text: `LLM загружена: ${modelDesc || 'модель'}` }
    : { color: 'gold', text: 'LLM не загружена — будет честный fallback' };
}

/** Компактный тумблер «Демо ↔ LLM» с индикатором готовности модели (шапка и «Настройка»). */
export const DataModeToggle: React.FC<{ showLabels?: boolean }> = ({ showLabels = true }) => {
  const dispatch = useAppDispatch();
  const dataMode = useSelector((s: RootState) => s.ui.dataMode);
  const { data, isError } = useGetLlmStatusQuery();
  const { color, text } = llmStatusView(data, isError);
  return (
    <Tooltip title={`${text}. Переключатель источника данных дашбордов.`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.snug, flex: '0 0 auto' }}>
        <Badge color={color} />
        <RobotOutlined style={{ color: dataMode === 'live' ? BRAND.ink : BRAND.inkSoft }} />
        {showLabels && <Text type="secondary" className="header-mode-label" style={TYPE.caption}>Демо</Text>}
        <Switch
          size="small"
          aria-label="Источник данных дашбордов: демо или живые данные с LLM"
          checked={dataMode === 'live'}
          onChange={(v) => dispatch(setDataMode(v ? 'live' : 'mock'))}
        />
        {showLabels && <Text type="secondary" className="header-mode-label" style={TYPE.caption}>LLM</Text>}
      </div>
    </Tooltip>
  );
};

/**
 * Плашка над плитками кокпита (КП-43): «Демонстрационные данные» — если бэкенд работает на
 * демо-наборе, иначе ничего. Опирается на признак бэкенда, а не на клиентский тумблер: плитки
 * кокпита всегда читают бэкенд, и именно его данные могут оказаться демонстрационными.
 */
export const DemoDataBanner: React.FC = () => {
  const { data } = useGetLlmStatusQuery();
  if (!data?.demo_data) return null;
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: SPACE.cozy }}
      message="Демонстрационные данные"
      description="Цифры на плитках рассчитаны на демо-наборе стенда, а не на портфеле предприятия."
    />
  );
};
