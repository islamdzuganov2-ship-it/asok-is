/**
 * DynamicsModal.tsx — динамика метрики/характеристики по кварталам + ввод причин изменения.
 * По каждому кварталу: качество, изменение (Δ) к предыдущей оценке и поле «Причина изменения».
 * Причины сохраняются в dynamicsSlice (localStorage).
 */
import React from 'react';
import { Modal, Typography, Tag, Space, Input } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { ragToken } from '../theme/ragPalette';
import { QUARTERS, type DynSeries } from '../data/mockScaleData';
import { reasonKey, selectReasons, setReason } from '../store/slices/dynamicsSlice';

const { Text } = Typography;

interface Props {
  open: boolean;
  system: string;
  series: DynSeries | null;
  onClose: () => void;
}

export const DynamicsModal: React.FC<Props> = ({ open, system, series, onClose }) => {
  const dispatch = useDispatch();
  const reasons = useSelector(selectReasons);
  if (!series) return null;

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={640}
      title={`Динамика: ${series.name}`}>
      <Text type="secondary">
        Качество по кварталам и причины изменения относительно предыдущей оценки.
        Заполняет менеджер по качеству.
      </Text>
      <div style={{ marginTop: 12 }}>
        {QUARTERS.map((q, i) => {
          const v = series.series[i];
          const prev = i > 0 ? series.series[i - 1] : null;
          const delta = v >= 0 && prev != null && prev >= 0 ? v - prev : null;
          const key = reasonKey(system, series.key, q);
          return (
            <div key={q} style={{ borderTop: i ? '1px solid #F0F1F3' : 'none', padding: '10px 0' }}>
              <Space wrap>
                <Tag>{q}</Tag>
                <Text strong style={{ color: v < 0 ? '#9AA0A6' : ragToken(v).color }}>
                  {v < 0 ? 'н/д' : `${v}%`}
                </Text>
                {delta != null && (
                  <Tag color={delta > 0 ? 'green' : delta < 0 ? 'red' : 'default'}>
                    {delta > 0 ? '+' : ''}{delta}% к пред.
                  </Tag>
                )}
                {i === 0 && <Text type="secondary" style={{ fontSize: 12 }}>(первая оценка)</Text>}
              </Space>
              <Input.TextArea
                rows={1}
                autoSize={{ minRows: 1, maxRows: 3 }}
                placeholder="Причина изменения качества (что и почему изменилось)…"
                defaultValue={reasons[key] || ''}
                onBlur={(e) => dispatch(setReason({ key, text: e.target.value }))}
                style={{ marginTop: 6 }}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default DynamicsModal;
