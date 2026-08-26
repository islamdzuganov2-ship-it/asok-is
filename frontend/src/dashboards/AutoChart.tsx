/**
 * AutoChart.tsx — ECharts, который переживает изменение размера ЯЧЕЙКИ, а не только окна.
 *
 * echarts-for-react пересчитывает canvas по `window.resize`. В конструкторе размер меняет
 * пользователь, растягивая карточку мышью: окно при этом неподвижно, и график остаётся в старых
 * пикселях — растянутый или обрезанный. Лечится ResizeObserver'ом на контейнере.
 */
import React, { useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

interface AutoChartProps {
  option: Record<string, unknown>;
  notMerge?: boolean;
  onEvents?: Record<string, (params: unknown) => void>;
  /** Минимальная высота — чтобы график не схлопнулся в ноль на маленькой карточке. */
  minHeight?: number;
  style?: React.CSSProperties;
}

export const AutoChart: React.FC<AutoChartProps> = ({ option, notMerge, onEvents, minHeight = 160, style }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReactECharts | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    // jsdom в тестах ResizeObserver не реализует — молча работаем без авто-ресайза.
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance()?.resize();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} style={{ flex: '1 1 auto', minHeight, width: '100%', ...style }}>
      <ReactECharts
        ref={(r) => { chartRef.current = r; }}
        option={option}
        notMerge={notMerge}
        onEvents={onEvents}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
};

export default AutoChart;
