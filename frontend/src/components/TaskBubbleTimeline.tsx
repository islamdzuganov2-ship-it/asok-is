/**
 * TaskBubbleTimeline.tsx — пузырьковая карта задач (ТЗ v15.1).
 *
 * Ось Y — ОТВЕТСТВЕННЫЕ (не системы; системы в этом виде не упоминаются).
 * Ось X — время: от самого раннего старта задач до самой поздней даты исполнения (срока).
 * Пузырьки светятся по зоне: красный — просрочено, жёлтый — зона риска, зелёный — в плане.
 * Задачи одного ответственного с совпадающей датой исполнения собираются в «пирог» (донат
 * с сегментами по зонам и счётчиком); при наведении пирог «разъезжается» на отдельные пузырьки,
 * каждый из которых можно выбрать. Клик по пузырьку открывает задачу.
 *
 * Реализовано на HTML/CSS (не canvas): плавная анимация fan-out и предсказуемая доступность.
 */
import React, { useMemo, useState } from 'react';
import { Tooltip } from 'antd';
import type { Proposal } from '../store/slices/governanceSlice';
import { BRAND } from '../theme/ragPalette';

const DAY = 86400000;
const LABEL_W = 184;
const ROW_H = 62;
const RISK_DAYS = 14;

const parseRu = (d?: string): Date | null => {
  if (!d) return null;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};

type Zone = 'overdue' | 'risk' | 'plan';
const ZONE: Record<Zone, { color: string; label: string }> = {
  overdue: { color: '#C06B5A', label: 'просрочено' },
  risk:    { color: '#C9A14A', label: 'в зоне риска' },
  plan:    { color: '#6F9F86', label: 'в плане' },
};
const ZONE_RANK: Zone[] = ['overdue', 'risk', 'plan']; // худшая → лучшая

interface Props {
  tasks: { p: Proposal }[];
  onOpen: (p: Proposal) => void;
}

interface Cluster { key: string; owner: string; due: number; tasks: Proposal[] }

const TaskBubbleTimeline: React.FC<Props> = ({ tasks, onOpen }) => {
  const [hover, setHover] = useState<string | null>(null);
  const now = Date.now();

  const zoneOf = (t: Proposal): Zone => {
    if (t.execution === 'DONE') return 'plan';
    const d = parseRu(t.dueDate);
    if (!d) return 'plan';
    const daysLeft = Math.round((d.getTime() - now) / DAY);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= RISK_DAYS) return 'risk';
    return 'plan';
  };
  const dueOf = (t: Proposal) => parseRu(t.dueDate)?.getTime() ?? new Date(t.createdAt).getTime() + 30 * DAY;

  // Ответственные (строки-дорожки).
  const owners = useMemo(
    () => [...new Set(tasks.map((t) => t.p.owner || 'Не назначен'))],
    [tasks],
  );

  const bounds = useMemo(() => {
    const ts = tasks.flatMap((t) => [new Date(t.p.createdAt).getTime(), dueOf(t.p)]);
    ts.push(now, now + 20 * DAY);
    const min = Math.min(...ts), max = Math.max(...ts);
    return { min, max, span: (max - min) || 1 };
  }, [tasks, now]);

  const months = useMemo(() => {
    const out: { label: string; pct: number }[] = [];
    const d = new Date(bounds.min); d.setDate(1);
    while (d.getTime() <= bounds.max) {
      out.push({ label: d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), pct: ((d.getTime() - bounds.min) / bounds.span) * 100 });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [bounds]);
  const todayPct = ((now - bounds.min) / bounds.span) * 100;

  // Кластеры: один ответственный + совпадающий день исполнения.
  const clusters = useMemo(() => {
    const map = new Map<string, Cluster>();
    tasks.forEach((t) => {
      const owner = t.p.owner || 'Не назначен';
      const due = dueOf(t.p);
      const day = Math.floor(due / DAY);
      const key = `${owner}|${day}`;
      if (!map.has(key)) map.set(key, { key, owner, due, tasks: [] });
      map.get(key)!.tasks.push(t.p);
    });
    return [...map.values()];
  }, [tasks]);

  const worstZone = (ts: Proposal[]): Zone => {
    const zones = ts.map(zoneOf);
    return ZONE_RANK.find((z) => zones.includes(z)) ?? 'plan';
  };
  const sizeOf = (p: Proposal) => 18 + ((100 - Math.max(0, p.calculatedScore)) / 100) * 14;

  const plotH = Math.max(owners.length * ROW_H, ROW_H);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 820 }}>
        {/* Шкала месяцев */}
        <div style={{ display: 'flex', height: 20 }}>
          <div style={{ width: LABEL_W, flex: '0 0 auto', fontSize: 12, color: '#8a94a6', fontWeight: 500 }}>Ответственный</div>
          <div style={{ position: 'relative', flex: 1 }}>
            {months.map((m) => (
              <span key={m.label + m.pct} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: 11, color: '#8a94a6', transform: 'translateX(-50%)' }}>{m.label}</span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex' }}>
          {/* Подписи ответственных */}
          <div style={{ width: LABEL_W, flex: '0 0 auto' }}>
            {owners.map((o, i) => (
              <div key={o} style={{ height: ROW_H, display: 'flex', alignItems: 'center', fontSize: 13, color: BRAND.ink, borderTop: i ? '1px solid #F0F2F4' : 'none', paddingRight: 10, overflow: 'hidden' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o}</span>
              </div>
            ))}
          </div>

          {/* Поле диаграммы */}
          <div style={{ position: 'relative', flex: 1, height: plotH }}>
            {/* Горизонтальные разделители дорожек */}
            {owners.map((o, i) => (
              <div key={o} style={{ position: 'absolute', left: 0, right: 0, top: i * ROW_H, height: ROW_H, borderTop: i ? '1px solid #F0F2F4' : 'none' }} />
            ))}
            {/* Линии месяцев */}
            {months.map((m) => (
              <div key={m.pct} style={{ position: 'absolute', left: `${m.pct}%`, top: 0, bottom: 0, borderLeft: '1px dashed #EEF0F2', pointerEvents: 'none' }} />
            ))}
            {/* «Сегодня» */}
            {todayPct >= 0 && todayPct <= 100 && (
              <div style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, borderLeft: '2px solid #C06B5A', pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', top: -16, left: -18, fontSize: 10, color: '#C06B5A', fontWeight: 600 }}>сегодня</span>
              </div>
            )}

            {clusters.map((cl) => {
              const rowIdx = owners.indexOf(cl.owner);
              const cy = rowIdx * ROW_H + ROW_H / 2;
              const cx = ((cl.due - bounds.min) / bounds.span) * 100;
              const isHover = hover === cl.key;
              const n = cl.tasks.length;

              if (n === 1) {
                const p = cl.tasks[0];
                const z = zoneOf(p);
                const d = sizeOf(p);
                return (
                  <Tooltip key={cl.key} title={`${p.riskTitle || p.metricName} · ${p.owner || 'не назначен'} · срок ${p.dueDate || 'без срока'} · ${ZONE[z].label}`}>
                    <div
                      onClick={() => onOpen(p)}
                      style={{
                        position: 'absolute', left: `${cx}%`, top: cy, width: d, height: d,
                        transform: 'translate(-50%,-50%)', borderRadius: '50%', cursor: 'pointer',
                        background: ZONE[z].color, border: '2px solid #fff',
                        boxShadow: `0 0 12px ${ZONE[z].color}, 0 1px 3px rgba(0,0,0,.2)`,
                      }}
                    />
                  </Tooltip>
                );
              }

              // Кластер: «пирог» (донат), при наведении разъезжается на отдельные пузырьки.
              const D = 36;
              const stops = cl.tasks.map((p, i) => {
                const from = (i / n) * 360; const to = ((i + 1) / n) * 360;
                return `${ZONE[zoneOf(p)].color} ${from}deg ${to}deg`;
              }).join(', ');
              const glow = ZONE[worstZone(cl.tasks)].color;
              const bubbleD = 24;
              const R = Math.max(42, 14 + n * 8); // радиус разлёта растёт с числом задач
              const shieldR = R + bubbleD;        // «щит» наведения покрывает всю зону разлёта

              return (
                <div
                  key={cl.key}
                  onMouseEnter={() => setHover(cl.key)}
                  onMouseLeave={() => setHover((h) => (h === cl.key ? null : h))}
                  style={{ position: 'absolute', left: `${cx}%`, top: cy, width: 0, height: 0, zIndex: isHover ? 30 : 2 }}
                >
                  {/* Прозрачный «щит» наведения покрывает всю область разлёта — устраняет мигание:
                      курсор не попадает в «мёртвые зоны» между разъехавшимися пузырьками, поэтому
                      кластер не схлопывается, и любой пузырёк можно спокойно выбрать. */}
                  {isHover && (
                    <div style={{
                      position: 'absolute', left: 0, top: 0, width: shieldR * 2, height: shieldR * 2,
                      transform: 'translate(-50%,-50%)', borderRadius: '50%', pointerEvents: 'auto',
                      background: 'radial-gradient(circle, rgba(43,58,75,0.06), rgba(43,58,75,0) 68%)',
                    }} />
                  )}

                  {/* Пирог-глиф (виден, пока не наведено) */}
                  <div
                    style={{
                      position: 'absolute', left: 0, top: 0, width: D, height: D, transform: 'translate(-50%,-50%)',
                      borderRadius: '50%', background: `conic-gradient(${stops})`,
                      boxShadow: `0 0 14px ${glow}, 0 1px 4px rgba(0,0,0,.22)`, cursor: 'pointer',
                      opacity: isHover ? 0 : 1, transition: 'opacity .18s ease', pointerEvents: isHover ? 'none' : 'auto',
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: BRAND.ink }}>{n}</div>
                  </div>

                  {/* Разлетающиеся пузырьки — выбираются кликом */}
                  {cl.tasks.map((p, i) => {
                    const ang = (-90 + (360 / n) * i) * Math.PI / 180;
                    const bx = isHover ? Math.cos(ang) * R : 0;
                    const by = isHover ? Math.sin(ang) * R : 0;
                    const z = zoneOf(p);
                    return (
                      <Tooltip key={p.id} title={`${p.riskTitle || p.metricName} · срок ${p.dueDate || 'без срока'} · ${ZONE[z].label}`}>
                        <div
                          onClick={() => onOpen(p)}
                          style={{
                            position: 'absolute', left: 0, top: 0, width: bubbleD, height: bubbleD,
                            transform: `translate(-50%,-50%) translate(${bx}px, ${by}px)`,
                            borderRadius: '50%', background: ZONE[z].color, border: '2px solid #fff',
                            boxShadow: `0 0 10px ${ZONE[z].color}, 0 1px 3px rgba(0,0,0,.28)`,
                            opacity: isHover ? 1 : 0, cursor: 'pointer', zIndex: 2,
                            transition: 'transform .28s cubic-bezier(.34,1.42,.5,1), opacity .18s ease',
                            pointerEvents: isHover ? 'auto' : 'none',
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskBubbleTimeline;
