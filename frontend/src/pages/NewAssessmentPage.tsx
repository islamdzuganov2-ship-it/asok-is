/**
 * NewAssessmentPage.tsx — под-вкладка «Новая оценка».
 *
 * Рабочий процесс оценки ИС по модели качества ISO/IEC 25010 (8 характеристик / 31
 * подхарактеристика, см. constants/qualityModel.ts):
 *   1. Выбрать/добавить систему и период (оценку).
 *   2. Видеть обзор: какие оценки уже сделаны по системе и насколько они заполнены.
 *   3. Добавлять оценки по парам «характеристика → подхарактеристика»; уже заполненные
 *      пары исчезают из выпадающих списков (их правят комментариями во вкладке отчётов).
 *   4. Завершить оценку можно только когда заполнены все 31 подхарактеристика, иначе
 *      оценка не учитывается (бэкенд возвращает 409).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Progress, Select, Space,
    Table, Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, PlusOutlined, TableOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
    EditableMetric,
    PeriodSummary,
    SystemCreateDto,
    useCreateAssessmentPeriodMutation,
    useCreateAssessmentValueMutation,
    useCreateSystemMutation,
    useFinalizeAssessmentMutation,
    useGetAssessmentMetricsQuery,
    useGetPeriodSummariesQuery,
    useGetSystemsQuery,
} from '../store/api/apiSlice';
import {
    CHARACTERISTICS, QUALITY_PAIRS, TOTAL_SUBS, formulaFor, subsOf,
} from '../constants/qualityModel';
import { subArtifacts, subDescription } from '../constants/subDescriptions';
import ProfessionalJudgmentsPanel from '../components/ProfessionalJudgmentsPanel';

const { Title, Text } = Typography;

/** Цвета уровней качества — ключи совпадают с выводом backend map_to_level. */
const LEVEL_COLOR: Record<string, string> = {
    'Высокий уровень': 'green',
    'Выше среднего': 'cyan',
    'Средний уровень': 'gold',
    'Ниже среднего': 'orange',
    'Низкий уровень': 'red',
    'Невозможно измерить': 'default',
};

const pairKey = (characteristic: string, subcharacteristic: string) =>
    `${characteristic}|||${subcharacteristic}`;

interface AddValueForm {
    characteristic?: string;
    subcharacteristic?: string;
    val_a?: number;
    val_b?: number;
    expert_comment?: string;
    unmeasurable?: boolean;
    artifact_links?: string;
}

interface ResultRow {
    key: string;
    characteristic: string;
    subcharacteristic: string;
    val_a: number | null;
    val_b: number | null;
    x: number | null;
    level: string | null;
    comment: string;
}

export const NewAssessmentPage: React.FC = () => {
    const navigate = useNavigate();
    const [systemForm] = Form.useForm<SystemCreateDto>();
    const [valueForm] = Form.useForm<AddValueForm>();

    const { data: systems, isLoading: systemsLoading, isError: systemsError } = useGetSystemsQuery();
    const [createSystem, { isLoading: creatingSystem }] = useCreateSystemMutation();
    const [createPeriod, { isLoading: creatingPeriod }] = useCreateAssessmentPeriodMutation();
    const [createValue, { isLoading: addingValue }] = useCreateAssessmentValueMutation();
    const [finalize, { isLoading: finalizing }] = useFinalizeAssessmentMutation();

    // Контекст оценки сохраняется, чтобы «Назад» из табличного ввода возвращал к той же ИС/периоду
    // (а не выходил полностью из оценки выбранной системы).
    const [systemId, setSystemId] = useState<string | undefined>(() => localStorage.getItem('asok_last_system') || undefined);
    const [periodId, setPeriodId] = useState<string | undefined>(() => localStorage.getItem('asok_last_period') || undefined);
    const [newPeriodLabel, setNewPeriodLabel] = useState<string | undefined>();
    const [systemModalOpen, setSystemModalOpen] = useState(false);
    const [valueModalOpen, setValueModalOpen] = useState(false);

    useEffect(() => {
        if (systemId) localStorage.setItem('asok_last_system', systemId);
    }, [systemId]);
    useEffect(() => {
        if (periodId) localStorage.setItem('asok_last_period', periodId);
        else localStorage.removeItem('asok_last_period');
    }, [periodId]);

    const periodOptions = useMemo(() => {
        const year = new Date().getFullYear();
        return [year, year - 1].flatMap((y) => [4, 3, 2, 1].map((q) => `Q${q}-${y}`));
    }, []);

    const { data: summaries, isFetching: summariesLoading } = useGetPeriodSummariesQuery(
        systemId ? { system_id: systemId } : undefined,
        { skip: !systemId },
    );
    const { data: metrics } = useGetAssessmentMetricsQuery(periodId ?? '', { skip: !periodId });

    // Карта заполненных пар периода: ключ «характеристика|||подхарактеристика» → строка значения.
    const filledMap = useMemo(() => {
        const map = new Map<string, EditableMetric>();
        (metrics || []).forEach((row) => {
            if (row.characteristic && row.subcharacteristic) {
                map.set(pairKey(row.characteristic, row.subcharacteristic), row);
            }
        });
        return map;
    }, [metrics]);

    // Множество ПАР МОДЕЛИ, у которых рассчитан X (только они идут в полноту).
    const filledSet = useMemo(() => {
        const set = new Set<string>();
        QUALITY_PAIRS.forEach((p) => {
            const row = filledMap.get(pairKey(p.characteristic, p.subcharacteristic));
            if (row && row.calculatedX != null) set.add(pairKey(p.characteristic, p.subcharacteristic));
        });
        return set;
    }, [filledMap]);

    const filledCount = filledSet.size;
    const complete = filledCount >= TOTAL_SUBS;
    const activeSummary = useMemo(
        () => (summaries || []).find((s) => s.id === periodId),
        [summaries, periodId],
    );

    // Доступные для добавления характеристики/подхарактеристики (минус уже заполненные).
    const selectedChar = Form.useWatch('characteristic', valueForm);
    const selectedSub = Form.useWatch('subcharacteristic', valueForm);
    const unmeasurable = Form.useWatch('unmeasurable', valueForm);
    const availableCharacteristics = useMemo(
        () => CHARACTERISTICS.filter((c) => subsOf(c).some((s) => !filledSet.has(pairKey(c, s.name)))),
        [filledSet],
    );
    const availableSubs = useMemo(
        () => (selectedChar
            ? subsOf(selectedChar).filter((s) => !filledSet.has(pairKey(selectedChar, s.name)))
            : []),
        [selectedChar, filledSet],
    );

    const resultRows: ResultRow[] = useMemo(
        () => QUALITY_PAIRS.map((p) => {
            const row = filledMap.get(pairKey(p.characteristic, p.subcharacteristic));
            return {
                key: pairKey(p.characteristic, p.subcharacteristic),
                characteristic: p.characteristic,
                subcharacteristic: p.subcharacteristic,
                val_a: row?.val_a ?? null,
                val_b: row?.val_b ?? null,
                x: row?.calculatedX ?? null,
                level: row?.qualityLevel ?? null,
                comment: row?.expert_comment ?? '',
            };
        }),
        [filledMap],
    );

    const handleCreateSystem = async () => {
        try {
            const values = await systemForm.validateFields();
            const created = await createSystem(values).unwrap();
            setSystemId(created.id);
            setPeriodId(undefined);
            setSystemModalOpen(false);
            systemForm.resetFields();
            message.success('Система добавлена');
        } catch (error: any) {
            if (error?.errorFields) return; // ошибки валидации формы покажет antd
            message.error(error?.status === 409 ? 'Код системы уже существует' : 'Не удалось добавить систему');
        }
    };

    const handleCreatePeriod = async () => {
        if (!systemId) { message.warning('Сначала выберите систему'); return; }
        if (!newPeriodLabel) { message.warning('Выберите отчётный период'); return; }
        try {
            const created = await createPeriod({ system_id: systemId, period: newPeriodLabel }).unwrap();
            setPeriodId(created.id);
            message.success('Оценка за период создана');
        } catch (error: any) {
            if (error?.status === 409) {
                const existing = (summaries || []).find((s) => s.period === newPeriodLabel && s.system_id === systemId);
                if (existing) { setPeriodId(existing.id); message.info('Оценка за этот период уже есть — открыта'); }
                else message.error('Оценка для системы и периода уже существует');
            } else {
                message.error('Не удалось создать оценку за период');
            }
        }
    };

    const handleAddValue = async () => {
        if (!periodId) return;
        try {
            const values = await valueForm.validateFields();
            const isUnmeasurable = !!values.unmeasurable;
            await createValue({
                id: periodId,
                body: {
                    characteristic: values.characteristic!,
                    subcharacteristic: values.subcharacteristic!,
                    formula_type: formulaFor(values.characteristic!, values.subcharacteristic!),
                    val_a: isUnmeasurable ? null : (values.val_a ?? null),
                    val_b: isUnmeasurable ? null : (values.val_b ?? null),
                    expert_comment: values.expert_comment,
                    unmeasurable: isUnmeasurable,
                    artifact_links: values.artifact_links,
                },
            }).unwrap();
            message.success('Оценка добавлена');
            valueForm.resetFields();
            setValueModalOpen(false);
        } catch (error: any) {
            if (error?.errorFields) return;
            message.error('Не удалось добавить оценку');
        }
    };

    const handleFinalize = async () => {
        if (!periodId) return;
        try {
            await finalize(periodId).unwrap();
            message.success('Оценка завершена и учтена');
        } catch (error: any) {
            message.error(
                error?.status === 409
                    ? (error?.data?.detail || 'Оценка неполная — заполните все характеристики')
                    : 'Не удалось завершить оценку',
            );
        }
    };

    const overviewColumns: ColumnsType<PeriodSummary> = [
        { title: 'Период', dataIndex: 'period', width: 130 },
        {
            title: 'Заполнено', key: 'filled', width: 200,
            render: (_: unknown, rec) => (
                <Progress
                    percent={Math.round((rec.filled / rec.total) * 100)}
                    size="small"
                    status={rec.complete ? 'success' : 'active'}
                    format={() => `${rec.filled}/${rec.total}`}
                />
            ),
        },
        {
            title: 'Статус', key: 'status', width: 160,
            render: (_: unknown, rec) => (
                rec.complete
                    ? <Tag color="green">Завершена</Tag>
                    : rec.filled > 0
                        ? <Tag color="gold">Заполняется</Tag>
                        : <Tag>Черновик</Tag>
            ),
        },
        {
            title: '', key: 'action', width: 130,
            render: (_: unknown, rec) => (
                <Button
                    size="small"
                    type={rec.id === periodId ? 'primary' : 'default'}
                    onClick={() => setPeriodId(rec.id)}
                >
                    {rec.id === periodId ? 'Выбрана' : 'Открыть'}
                </Button>
            ),
        },
    ];

    const resultColumns: ColumnsType<ResultRow> = [
        { title: 'Характеристика', dataIndex: 'characteristic', width: 220 },
        { title: 'Подхарактеристика', dataIndex: 'subcharacteristic', width: 230 },
        { title: 'A', dataIndex: 'val_a', width: 70, render: (v: number | null) => (v ?? '—') },
        { title: 'B', dataIndex: 'val_b', width: 70, render: (v: number | null) => (v ?? '—') },
        {
            title: 'X', dataIndex: 'x', width: 80,
            render: (x: number | null) => (x != null ? <Text strong>{x.toFixed(2)}</Text> : <Text type="secondary">—</Text>),
        },
        {
            title: 'Уровень', dataIndex: 'level', width: 180,
            render: (level: string | null) => (
                level
                    ? <Tag color={LEVEL_COLOR[level] ?? 'default'}>{level}</Tag>
                    : <Tag color="default">Не заполнено</Tag>
            ),
        },
        {
            title: 'Комментарий', dataIndex: 'comment',
            render: (c: string) => (c ? <Text style={{ fontSize: 12 }}>{c}</Text> : <Text type="secondary">—</Text>),
        },
    ];

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingTop: 16 }}>
            <Space direction="vertical" size="large" style={{ display: 'flex' }}>
                <div>
                    <Title level={3} style={{ color: '#1F3864', marginBottom: 8 }}>Новая оценка ИС</Title>
                    <Text type="secondary">
                        Оценка качества: 8 характеристик и {TOTAL_SUBS} подхарактеристик.
                        Оценка учитывается только при полном заполнении.
                    </Text>
                </div>

                {systemsError && <Alert type="error" showIcon message="Не удалось загрузить справочник систем" />}

                {/* 1. Выбор системы и периода */}
                <Card title="Система и период оценки">
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Space wrap align="end" style={{ width: '100%' }}>
                            <div style={{ minWidth: 360 }}>
                                <Text type="secondary">Информационная система</Text>
                                <Select
                                    style={{ width: 360, display: 'block' }}
                                    loading={systemsLoading}
                                    showSearch
                                    placeholder="Начните вводить название ИС"
                                    optionFilterProp="label"
                                    value={systemId}
                                    onChange={(v) => { setSystemId(v); setPeriodId(undefined); }}
                                    options={(systems?.items || []).map((s) => ({
                                        value: s.id,
                                        label: `${s.name}${s.code ? ` (${s.code})` : ''}`,
                                    }))}
                                />
                            </div>
                            <Button onClick={() => setSystemModalOpen(true)}>Добавить систему</Button>
                        </Space>

                        <Space wrap align="end">
                            <div>
                                <Text type="secondary">Создать оценку за период</Text>
                                <Select
                                    style={{ width: 200, display: 'block' }}
                                    placeholder="Период"
                                    value={newPeriodLabel}
                                    onChange={setNewPeriodLabel}
                                    options={periodOptions.map((p) => ({ value: p, label: p }))}
                                    disabled={!systemId}
                                />
                            </div>
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                loading={creatingPeriod}
                                disabled={!systemId || !newPeriodLabel}
                                onClick={handleCreatePeriod}
                            >
                                Создать период
                            </Button>
                        </Space>
                    </Space>
                </Card>

                {/* 2. Обзор существующих оценок по системе */}
                {systemId && (
                    <Card title="Оценки по системе">
                        <Table<PeriodSummary>
                            columns={overviewColumns}
                            dataSource={summaries || []}
                            rowKey="id"
                            loading={summariesLoading}
                            size="small"
                            bordered
                            pagination={{ pageSize: 8, hideOnSinglePage: true }}
                            locale={{ emptyText: 'По этой системе ещё нет оценок. Создайте период выше.' }}
                        />
                    </Card>
                )}

                {/* 3. Активная оценка: полнота + добавление + результаты */}
                {periodId && (
                    <Card
                        title={(
                            <Space>
                                <span>Оценка: {activeSummary?.period || ''}</span>
                                {complete
                                    ? <Tag color="green" icon={<CheckCircleOutlined />}>Полная</Tag>
                                    : <Tag color="gold">Заполнено {filledCount} из {TOTAL_SUBS}</Tag>}
                            </Space>
                        )}
                        extra={(
                            <Space>
                                <Button icon={<TableOutlined />} onClick={() => navigate(`/assessments/${periodId}/input`)}>
                                    Табличный ввод
                                </Button>
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    disabled={availableCharacteristics.length === 0}
                                    onClick={() => { valueForm.resetFields(); setValueModalOpen(true); }}
                                >
                                    Добавить оценку
                                </Button>
                                <Tooltip title={complete ? '' : 'Заполните все характеристики, чтобы завершить'}>
                                    <Button
                                        icon={<CheckCircleOutlined />}
                                        loading={finalizing}
                                        disabled={!complete}
                                        onClick={handleFinalize}
                                    >
                                        Завершить оценку
                                    </Button>
                                </Tooltip>
                            </Space>
                        )}
                    >
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <Progress
                                percent={Math.round((filledCount / TOTAL_SUBS) * 100)}
                                status={complete ? 'success' : 'active'}
                                format={() => `${filledCount}/${TOTAL_SUBS}`}
                            />
                            {!complete && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="Оценка неполная — пока заполнены не все характеристики, она не учитывается."
                                    description={(
                                        <Space size={[6, 6]} wrap>
                                            {CHARACTERISTICS.map((c) => {
                                                const total = subsOf(c).length;
                                                const done = subsOf(c).filter((s) => filledSet.has(pairKey(c, s.name))).length;
                                                const ok = done >= total;
                                                return (
                                                    <Tag key={c} color={ok ? 'green' : 'gold'}>
                                                        {c}: {done}/{total}
                                                    </Tag>
                                                );
                                            })}
                                        </Space>
                                    )}
                                />
                            )}
                            <Table<ResultRow>
                                columns={resultColumns}
                                dataSource={resultRows}
                                rowKey="key"
                                size="small"
                                bordered
                                sticky
                                pagination={false}
                                scroll={{ x: 900, y: 460 }}
                                rowClassName={(rec) => (rec.x == null ? '' : 'ant-table-row-selected')}
                            />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                Заполненные характеристики исчезают из списка добавления. Корректировать их можно
                                комментариями во вкладке «Отчёты и реестры» → «Характеристики качества ИС».
                            </Text>
                        </Space>
                    </Card>
                )}
                {/* Профессиональные суждения по каждой подхарактеристике (задача QM) + напоминание */}
                {periodId && (
                    <ProfessionalJudgmentsPanel periodId={periodId} periodLabel={activeSummary?.period || ''} />
                )}
            </Space>

            {/* Модал: добавить систему */}
            <Modal
                title="Добавить систему"
                open={systemModalOpen}
                onCancel={() => setSystemModalOpen(false)}
                onOk={handleCreateSystem}
                confirmLoading={creatingSystem}
                okText="Добавить"
                cancelText="Отмена"
            >
                <Form
                    form={systemForm}
                    layout="vertical"
                    initialValues={{ status_lc: 'ОЭ', criticality_class: 'BUSINESS_OPERATIONAL', system_kind: 'CLASSIC', is_active: true }}
                >
                    <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Введите название системы' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="code" label="Код" rules={[{ required: true, message: 'Введите уникальный код' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="status_lc" label="Статус жизненного цикла">
                        <Select
                            options={[
                                { value: 'ОЭ', label: 'ОЭ' },
                                { value: 'ПЭ', label: 'ПЭ' },
                                { value: 'Создание и тестирование', label: 'Создание и тестирование' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="criticality_class" label="Критичность" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: 'MISSION CRITICAL', label: 'MISSION CRITICAL' },
                                { value: 'BUSINESS CRITICAL', label: 'BUSINESS CRITICAL' },
                                { value: 'BUSINESS OPERATIONAL', label: 'BUSINESS OPERATIONAL' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        name="system_kind"
                        label="Тип системы"
                        tooltip="Классическая ИС оценивается по ISO 25010; система ИИ — по ГОСТ Р 59898-2021 (раздел «Оценка СИИ»)"
                    >
                        <Select
                            options={[
                                { value: 'CLASSIC', label: 'Классическая ИС (ISO 25010)' },
                                { value: 'AI', label: 'Система ИИ — СИИ (ГОСТ Р 59898-2021)' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="owner" label="Владелец">
                        <Input />
                    </Form.Item>
                </Form>
            </Modal>

            {/* Модал: добавить оценку (каскад характеристика → подхарактеристика) */}
            <Modal
                title="Добавить оценку"
                open={valueModalOpen}
                onCancel={() => setValueModalOpen(false)}
                onOk={handleAddValue}
                confirmLoading={addingValue}
                okText="Добавить"
                cancelText="Отмена"
                width={640}
            >
                <Form form={valueForm} layout="vertical">
                    <Form.Item
                        name="characteristic"
                        label="Характеристика"
                        rules={[{ required: true, message: 'Выберите характеристику' }]}
                    >
                        <Select
                            showSearch
                            placeholder="Выберите характеристику"
                            optionFilterProp="label"
                            onChange={() => valueForm.setFieldsValue({ subcharacteristic: undefined })}
                            options={availableCharacteristics.map((c) => ({ value: c, label: c }))}
                            notFoundContent="Все характеристики заполнены"
                        />
                    </Form.Item>
                    <Form.Item
                        name="subcharacteristic"
                        label="Подхарактеристика"
                        rules={[{ required: true, message: 'Выберите подхарактеристику' }]}
                    >
                        <Select
                            showSearch
                            placeholder={selectedChar ? 'Выберите подхарактеристику' : 'Сначала выберите характеристику'}
                            optionFilterProp="label"
                            disabled={!selectedChar}
                            options={availableSubs.map((s) => ({ value: s.name, label: s.name }))}
                            notFoundContent="Все подхарактеристики этой характеристики заполнены"
                        />
                    </Form.Item>
                    {selectedSub && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message={selectedSub}
                            description={subDescription(selectedChar, selectedSub)}
                        />
                    )}
                    <Form.Item name="unmeasurable" valuePropName="checked" style={{ marginBottom: 8 }}>
                        <Checkbox>
                            Невозможно измерить&nbsp;
                            <Tooltip title="Нет возможности собрать данные. A/B не заполняются, комментарий с причиной обязателен.">
                                <Text type="secondary" style={{ fontSize: 12 }}>(нет данных — почему?)</Text>
                            </Tooltip>
                        </Checkbox>
                    </Form.Item>
                    <Space size="middle" style={{ display: 'flex' }} align="start">
                        <Form.Item
                            name="val_a"
                            label={(
                                <Tooltip title="A — фактически достигнутое значение (числитель): для прямых метрик «сколько выполнено/достигнуто», для обратных — «сколько проблем/дефектов/отказов».">
                                    <span>Значение A (факт) ⓘ</span>
                                </Tooltip>
                            )}
                            style={{ flex: 1 }}
                            extra="Числитель формулы"
                            rules={unmeasurable ? [] : [{ required: true, message: 'Введите A' }]}
                        >
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="A" disabled={unmeasurable} />
                        </Form.Item>
                        <Form.Item
                            name="val_b"
                            label={(
                                <Tooltip title="B — база сравнения (знаменатель): план/цель или общий объём (число требований, проверок, инцидентов, часов). B > 0.">
                                    <span>Значение B (база) ⓘ</span>
                                </Tooltip>
                            )}
                            style={{ flex: 1 }}
                            extra="Знаменатель формулы"
                            rules={unmeasurable ? [] : [{ required: true, message: 'Введите B' }]}
                        >
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="B" disabled={unmeasurable} />
                        </Form.Item>
                    </Space>
                    <Form.Item
                        name="expert_comment"
                        label={unmeasurable ? 'Причина: почему нельзя измерить (обязательно)' : 'Комментарий / экспертное мнение'}
                        rules={unmeasurable ? [{ required: true, message: 'Укажите причину, почему нет возможности собрать данные' }] : []}
                    >
                        <Input.TextArea rows={3} placeholder={unmeasurable ? 'Нет доступа к данным мониторинга / нет инструментов измерения …' : ''} />
                    </Form.Item>
                    <Form.Item
                        name="artifact_links"
                        label={(
                            <Tooltip title="Подтверждающие артефакты: ссылка на отчёт/дашборд, файл выгрузки, протокол теста, тикет. Требуются для обоснования оценки подхарактеристики.">
                                <span>Артефакты (файл / ссылка) ⓘ</span>
                            </Tooltip>
                        )}
                        extra={subArtifacts(selectedSub)}
                    >
                        <Input placeholder="https://… или путь к файлу / № тикета" />
                    </Form.Item>
                    {!unmeasurable && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Тип формулы берётся из модели. X = A/B (прямая) или 1 − A/B (обратная).
                        </Text>
                    )}
                </Form>
            </Modal>
        </div>
    );
};

export default NewAssessmentPage;
