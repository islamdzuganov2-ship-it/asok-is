/**
 * L3Link.tsx — ссылка из кокпита на глубокую страницу с адресом возврата (ТЗ-21 §7.5, КП-39).
 *
 * Единственное место, где переход L1/L2 → L3 получает `ret`: текущий адрес кокпита вместе с
 * разрезом и открытой шторкой (`tile`). Кнопка «← К кокпиту» (BackToCockpit) возвращает ровно
 * туда — с той же шторкой, а не на «чистый» кокпит.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { withCockpitReturn } from '../../store/slice/cockpitReturn';

export const L3Link: React.FC<{
  href: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  stopPropagation?: boolean;
}> = ({ href, children, style, stopPropagation }) => {
  const location = useLocation();
  const to = withCockpitReturn(href, `${location.pathname}${location.search}`);
  return (
    <Link to={to} style={style} onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      {children}
    </Link>
  );
};

export default L3Link;
