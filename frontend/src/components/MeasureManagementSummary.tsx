/**
 * MeasureManagementSummary.tsx — карточка меры на языке ЛПР (ТЗ v19 п.14).
 *
 * «Что не так → деньги/срок → решение → стоимость → результат → ответственный», ≤80 слов и без
 * формул. Текст готовит бэкенд (governance/management_summary.py, персона TOP_MANAGER) и там же
 * кэширует по содержимому факта — поэтому здесь нет ни своего кэша, ни повторных попыток.
 *
 * Список `missing` показывается специально: если на мере не заполнены деньги, срок или
 * ответственный, честнее сказать «цифры ниже неполные», чем показать ноль, который ЛПР прочтёт
 * как «эффекта нет».
 */
import React, { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { BRAND, ACCENT } from '../theme/ragPalette';
import { PREMIUM, TYPE } from '../theme/premium';

const { Text, Paragraph } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

interface ManagementSummary {
  text: string;
  wordCount: number;
  hasMoney: boolean;
  hasDeadline: boolean;
  hasResponsible: boolean;
  missing: string[];
}

interface Props {
  /** Карточка запрашивается только когда модалка открыта — иначе запрос уходил бы вхолостую. */
  open: boolean;
  proposalId?: string;
}

export const MeasureManagementSummary: React.FC<Props> = ({ open, proposalId }) => {
  const [summary, setSummary] = useState<ManagementSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !proposalId) { setSummary(null); return; }
    let alive = true;
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/governance/proposals/${proposalId}/management-summary`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSummary(d); })
      .catch(() => { if (alive) setSummary(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, proposalId]);

  if (!loading && !summary?.text) return null;

  return (
    <div style={{
      background: BRAND.surfaceSoft, borderRadius: PREMIUM.radiusSm, padding: 12, marginBottom: 12,
      borderInlineStart: `3px solid ${ACCENT.slate.color}`,
    }}>
      <Text type="secondary" style={TYPE.caption}>
        <FileTextOutlined /> Для топ-менеджмента
      </Text>
      {loading ? (
        <Paragraph style={{ marginBottom: 0, marginTop: 4 }} type="secondary">Готовится…</Paragraph>
      ) : (
        <>
          <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>{summary!.text}</Paragraph>
          {summary!.missing.length > 0 && (
            <Text type="secondary" style={{ ...TYPE.micro, display: 'block', marginTop: 4 }}>
              Не заполнено на мере: {summary!.missing.join(', ')} — цифры ниже неполные, не нулевые.
            </Text>
          )}
        </>
      )}
    </div>
  );
};

export default MeasureManagementSummary;
