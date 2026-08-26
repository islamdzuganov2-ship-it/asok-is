/**
 * execHeatmapCard.tsx — тепловая карта характеристик управленческого дашборда.
 *
 * Вынесена из execCards отдельным модулем: это самая тяжёлая карточка каталога (сортировка по
 * любому столбцу, четыре режима отображения, денежный слой, легенда), и держать её вместе с
 * остальными семью означало файл, который перестаёт читаться целиком.
 */
import React from 'react';
import { Button, Segmented, Space, Spin, Tooltip, Typography } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { RAG, BRAND, ACCENT } from '../../theme/ragPalette';
import { TYPE, SPACE } from '../../theme/premium';
import { SortButton } from '../../components/LevelHeatmap';
import { useExecScope, abbr, MONEY_MODE_OPTIONS, type MoneyMode } from '../scopes/ExecScope';
import GridCard from '../GridCard';
import RagDot from './RagDot';

const { Text } = Typography;
// ─────────────────── Тепловая карта характеристик ───────────────────

export const ExecHeatmapCard: React.FC = () => {
  const {
    data, heatCharsFull, systems, isLive, moneyMode, setMoneyMode, moneyLoading,
    moneyCellVisual, cellHasMeasure, heatSort, setHeatSort, orderedHeatRows, sortedHeatRows,
    showAllHeatmap, setShowAllHeatmap, openSystem,
  } = useExecScope();
  const navigate = useNavigate();
  const shownHeatRows = showAllHeatmap ? sortedHeatRows : sortedHeatRows.slice(0, 5);

  return (
    <GridCard
      accent="slate"
      dotColor={ACCENT.slate.color}
      title={<><AppstoreOutlined /> Тепловая карта характеристик</>}
      extra={<Button type="link" size="small" onClick={() => navigate('/dashboard/analytics')}>Детали →</Button>}
    >
      {isLive ? (
        <Segmented
          size="small"
          value={moneyMode}
          onChange={(v) => setMoneyMode(v as MoneyMode)}
          options={MONEY_MODE_OPTIONS}
          style={{ marginBottom: SPACE.cozy }}
        />
      ) : (
        <Text type="secondary" style={{ ...TYPE.caption, display: 'block', marginBottom: SPACE.cozy }}>
          Режим: <Text strong style={TYPE.caption}>Балл качества</Text> — денежные режимы
          (ALE/ΔALE/покрытие) считаются по реестру рисков и доступны только в режиме LLM.
        </Text>
      )}
      {moneyMode !== 'score' && isLive && moneyLoading && <Spin size="small" style={{ marginBottom: SPACE.cozy }} />}
      {/* Таблица шире карточки на узкой ячейке — скроллим её саму, а не страницу. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '0 8px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', fontWeight: 500, color: BRAND.inkSoft, fontSize: TYPE.caption.fontSize }}>
                Система
                <SortButton
                  active={heatSort?.col === 'name'} dir={heatSort?.dir}
                  label="Сортировать по названию системы"
                  onSort={() => setHeatSort((s) => (s?.col === 'name' ? { col: 'name', dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: 'name', dir: 'asc' }))}
                />
              </th>
              {data.heatmap.characteristics.map((c, i) => (
                <th key={c} style={{ fontWeight: 500, color: BRAND.inkSoft, fontSize: TYPE.caption.fontSize, padding: '0 4px' }}>
                  <Tooltip title={c}>
                    <span style={{ borderBottom: `1px dotted ${BRAND.inkSoft}`, cursor: 'help' }}>{abbr(c)}</span>
                  </Tooltip>
                  <SortButton
                    active={heatSort?.col === i} dir={heatSort?.dir}
                    label={`Сортировать по «${c}»`}
                    onSort={() => setHeatSort((s) => (s?.col === i ? { col: i, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: i, dir: 'desc' }))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownHeatRows.map((r) => {
              const sys = systems.find((s) => s.name === r.system || s.name.includes(r.system));
              return (
                <tr key={r.system}>
                  <td
                    onClick={() => { if (sys) openSystem(sys); }}
                    title="Открыть карточку ИС (кто отвечает, действия, все меры)"
                    style={{ fontSize: TYPE.bodySm.fontSize, color: BRAND.ink, paddingRight: 12, cursor: sys ? 'pointer' : 'default' }}
                  >{r.system}</td>
                  {r.cells.map((cell, i) => {
                    const measured = cellHasMeasure(r.system, heatCharsFull[i]);
                    const money = moneyMode !== 'score' ? moneyCellVisual(r.system, heatCharsFull[i]) : null;
                    const dotScore = money ? money.score : cell.score;
                    const dotLabel = money
                      ? `${r.system} · ${heatCharsFull[i]} · ${money.label}`
                      : `${r.system} · ${heatCharsFull[i]}${measured ? ' · мера ожидает решения' : ''}`;
                    return (
                      <td
                        key={i}
                        onClick={() => { if (sys) openSystem(sys, heatCharsFull[i], cell.score); }}
                        title={`${heatCharsFull[i]} — карточка ИС с мерами по характеристике`}
                        style={{ textAlign: 'center', cursor: sys ? 'pointer' : 'default' }}
                      >
                        <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                          {money?.noData ? (
                            <span
                              title={dotLabel}
                              style={{
                                display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                                border: `1.5px dashed ${BRAND.inkSoft}`, boxSizing: 'border-box',
                              }}
                            />
                          ) : (
                            <RagDot score={dotScore} label={dotLabel} titleIsComplete={!!money} />
                          )}
                          {measured && !money && (
                            <span
                              title="По этой характеристике есть мера, ожидающая решения"
                              style={{
                                position: 'absolute', top: -5, right: -5, width: 8, height: 8,
                                borderRadius: '50%', background: RAG.good.color,
                                boxShadow: `0 0 0 2px ${BRAND.surface}`,
                              }}
                            />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Space size={16} style={{ marginTop: 12 }} wrap>
        {(['good', 'medium', 'bad'] as const).map((k) => (
          <Space key={k} size={6}>
            <RagDot score={k === 'good' ? 90 : k === 'medium' ? 60 : 20} size={10} />
            <Text type="secondary" style={TYPE.caption}>
              {moneyMode === 'score' ? RAG[k].label
                : moneyMode === 'ale' ? (k === 'good' ? 'ALE низкий' : k === 'medium' ? 'ALE средний' : 'ALE высокий')
                : moneyMode === 'delta' ? (k === 'good' ? 'ΔALE высокий' : k === 'medium' ? 'ΔALE средний' : 'ΔALE низкий')
                : (k === 'good' ? 'покрытие высокое' : k === 'medium' ? 'покрытие среднее' : 'покрытие низкое')}
            </Text>
          </Space>
        ))}
        {moneyMode === 'score' ? (
          <Space size={6}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAG.good.color, boxShadow: `0 0 0 2px ${BRAND.surface}`, display: 'inline-block' }} />
            <Text type="secondary" style={TYPE.caption}>мера ожидает решения</Text>
          </Space>
        ) : (
          <Space size={6}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1.5px dashed ${BRAND.inkSoft}`, boxSizing: 'border-box', display: 'inline-block' }} />
            <Text type="secondary" style={TYPE.caption}>риски не заведены (не то же самое, что 0 ₽)</Text>
          </Space>
        )}
      </Space>
      {orderedHeatRows.length > 5 && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Button type="link" onClick={() => setShowAllHeatmap(!showAllHeatmap)}>
            {showAllHeatmap ? 'Свернуть' : `Раскрыть все (${orderedHeatRows.length})`}
          </Button>
        </div>
      )}
    </GridCard>
  );
};

