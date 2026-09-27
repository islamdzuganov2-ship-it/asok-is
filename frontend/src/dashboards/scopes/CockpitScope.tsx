/**
 * CockpitScope.tsx — общее состояние плиток кокпита CEO/CTO (ТЗ v21) в конструкторе дашбордов.
 *
 * Плитка кокпита самодостаточна как карточка каталога (сама вызывает `useValue`), но ей нужен
 * общий разрез (`Slice`, тянут сигнатуры `CockpitTile.useValue`/`Detail`) и общее место для
 * шторки L2 «разложение» — иначе каждая плитка держала бы свой Drawer, и открытая на «Мой
 * дашборд» плитка не знала бы, как показать разбор клика.
 *
 * Сквозной разрез (ТЗ v21 §3, КП-01…КП-10) живёт в адресной строке, а не здесь: скоуп только
 * читает его через `useSlice()` и раздаёт плиткам. Панель управления разрезом — `SliceBar`
 * в `CockpitScopeToolbar`: конструктор рендерит панели активных скоупов над сеткой, поэтому
 * фильтр появляется ровно там, где на дашборде есть плитки кокпита, и нигде больше.
 *
 * Открытая шторка L2 — тоже в адресной строке (`?tile=<id>`, ТЗ-21 §7.4, КП-ПР-4): «Скопировать
 * ссылку» отдаёт экран вместе с открытым разложением, а «← К кокпиту» с L3 возвращает в ту же
 * шторку. Запись — с `replace`: открытие/закрытие шторки не засоряет историю браузера.
 */
import React, { createContext, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Drawer, Typography } from 'antd';
import { PREMIUM, SPACE } from '../../theme/premium';
import { isSliceEmpty, type Slice } from '../../store/slice/sliceTypes';
import { useSlice, sliceSummaryText } from '../../store/slice/sliceUrl';
import SliceBar from '../../components/SliceBar';
import { DemoDataBanner } from '../../components/DataModeToggle';
import { TILE_PARAM } from '../../store/slice/cockpitReturn';
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
  const [params, setParams] = useSearchParams();
  const [slice] = useSlice();
  const openTileId = params.get(TILE_PARAM);
  // Неизвестный id (плитку убрали из реестра, ссылка старая) — шторка просто не открывается.
  const openTile = openTileId ? ALL_TILES.get(openTileId) ?? null : null;
  const setOpenTileId = useCallback((id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set(TILE_PARAM, id); else next.delete(TILE_PARAM);
      return next;
    }, { replace: true });
  }, [setParams]);

  return (
    <Ctx.Provider value={{ slice, setOpenTile: setOpenTileId }}>
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
            {/* Разбор наследует тот же разрез, что и плитка: цифра в шторке обязана совпадать
                с цифрой на карточке, иначе разложение объясняет не то число. */}
            <Text type="secondary" style={{ display: 'block', marginBottom: SPACE.base }}>
              Разрез: {isSliceEmpty(slice) ? 'весь портфель' : sliceSummaryText(slice)}
            </Text>
            <openTile.Detail slice={slice} />
          </>
        )}
      </Drawer>
    </Ctx.Provider>
  );
};

export const CockpitScopeToolbar: React.FC = () => (
  <>
    {/* КП-43 (ТЗ-21 §9.1): вместо тумблера в шапке — заметная плашка над плитками. */}
    <DemoDataBanner />
    <SliceBar />
  </>
);
