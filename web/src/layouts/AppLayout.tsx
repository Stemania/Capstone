import { Grid, Layout, Menu, Button, Drawer, Popover, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  LogoutOutlined,
  FileTextOutlined,
  TeamOutlined,
  ToolOutlined,
  SettingOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ContactsOutlined,
  BuildOutlined,
  AppstoreOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FieldTimeOutlined,
  ShopOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
  DownOutlined,
  DashboardOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { confirmLogout } from '../utils/confirmLogout';
import KeepAliveOutlet from '../navigation/KeepAliveOutlet';
import { getNavSection, useNavMemory } from '../navigation/navMemory';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import NotificationBell from '../components/NotificationBell';
import { PersonAvatar } from '../components/PersonAvatar';
import { Breadcrumbs, type Crumb } from '../components/ui/PageHeader';
import { layout } from '../theme/tokens';
import { formatShop, shopNow } from '../utils/shopTime';
import { PageHeaderActionsProvider, usePageHeaderActionsSlot } from './pageHeaderActions';
import './appShell.css';

const { Header, Sider, Content } = Layout;

type NavItem = { key: string; icon: ReactNode; label: string; adminOnly?: boolean };
type NavGroup = { label: string; items: NavItem[] };

/** Same groups and names for Admin and Office Staff; each sees only what it can open. */
const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: '/schedule', icon: <CalendarOutlined />, label: 'Schedule' },
    ],
  },
  {
    label: 'Production',
    items: [
      { key: '/job-orders', icon: <FileTextOutlined />, label: 'Job Orders' },
      { key: '/machines', icon: <BuildOutlined />, label: 'Machines' },
      { key: '/work-calendar', icon: <FieldTimeOutlined />, label: 'Work calendar' },
    ],
  },
  {
    label: 'Purchasing & stock',
    items: [
      { key: '/suppliers', icon: <ShopOutlined />, label: 'Suppliers and Orders' },
      { key: '/tools', icon: <ToolOutlined />, label: 'Inventory' },
    ],
  },
  {
    label: 'Clients',
    items: [{ key: '/clients', icon: <ContactsOutlined />, label: 'Clients' }],
  },
  {
    label: 'People',
    items: [
      { key: '/users', icon: <TeamOutlined />, label: 'Users & Roles', adminOnly: true },
      { key: '/worker-setup', icon: <SettingOutlined />, label: 'Worker setup', adminOnly: true },
      { key: '/attendance', icon: <ClockCircleOutlined />, label: 'Attendance', adminOnly: true },
      { key: '/settings/shop', icon: <BankOutlined />, label: 'Shop details', adminOnly: true },
    ],
  },
  {
    label: 'Insights',
    items: [{ key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics' }],
  },
];

const SECTION_META: Record<string, { title: string; subtitle: string }> = {
  '/schedule': { title: 'Schedule', subtitle: 'Shop-wide production schedule by machine and worker' },
  '/my-assignments': { title: 'My assignments', subtitle: 'Operations assigned to you' },
  '/job-orders': { title: 'Job Orders', subtitle: 'Create and track production job orders' },
  '/machines': { title: 'Machines', subtitle: 'Machine units, breakdowns, and who reported them' },
  '/work-calendar': { title: 'Work calendar', subtitle: 'Shop-wide overtime, special days, and holidays' },
  '/suppliers': { title: 'Suppliers and Orders', subtitle: 'Material suppliers and the purchase orders sent to them' },
  '/tools': { title: 'Inventory', subtitle: 'Tools, consumables, and raw materials' },
  '/clients': { title: 'Clients', subtitle: 'Clients and contacts for job update messages' },
  '/users': { title: 'Users & Roles', subtitle: 'Accounts, roles, and who can sign in' },
  '/worker-setup': { title: 'Worker setup', subtitle: 'Skills, weekly hours, and work history' },
  '/attendance': { title: 'Attendance', subtitle: 'Each worker\u2019s clock-in and clock-out' },
  '/analytics': { title: 'Analytics', subtitle: 'How the shop is doing, and printable reports' },
  '/settings/shop': { title: 'Shop details', subtitle: 'Printed on purchase orders and job orders' },
  '/account': { title: 'Account security', subtitle: 'Password, PIN unlock and your devices' },
};

const REPORT_TITLES: Record<string, string> = {
  efficiency: 'Production Performance',
  inventory: 'Inventory Status',
  'worker-performance': 'Worker Performance',
};

type Meta = { title: string; subtitle?: string; crumbs?: Crumb[] };

function routeMeta(pathname: string, section: string | null): Meta {
  const jobs: Crumb = { label: 'Job Orders', to: '/job-orders' };
  if (pathname === '/job-orders/archived') {
    return {
      title: 'Archived job orders',
      subtitle: 'Jobs removed from the day-to-day list',
      crumbs: [jobs, { label: 'Archived' }],
    };
  }
  if (pathname === '/job-orders/new') return { title: 'New job order', crumbs: [jobs, { label: 'New' }] };
  if (/^\/job-orders\/[^/]+\/edit$/.test(pathname)) return { title: 'Edit job order', crumbs: [jobs, { label: 'Edit' }] };
  if (/^\/job-orders\/[^/]+\/plan$/.test(pathname)) {
    return { title: 'Plan job order', crumbs: [{ label: 'Job Orders', to: '/job-orders?tab=drafts' }, { label: 'Plan' }] };
  }
  if (/^\/job-orders\/[^/]+$/.test(pathname)) {
    return { title: 'Job order', subtitle: 'Details, progress, and notifications', crumbs: [jobs, { label: 'Details' }] };
  }
  if (/^\/clients\/[^/]+$/.test(pathname)) {
    return { title: 'Client', subtitle: 'Details and job history', crumbs: [{ label: 'Clients', to: '/clients' }, { label: 'Details' }] };
  }
  if (/^\/supplier-orders\/[^/]+$/.test(pathname)) {
    return {
      title: 'Supplier order',
      subtitle: 'Lines, issuing, receiving, and the printed PO',
      crumbs: [{ label: 'Suppliers and Orders', to: '/supplier-orders' }, { label: 'Supplier order' }],
    };
  }
  if (/^\/my-assignments\/[^/]+$/.test(pathname)) {
    return { title: 'Assignment', crumbs: [{ label: 'My assignments', to: '/my-assignments' }, { label: 'Assignment' }] };
  }
  const report = pathname.match(/^\/analytics\/reports\/([^/]+)/);
  if (report) {
    return {
      title: REPORT_TITLES[report[1]] || 'Report',
      crumbs: [
        { label: 'Analytics', to: '/analytics' },
        { label: 'Reports', to: '/analytics/reports' },
        { label: REPORT_TITLES[report[1]] || 'Report' },
      ],
    };
  }
  return SECTION_META[section || ''] || { title: '' };
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`app-brand${collapsed ? ' is-collapsed' : ''}`}>
      <img src="/logo.png" alt="Brothers Machine Shop logo" className="app-brand__logo" />
      {!collapsed && (
        <div className="app-brand__copy">
          <div className="app-brand__name">Brothers Machine Shop</div>
          <div className="app-brand__tag">Production Scheduling</div>
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = shopNow().hour();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function firstName(nickname?: string | null, fullName?: string | null) {
  return nickname?.trim() || fullName?.trim().split(/\s+/)[0] || 'there';
}

function roleLabel(role?: string) {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'OFFICE_STAFF') return 'Office Staff';
  return role || '';
}

function AppLayoutShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const isCompact = !screens.lg;
  const { user, logout, isAdmin, isOfficeStaff } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { resolveSectionNav, clearSectionCache } = useNavMemory();
  const showBell = isAdmin || isOfficeStaff;
  const pageHeaderActions = usePageHeaderActionsSlot();

  const goSection = (sectionKey: string) => {
    const { to } = resolveSectionNav(sectionKey);
    navigate(to);
    setMobileOpen(false);
  };

  const groups = (isAdmin || isOfficeStaff ? NAV : [])
    .map((g) => {
      const items = g.items.filter((it) => isAdmin || !it.adminOnly);
      return { ...g, items };
    })
    .filter((g) => g.items.length > 0);

  const section = getNavSection(location.pathname);
  const allKeys = groups.flatMap((g) => g.items.map((it) => it.key));
  const selectedKey = allKeys.find((k) => k === section) || '';
  const meta =
    section === '/dashboard'
      ? { title: `${greeting()}, ${firstName(user?.nickname, user?.fullName)}`, subtitle: formatShop(shopNow(), 'dddd, MMMM D, YYYY') }
      : routeMeta(location.pathname, section);
  const iconOnly = collapsed && !isCompact;

  const menuItems: MenuProps['items'] = groups.map((g) => ({
    type: 'group' as const,
    key: `group:${g.label}`,
    label: iconOnly ? <span className="app-nav__rule" aria-hidden /> : g.label,
    children: g.items.map((it) => ({
      key: it.key,
      icon: it.icon,
      label: it.label,
      title: it.label,
    })),
  }));

  const handleLogout = () => {
    confirmLogout(() => {
      logout();
      try {
        sessionStorage.removeItem('bmsc.navMemory.v1');
      } catch {
        /* ignore */
      }
      setMobileOpen(false);
      navigate('/login');
    });
  };

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      inlineCollapsed={iconOnly}
      selectedKeys={[selectedKey]}
      items={menuItems}
      className="app-nav"
      onClick={({ key }) => goSection(String(key))}
    />
  );

  const logoutButton = (compactBtn: boolean) => (
    <div className={`app-sider__foot${compactBtn ? ' is-collapsed' : ''}`}>
      <Tooltip title={compactBtn ? 'Log out' : undefined} placement="right">
        <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout} block aria-label="Log out" className="app-sider__logout">
          {compactBtn ? null : 'Log out'}
        </Button>
      </Tooltip>
    </div>
  );

  const onSchedule = location.pathname.startsWith('/schedule');

  const accountPanel = (
    <div className="acct-panel">
      <div className="acct-panel__who">
        <PersonAvatar userId={user?.id} fullName={user?.fullName} photoVersion={user?.photoVersion} size={40} />
        <div style={{ minWidth: 0 }}>
          <div className="acct-panel__name">{user?.fullName}</div>
          <div className="acct-panel__role">{roleLabel(user?.role)}</div>
        </div>
      </div>
      <button
        type="button"
        className="acct-sheet-btn"
        onClick={() => {
          setAccountOpen(false);
          clearSectionCache('/account');
          navigate('/account/security');
        }}
      >
        <SafetyCertificateOutlined />
        Account security
      </button>
      <button
        type="button"
        className="acct-sheet-btn acct-sheet-btn--danger"
        onClick={() => {
          setAccountOpen(false);
          handleLogout();
        }}
      >
        <LogoutOutlined />
        Log out
      </button>
    </div>
  );

  const accountChip = user?.fullName ? (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={accountOpen}
      onOpenChange={setAccountOpen}
      content={accountPanel}
      styles={{ container: { padding: 12, borderRadius: 12 } }}
    >
      <button type="button" className={`app-topbar__who${accountOpen ? ' is-open' : ''}`} aria-label="Account">
        <PersonAvatar userId={user.id} fullName={user.fullName} photoVersion={user.photoVersion} size={32} />
        {!isPhone && (
          <span className="app-topbar__who-copy">
            <span className="app-topbar__who-name">{user.fullName}</span>
            <span className="app-topbar__who-role">{roleLabel(user.role)}</span>
          </span>
        )}
        {!isPhone && <DownOutlined className="app-topbar__who-caret" aria-hidden />}
      </button>
    </Popover>
  ) : null;

  const phoneTabs = [
    { key: '/job-orders', label: 'Jobs', icon: <FileTextOutlined />, match: '/job-orders' },
    { key: '/schedule', label: 'Schedule', icon: <CalendarOutlined />, match: '/schedule' },
    { key: '/tools', label: 'Stock', icon: <ToolOutlined />, match: '/tools' },
  ];
  const moreActive = !phoneTabs.some((t) => location.pathname.startsWith(t.match));

  return (
    <Layout
      className={`app-shell${isPhone ? ' app-shell--phone' : ''}${isCompact ? ' app-shell--compact' : ''}`}
      style={{ height: '100%', overflow: 'hidden' }}
    >
      {!isCompact && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          collapsedWidth={layout.sidebarCollapsedWidth}
          width={layout.sidebarWidth}
          className="app-sider"
        >
          <Brand collapsed={collapsed} />
          <div className="app-sider__nav">{menu}</div>
          {logoutButton(collapsed)}
        </Sider>
      )}

      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        size={layout.sidebarWidth + 48}
        closable={false}
        className="app-nav-drawer"
        styles={{ section: { padding: 0, borderRadius: 0 }, header: { display: 'none' }, body: { padding: 0 } }}
      >
        <div className="app-nav-drawer__top">
          <Brand collapsed={false} />
          <button type="button" className="app-nav-drawer__close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            ×
          </button>
        </div>
        <div className="app-sider__nav">{menu}</div>
        {logoutButton(false)}
      </Drawer>

      <Layout className="app-main">
        <Header className="app-topbar">
          <div className="app-topbar__left">
            {!isPhone && (
              <Tooltip title={isCompact ? 'Open menu' : collapsed ? 'Expand menu' : 'Collapse menu'}>
                <Button
                  type="text"
                  className="app-topbar__menu-btn"
                  icon={isCompact ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => {
                    if (isCompact) setMobileOpen(true);
                    else setCollapsed(!collapsed);
                  }}
                  aria-label={isCompact ? 'Open menu' : collapsed ? 'Expand menu' : 'Collapse menu'}
                />
              </Tooltip>
            )}
            <div className="app-topbar__heading">
              {meta.crumbs?.length ? <Breadcrumbs items={meta.crumbs} /> : null}
              <div className="app-topbar__title-row">
                <h1 className="app-topbar__title">{meta.title || 'BMSC'}</h1>
                {meta.subtitle && !meta.crumbs?.length && !pageHeaderActions ? (
                  <span className="app-topbar__subtitle">{meta.subtitle}</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="app-topbar__right">
            {pageHeaderActions ? (
              <div className="app-topbar__page-actions">{pageHeaderActions}</div>
            ) : null}
            {showBell && <NotificationBell className="app-topbar__icon-btn" />}
            {isPhone && !onSchedule && (
              <Tooltip title="Schedule">
                <button type="button" className="app-topbar__icon-btn" onClick={() => goSection('/schedule')} aria-label="Schedule">
                  <CalendarOutlined />
                </button>
              </Tooltip>
            )}
            {accountChip}
          </div>
        </Header>
        <div className="app-shell__scroll">
          <Content className="app-shell__content">
            <RouteErrorBoundary resetKey={location.pathname}>
              <KeepAliveOutlet />
            </RouteErrorBoundary>
          </Content>
        </div>

        {isPhone && (
          <nav className="app-phone-nav" aria-label="Main">
            {phoneTabs.map((tab) => {
              const active = location.pathname.startsWith(tab.match);
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`app-phone-nav__item${active ? ' is-active' : ''}`}
                  onClick={() => goSection(tab.key)}
                >
                  <span className="app-phone-nav__icon">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={`app-phone-nav__item${moreActive ? ' is-active' : ''}`}
              onClick={() => setMobileOpen(true)}
            >
              <span className="app-phone-nav__icon">
                <AppstoreOutlined />
              </span>
              <span>More</span>
            </button>
          </nav>
        )}
      </Layout>
    </Layout>
  );
}

export default function AppLayout() {
  return (
    <PageHeaderActionsProvider>
      <AppLayoutShell />
    </PageHeaderActionsProvider>
  );
}
