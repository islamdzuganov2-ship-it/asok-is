import React, { useEffect, useState } from 'react';
import { Button, Dropdown, Layout, Menu, Spin, Typography } from 'antd';
import {
    LogoutOutlined,
    KeyOutlined,
    SettingOutlined,
    UserOutlined,
    TeamOutlined,
    SafetyOutlined,
    ExperimentOutlined,
    ApartmentOutlined,
    SlidersOutlined,
    HolderOutlined,
    CheckOutlined,
    AuditOutlined,
    MailOutlined,
    // ExperimentOutlined — под развитие: иконка пункта «Оценка СИИ» (пока не выведен в меню).
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { useAppDispatch } from '../store/hooks';
import { logout, setPermissions } from '../store/slices/authSlice';
import { NAV_SECTIONS } from '../store/slices/uiSlice';
import { syncProposals } from '../store/slices/governanceSlice';
import { useGetMyPermissionsQuery, useGetMandatorySectionsQuery, useGetLlmStatusQuery } from '../store/api/apiSlice';
import { useNavPrefsHydration } from '../hooks/useNavPreferences';
import SidebarNavEditor from './SidebarNavEditor';
import { ROUTE_BY_PERM, ICON_BY_PERM } from '../constants/navMeta';
import { groupOfPerm, NAV_GROUPS } from '../constants/navOrderMath';
import { roleLabel } from '../constants/roles';
import NotificationBell from './NotificationBell';
import CommandPalette from './CommandPalette';
import { DataModeToggle, headerToggleVisible } from './DataModeToggle';
import BackToCockpit from './BackToCockpit';
import { serverLogout } from '../utils/serverLogout';
import { PREMIUM, GOLD, TYPE, SPACE } from '../theme/premium';
import { BRAND } from '../theme/ragPalette';

// Приглушённый заголовок группы меню (капитель/трекинг) — премиум, не «кричащий».
// Альфа 0.7 (было 0.55): на самом светлом стопе градиента сайдбара 0.55 давало 3.84:1 —
// ниже WCAG AA для 10.5px (T-57). Приглушённость сохраняется, читаемость — нет.
const groupLabel = (text: string) => (
    <span style={{ ...TYPE.micro, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(233,220,190,0.7)' }}>{text}</span>
);

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [collapsed, setCollapsed] = useState(false);
    // ТЗ v21 §4 (КП-38): командная строка Ctrl+K / ⌘K. Слушатель глобальный, а не на странице —
    // строка доступна из любого раздела, не только с кокпита. preventDefault обязателен:
    // иначе Chrome уводит фокус в адресную строку и модалка открывается «вслепую».
    const [paletteOpen, setPaletteOpen] = useState(false);
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useAppDispatch();
    const { role, fullName, permissions, permissionsLoaded } = useSelector((state: RootState) => state.auth);
    const dataMode = useSelector((state: RootState) => state.ui.dataMode);
    // Переключатели опциональных дашбордов из «Настройка» (ТЗ v17, req 5).
    const hiddenSections = useSelector((state: RootState) => state.ui.hiddenSections);
    const navOrder = useSelector((state: RootState) => state.ui.navOrder);
    const navGroups = useSelector((state: RootState) => state.ui.navGroups);
    // ТЗ v20 п.10: разделы, зафиксированные супер-администратором как обязательные для всех —
    // персональное скрытие (hiddenSections) их не должно затрагивать.
    const { data: mandatorySections } = useGetMandatorySectionsQuery();
    const mandatorySet = new Set(mandatorySections?.permissions ?? []);
    const userRole = role || 'GUEST';

    // Порядок меню (без ТЗ, ТЗ-23 §5) едет за пользователем между устройствами (серверные prefs).
    useNavPrefsHydration();
    // Режим «Настроить меню»: пункты перетаскиваются прямо в сайдбаре, в т.ч. между группами.
    const [navEditing, setNavEditing] = useState(false);


    // Права пользователя (BL-008): грузим с сервера и кладём в стор (обновляются и при возврате
    // во вкладку — refetchOnFocus в apiSlice), чтобы правки супер-админа применялись без F5.
    const { data: myPerms } = useGetMyPermissionsQuery(undefined, { skip: !role });
    useEffect(() => { if (myPerms) dispatch(setPermissions(myPerms.permissions)); }, [myPerms, dispatch]);

    // Синхронизация мер governance из БД при live-режиме (T-10): петля работает между ролями и
    // устройствами (меры/решения/эскалации — на бэкенде). В mock — локальный демо-набор.
    // Дополнительно ре-синхронизируем при возврате во вкладку (focus) — чтобы меры/статусы
    // обновлялись без ручного F5 (жалоба «нет авто-сброса кэша»). В mock thunk — no-op.
    useEffect(() => {
        dispatch(syncProposals());
        const onFocus = () => dispatch(syncProposals());
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [dataMode, dispatch]);

    // Статус встроенной LLM (индикатор у переключателя) — общий RTK-запрос с плашкой демо-данных
    // кокпита (КП-43); перечитывается при смене режима, как и прежний ручной fetch.
    const { refetch: refetchLlmStatus } = useGetLlmStatusQuery(undefined, { skip: !role });
    useEffect(() => { if (role) refetchLlmStatus(); }, [dataMode, role, refetchLlmStatus]);

    // До загрузки прав пользователя — экран-заглушка (гейтинг маршрутов зависит от permissions).
    if (!permissionsLoaded) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', gap: SPACE.cozy,
                justifyContent: 'center', alignItems: 'center', height: '100vh',
                background: PREMIUM.gradient.canvas,
            }}>
                <Spin size="large" />
                <span style={{ ...TYPE.caption, color: BRAND.inkSoft }}>Загрузка прав доступа…</span>
            </div>
        );
    }

    // Меню строится ПО ПРАВАМ (BL-008): пункт виден, если у роли есть указанное право.
    // Раньше меню ветвилось по роли (isExec/isManager) — теперь состав задаёт матрица прав,
    // которую супер-админ настраивает в разделе «Права». Оценка СИИ (view.ai_assessments) в меню
    // намеренно не выводится (раздел под развитие), но маршрут доступен по праву.
    const has = (perm: string) => permissions.includes(perm) && (mandatorySet.has(perm) || !hiddenSections[perm]);
    // ДЕФ-12 (БТ-444): пункт виден, если есть ПРАВО и пользователь не скрыл раздел в
    // «Настройка». Раньше флаги действовали только для ADMIN/CTO/CEO — менеджер по качеству
    // щёлкал тумблер, и ничего не происходило. Персонализация — поверх RBAC, а не вместо:
    // право остаётся верхней границей.
    //
    // КП-37 (ТЗ-21 §8.2): группы по глубине раскрытия — «Моя картина», «Разрезы»,
    // «Работа с данными» (NAV_GROUPS). Прежние группы ДЕФ-11 делили меню по типу артефакта.
    // ДЕФ-14 (БТ-445): порядок внутри группы задаёт пользователь перетаскиванием; ключи, для
    // которых порядок не задан, идут следом в исходном порядке NAV_SECTIONS.
    //
    // Единый источник состава — NAV_SECTIONS (uiSlice): и меню, и экран настроек читают
    // ОДИН список, поэтому «есть тумблер, но нет пункта» стало невозможным по построению.
    const mi = (key: string, icon: React.ReactNode, label: string) => ({ key, icon, label });
    const group = (label: string, children: Array<{ key: string; icon: React.ReactNode; label: string }>) =>
        children.length ? [{ type: 'group' as const, label: collapsed ? undefined : groupLabel(label), children }] : [];

    const orderIndex = (perm: string) => {
        const i = navOrder.indexOf(perm);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    // Группа пункта — по умолчанию из NAV_SECTIONS, но пользователь мог перенести пункт
    // в другую группу перетаскиванием в сайдбаре (без ТЗ, ТЗ-23 §5).
    const groupOf = (perm: string) => groupOfPerm(perm, NAV_SECTIONS, navGroups);

    /** Секции группы в пользовательском порядке — общий источник и для меню, и для режима правки. */
    const sectionsOfGroup = (groupName: string) => NAV_SECTIONS
        .filter((sec) => groupOf(sec.perm) === groupName && has(sec.perm))
        .slice()
        .sort((a, b) => orderIndex(a.perm) - orderIndex(b.perm));

    const itemsOfGroup = (groupName: string) => sectionsOfGroup(groupName)
        .map((sec) => mi(ROUTE_BY_PERM[sec.perm], ICON_BY_PERM[sec.perm], sec.label));

    const adminItems = [
        ...(has('view.admin.users') ? [mi('/admin/users', <TeamOutlined />, 'Пользователи')] : []),
        ...(has('view.admin.permissions') ? [mi('/admin/permissions', <SafetyOutlined />, 'Права')] : []),
        // ТЗ v19 §17.3 (УК-47): справочник направлений — тот же уровень доступа, что и правка прав (В-58).
        ...(has('admin.permissions.manage') ? [mi('/admin/measure-departments', <ApartmentOutlined />, 'Направления')] : []),
        // ТЗ v19 УК-07: редактор весов — исключительное право (В-9), матрицей не выдаётся, только SUPER_ADMIN.
        ...(has('quality.weights.edit') ? [mi('/admin/weights', <SlidersOutlined />, 'Веса ГОСТ 25010')] : []),
        // Пункт виден только суперадминистратору: право view.admin.llm_quality исключительное
        // и матрицей другим ролям не выдаётся (ТЗ v18 п.10).
        ...(has('view.admin.llm_quality') ? [mi('/admin/llm-quality', <ExperimentOutlined />, 'Качество LLM')] : []),
        // ИБ-08: журнал событий ИБ — исключительное право суперадминистратора.
        ...(has('view.admin.audit') ? [mi('/admin/audit', <AuditOutlined />, 'Журнал ИБ')] : []),
        ...(has('view.admin.notifications') ? [mi('/admin/notifications', <MailOutlined />, 'Журнал уведомлений')] : []),
    ];
    const settingsItems = has('view.settings') ? [mi('/admin/flags', <SettingOutlined />, 'Настройка')] : [];

    const menuItems = [
        ...NAV_GROUPS.flatMap((g) => group(g, itemsOfGroup(g))),
        ...group('Администрирование', adminItems),
        ...settingsItems,
    ];

    const handleLogout = () => {
        // ИБ-12: сначала отзываем токен на сервере, затем чистим клиентское состояние.
        serverLogout(localStorage.getItem('token'));
        dispatch(logout());
        navigate('/login');
    };

    const userMenu = {
        items: [
            { key: 'password', icon: <KeyOutlined />, label: 'Сменить пароль', onClick: () => navigate('/change-password') },
            { key: 'logout', danger: true, icon: <LogoutOutlined />, label: 'Выйти', onClick: handleLogout },
        ],
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            {/* `breakpoint` — сайдбар сам сворачивается на узком экране. Без него 244px были
                фиксированы всегда: на 375px под контент оставалось 131px, и КАЖДАЯ страница
                уезжала вбок на ~450px. Причина была не в контенте, а здесь (UI-13). */}
            <Sider
                collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={244}
                breakpoint="lg" collapsedWidth={56}
                style={{ background: PREMIUM.gradient.sider, boxShadow: '2px 0 24px -12px rgba(16,24,40,0.45)' }}
            >
                {/* Премиальный логотип: графит-плашка с золотым акцентом */}
                <div style={{ height: 56, margin: `${SPACE.base}px ${SPACE.base}px ${SPACE.cozy}px`, display: 'flex', alignItems: 'center', gap: SPACE.cozy, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: PREMIUM.gradient.ink, border: `1px solid ${GOLD.line}`, boxShadow: `0 0 0 3px ${GOLD.glow}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                        <span style={{ color: GOLD.soft, fontWeight: 800, fontSize: TYPE.body.fontSize }}>А</span>
                    </div>
                    {!collapsed && (
                        <div style={{ lineHeight: 1.15 }}>
                            <div style={{ ...TYPE.cardTitle, color: '#fff', fontWeight: 700, letterSpacing: 1.2 }}>АСОК ИС</div>
                            <div style={{ ...TYPE.micro, fontWeight: 400, color: 'rgba(233,220,190,0.7)', letterSpacing: 1.8, textTransform: 'uppercase' }}>оценка качества</div>
                        </div>
                    )}
                </div>
                <div style={{ height: 1, margin: '0 16px 6px', background: PREMIUM.gradient.goldLine }} />
                {/* Кнопка режима правки меню. В свёрнутом сайдбаре скрыта: перетаскивать
                    56-пиксельные иконки без подписей — не настройка, а угадайка. */}
                {!collapsed && (
                    <div style={{ padding: `0 ${SPACE.base}px ${SPACE.cozy}px`, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            size="small"
                            type={navEditing ? 'primary' : 'text'}
                            icon={navEditing ? <CheckOutlined /> : <HolderOutlined />}
                            onClick={() => setNavEditing((v) => !v)}
                            style={navEditing ? undefined : { color: 'rgba(233,220,190,0.8)' }}
                        >
                            {navEditing ? 'Готово' : 'Порядок'}
                        </Button>
                    </div>
                )}
                {navEditing && !collapsed ? (
                    <SidebarNavEditor
                        groupLabel={groupLabel}
                        iconByPerm={ICON_BY_PERM}
                        sectionsOfGroup={sectionsOfGroup}
                    />
                ) : (
                    <Menu
                        theme="dark"
                        mode="inline"
                        selectedKeys={[location.pathname]}
                        items={menuItems}
                        onClick={({ key }) => navigate(key)}
                        style={{ background: 'transparent', borderInlineEnd: 'none' }}
                    />
                )}
            </Sider>
            <Layout style={{ background: PREMIUM.gradient.canvas }}>
                {/* Шапка не сжималась: заголовок и блок пользователя вместе требовали ~637px,
                    из-за чего на 375px КАЖДАЯ страница уезжала вбок на 262px даже при
                    свёрнутом сайдбаре. Заголовок теперь ужимается, имя — с многоточием (UI-13). */}
                <Header style={{ padding: `0 ${SPACE.page}px`, background: PREMIUM.gradient.header, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.base, borderBottom: `1px solid ${PREMIUM.border}`, boxShadow: '0 1px 4px rgba(0,21,41,.06)', zIndex: 1 }}>
                    <Title
                        level={4}
                        style={{
                            ...TYPE.pageTitle, margin: 0, color: BRAND.ink, letterSpacing: 0.3,
                            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                    >
                        Система оценки качества
                    </Title>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.base, minWidth: 0, flex: '0 1 auto' }}>
                        {/* КП-43 (ТЗ-21 §9.1): на кокпитах тумблер в шапке — только у администраторов;
                            остальным переключение доступно в «Настройка». */}
                        {headerToggleVisible(location.pathname, role) && <DataModeToggle />}
                        <NotificationBell />
                        <Dropdown menu={userMenu} placement="bottomRight">
                            <Button
                                type="text"
                                icon={<UserOutlined />}
                                // Имя+роль — самый длинный элемент шапки; ужимаем его, а не вьюпорт.
                                style={{ maxWidth: 'min(220px, 34vw)', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                {fullName || 'Пользователь'} · {roleLabel(userRole)}
                            </Button>
                        </Dropdown>
                    </div>
                </Header>
                <Content style={{ margin: 0, background: 'transparent', padding: 24, minHeight: 'calc(100vh - 64px)' }}>
                    {/* КП-39 (ТЗ-21 §7.5): «← К кокпиту» на глубокой странице, открытой из шторки. */}
                    <BackToCockpit />
                    {children}
                </Content>
            </Layout>
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </Layout>
    );
};
