/**
 * ConclusionFeedback.tsx — обратная связь человека по заключению LLM (обучает «резервный мозг»).
 *
 * Принять / Поправить / Отклонить → POST /reports/conclusion-feedback c fingerprint заключения.
 * Правка сохраняется как «золотой» пример для дообучения и повышает приоритет в будущем recall;
 * отклонённые заключения не подмешиваются в контекст следующих прогонов.
 */
import React, { useState } from 'react';
import { Button, Space, Modal, Input, message, Tag } from 'antd';
import { LikeOutlined, DislikeOutlined, EditOutlined } from '@ant-design/icons';

const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface Props {
  fingerprint?: string | null;
  currentText?: string;
}

const LABEL: Record<string, string> = { accept: 'принято', reject: 'отклонено', edit: 'исправлено' };

const ConclusionFeedback: React.FC<Props> = ({ fingerprint, currentText }) => {
  const [sent, setSent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(currentText || '');
  const [busy, setBusy] = useState(false);

  if (!fingerprint) return null;

  const send = async (verdict: 'accept' | 'reject' | 'edit', edited_text?: string) => {
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`${VITE_API}/reports/conclusion-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ fingerprint, verdict, edited_text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSent(verdict);
      setEditing(false);
      message.success(`Обратная связь сохранена в «мозг» (${LABEL[verdict]})`);
    } catch (e: any) {
      message.error(`Не удалось сохранить: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Tag color={sent === 'reject' ? 'red' : 'green'} style={{ marginTop: 8 }}>
        Обратная связь учтена ({LABEL[sent]})
      </Tag>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <Space size={6} wrap>
        <span style={{ fontSize: 12, color: '#888' }}>Оценка заключения (обучает «мозг»):</span>
        <Button size="small" icon={<LikeOutlined />} loading={busy} onClick={() => send('accept')}>Принять</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => { setText(currentText || ''); setEditing(true); }}>Поправить</Button>
        <Button size="small" danger icon={<DislikeOutlined />} loading={busy} onClick={() => send('reject')}>Отклонить</Button>
      </Space>
      <Modal
        title="Исправить заключение (сохранится как эталон для дообучения)"
        open={editing}
        onOk={() => send('edit', text)}
        confirmLoading={busy}
        onCancel={() => setEditing(false)}
        okText="Сохранить в «мозг»"
        cancelText="Отмена"
        width={640}
      >
        <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
      </Modal>
    </div>
  );
};

export default ConclusionFeedback;
