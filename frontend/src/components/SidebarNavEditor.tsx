/**
 * SidebarNavEditor.tsx — режим «Порядок» левого меню (БТ-500).
 *
 * Раньше порядок разделов менялся только на отдельной странице «Настройка» и только внутри своей
 * группы: чтобы поменять местами два дашборда, надо было уйти со страницы, где на них смотришь.
 * Здесь пункты перетаскиваются прямо в сайдбаре, в том числе между группами.
 *
 * Модель хранения: плоский `navOrder` (порядок) + `navGroups` (переопределение группы). Группу
 * держим отдельным словарём, а не переписыванием NAV_SECTIONS: релиз может добавить раздел или
 * переименовать группу, и тогда «родная» принадлежность должна вернуться сама, а не остаться
 * замороженной в пользовательских настройках.
 */
import React, { useState } from 'react';
import { Typography } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { setNavOrder, setNavGroup, NAV_SECTIONS } from '../store/slices/uiSlice';
import { useSaveNavPrefs } from '../hooks/useNavPreferences';
import { moveNavItem } from '../constants/navOrderMath';
import { PREMIUM, GOLD, SPACE, TYPE } from '../theme/premium';

const { Text } = Typography;

/** Группы, доступные для перестановки. «Администрирование» и «Настройка» не трогаем: их состав
 *  задаётся правами администратора, а не вкусом пользователя. */
export const REORDERABLE_GROUPS = ['Основное', 'Сбор и анализ данных', 'Формирование техдолга'];

interface Props {
  /** Заголовок группы в стиле сайдбара (общий с AppLayout). */
  groupLabel: (text: string) => React.ReactNode;
  /** Иконка пункта по праву — тот же словарь, что и в меню. */
  iconByPerm: Record<string, React.ReactNode>;
  /** Пункты группы в текущем пользовательском порядке (уже отфильтрованы по правам). */
  sectionsOfGroup: (groupName: string) => ReadonlyArray<{ perm: string; label: string }>;
}

export const SidebarNavEditor: React.FC<Props> = ({ groupLabel, iconByPerm, sectionsOfGroup }) => {
  const dispatch = useAppDispatch();
  const navOrder = useSelector((s: RootState) => s.ui.navOrder);
  const navGroups = useSelector((s: RootState) => s.ui.navGroups);
  const saveNavPrefs = useSaveNavPrefs();
  const [dragPerm, setDragPerm] = useState<string | null>(null);

  /** Переставить `perm` в группу `targetGroup` перед `beforePerm` (или в конец группы). */
  const applyMove = (perm: string, targetGroup: string, beforePerm: string | null) => {
    setDragPerm(null);
    if (perm === beforePerm) return;
    const next = moveNavItem(perm, targetGroup, beforePerm, NAV_SECTIONS, navOrder, navGroups);
    const home = NAV_SECTIONS.find((s) => s.perm === perm)?.group;

    dispatch(setNavOrder(next.navOrder));
    dispatch(setNavGroup({ perm, group: targetGroup === home ? null : targetGroup }));
    saveNavPrefs(next);
  };

  const row = (sec: { perm: string; label: string }, groupName: string) => (
    <div
      key={sec.perm}
      draggable
      data-nav-edit={sec.perm}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', sec.perm); setDragPerm(sec.perm); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        // Без stopPropagation дроп на строку всплыл бы до контейнера группы и увёл пункт в её
        // конец вместо позиции перед целевой строкой.
        e.stopPropagation();
        const src = e.dataTransfer.getData('text/plain') || dragPerm;
        if (src) applyMove(src, groupName, sec.perm);
      }}
      onDragEnd={() => setDragPerm(null)}
      style={{
        display: 'flex', alignItems: 'center', gap: SPACE.snug,
        padding: `${SPACE.snug}px ${SPACE.cozy}px`,
        margin: `0 ${SPACE.cozy}px ${SPACE.tight}px`,
        borderRadius: PREMIUM.radiusSm,
        border: `1px dashed ${dragPerm === sec.perm ? GOLD.base : 'rgba(233,220,190,0.28)'}`,
        background: dragPerm === sec.perm ? 'rgba(185,154,85,0.18)' : 'rgba(255,255,255,0.04)',
        color: '#fff', cursor: 'grab', userSelect: 'none',
        ...TYPE.bodySm,
      }}
    >
      <HolderOutlined style={{ color: GOLD.soft, flex: '0 0 auto' }} />
      <span style={{ flex: '0 0 auto', color: 'rgba(233,220,190,0.9)' }}>{iconByPerm[sec.perm]}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sec.label}
      </span>
    </div>
  );

  return (
    <div style={{ paddingBottom: SPACE.base }}>
      <div style={{ padding: `0 ${SPACE.base}px ${SPACE.cozy}px` }}>
        <Text style={{ ...TYPE.micro, color: 'rgba(233,220,190,0.75)' }}>
          Перетащите пункт на другой — он встанет перед ним. Можно переносить между группами.
        </Text>
      </div>
      {REORDERABLE_GROUPS.map((g) => {
        const rows = sectionsOfGroup(g);
        return (
          <div
            key={g}
            // Дроп на пустую область группы = «в конец этой группы». Без него перенести пункт
            // в группу, где ничего не осталось, было бы нечем.
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const src = e.dataTransfer.getData('text/plain') || dragPerm;
              if (src) applyMove(src, g, null);
            }}
            style={{ marginBottom: SPACE.cozy, minHeight: 44 }}
          >
            <div style={{ padding: `0 ${SPACE.base}px ${SPACE.tight}px` }}>{groupLabel(g)}</div>
            {rows.length === 0 && (
              <div style={{
                margin: `0 ${SPACE.cozy}px`, padding: SPACE.cozy,
                border: '1px dashed rgba(233,220,190,0.25)', borderRadius: PREMIUM.radiusSm,
                ...TYPE.micro, color: 'rgba(233,220,190,0.6)', textAlign: 'center',
              }}>
                перетащите сюда
              </div>
            )}
            {rows.map((sec) => row(sec, g))}
          </div>
        );
      })}
    </div>
  );
};

export default SidebarNavEditor;
