/**
 * FilledJudgmentsCard.tsx — заполненные профессиональные суждения по выбранной ИС.
 * Дополнительная карточка на дашборде менеджера по качеству (внизу): суждения связаны
 * с характеристикой, подхарактеристикой и системой (периодом).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, List, Tag, Typography, Space, Empty, Button, Input } from 'antd';
import { FormOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface Item { system_name: string; period: string; characteristic: string; subcharacteristic: string; judgment_text: string }

const FilledJudgmentsCard: React.FC<{ systemName?: string }> = ({ systemName }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(false);

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

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.characteristic} ${i.subcharacteristic} ${i.judgment_text}`.toLowerCase().includes(s)) : items;
  }, [items, q]);
  const shown = expanded ? filtered : filtered.slice(0, 5);

  return (
    <Card
      title={<span><FormOutlined /> Заполненные профессиональные суждения{systemName ? ` — «${systemName}»` : ''}</span>}
      style={{ marginTop: 16 }}
      styles={{ body: { paddingTop: 12 } }}
      extra={items.length > 0 && <Input.Search placeholder="поиск" allowClear size="small" style={{ width: 180 }} onChange={(e) => setQ(e.target.value)} />}
    >
      {filtered.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="По этой ИС профессиональные суждения ещё не заполнены" />
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
