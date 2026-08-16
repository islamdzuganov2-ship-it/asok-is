/**
 * PermissionsMatrixPage.tsx (BL-008) — раздел «Права» супер-администратора.
 * Выбор роли → галочки по всему каталогу функционала (сгруппированы) → «Сохранить».
 * Встроенные роли (ADMIN, SUPER_ADMIN) показаны только для чтения — их права фиксированы.
 * Доступ гейтится правом view.admin.permissions (маршрут в App.tsx).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Checkbox, Select, Button, Space, Typography, Alert, Row, Col, Tag, Spin } from 'antd';
import { message } from '../../theme/appMessage';
import { SafetyOutlined, SaveOutlined, PushpinOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import {
  useGetPermissionCatalogQuery, useGetPermissionMatrixQuery, useSetRolePermissionsMutation,
  useGetMandatorySectionsQuery, useSetMandatorySectionsMutation,
} from '../../store/api/apiSlice';
import { roleLabel } from '../../constants/roles';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, TYPE, SPACE } from '../../theme/premium';
import { BRAND, RAG, solidTagStyle } from '../../theme/ragPalette';

const { Title, Text } = Typography;
const BUILTIN = ['SUPER_ADMIN', 'ADMIN'];

const apiError = (e: unknown, fallback: string): string => {
  const detail = (e as { data?: { detail?: string } })?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const PermissionsMatrixPage: React.FC = () => {
  const { data: catalog, isLoading: cLoading } = useGetPermissionCatalogQuery();
  const { data: matrix, isLoading: mLoading } = useGetPermissionMatrixQuery();
  const [saveRole, saveState] = useSetRolePermissionsMutation();
  const myPermissions = useSelector((s: RootState) => s.auth.permissions);
  const canManageMandatory = myPermissions.includes('admin.mandatory_sections.manage');

  const [role, setRole] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  // ТЗ v20 п.10 — обязательные дашборды (глобально, вне матрицы ролей).
  const { data: mandatory, isLoading: mandLoading } = useGetMandatorySectionsQuery();
  const [saveMandatory, saveMandatoryState] = useSetMandatorySectionsMutation();
  const [mandSelected, setMandSelected] = useState<Set<string>>(new Set());
  const [mandDirty, setMandDirty] = useState(false);
  useEffect(() => {
    if (mandatory) { setMandSelected(new Set(mandatory.permissions)); setMandDirty(false); }
  }, [mandatory]);
  const toggleMandatory = (key: string) => {
    if (!canManageMandatory) return;
    setMandSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setMandDirty(true);
  };
  const saveMandatorySections = async () => {
    try {
      await saveMandatory({ permissions: [...mandSelected] }).unwrap();
      message.success('Обязательные дашборды сохранены');
      setMandDirty(false);
    } catch (e) {
      message.error(apiError(e, 'Не удалось сохранить обязательные дашборды'));
    }
  };
  const dashboardPerms = useMemo(
    () => (catalog?.permissions ?? []).filter((p) => p.group === 'Дашборды'),
    [catalog],
  );

  useEffect(() => {
    if (catalog && !role) {
      setRole(catalog.roles.find((r) => !BUILTIN.includes(r)) ?? catalog.roles[0] ?? '');
    }
  }, [catalog, role]);

  useEffect(() => {
    if (role && matrix) { setSelected(new Set(matrix[role] ?? [])); setDirty(false); }
  }, [role, matrix]);

  const isBuiltin = BUILTIN.includes(role);
  const permsByGroup = useMemo(() => {
    const map: Record<string, { key: string; label: string; description: string }[]> = {};
    (catalog?.permissions ?? []).forEach((p) => {
      (map[p.group] ??= []).push({ key: p.key, label: p.label, description: p.description });
    });
    return map;
  }, [catalog]);

  const toggle = (key: string) => {
    if (isBuiltin) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    try {
      await saveRole({ role, permissions: [...selected] }).unwrap();
      message.success(`Права роли «${roleLabel(role)}» сохранены`);
      setDirty(false);
    } catch (e) {
      message.error(apiError(e, 'Не удалось сохранить права'));
    }
  };

  if (cLoading || mLoading) {
    return <div style={pageContainer}><Spin /> <Text type="secondary">Загрузка каталога прав…</Text></div>;
  }

  return (
    <div style={pageContainer}>
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={pageTitle}><SafetyOutlined style={{ color: GOLD.base, marginRight: 8 }} />Права</Title>
          <Text type="secondary">Отметьте галочками, какой функционал доступен роли. Изменения применяются сразу после сохранения.</Text>
        </div>
        <Space wrap>
          <Text type="secondary">Роль:</Text>
          <Select
            value={role || undefined}
            style={{ minWidth: 260 }}
            onChange={setRole}
            options={(catalog?.roles ?? []).map((r) => ({
              value: r,
              label: `${roleLabel(r)} (${r})${BUILTIN.includes(r) ? ' · встроенная' : ''}`,
            }))}
          />
          <Button type="primary" icon={<SaveOutlined />} disabled={!dirty || isBuiltin}
            loading={saveState.isLoading} onClick={save}>Сохранить</Button>
        </Space>
      </Space>

      {isBuiltin && (
        <Alert style={{ marginTop: 16 }} type="info" showIcon
          message="Встроенная роль — права фиксированы в коде"
          description={role === 'SUPER_ADMIN'
            ? 'SUPER_ADMIN всегда имеет полный доступ (управление пользователями и правами).'
            : 'ADMIN имеет широкий функциональный доступ, но не управляет пользователями и правами — это прерогатива SUPER_ADMIN.'} />
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {(catalog?.groups ?? []).map((group) => (
          <Col xs={24} lg={12} key={group}>
            <Card
              {...premiumCard('ink')}
              title={<Space><span style={accentDot(GOLD.base)} /><span style={{ color: BRAND.ink }}>{group}</span></Space>}
            >
              <Space direction="vertical" size={SPACE.snug} style={{ width: '100%' }}>
                {(permsByGroup[group] ?? []).map((p) => (
                  <Checkbox key={p.key} checked={selected.has(p.key)} disabled={isBuiltin} onChange={() => toggle(p.key)}>
                    <Space size={4} wrap>
                      <span style={{ color: BRAND.ink }}>{p.label}</span>
                      <Text type="secondary" style={TYPE.caption} code>{p.key}</Text>
                    </Space>
                  </Checkbox>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ marginTop: 16 }}>
        <Tag style={solidTagStyle(dirty ? RAG.medium.strong : RAG.good.strong)}>
          {isBuiltin ? 'Только просмотр' : dirty ? 'Есть несохранённые изменения' : 'Сохранено'}
        </Tag>
      </div>

      {/* ТЗ v20 п.10 — обязательные дашборды: глобально для всех пользователей, вне матрицы ролей */}
      <Card
        {...premiumCard('gold', { marginTop: 24 })}
        title={<Space><span style={accentDot(GOLD.base)} /><PushpinOutlined /><span style={{ color: BRAND.ink }}>Обязательные дашборды</span></Space>}
        extra={
          <Button type="primary" icon={<SaveOutlined />} disabled={!mandDirty || !canManageMandatory}
            loading={saveMandatoryState.isLoading} onClick={saveMandatorySections}>Сохранить</Button>
        }
      >
        <Text type="secondary">
          Отмеченные дашборды обязательны для ВСЕХ пользователей независимо от роли — их нельзя
          скрыть в персональных настройках («Настройка» → состав разделов). Доступен всем ролям,
          у которых дашборд разрешён матрицей выше; здесь фиксируется только сама обязательность.
        </Text>
        {!canManageMandatory && (
          <Alert style={{ marginTop: 12 }} type="info" showIcon
            message="Только просмотр — фиксировать обязательные дашборды может только супер-администратор." />
        )}
        {mandLoading ? <Spin style={{ marginTop: 12 }} /> : (
          <Space direction="vertical" size={SPACE.snug} style={{ width: '100%', marginTop: 12 }}>
            {dashboardPerms.map((p) => (
              <Checkbox key={p.key} checked={mandSelected.has(p.key)} disabled={!canManageMandatory} onChange={() => toggleMandatory(p.key)}>
                <Space size={4} wrap>
                  <span style={{ color: BRAND.ink }}>{p.label}</span>
                  <Text type="secondary" style={TYPE.caption} code>{p.key}</Text>
                </Space>
              </Checkbox>
            ))}
          </Space>
        )}
      </Card>
    </div>
  );
};

export default PermissionsMatrixPage;
