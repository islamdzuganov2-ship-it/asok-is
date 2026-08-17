/**
 * MeasureDepartmentsPage.tsx — ТЗ v19 §17.3 (УК-47): справочник направлений.
 *
 * Временный справочник «характеристика → направление» — условное деление вручную до
 * интеграции с AD (задел, см. governance/models.py MeasureDepartment). Автоматически
 * подставляется на карточку меры при создании (governance/service.py apply_department).
 * Ведёт SUPER_ADMIN (В-58: тот же уровень, что настройка прав) — гейт на бэкенде
 * `admin.permissions.manage`, здесь маршрут защищён тем же правом (App.tsx).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Space, Table, Typography } from 'antd';
import { message } from '../../theme/appMessage';
import { ApartmentOutlined, SaveOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { fetchMeasureDepartments, upsertMeasureDepartment } from '../../store/slices/governanceCardThunks';
import type { MeasureDepartment } from '../../store/slices/governanceSlice';
import { CHARACTERISTICS } from '../../constants/qualityModel';
import { pageContainer, pageTitle, GOLD, premiumCard, accentDot, SPACE } from '../../theme/premium';
import { BRAND } from '../../theme/ragPalette';

const { Title, Text } = Typography;

interface Row {
  characteristic: string;
  departmentName: string;
  saved: string;  // последнее сохранённое значение — для отображения «есть несохранённое»
}

const MeasureDepartmentsPage: React.FC = () => {
  const [rows, setRows] = useState<Row[]>(CHARACTERISTICS.map((c) => ({ characteristic: c, departmentName: '', saved: '' })));
  const [loading, setLoading] = useState(true);
  const [savingChar, setSavingChar] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchMeasureDepartments();
      const byChar = new Map(data.map((d: MeasureDepartment) => [d.characteristic, d.departmentName]));
      setRows(CHARACTERISTICS.map((c) => {
        const v = byChar.get(c) ?? '';
        return { characteristic: c, departmentName: v, saved: v };
      }));
    } catch {
      message.error('Не удалось загрузить справочник направлений');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setValue = (characteristic: string, value: string) =>
    setRows((prev) => prev.map((r) => (r.characteristic === characteristic ? { ...r, departmentName: value } : r)));

  const save = async (r: Row) => {
    if (!r.departmentName.trim()) { message.error('Укажите направление'); return; }
    setSavingChar(r.characteristic);
    try {
      await upsertMeasureDepartment(r.characteristic, r.departmentName.trim());
      setRows((prev) => prev.map((x) => (x.characteristic === r.characteristic ? { ...x, saved: x.departmentName.trim(), departmentName: x.departmentName.trim() } : x)));
      message.success(`Направление для «${r.characteristic}» сохранено`);
    } catch {
      message.error('Не удалось сохранить направление');
    } finally {
      setSavingChar(null);
    }
  };

  const dirtyCount = useMemo(() => rows.filter((r) => r.departmentName.trim() !== r.saved).length, [rows]);

  const columns: ColumnsType<Row> = [
    { title: 'Характеристика', dataIndex: 'characteristic', width: 260,
      render: (v: string) => <Text strong style={{ color: BRAND.ink }}>{v}</Text> },
    { title: 'Направление', dataIndex: 'departmentName',
      render: (_: string, r) => (
        <Input
          value={r.departmentName}
          placeholder="Например: Департамент разработки"
          onChange={(e) => setValue(r.characteristic, e.target.value)}
          onPressEnter={() => save(r)}
        />
      ) },
    { title: '', key: 'action', width: 120, align: 'right',
      render: (_: unknown, r) => (
        <Button
          size="small" type="primary" icon={<SaveOutlined />}
          loading={savingChar === r.characteristic}
          disabled={!r.departmentName.trim() || r.departmentName.trim() === r.saved}
          onClick={() => save(r)}
        >
          Сохранить
        </Button>
      ) },
  ];

  return (
    <div style={pageContainer}>
      <Title level={4} style={pageTitle}><span style={accentDot(GOLD.base)} />Направления</Title>
      <Text type="secondary">
        Справочник «характеристика → направление» (§17.3, УК-47) — подставляется автоматически
        на карточку новой меры по характеристике. Временное решение до интеграции с AD, где
        оргструктура придёт готовой.
      </Text>

      <Alert
        style={{ margin: '16px 0' }}
        type="info"
        showIcon
        message="Условное деление"
        description="Одна запись на характеристику (не подхарактеристику) — по решению заказчика §17.3. Более тонкая гранулярность добавится позже, если понадобится."
      />

      <Card {...premiumCard()} title={<Space><ApartmentOutlined />Направления по характеристикам</Space>}>
        <Table<Row>
          rowKey="characteristic"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          size="small"
        />
        {dirtyCount > 0 && (
          <Text type="warning" style={{ display: 'block', marginTop: SPACE.snug }}>
            Несохранённых изменений: {dirtyCount}
          </Text>
        )}
      </Card>
    </div>
  );
};

export default MeasureDepartmentsPage;
