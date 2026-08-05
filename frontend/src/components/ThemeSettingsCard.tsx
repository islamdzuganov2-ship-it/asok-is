/**
 * ThemeSettingsCard.tsx — карточка «Оформление»: выбор темы и шрифта (ТЗ v17, req 4/5).
 *
 * Переиспользуется:
 *   • SettingsPage — «Настройка» аналитика и менеджера по качеству;
 *   • AdminFlagsPage — «Настройка» топ-менеджера (добавлена к переключателям дашбордов).
 *
 * Выбор применяется сразу (dispatch → uiSlice → ConfigProvider + ThemeVarsBridge) и сохраняется в
 * localStorage. Дропдауны с мини-превью палитры темы и образцом шрифта.
 */
import React from 'react';
import { Card, Col, Row, Select, Space, Typography } from 'antd';
import { BgColorsOutlined, FontSizeOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { setThemeName, setFontKey } from '../store/slices/uiSlice';
import { THEMES, THEME_ORDER, FONT_OPTIONS, type ThemeName } from '../theme/themes';
import { premiumCard, accentDot, GOLD, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

const { Text, Title } = Typography;

// Мини-превью палитры темы: полотно · сайдбар · поверхность · акцент.
const swatch = (color: string, grad = false): React.CSSProperties => ({
  width: 18, height: 18, borderRadius: 5, flex: '0 0 auto',
  ...(grad ? { background: color } : { background: color }),
  border: '1px solid rgba(0,0,0,0.12)',
});

const ThemePreview: React.FC<{ name: ThemeName }> = ({ name }) => {
  const v = THEMES[name].vars;
  return (
    <Space size={4} style={{ marginLeft: 8 }}>
      <span style={swatch(v['--canvas'])} title="Полотно" />
      <span style={{ ...swatch(''), background: v['--sider-grad'] }} title="Сайдбар" />
      <span style={swatch(v['--surface'])} title="Карточки" />
      <span style={swatch(THEMES[name].antd.colorPrimary as string)} title="Акцент" />
    </Space>
  );
};

const ThemeSettingsCard: React.FC = () => {
  const dispatch = useDispatch();
  const themeName = useSelector((s: RootState) => s.ui.themeName);
  const fontKey = useSelector((s: RootState) => s.ui.fontKey);

  const themeOptions = THEME_ORDER.map((name) => ({
    value: name,
    label: (
      <Space style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <span>{THEMES[name].label}</span>
        <ThemePreview name={name} />
      </Space>
    ),
  }));

  const fontOptions = FONT_OPTIONS.map((f) => ({
    value: f.key,
    label: <span style={{ fontFamily: f.stack }}>{f.label} — Пример / Sample 123</span>,
  }));

  return (
    <Card
      title={<span style={{ color: BRAND.ink }}><span style={accentDot(GOLD.base)} /><BgColorsOutlined /> Оформление</span>}
      {...premiumCard('gold')}
    >
      <Text type="secondary">
        Тема и шрифт применяются сразу ко всему интерфейсу и сохраняются в этом браузере.
      </Text>
      <Row gutter={[SPACE.base, SPACE.base]} style={{ marginTop: SPACE.base }}>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0 }}><BgColorsOutlined /> Тема оформления</Title>
          <Select
            style={{ width: '100%' }}
            size="large"
            value={themeName}
            onChange={(v) => dispatch(setThemeName(v as ThemeName))}
            options={themeOptions}
            optionLabelProp="label"
          />
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            {THEMES[themeName].hint}
          </Text>
        </Col>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0 }}><FontSizeOutlined /> Шрифт</Title>
          <Select
            style={{ width: '100%' }}
            size="large"
            value={fontKey}
            onChange={(v) => dispatch(setFontKey(v as string))}
            options={fontOptions}
          />
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            Влияет на весь текст приложения; используются шрифты, установленные в системе.
          </Text>
        </Col>
      </Row>
    </Card>
  );
};

export default ThemeSettingsCard;
