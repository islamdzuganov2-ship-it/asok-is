/**
 * FieldHint.tsx — подпись поля ввода с подсказкой по наведению (ТЗ: подсказки над каждым
 * запрашиваемым полем по всему фронту). Оборачивает текст label в Form.Item: подсказка +
 * иконка-маркер, чтобы было видно, что расшифровка вообще есть (просто title на тексте — нет).
 */
import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

interface Props {
  title: React.ReactNode;
  children: React.ReactNode;
}

const FieldHint: React.FC<Props> = ({ title, children }) => (
  <Tooltip title={title}>
    {children} <InfoCircleOutlined style={{ color: '#bbb' }} />
  </Tooltip>
);

export default FieldHint;
