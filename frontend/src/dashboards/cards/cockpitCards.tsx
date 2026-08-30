/**
 * cockpitCards.tsx — плитки кокпита CEO/CTO (ТЗ v21) в общем каталоге карточек (БТ-500).
 *
 * Каждая `CockpitTile` (ceoTiles.tsx/ctoTiles.tsx) оборачивается в самодостаточный `CardDef` —
 * так кокпит становится обычным дашбордом конструктора: плитки можно добавлять/убирать через
 * каталог, перетаскивать и уносить на «Мой дашборд», как любую другую карточку. Разрез и
 * шторка L2 «разложение» — общие на все плитки, отсюда `CockpitScope` (см. scopes/CockpitScope).
 */
import React from 'react';
import { FillCard } from '../GridCard';
import { useCockpitScope } from '../scopes/CockpitScope';
import TileCard from '../cockpit/TileCard';
import TileThumbnail from '../cockpit/TileThumbnail';
import { CEO_TILES } from '../cockpit/ceoTiles';
import { CTO_TILES } from '../cockpit/ctoTiles';
import type { CockpitTile } from '../cockpit/types';
import type { CardDef, DashboardKey } from '../types';

/** Плитки с реальным рядом по периодам — остальные честно показывают текущее значение без тренда. */
const TILES_WITH_TREND = new Set(['ceo-rosi', 'cto-degraded']);
/** Плитки, у которых `useValue` может отдать `delta` (сравнение с прошлым периодом). */
const TILES_WITH_DELTA = new Set(['cto-degraded']);

function cockpitCardDef(t: CockpitTile, role: 'CEO' | 'CTO'): CardDef {
  const source: DashboardKey = role === 'CEO' ? 'ceoCockpit' : 'ctoCockpit';
  const Component: React.FC = () => {
    const { slice, setOpenTile } = useCockpitScope();
    const value = t.useValue(slice);
    return (
      <FillCard>
        <TileCard
          question={t.question}
          value={value}
          formula={t.formula}
          onClick={value.empty ? undefined : () => setOpenTile(t.id)}
        />
      </FillCard>
    );
  };
  return {
    id: `cockpit.${t.id}`,
    title: t.question,
    source,
    perm: t.perm ?? (role === 'CEO' ? 'view.dashboard.ceo' : 'view.dashboard.cto'),
    scope: 'cockpit',
    w: 4, h: 8, minW: 3, minH: 6,
    hint: t.formula.summary,
    thumbnail: (
      <TileThumbnail tone="neutral" hasTrend={TILES_WITH_TREND.has(t.id)} hasDelta={TILES_WITH_DELTA.has(t.id)} />
    ),
    Component,
  };
}

export const COCKPIT_CARDS: CardDef[] = [
  ...CEO_TILES.map((t) => cockpitCardDef(t, 'CEO')),
  ...CTO_TILES.map((t) => cockpitCardDef(t, 'CTO')),
];
