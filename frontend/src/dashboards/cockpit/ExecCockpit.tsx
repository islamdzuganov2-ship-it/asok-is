/**
 * ExecCockpit.tsx — оболочка кокпита C-Level (ТЗ v21 §2, §7.2, §11.1).
 *
 * L1: сетка плиток-ответов (5-6 штук), без прокрутки на 1280×800. L2: шторка с разложением —
 * открывается ПОВЕРХ кокпита, кокпит остаётся под ней (принцип §2: L2 не новая страница).
 * Состав/порядок плиток настраивается через существующий DashboardShell-паттерн персонализации
 * (PUT /iam/me/preferences) — та же механика, что уже работает у владельца риска.
 */
import React, { useMemo } from 'react';
import { Button, Drawer, Row, Col, Space, Typography } from 'antd';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RootState } from '../../store';
import { pageContainer, pageTitle, PREMIUM, SPACE } from '../../theme/premium';
import { BRAND } from '../../theme/ragPalette';
import { useGetMyPreferencesQuery, usePutMyPreferencesMutation } from '../../store/api/apiSlice';
import { message } from '../../theme/appMessage';
import { useSlice } from '../../store/slice/sliceUrl';
import { Slice } from '../../store/slice/sliceTypes';
import SliceBar from '../../components/SliceBar';
import TileCard from './TileCard';
import type { CockpitTile } from './types';

const { Title, Text } = Typography;

interface Props {
  dashboardKey: string;
  title: string;
  icon: React.ReactNode;
  tiles: CockpitTile[];
  defaultLens: Slice['lens'];
  /** Ссылка «Полная картина» — существующая лента виджетов (не переписывается, ТЗ v21 §11.1). */
  fullPictureHref: string;
  /** 'ceo' | 'cto' — метит переходы на глубокие страницы, чтобы там появилась «← К кокпиту» (§7.5). */
  role: 'ceo' | 'cto';
}

function buildOrder(tiles: CockpitTile[], saved?: { id: string; enabled: boolean; order: number }[]): CockpitTile[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const ordered: CockpitTile[] = [];
  (saved ?? []).slice().sort((a, b) => a.order - b.order).forEach((s) => {
    if (byId.has(s.id) && s.enabled && !seen.has(s.id)) { ordered.push(byId.get(s.id)!); seen.add(s.id); }
  });
  tiles.forEach((t) => { if (!seen.has(t.id) && t.defaultEnabled) ordered.push(t); });
  return ordered;
}

const ExecCockpit: React.FC<Props> = ({ dashboardKey, title, icon, tiles, defaultLens, fullPictureHref, role }) => {
  const navigate = useNavigate();
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const [slice] = useSlice({ lens: defaultLens });
  // Открытая плитка L2 — в адресе (`&tile=`), не в локальном state (§7.4): скопированная
  // ссылка обязана открывать ту же шторку (КП-ПР-4), а не просто тот же кокпит.
  const [searchParams, setSearchParams] = useSearchParams();
  const openTileId = searchParams.get('tile');
  const openTile = tiles.find((t) => t.id === openTileId) ?? null;
  const setOpenTile = (t: CockpitTile | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t) next.set('tile', t.id); else next.delete('tile');
      return next;
    });
  };

  const visibleTiles = useMemo(
    () => tiles.filter((t) => !t.perm || permissions.includes(t.perm)),
    [tiles, permissions],
  );

  const { data: prefsData } = useGetMyPreferencesQuery();
  const [putPrefs] = usePutMyPreferencesMutation();
  const saved = prefsData?.prefs?.dashboards?.[dashboardKey]?.widgets;
  const ordered = useMemo(() => buildOrder(visibleTiles, saved), [visibleTiles, saved]);

  // ВАЖНО (правила хуков): `useValue` каждой плитки — хук. Вызываем его для ВСЕГО статического
  // реестра `tiles` на каждом рендере, а не для `ordered`/`visibleTiles` — те меняются по правам
  // и персонализации, и вызов хуков в цикле по переменному списку нарушил бы «одинаковый порядок
  // хуков между рендерами». Показываем только то, что попало в `ordered` (см. JSX ниже).
  const values = new Map<string, ReturnType<CockpitTile['useValue']>>();
  tiles.forEach((t) => { values.set(t.id, t.useValue(slice)); });

  const toggleTile = async (id: string) => {
    const current = buildOrder(visibleTiles, saved).map((t) => t.id);
    const on = new Set(saved ? saved.filter((s) => s.enabled).map((s) => s.id) : current);
    if (on.has(id)) on.delete(id); else on.add(id);
    const widgets = visibleTiles.map((t, i) => ({ id: t.id, enabled: on.has(t.id), order: i }));
    try {
      await putPrefs({ prefs: { ...(prefsData?.prefs ?? {}), dashboards: { ...(prefsData?.prefs?.dashboards ?? {}), [dashboardKey]: { widgets } } } }).unwrap();
    } catch {
      message.error('Не удалось сохранить раскладку кокпита');
    }
  };

  return (
    <div style={pageContainer}>
      <Row align="middle" justify="space-between" gutter={[16, 8]} style={{ marginBottom: SPACE.base }}>
        <Col>
          <Title level={4} style={pageTitle}>{icon}{title}</Title>
        </Col>
        <Col>
          <Space wrap>
            {ordered.length < visibleTiles.length && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Скрыто плиток: {visibleTiles.length - ordered.length} —{' '}
                <a onClick={() => visibleTiles.forEach((t) => { if (!ordered.includes(t)) toggleTile(t.id); })}>показать все</a>
              </Text>
            )}
            <Button onClick={() => navigate(`${fullPictureHref}?from=cockpit&role=${role}`)}>Полная картина →</Button>
          </Space>
        </Col>
      </Row>

      <SliceBar />

      <Row gutter={[16, 16]} style={{ marginTop: SPACE.base }}>
        {ordered.map((t) => {
          const v = values.get(t.id)!;
          return (
            <Col key={t.id} xs={24} sm={12} lg={8} xl={8}>
              <TileCard question={t.question} value={v} onClick={v.empty ? undefined : () => setOpenTile(t)} />
            </Col>
          );
        })}
      </Row>

      <Drawer
        open={!!openTile}
        onClose={() => setOpenTile(null)}
        width={720}
        title={openTile?.question}
        styles={{ body: { background: PREMIUM.surfaceTint } }}
      >
        {openTile && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: SPACE.base }}>
              Разрез: {slice.systems.length ? `${slice.systems.length} ИС` : 'весь портфель'}
              {slice.characteristic ? ` · ${slice.characteristic}` : ''}
              {slice.owner ? ` · ${slice.owner}` : ''}
            </Text>
            <openTile.Detail slice={slice} />
          </>
        )}
      </Drawer>
    </div>
  );
};

export default ExecCockpit;
