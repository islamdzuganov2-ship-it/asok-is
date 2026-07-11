/**
 * FilledJudgmentsCard.tsx — заполненные профессиональные суждения по выбранной ИС.
 * Дополнительная карточка на дашборде менеджера по качеству (внизу): суждения связаны
 * с характеристикой, подхарактеристикой и системой (периодом).
 *
 * Чёткая связь с выбранной характеристикой (как у карточки «Метрики характеристики "X"»):
 * при передаче prop `characteristic` карточка по умолчанию показывает суждения ТОЛЬКО по ней
 * (заголовок и тег повторяют выбор), с переключателем «все характеристики».
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, List, Tag, Typography, Space, Empty, Button, Input, Switch } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import { premiumCard, accentDot } from '../theme/premium';

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface Item { system_name: string; period: string; characteristic: string; subcharacteristic: string; judgment_text: string }

// Нормализация названий характеристик (ё/е, регистр, пробелы) — как в теплокарте.
const norm = (s: string) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

interface Props { systemName?: string; characteristic?: string; sub?: string; hideWhenEmpty?: boolean }

const FilledJudgmentsCard: React.FC<Props> = ({ systemName, characteristic, sub, hideWhenEmpty }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(false);
  // Связь с выбранной характеристикой включена по умолчанию (паритет с карточкой метрик).
  const [onlyChar, setOnlyChar] = useState(true);

  useEffect(() => {
    if (!systemName) { setItems([]); return; }
    let alive = true;
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/assessments/judgments-filled?system_name=${encodeURIComponent(systemName)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Item[]) => { if (alive) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [systemName]);

  const charFiltered = useMemo(() => {
    if (!(characteristic && onlyChar)) return items;
    return items.filter((i) =>
      norm(i.characteristic) === norm(characteristic)
      && (!sub || norm(i.subcharacteristic) === norm(sub)));
  }, [items, characteristic, onlyChar, sub]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? charFiltered.filter((i) => `${i.characteristic} ${i.subcharacteristic} ${i.judgment_text}`.toLowerCase().includes(s)) : charFiltered;
  }, [charFiltered, q]);
  const shown = expanded ? filtered : filtered.slice(0, 5);

  const linked = characteristic && onlyChar;

  // «Раскрывается только когда что-то есть»: если по выбору суждений нет — карточку не рисуем.
  // Решение по charFiltered (до строкового поиска), чтобы поиск не «прятал» карточку.
  if (hideWhenEmpty && charFiltered.length === 0) return null;

  return (
    <Card
      title={
        <Space wrap size={6}>
          <span style={accentDot('#6E89A6')} />
          <FormOutlined />
          <span>
            Профессиональные суждения{systemName ? ` — «${systemName}»` : ''}
          </span>
          {linked && <Tag color="blue">характеристика «{characteristic}»</Tag>}
          {linked && sub && <Tag>{sub}</Tag>}
        </Space>
      }
      {...premiumCard('slate', { marginTop: 16 })}
      extra={
        <Space size={12}>
          {characteristic && (
            <Space size={6}>
              <Switch size="small" checked={onlyChar} onChange={setOnlyChar} />
              <Text type="secondary" style={{ fontSize: 12 }}>только выбранная характеристика</Text>
            </Space>
          )}
          {items.length > 0 && <Input.Search placeholder="поиск" allowClear size="small" style={{ width: 180 }} onChange={(e) => setQ(e.target.value)} />}
        </Space>
      }
    >
      {filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={linked
            ? `По характеристике «${characteristic}» этой ИС профессиональные суждения ещё не заполнены`
            : 'По этой ИС профессиональные суждения ещё не заполнены'}
        />
      ) : (
        <>
          <List
            size="small"
            dataSource={shown}
            renderItem={(j) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space wrap size={4}>
                    <Tag color="blue">{j.characteristic}</Tag>
                    <Text strong style={{ fontSize: 13 }}>{j.subcharacteristic}</Text>
                    <Tag>{j.period}</Tag>
                  </Space>
                  <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>{j.judgment_text}</Paragraph>
                </Space>
              </List.Item>
            )}
          />
          {filtered.length > 5 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Button type="link" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Свернуть' : `Показать все (${filtered.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default FilledJudgmentsCard;
