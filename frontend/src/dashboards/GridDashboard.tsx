/**
 * GridDashboard.tsx — конструктор дашборда: сетка карточек с режимом редактирования.
 *
 * Обычный режим — просто раскладка. «Настроить» включает react-grid-layout: карточку можно
 * перетащить за шапку, растянуть за угол, убрать крестиком или добавить любую другую из каталога
 * (CardPicker). «Готово» пишет раскладку в серверные prefs, «Отмена» откатывает черновик,
 * «Сбросить» возвращает штатный вид дашборда.
 *
 * Почему drag разрешён только за шапку (`draggableHandle`): внутри карточек живые элементы —
 * таблицы с сортировкой, селекторы, кликабельные ячейки теплокарты. Если тащить можно за любую
 * точку, обычный клик по сортировке превращается в микро-перетаскивание, и карточка «уезжает»
 * от каждого взаимодействия.
 *
 * На узком экране (< lg) сетка схлопывается в одну колонку и редактирование выключено: тащить
 * карточки пальцем по 12-колоночной сетке в 375px — не работа, а лотерея.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Space, Spin, Typography } from 'antd';
import { EditOutlined, CheckOutlined, PlusOutlined, CloseOutlined, HolderOutlined, UndoOutlined } from '@ant-design/icons';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import { useSelector } from 'react-redux';
import { message } from '../theme/appMessage';
import type { RootState } from '../store';
import { pageContainer, pageTitle, PREMIUM, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';
import { cardById, DASHBOARDS } from './registry';
import { useDashboardLayout } from './useDashboardLayout';
import { ScopeHost, ScopeToolbars } from './scopes';
import {
  GRID_COLS, GRID_ROW_HEIGHT, GRID_MARGIN, cardAllowed,
  type CardDef, type DashboardKey, type ScopeKey,
} from './types';

const { Title, Text } = Typography;

const ReactGridLayout = WidthProvider(RGL);

/** Ширина, ниже которой редактирование раскладки выключается (совпадает с antd `lg`). */
const EDIT_MIN_WIDTH = 992;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < EDIT_MIN_WIDTH,
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setNarrow(window.innerWidth < EDIT_MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

/**
 * Тело карточки: компонент из каталога грузится лениво (см. catalog.lazyCard), поэтому у каждой
 * ячейки свой Suspense. Общий Suspense на всю сетку не годится — тогда одна медленно
 * подгружаемая карточка гасила бы весь дашборд целиком.
 */
const CardBody: React.FC<{ card: CardDef }> = ({ card }) => (
  <React.Suspense
    fallback={
      <div style={{
        height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${PREMIUM.border}`, borderRadius: PREMIUM.radius, background: BRAND.surface,
      }}>
        <Spin />
      </div>
    }
  >
    <card.Component />
  </React.Suspense>
);

interface GridDashboardProps {
  dashboardKey: DashboardKey;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** Кнопки страницы, видимые вне режима редактирования. */
  headerExtra?: React.ReactNode;
}

export const GridDashboard: React.FC<GridDashboardProps> = ({
  dashboardKey, title, subtitle, icon, headerExtra,
}) => {
  const def = DASHBOARDS[dashboardKey];
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const narrow = useIsNarrow();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const {
    layout, dirty, saving, customized, setLayout, addCard, removeCard, save, revert, resetToDefault,
  } = useDashboardLayout(dashboardKey, def.defaultLayout, editing);

  // Какие скоупы поднимать — по карточкам, которые реально на экране.
  const scopes = useMemo(() => {
    const s = new Set<ScopeKey>();
    layout.forEach((row) => {
      const c = cardById(row.i);
      if (c && c.scope !== 'none') s.add(c.scope);
    });
    return s;
  }, [layout]);

  const presentIds = useMemo(() => new Set(layout.map((r) => r.i)), [layout]);

  /**
   * Раскладка для react-grid-layout: геометрия и минимальный размер карточки.
   *
   * Возможность двигать и растягивать задаётся пропсами самой сетки (`isDraggable`/`isResizable`
   * ниже), а не полями каждого элемента: правило здесь общее для всех карточек — «можно только
   * в режиме редактирования», и дублировать его в каждой строке раскладки незачем.
   */
  const rglLayout: Layout[] = useMemo(() => layout.map((row) => {
    const def2 = cardById(row.i);
    return { ...row, minW: def2?.minW ?? 3, minH: def2?.minH ?? 3 };
  }), [layout]);

  const onLayoutChange = (next: Layout[]) => {
    if (!editing) return;
    setLayout(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));
  };

  const finish = async () => {
    if (!dirty) { setEditing(false); return; }
    const ok = await save();
    if (ok) { message.success('Раскладка сохранена'); setEditing(false); }
    else message.error('Не удалось сохранить раскладку');
  };

  const cancel = () => { revert(); setEditing(false); };

  const body = layout.length === 0 ? (
    <Empty
      style={{ marginTop: 48 }}
      description={
        <Space direction="vertical" size={4}>
          <Text>На дашборде нет ни одной карточки.</Text>
          <Text type="secondary">Нажмите «Добавить карточку» и соберите его под себя.</Text>
        </Space>
      }
    >
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(true); setPickerOpen(true); }}>
        Добавить карточку
      </Button>
    </Empty>
  ) : narrow ? (
    // Узкий экран: одна колонка в порядке раскладки (сверху вниз, слева направо).
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.base, marginTop: SPACE.base }}>
      {[...layout]
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .map((row) => {
          const c = cardById(row.i);
          if (!c) return null;
          return (
            <div key={row.i} data-card={row.i} style={{ minHeight: 240 }}>
              <CardBody card={c} />
            </div>
          );
        })}
    </div>
  ) : (
    <ReactGridLayout
      className={editing ? 'dash-grid dash-grid--editing' : 'dash-grid'}
      layout={rglLayout}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={GRID_MARGIN}
      containerPadding={[0, SPACE.base]}
      onLayoutChange={onLayoutChange}
      draggableHandle=".dash-card__handle"
      isDraggable={editing}
      isResizable={editing}
      compactType="vertical"
      // useCSSTransforms оставляем включённым (дефолт): position:absolute + transform не ломает
      // внутренние sticky-шапки таблиц, а без него драг заметно дёргается.
      resizeHandles={['se', 'e', 's']}
    >
      {layout.map((row) => {
        const c = cardById(row.i);
        if (!c) return <div key={row.i} />;
        return (
          <div key={row.i} data-card={row.i} style={{ position: 'relative' }}>
            {editing && (
              <div className="dash-card__overlay">
                <span className="dash-card__handle" title="Перетащить карточку">
                  <HolderOutlined /> {c.title}
                </span>
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  aria-label={`Убрать карточку «${c.title}»`}
                  title="Убрать с дашборда"
                  onClick={() => removeCard(row.i)}
                />
              </div>
            )}
            <div style={{ height: '100%', ...(editing ? { pointerEvents: 'none' as const, userSelect: 'none' as const } : null) }}>
              <CardBody card={c} />
            </div>
          </div>
        );
      })}
    </ReactGridLayout>
  );

  return (
    <ScopeHost scopes={scopes}>
      <div style={pageContainer}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.base, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <Title level={4} style={pageTitle}>{icon}{title ?? def.label}</Title>
            {subtitle && <Text type="secondary">{subtitle}</Text>}
          </div>
          <Space wrap>
            {!editing && headerExtra}
            {editing ? (
              <>
                <Button icon={<PlusOutlined />} onClick={() => setPickerOpen(true)}>Добавить карточку</Button>
                {customized && (
                  <Popconfirm
                    title="Вернуть стандартную раскладку?"
                    description="Ваши правки на этом дашборде будут отменены."
                    okText="Сбросить"
                    cancelText="Отмена"
                    onConfirm={resetToDefault}
                  >
                    <Button icon={<UndoOutlined />}>Сбросить</Button>
                  </Popconfirm>
                )}
                <Button onClick={cancel}>Отмена</Button>
                <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={finish}>Готово</Button>
              </>
            ) : (
              <Button
                icon={<EditOutlined />}
                onClick={() => setEditing(true)}
                disabled={narrow}
                title={narrow ? 'Настройка раскладки доступна на широком экране' : undefined}
              >
                Настроить
              </Button>
            )}
          </Space>
        </div>

        {/* Панели активных скоупов (выбор ИС, фильтры сбоев, фильтры плана задач…) */}
        <div style={{ marginTop: SPACE.cozy, display: 'flex', flexDirection: 'column', gap: SPACE.snug }}>
          <ScopeToolbars scopes={scopes} />
        </div>

        {editing && (
          <Alert
            style={{ marginTop: SPACE.base }}
            type="info"
            showIcon
            message={<>Тащите карточку за её шапку <HolderOutlined />, меняйте размер за правый нижний угол, убирайте крестиком. «Добавить карточку» — каталог всех доступных вам карточек системы.</>}
          />
        )}

        {body}

        <CardPickerLazy
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          permissions={permissions}
          presentIds={presentIds}
          currentKey={dashboardKey}
          onAdd={(id) => {
            const c = cardById(id);
            if (c && !cardAllowed(c, permissions)) return;
            addCard(id);
            message.success('Карточка добавлена вниз дашборда');
          }}
        />
      </div>
    </ScopeHost>
  );
};

/** Каталог грузится только когда его впервые открыли — он тянет весь реестр карточек. */
const CardPickerImpl = React.lazy(() => import('./CardPicker'));
const CardPickerLazy: React.FC<React.ComponentProps<typeof CardPickerImpl>> = (props) => {
  // Пока ни разу не открывали — не грузим чанк вовсе.
  const [everOpened, setEverOpened] = useState(props.open);
  React.useEffect(() => { if (props.open) setEverOpened(true); }, [props.open]);
  if (!everOpened) return null;
  return (
    <React.Suspense fallback={null}>
      <CardPickerImpl {...props} />
    </React.Suspense>
  );
};

export default GridDashboard;
