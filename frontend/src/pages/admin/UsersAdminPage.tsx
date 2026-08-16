/**
 * UsersAdminPage.tsx (BL-008) — раздел «Пользователи» супер-администратора.
 * Список учёток + создание/редактирование (роль, активность), сброс пароля, мягкое удаление.
 * Доступ гейтится правом view.admin.users (маршрут в App.tsx).
 */
import React, { useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Switch, Space, Tag, Popconfirm, Typography, Alert } from 'antd';
import { message } from '../../theme/appMessage';
import type { ColumnsType } from 'antd/es/table';
import { UserAddOutlined, EditOutlined, KeyOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import {
  useGetUsersQuery, useCreateUserMutation, useUpdateUserMutation,
  useResetUserPasswordMutation, useDeleteUserMutation, useGetPermissionCatalogQuery,
  type AdminUser,
} from '../../store/api/apiSlice';
import { roleLabel } from '../../constants/roles';
import { pageContainer, pageTitle, GOLD, premiumCard, TYPE } from '../../theme/premium';
import { RAG, BRAND, solidTagStyle } from '../../theme/ragPalette';
import { sorterFor } from '../../theme/table';

const { Title, Text } = Typography;

const apiError = (e: unknown, fallback: string): string => {
  const detail = (e as { data?: { detail?: string } })?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const UsersAdminPage: React.FC = () => {
  const { data: users, isLoading } = useGetUsersQuery();
  const { data: catalog } = useGetPermissionCatalogQuery();
  const [createUser, createState] = useCreateUserMutation();
  const [updateUser] = useUpdateUserMutation();
  const [resetPassword] = useResetUserPasswordMutation();
  const [deleteUser] = useDeleteUserMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pwdFor, setPwdFor] = useState<AdminUser | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const roleOptions = (catalog?.roles ?? []).map((r) => ({ value: r, label: `${roleLabel(r)} (${r})` }));

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    editForm.setFieldsValue({ full_name: u.full_name, role: u.role, is_active: u.is_active });
  };

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    try {
      await createUser(v).unwrap();
      message.success('Пользователь создан');
      setCreateOpen(false);
      createForm.resetFields();
    } catch (e) {
      message.error(apiError(e, 'Не удалось создать пользователя'));
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const v = await editForm.validateFields();
    try {
      await updateUser({ id: editing.id, body: v }).unwrap();
      message.success('Изменения сохранены');
      setEditing(null);
    } catch (e) {
      message.error(apiError(e, 'Не удалось сохранить'));
    }
  };

  const submitPwd = async () => {
    if (!pwdFor) return;
    const v = await pwdForm.validateFields();
    try {
      await resetPassword({ id: pwdFor.id, password: v.password }).unwrap();
      message.success('Пароль сброшен');
      setPwdFor(null);
      pwdForm.resetFields();
    } catch (e) {
      message.error(apiError(e, 'Не удалось сбросить пароль'));
    }
  };

  const onDelete = async (u: AdminUser) => {
    try {
      await deleteUser(u.id).unwrap();
      message.success('Пользователь удалён');
    } catch (e) {
      message.error(apiError(e, 'Не удалось удалить'));
    }
  };

  const columns: ColumnsType<AdminUser> = [
    { title: 'Логин', dataIndex: 'username', key: 'username', sorter: sorterFor((r: AdminUser) => r.username), render: (v) => <Text strong>{v}</Text> },
    { title: 'Имя', dataIndex: 'full_name', key: 'full_name', sorter: sorterFor((r: AdminUser) => r.full_name), render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: 'Роль', dataIndex: 'role', key: 'role',
      sorter: sorterFor((r: AdminUser) => roleLabel(r.role)),
      render: (r: string) => <Tag style={solidTagStyle(BRAND.ink)}>{roleLabel(r)}</Tag>,
    },
    {
      title: 'Статус', dataIndex: 'is_active', key: 'is_active',
      sorter: sorterFor((r: AdminUser) => (r.is_active ? 1 : 0)),
      render: (a: boolean) => <Tag style={solidTagStyle(a ? RAG.good.strong : RAG.muted.strong)}>{a ? 'Активен' : 'Отключён'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 260,
      render: (_: unknown, u: AdminUser) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)}>Изменить</Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => setPwdFor(u)}>Пароль</Button>
          <Popconfirm title="Удалить пользователя?" okText="Удалить" cancelText="Отмена"
            okButtonProps={{ danger: true }} onConfirm={() => onDelete(u)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={pageContainer}>
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Title level={4} style={pageTitle}><TeamOutlined style={{ color: GOLD.base, marginRight: 8 }} />Пользователи</Title>
          <Text type="secondary">Заведение учётных записей и назначение ролей. Права ролей — в разделе «Права».</Text>
        </div>
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreateOpen(true)}>Добавить</Button>
      </Space>

      <Table<AdminUser>
        style={{ marginTop: 16 }}
        rowKey="id"
        loading={isLoading}
        dataSource={users ?? []}
        columns={columns}
        pagination={false}
        {...premiumCard('ink')}
      />

      {/* Создание */}
      <Modal title="Новый пользователь" open={createOpen} onOk={submitCreate}
        confirmLoading={createState.isLoading} onCancel={() => setCreateOpen(false)} okText="Создать" cancelText="Отмена">
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Form.Item name="username" label="Логин" rules={[{ required: true, message: 'Укажите логин' }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="full_name" label="Имя"><Input autoComplete="off" /></Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true, message: 'Выберите роль' }]}>
            <Select options={roleOptions} placeholder="Роль" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Редактирование */}
      <Modal title={`Пользователь: ${editing?.username ?? ''}`} open={!!editing} onOk={submitEdit}
        onCancel={() => setEditing(null)} okText="Сохранить" cancelText="Отмена">
        <Form form={editForm} layout="vertical" requiredMark={false}>
          <Form.Item name="full_name" label="Имя"><Input /></Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      {/* Сброс пароля */}
      <Modal title={`Сброс пароля: ${pwdFor?.username ?? ''}`} open={!!pwdFor} onOk={submitPwd}
        onCancel={() => setPwdFor(null)} okText="Сбросить" cancelText="Отмена">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="Новый пароль сообщите пользователю по защищённому каналу." />
        <Form form={pwdForm} layout="vertical" requiredMark={false}>
          <Form.Item name="password" label="Новый пароль" rules={[{ required: true, min: 6, message: 'Минимум 6 символов' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersAdminPage;
