/**
 * CockpitScope.tsx — общее состояние плиток кокпита CEO/CTO (ТЗ v21) в конструкторе дашбордов.
 *
 * Плитка кокпита самодостаточна как карточка каталога (сама вызывает `useValue`), но ей нужен
 * общий разрез (`Slice`, тянут сигнатуры `CockpitTile.useValue`/`Detail`) и общее место для
 * шторки L2 «разложение» — иначе каждая плитка держала бы свой Drawer, и открытая на «Мой
 * дашборд» плитка не знала бы, как показать разбор клика.
 *
 * Полоса сквозного фильтра (период/ИС/критичность) — из ТЗ v21 — сюда сознательно не перенесена
 * (см. границы задачи): плитки работают на `DEFAULT_SLICE` (весь портфель), как и остальные
 * дашборды конструктора выглядят по умолчанию, пока пользователь ничего не настраивал.
 */
import React, { createContext, useContext, useState } from 'react';
import { Drawer, Typography } from 'antd';
import { PREMIUM, SPACE } from '../../theme/premium';
import { DEFAULT_SLICE, type Slice } from '../../store/slice/sliceTypes';
import { CEO_TILES } from '../cockpit/ceoTiles';
import { CTO_TILES } from '../cockpit/ctoTiles';
import type { CockpitTile } from '../cockpit/types';

const { Text } = Typography;

const ALL_TILES = new Map<string, CockpitTile>(
  [...CEO_TILES, ...CTO_TILES].map((t) => [t.id, t]),
);

interface CockpitScopeValue {
  slice: Slice;
  setOpenTile: (id: string) => void;
}

const Ctx = createContext<CockpitScopeValue | null>(null);

export function useCockpitScope(): CockpitScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Карточка кокпита отрисована вне CockpitScope');
  return v;
}

export const CockpitScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const openTile = openTileId ? ALL_TILES.get(openTileId) ?? null : null;

  return (
    <Ctx.Provider value={{ slice: DEFAULT_SLICE, setOpenTile: setOpenTileId }}>
      {children}
      <Drawer
        open={!!openTile}
        onClose={() => setOpenTileId(null)}
        width={720}
        title={openTile?.question}
        styles={{ body: { background: PREMIUM.surfaceTint } }}
      >
        {openTile && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: SPACE.base }}>
              Разрез: весь портфель
            </Text>
            <openTile.Detail slice={DEFAULT_SLICE} />
          </>
        )}
      </Drawer>
    </Ctx.Provider>
  );
};

export const CockpitScopeToolbar: React.FC = () => null;
