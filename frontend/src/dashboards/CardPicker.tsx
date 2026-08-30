/**
 * CardPicker.tsx — каталог карточек: «добавить на дашборд что угодно из доступного».
 *
 * Группировка — по дашборду-происхождению: пользователь ищет не «карточку exec.heatmap», а
 * «ту теплокарту с управленческого». Уже стоящие на дашборде карточки показываются отмеченными
 * и повторно не добавляются — вместо того чтобы прятать их из списка: увидеть, что карточка уже
 * взята, полезнее, чем гадать, куда она делась.
 */
import React, { useMemo, useState } from 'react';
import { Button, Drawer, Empty, Input, Space, Tag, Typography } from 'antd';
import { CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { CARD_REGISTRY, DASHBOARDS } from './registry';
import { cardAllowed, type CardDef, type DashboardKey } from './types';
import { PREMIUM, SPACE, TYPE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text } = Typography;

interface CardPickerProps {
  open: boolean;
  onClose: () => void;
  /** Права пользователя — верхняя граница каталога. */
  permissions: string[];
  /** id карточек, уже стоящих на дашборде. */
  presentIds: Set<string>;
  onAdd: (cardId: string) => void;
  /** Ключ текущего дашборда — его карточки показываем первой группой. */
  currentKey: DashboardKey;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export const CardPicker: React.FC<CardPickerProps> = ({
  open, onClose, permissions, presentIds, onAdd, currentKey,
}) => {
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const allowed = CARD_REGISTRY.filter((c) => cardAllowed(c, permissions));
    const needle = norm(q.trim());
    const matched = needle
      ? allowed.filter((c) => norm(`${c.title} ${c.hint ?? ''} ${DASHBOARDS[c.source].label}`).includes(needle))
      : allowed;

    const bySource = new Map<DashboardKey, CardDef[]>();
    matched.forEach((c) => {
      if (!bySource.has(c.source)) bySource.set(c.source, []);
      bySource.get(c.source)!.push(c);
    });
    // Карточки текущего дашборда — первыми: чаще всего возвращают убранную «свою».
    return [...bySource.entries()].sort(([a], [b]) => {
      if (a === currentKey) return -1;
      if (b === currentKey) return 1;
      return DASHBOARDS[a].label.localeCompare(DASHBOARDS[b].label, 'ru');
    });
  }, [permissions, q, currentKey]);

  const total = groups.reduce((n, [, cards]) => n + cards.length, 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Каталог карточек"
      width={460}
      styles={{ body: { padding: SPACE.base } }}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: SPACE.cozy }}>
        Любая карточка из доступных вам дашбордов. Добавленная встаёт вниз сетки — дальше
        двигайте и меняйте размер мышью.
      </Text>
      <Input.Search
        allowClear
        placeholder="Поиск по названию или дашборду"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: SPACE.base }}
      />

      {total === 0 ? (
        <Empty description={q ? 'Ничего не найдено' : 'Доступных карточек нет'} />
      ) : (
        groups.map(([source, cards]) => (
          <div key={source} style={{ marginBottom: SPACE.airy }}>
            <Space style={{ marginBottom: SPACE.snug }}>
              <Text strong style={{ color: BRAND.ink }}>{DASHBOARDS[source].label}</Text>
              {source === currentKey && <Tag color="gold">этот дашборд</Tag>}
            </Space>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.snug }}>
              {cards.map((c) => {
                const present = presentIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: SPACE.cozy,
                      padding: SPACE.cozy,
                      border: `1px solid ${PREMIUM.border}`,
                      borderRadius: PREMIUM.radiusSm,
                      background: present ? PREMIUM.surfaceTint : 'transparent',
                    }}
                  >
                    {c.thumbnail}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: BRAND.ink, fontWeight: 500 }}>{c.title}</div>
                      {c.hint && <Text type="secondary" style={TYPE.caption}>{c.hint}</Text>}
                    </div>
                    <Button
                      size="small"
                      type={present ? 'text' : 'primary'}
                      disabled={present}
                      icon={present ? <CheckOutlined /> : <PlusOutlined />}
                      onClick={() => onAdd(c.id)}
                    >
                      {present ? 'на дашборде' : 'Добавить'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </Drawer>
  );
};

export default CardPicker;

