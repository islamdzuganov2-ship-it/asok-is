/**
 * BackToCockpit.tsx — кнопка «← К кокпиту» на глубокой странице (ТЗ-21 §7.5, КП-39).
 *
 * Рисуется в `AppLayout` над содержимым любой страницы, открытой из кокпита (`from=cockpit`),
 * — поэтому L3-страницы не нужно править по одной. Возвращает на адрес `ret`: тот же разрез
 * и та же открытая шторка L2, с которыми уходили (§3.5, строка «L3 → L2»).
 */
import React from 'react';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { cockpitReturnTarget } from '../store/slice/cockpitReturn';
import { SPACE } from '../theme/premium';

const BackToCockpit: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const target = cockpitReturnTarget(location.search);
  if (!target) return null;
  return (
    <div style={{ marginBottom: SPACE.base }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(target)}>
        К кокпиту
      </Button>
    </div>
  );
};

export default BackToCockpit;
