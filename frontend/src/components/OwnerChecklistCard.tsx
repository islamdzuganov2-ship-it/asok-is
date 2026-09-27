/**
 * OwnerChecklistCard.tsx — «Чек-лист владельца ИС» на «Моих задачах» (BL-007 RE-19, рычаг 3).
 *
 * Владелец ИС сам отвечает на пункты чек-листа периода оценки и прикладывает артефакт — это
 * снимает сбор с аналитика. Отклонённые аналитиком пункты возвращаются сюда с комментарием.
 * Карточка видна только при праве `assessment.checklist.fill` и только когда есть что делать.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { message } from '../theme/appMessage';
import { premiumCard, SPACE } from '../theme/premium';

const { Text } = Typography;
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

interface OpenItem {
  id: string; periodId: string; period: string; systemName: string;
  characteristic: string; subcharacteristic: string; question: string;
  answer: string | null; artifactUrl: string | null; verification: string; verifierComment: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${r.status}`);
  }
  return r.json();
}

const OwnerChecklistCard: React.FC = () => {
  const allowed = useSelector((s: RootState) => s.auth.permissions.includes('assessment.checklist.fill'));
  const [items, setItems] = useState<OpenItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { answer: string; url: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    call<OpenItem[]>('/assessments/checklist/open').then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed || items.length === 0) return null;

  const submit = async (it: OpenItem) => {
    const d = drafts[it.id] ?? { answer: it.answer ?? '', url: it.artifactUrl ?? '' };
    setSaving(it.id);
    try {
      await call(`/assessments/checklist/${it.id}/answer`, {
        method: 'PUT', body: JSON.stringify({ answer: d.answer, artifact_url: d.url }),
      });
      message.success('Ответ отправлен аналитику');
      load();
    } catch (e: any) { message.error(e.message); }
    finally { setSaving(null); }
  };

  return (
    <Card {...premiumCard('sage', { marginBottom: SPACE.base })} title={`Чек-лист владельца ИС · ${items.length}`}>
      <List
        dataSource={items}
        renderItem={(it) => {
          const d = drafts[it.id] ?? { answer: it.answer ?? '', url: it.artifactUrl ?? '' };
          const setD = (patch: Partial<typeof d>) => setDrafts((all) => ({ ...all, [it.id]: { ...d, ...patch } }));
          return (
            <List.Item key={it.id}>
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                <Space wrap>
                  <Text strong>{it.systemName} · {it.period}</Text>
                  <Tag>{it.subcharacteristic}</Tag>
                  {it.verification === 'REJECTED' && <Tag color="red">возвращён аналитиком</Tag>}
                </Space>
                <Text type="secondary">{it.question}</Text>
                {it.verifierComment && <Text type="danger">Комментарий аналитика: {it.verifierComment}</Text>}
                <Input.TextArea rows={2} placeholder="Ответ" value={d.answer} onChange={(e) => setD({ answer: e.target.value })} />
                <Space.Compact style={{ width: '100%' }}>
                  <Input placeholder="Ссылка на артефакт (отчёт, выгрузка, регламент)" value={d.url} onChange={(e) => setD({ url: e.target.value })} />
                  <Button type="primary" loading={saving === it.id} onClick={() => submit(it)}>Отправить</Button>
                </Space.Compact>
              </Space>
            </List.Item>
          );
        }}
      />
    </Card>
  );
};

export default OwnerChecklistCard;
