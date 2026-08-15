import React from 'react';
import { Typography, Card, Switch, Row, Col, Space, Button } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setSectionVisible, setNavOrder, resetPersonalization, NAV_SECTIONS } from '../store/slices/uiSlice';
import { accentDot, pageContainer, pageTitle, GOLD, PREMIUM, SPACE } from '../theme/premium';
import { RAG, BRAND } from '../theme/ragPalette';
import ThemeSettingsCard from '../components/ThemeSettingsCard';

const { Title, Text } = Typography;

// Мини-превью «Аналитика сбоев» — донат первопричин + столбцы MTTR.

const GROUPS = ['Основное', 'Сбор и анализ данных', 'Формирование техдолга'];

const AdminFlagsPage: React.FC = () => {
  const dispatch = useDispatch();
  const ui = useSelector((s: RootState) => s.ui);
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const [dragged, setDragged] = React.useState<string | null>(null);

  // Показываем ТОЛЬКО разделы, доступные роли по матрице прав: тумблер на недоступный
  // раздел вводил бы в заблуждение (ДЕФ-12 — ровно этим и был плох прежний экран).
  const visibleSections = React.useMemo(() => {
    const allowed = NAV_SECTIONS.filter((sec) => permissions.includes(sec.perm));
    const idx = (perm: string) => {
      const i = ui.navOrder.indexOf(perm);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return allowed.slice().sort((a, b) => idx(a.perm) - idx(b.perm));
  }, [permissions, ui.navOrder]);

  /** Перетаскивание (ДЕФ-14): переносим ключ перед целевым и сохраняем полный порядок.
   *
   * Ключ переносимого раздела кладём в dataTransfer, а не только в состояние компонента:
   * состояние обновляется асинхронно, и при быстром drop (а также при программном
   * воспроизведении событий) в обработчике оно ещё пустое — перенос молча не применялся.
   * Состояние остаётся только для подсветки строки. */
  const onDrop = (e: React.DragEvent, targetPerm: string) => {
    e.preventDefault();
    const source = e.dataTransfer.getData('text/plain') || dragged;
    setDragged(null);
    if (!source || source === targetPerm) return;
    const order = visibleSections.map((sec) => sec.perm);
    const from = order.indexOf(source);
    const to = order.indexOf(targetPerm);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    dispatch(setNavOrder(order));
  };

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Настройка</Title>
      <Text type="secondary">Персональные настройки интерфейса: оформление, состав и порядок разделов меню.</Text>

      {/* Оформление: тема + шрифт (ТЗ v17, req 5) — применяется сразу, сохраняется в браузере. */}
      <div style={{ marginTop: 16 }}>
        <ThemeSettingsCard />
      </div>

      <Title level={5} style={{ marginTop: 24, marginBottom: 4 }}>Состав и порядок разделов</Title>
      <Text type="secondary">
        Выключенные разделы скрываются из меню; порядок задаётся перетаскиванием. Настройка личная
        и не влияет на права: показать можно только то, что доступно вашей роли.
      </Text>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <Button size="small" onClick={() => dispatch(resetPersonalization())}>Вернуть вид по умолчанию</Button>
      </div>
      <Row gutter={[16, 16]}>
        {GROUPS.map((groupName) => {
          const rows = visibleSections.filter((sec) => sec.group === groupName);
          if (!rows.length) return null;
          return (
            <Col xs={24} md={8} key={groupName}>
              <Card
                title={groupName}
                styles={{ body: { padding: 8 } }}
                style={{ borderColor: PREMIUM.border, borderRadius: PREMIUM.radius, boxShadow: PREMIUM.shadow.card }}
              >
                {rows.map((sec) => {
                  const on = !ui.hiddenSections[sec.perm];
                  return (
                    <div
                      key={sec.perm}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', sec.perm);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragged(sec.perm);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnd={() => setDragged(null)}
                      onDrop={(e) => onDrop(e, sec.perm)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: SPACE.cozy,
                        padding: '8px 8px', borderRadius: 8, cursor: 'grab',
                        background: dragged === sec.perm ? BRAND.dividerSoft : 'transparent',
                        borderBottom: `1px solid ${BRAND.dividerSoft}`,
                      }}
                    >
                      <HolderOutlined style={{ color: RAG.muted.strong }} />
                      <Text style={{ flex: 1 }} type={on ? undefined : 'secondary'}>{sec.label}</Text>
                      <Switch
                        size="small"
                        checked={on}
                        onChange={(v) => dispatch(setSectionVisible({ perm: sec.perm, visible: v }))}
                      />
                    </div>
                  );
                })}
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ПОД РАЗВИТИЕ: раздел «Оценка СИИ» (ГОСТ Р 59898-2021) и история ИИ-оценок пока НЕ
          выведены в интерфейс. Страница и маршрут сохранены в коде (App.tsx, AiAssessmentPage);
          когда понадобится — вернуть сюда карточку-переключатель и пункт меню (AppLayout). */}
    </div>
  );
};

export default AdminFlagsPage;
