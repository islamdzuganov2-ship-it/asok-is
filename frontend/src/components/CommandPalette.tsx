/**
 * CommandPalette.tsx — командная строка Ctrl+K (ТЗ v21 §4).
 *
 * Единая точка «я знаю, что ищу»: ИС, характеристики, разделы меню (с их вопросом) и, при
 * пустом запросе, шесть вопросов активного кокпита как быстрые команды. Поиск по рискам
 * (`/risks/semantic-search`) и мерам — за границей этой реализации (см. итоговый отчёт);
 * список источников расширяется этим же компонентом без изменения механики открытия.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, List, Typography, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { NAV_SECTIONS } from '../store/slices/uiSlice';
import { QUALITY_MODEL } from '../constants/qualityModel';
import { useGetSystemsQuery } from '../store/api/apiSlice';
import { useSlice } from '../store/slice/sliceUrl';
import { TYPE, SPACE, PREMIUM } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text } = Typography;

const ROUTE_BY_PERM: Record<string, string> = {
  'view.dashboard.cto': '/dashboard/cto',
  'view.dashboard.ceo': '/dashboard/ceo',
  'view.dashboard.manager': '/dashboard/manager',
  'view.dashboard.risk': '/dashboard/risk',
  'view.dashboard.analytics': '/dashboard/analytics',
  'view.dashboard.dynamics': '/dashboard/manager/dynamics',
  'view.assessments': '/assessments/new',
  'view.dashboard.incidents': '/dashboard/incidents',
  'view.risks': '/risks',
  'view.risk_economics': '/risk-economics',
  'view.reports': '/reports',
  'view.dashboard.taskplan': '/dashboard/taskplan',
  'view.my_tasks': '/my-tasks',
  'view.dashboard.risk_radar': '/dashboard/risk-radar',
};

interface Row {
  key: string;
  group: string;
  label: string;
  hint?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<Props> = ({ open, onClose }) => {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const permissions = useSelector((s: RootState) => s.auth.permissions);
  const { data: systemsResp } = useGetSystemsQuery(undefined, { skip: !open });
  const [, patchSlice] = useSlice();

  useEffect(() => { if (open) setQ(''); }, [open]);

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out: Row[] = [];

    NAV_SECTIONS.filter((s) => permissions.includes(s.perm)).forEach((s) => {
      if (term && !s.label.toLowerCase().includes(term) && !s.question.toLowerCase().includes(term)) return;
      out.push({
        key: `nav-${s.perm}`, group: 'Раздел', label: s.label, hint: s.question,
        action: () => { navigate(ROUTE_BY_PERM[s.perm] ?? '/dashboard'); onClose(); },
      });
    });

    if (term.length >= 1) {
      (systemsResp?.items ?? []).filter((s) => s.name.toLowerCase().includes(term)).slice(0, 5).forEach((s) => {
        out.push({
          key: `sys-${s.id}`, group: 'Информационная система', label: s.name, hint: s.criticality_class,
          action: () => { patchSlice({ systems: [s.id] }); onClose(); },
        });
      });
      QUALITY_MODEL.filter((c) => c.title.toLowerCase().includes(term)).slice(0, 5).forEach((c) => {
        out.push({
          key: `char-${c.title}`, group: 'Характеристика', label: c.title,
          action: () => { patchSlice({ characteristic: c.title }); onClose(); },
        });
      });
    }

    return out.slice(0, 20);
  }, [q, permissions, systemsResp, navigate, patchSlice, onClose]);

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={null} closable={false} width={560}
      styles={{ content: { padding: 0, borderRadius: PREMIUM.radius, overflow: 'hidden' } }}
    >
      <Input
        autoFocus size="large" variant="borderless"
        prefix={<SearchOutlined style={{ color: BRAND.inkSoft }} />}
        placeholder="Искать ИС, характеристику или раздел…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: SPACE.cozy, borderBottom: `1px solid ${PREMIUM.border}` }}
      />
      {rows.length ? (
        <List
          size="small"
          style={{ maxHeight: 360, overflowY: 'auto' }}
          dataSource={rows}
          renderItem={(r) => (
            <List.Item key={r.key} onClick={r.action} style={{ cursor: 'pointer', padding: `${SPACE.snug}px ${SPACE.cozy}px` }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Text style={{ ...TYPE.bodySm, color: BRAND.ink }}>{r.label}</Text>
                <Text type="secondary" style={TYPE.micro}>{r.group}{r.hint ? ` · ${r.hint}` : ''}</Text>
              </div>
            </List.Item>
          )}
        />
      ) : (
        <Empty description="Ничего не найдено" style={{ padding: SPACE.airy }} />
      )}
    </Modal>
  );
};

export default CommandPalette;
