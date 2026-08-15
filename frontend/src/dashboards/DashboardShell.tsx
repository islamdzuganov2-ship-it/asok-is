/**
 * DashboardShell.tsx (BL-008, Фаза 4) — оболочка НАСТРАИВАЕМОГО дашборда.
 *
 * В обычном режиме рендерит включённые виджеты в сохранённом порядке. В режиме «Настроить»
 * даёт галочками включать/выключать любой доступный виджет и перетаскивать их порядок
 * (нативный HTML5 drag-and-drop, без внешних библиотек). Раскладка хранится per-user на
 * бэкенде: GET/PUT /iam/me/preferences → prefs.dashboards[dashboardKey].widgets.
 * Реестр виджетов задаёт дефолты; сохранённые prefs их переопределяют, новые виджеты реестра
 * добавляются в конец с дефолтной видимостью.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Checkbox, Space, Typography, Empty } from 'antd';
import { message } from '../theme/appMessage';
import { EditOutlined, CheckOutlined, HolderOutlined } from '@ant-design/icons';
import { useGetMyPreferencesQuery, usePutMyPreferencesMutation, type UserPrefs, type WidgetPref } from '../store/api/apiSlice';
import { premiumCard, pageContainer, pageTitle, PREMIUM, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Title, Text } = Typography;

export interface WidgetDef { id: string; title: string; defaultEnabled: boolean; Component: React.FC }

interface Row { id: string; enabled: boolean }

function buildLayout(widgets: WidgetDef[], saved?: WidgetPref[]): Row[] {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const rows: Row[] = [];
  const seen = new Set<string>();
  (saved ?? []).slice().sort((a, b) => a.order - b.order).forEach((s) => {
    if (byId.has(s.id) && !seen.has(s.id)) { rows.push({ id: s.id, enabled: s.enabled }); seen.add(s.id); }
  });
  widgets.forEach((w) => { if (!seen.has(w.id)) rows.push({ id: w.id, enabled: w.defaultEnabled }); });
  return rows;
}

interface ShellProps {
  dashboardKey: string;
  widgets: WidgetDef[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headerExtra?: React.ReactNode;
}

export const DashboardShell: React.FC<ShellProps> = ({ dashboardKey, widgets, title, subtitle, icon, headerExtra }) => {
  const { data: prefsData } = useGetMyPreferencesQuery();
  const [putPrefs, putState] = usePutMyPreferencesMutation();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => buildLayout(widgets));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const savedWidgets = prefsData?.prefs?.dashboards?.[dashboardKey]?.widgets;
  useEffect(() => { setRows(buildLayout(widgets, savedWidgets)); }, [savedWidgets, widgets]);

  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const enabledRows = rows.filter((r) => r.enabled);

  const toggle = (id: string) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));

  const onDrop = (target: number) => {
    setRows((prev) => {
      if (dragIdx === null || dragIdx === target) return prev;
      const next = prev.slice();
      const [moved] = next.splice(dragIdx, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDragIdx(null);
  };

  const save = async () => {
    const prefs: UserPrefs = { ...(prefsData?.prefs ?? {}) };
    prefs.dashboards = { ...(prefs.dashboards ?? {}) };
    prefs.dashboards[dashboardKey] = { widgets: rows.map((r, i) => ({ id: r.id, enabled: r.enabled, order: i })) };
    try {
      await putPrefs({ prefs }).unwrap();
      message.success('Раскладка сохранена');
      setEditing(false);
    } catch {
      message.error('Не удалось сохранить раскладку');
    }
  };

  const cancel = () => { setRows(buildLayout(widgets, savedWidgets)); setEditing(false); };

  return (
    <div style={pageContainer}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.base, flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={pageTitle}>{icon}{title}</Title>
          {subtitle && <Text type="secondary">{subtitle}</Text>}
        </div>
        <Space wrap>
          {!editing && headerExtra}
          {editing ? (
            <>
              <Button onClick={cancel}>Отмена</Button>
              <Button type="primary" icon={<CheckOutlined />} loading={putState.isLoading} onClick={save}>Готово</Button>
            </>
          ) : (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>Настроить</Button>
          )}
        </Space>
      </div>

      {editing ? (
        <Card {...premiumCard('gold', { marginTop: SPACE.base })}>
          <Text type="secondary">
            Отметьте галочкой, что показывать на дашборде, и перетащите строки за <HolderOutlined /> для порядка.
          </Text>
          <div style={{ marginTop: SPACE.cozy, display: 'flex', flexDirection: 'column', gap: SPACE.snug }}>
            {rows.map((r, i) => {
              const w = byId.get(r.id);
              if (!w) return null;
              return (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  onDragEnd={() => setDragIdx(null)}
                  data-widget={r.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.cozy,
                    padding: `${SPACE.snug}px ${SPACE.cozy}px`,
                    border: `1px solid ${dragIdx === i ? '#8FB9A2' : PREMIUM.border}`,
                    borderRadius: PREMIUM.radiusSm, background: dragIdx === i ? '#EEF3F8' : '#fff',
                    cursor: 'grab', userSelect: 'none',
                  }}
                >
                  <HolderOutlined style={{ color: BRAND.inkSoft, cursor: 'grab' }} />
                  <Checkbox checked={r.enabled} onChange={() => toggle(r.id)} />
                  <span style={{ color: BRAND.ink, fontWeight: 500 }}>{w.title}</span>
                  {!r.enabled && <Text type="secondary">— скрыт</Text>}
                </div>
              );
            })}
          </div>
        </Card>
      ) : enabledRows.length === 0 ? (
        <Empty style={{ marginTop: 40 }} description="Все виджеты скрыты. Нажмите «Настроить», чтобы добавить." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.base, marginTop: SPACE.base }}>
          {enabledRows.map((r) => {
            const w = byId.get(r.id);
            return w ? <div key={r.id}><w.Component /></div> : null;
          })}
        </div>
      )}
    </div>
  );
};

export default DashboardShell;
