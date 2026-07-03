/**
 * NotificationBell.tsx — колокольчик уведомлений в шапке (рядом с именем пользователя).
 *
 *  Менеджер по качеству:
 *    • подходящие сроки по задачам на контроле у топ-менеджера (одобренные/эскалированные меры);
 *    • назначенные задачи из плана обеспечения качества;
 *    • незаполненные профессиональные суждения (на каких системах есть пустые значения).
 *  Топ-менеджер:
 *    • необработанные заявки (меры, ожидающие решения).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Popover, List, Typography, Tag, Empty, Button } from 'antd';
import {
  BellOutlined, ClockCircleOutlined, ScheduleOutlined, FormOutlined, AuditOutlined, WarningOutlined, RiseOutlined,
} from '@ant-design/icons';
import { useSelector, shallowEqual } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { selectVisibleProposals } from '../store/slices/governanceSlice';

const { Text } = Typography;
const VITE_API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';
const DAY = 86400000;

// Скрытые уведомления «до следующего входа»: хранятся в localStorage, сбрасываются при логине
// (authSlice.setCredentials удаляет ключ) и при выходе (localStorage.clear).
const DISMISS_KEY = 'asok_notif_dismissed';
const loadDismissed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
};

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};

interface Note { key: string; icon: React.ReactNode; color: string; text: string; to: string }
interface JudgStatus { period_id: string; system_name: string; period: string; filled: number; total: number }

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const role = useSelector((s: RootState) => s.auth.role) || '';
  const proposals = useSelector(selectVisibleProposals, shallowEqual);
  const isQM = role === 'QUALITY_MANAGER';
  const isExec = ['ADMIN', 'CTO', 'CEO', 'CIO', 'EXECUTIVE'].includes(role);

  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [judg, setJudg] = useState<JudgStatus[]>([]);
  useEffect(() => {
    if (!isQM) { setJudg([]); return; }
    let alive = true;
    const token = localStorage.getItem('token');
    fetch(`${VITE_API}/assessments/judgments-status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: JudgStatus[]) => { if (alive) setJudg(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setJudg([]); });
    return () => { alive = false; };
  }, [isQM]);

  const notes: Note[] = useMemo(() => {
    const out: Note[] = [];
    const now = Date.now();

    // Топ-менеджер: необработанные заявки (меры на согласовании) + эскалации на решение.
    if (isExec) {
      proposals.filter((p) => p.status === 'PENDING_APPROVAL').forEach((p) => {
        out.push({
          key: `pend-${p.id}`, icon: <AuditOutlined />, color: '#C9A14A',
          text: `Необработанная заявка: «${p.riskTitle || p.metricName}» (${p.systemName})`,
          to: '/dashboard/executive',
        });
      });
      proposals.filter((p) => p.escalated && !p.escalationDecision).forEach((p) => {
        out.push({
          key: `escpend-${p.id}`, icon: <RiseOutlined />, color: '#7E57C2',
          text: `Эскалация ожидает решения: «${p.riskTitle || p.metricName}» (${p.systemName})`,
          to: '/dashboard/taskplan',
        });
      });
    }

    // Менеджер по качеству.
    if (isQM) {
      // Незаполненные профессиональные суждения — на каких системах пусто.
      judg.forEach((j) => {
        out.push({
          key: `judg-${j.period_id}`, icon: <FormOutlined />, color: '#C06B5A',
          text: `Не заполнены проф. суждения: ${j.system_name} · ${j.period} (${j.filled}/${j.total})`,
          to: '/assessments/new',
        });
      });
      // Задачи на контроле / назначенные из плана обеспечения качества.
      proposals.filter((p) => p.status === 'APPROVED' && p.execution !== 'DONE').forEach((p) => {
        const due = parseRu(p.dueDate);
        const overdue = due ? due.getTime() < now : false;
        const soon = due ? due.getTime() - now < 7 * DAY && due.getTime() >= now : false;
        if (p.escalated && p.escalationDecision) {
          out.push({ key: `escd-${p.id}`, icon: <RiseOutlined />, color: '#7E57C2',
            text: `Решение по эскалации получено — отработать: «${p.riskTitle || p.metricName}» (${p.systemName})`, to: '/dashboard/taskplan' });
        } else if (p.escalated) {
          // ожидает решения топ-менеджмента — уведомление показывается топ-менеджеру
        } else if (overdue || soon) {
          out.push({ key: `due-${p.id}`, icon: <ClockCircleOutlined />, color: overdue ? '#C06B5A' : '#C9A14A',
            text: `Срок задачи «${p.riskTitle || p.metricName}» (${p.systemName}): ${p.dueDate}${overdue ? ' — просрочено' : ' — скоро'}`,
            to: '/dashboard/taskplan' });
        } else {
          out.push({ key: `task-${p.id}`, icon: <ScheduleOutlined />, color: '#6E89A6',
            text: `Назначенная задача из плана: «${p.riskTitle || p.metricName}» (${p.systemName})${p.dueDate ? `, срок ${p.dueDate}` : ''}`,
            to: '/dashboard/taskplan' });
        }
      });
    }
    return out;
  }, [isQM, isExec, proposals, judg]);

  const visibleNotes = useMemo(() => notes.filter((n) => !dismissed.has(n.key)), [notes, dismissed]);
  const clearAll = () => {
    const next = new Set(dismissed);
    notes.forEach((n) => next.add(n.key));
    setDismissed(next);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  };

  if (!isQM && !isExec) return null;

  const content = (
    <div style={{ width: 380, maxHeight: 420, overflow: 'auto' }}>
      {visibleNotes.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет уведомлений" />
      ) : (
        <List
          size="small"
          dataSource={visibleNotes}
          renderItem={(n) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(n.to)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ color: n.color, marginRight: 8, marginTop: 2 }}>{n.icon}</span>
                <Text style={{ fontSize: 13 }}>{n.text}</Text>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  const title = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span><BellOutlined /> Уведомления {visibleNotes.length ? `(${visibleNotes.length})` : ''}</span>
      {visibleNotes.length > 0 && (
        <Button type="link" size="small" onClick={clearAll}>Очистить всё</Button>
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" title={title}>
      <Badge count={visibleNotes.length} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Popover>
  );
};

export default NotificationBell;
