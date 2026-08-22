import { Grid, Layout, Menu, Button, Drawer, Popover } from 'antd';
import {
  LogoutOutlined,
  FileTextOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  SettingOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ContactsOutlined,
  FileSearchOutlined,
  BuildOutlined,
  AppstoreOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { confirmLogout } from '../utils/confirmLogout';

const { Header, Sider, Content } = Layout;

const NAVY = '#0f1c2e';

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/job-orders': { title: 'Job Orders', subtitle: 'Create and manage production job orders' },
  '/clients': {
    title: 'Clients',
    subtitle: 'Register clients and contacts for job update messages',
  },
  '/schedule': {
    title: 'Schedule',
    subtitle: 'Shop-wide production schedule by machine and worker',
  },
  '/machines': {
    title: 'Machines',
    subtitle: 'Machine units, breakdowns, and who reported them',
  },
  '/reports': {
    title: 'Reports',
    subtitle: 'Printable production performance, inventory, and worker reports',
  },
  '/analytics': {
    title: 'Analytics',
    subtitle: 'How the shop is doing — time, sales, and what is coming',
  },
  '/users': { title: 'Users & Roles', subtitle: 'Manage accounts, roles, and who can sign in' },
  '/tools': { title: 'Inventory', subtitle: 'Stock levels, QR codes, and usage' },
  '/worker-setup': {
    title: 'Worker setup',
    subtitle: 'Skills, weekly hours, and how the shop ranks workers',
  },
};

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      style={{
        padding: collapsed ? '20px 8px' : '20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        textAlign: collapsed ? 'center' : 'left',
      }}
    >
      <div
        style={{
          fontSize: collapsed ? 13 : 16,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: '#fff',
          whiteSpace: 'nowrap',
        }}
      >
        {collapsed ? 'BMSC' : 'Brothers Machine Shop'}
      </div>
      {!collapsed && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
          Production Management
        </div>
      )}
    </div>
  );
}

function roleLabel(role?: string) {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'OFFICE_STAFF') return 'Office Staff';
  return role || '';
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const isCompact = !screens.lg;
  const { user, logout, isAdmin, isOfficeStaff } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [];

  if (isAdmin || isOfficeStaff) {
    menuItems.push(
      { key: '/job-orders', icon: <FileTextOutlined />, label: 'Job Orders' },
      { key: '/schedule', icon: <CalendarOutlined />, label: 'Schedule' },
      { key: '/machines', icon: <BuildOutlined />, label: 'Machines' },
      { key: '/clients', icon: <ContactsOutlined />, label: 'Clients' },
      { key: '/reports', icon: <FileSearchOutlined />, label: 'Reports' },
      { key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics' },
      { key: '/tools', icon: <ToolOutlined />, label: 'Inventory' },
    );
  }

  if (isAdmin) {
    menuItems.push(
      { key: '/users', icon: <TeamOutlined />, label: 'Users & Roles' },
      { key: '/worker-setup', icon: <SettingOutlined />, label: 'Worker setup' },
    );
  }

  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '';
  const meta =
    /^\/job-orders\/[^/]+$/.test(location.pathname)
      ? { title: 'Job Order', subtitle: 'View details, time taken, and notifications' }
      : pageMeta[selectedKey] || { title: '', subtitle: '' };

  const handleLogout = () => {
    confirmLogout(() => {
      logout();
      setMobileOpen(false);
      navigate('/login');
    });
  };

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      inlineCollapsed={collapsed && !isCompact}
      selectedKeys={[selectedKey]}
      items={menuItems}
      style={{ background: 'transparent', border: 'none', padding: '8px' }}
      onClick={({ key }) => {
        navigate(key);
        setMobileOpen(false);
      }}
    />
  );

  const logoutButton = (iconOnly: boolean) => (
    <div
      style={{
        flexShrink: 0,
        padding: iconOnly ? '8px' : '8px 8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <Button
        type="text"
        icon={<LogoutOutlined />}
        onClick={handleLogout}
        block
        aria-label="Logout"
        style={{
          color: 'rgba(255,255,255,0.75)',
          fontWeight: 700,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: iconOnly ? 'center' : 'flex-start',
          paddingInline: iconOnly ? 0 : 16,
        }}
      >
        {iconOnly ? null : 'Logout'}
      </Button>
    </div>
  );

  const onSchedule = location.pathname.startsWith('/schedule');

  const accountPanel = (
    <div style={{ width: 240, padding: '4px 2px 2px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 8px 14px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 10,
        }}
      >
        <div className="app-nav-drawer__avatar" style={{ width: 44, height: 44, fontSize: 20 }}>
          <UserOutlined />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.25, wordBreak: 'break-word' }}>
            {user?.fullName}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{roleLabel(user?.role)}</div>
        </div>
      </div>
      <button
        type="button"
        className="app-shell__logout-btn"
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

  const phoneTabs = [
    { key: '/job-orders', label: 'Jobs', icon: <FileTextOutlined />, match: '/job-orders' },
    { key: '/schedule', label: 'Schedule', icon: <CalendarOutlined />, match: '/schedule' },
    { key: '/tools', label: 'Stock', icon: <ToolOutlined />, match: '/tools' },
  ];
  const moreActive = !phoneTabs.some((t) => location.pathname.startsWith(t.match));

  return (
    <Layout className={`app-shell${isPhone ? ' app-shell--phone' : ''}${isCompact ? ' app-shell--compact' : ''}`} style={{ height: '100%', overflow: 'hidden' }}>
      {!isCompact && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          collapsedWidth={72}
          width={230}
          className="app-sider"
          style={{
            background: NAVY,
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Brand collapsed={collapsed} />
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{menu}</div>
          {logoutButton(collapsed)}
        </Sider>
      )}

      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        width={280}
        closable={false}
        className="app-nav-drawer"
        styles={{
          content: { padding: 0, borderRadius: 0, background: NAVY },
          header: { display: 'none' },
          body: {
            padding: 0,
            background: NAVY,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          },
        }}
      >
        <div className="app-nav-drawer__top">
          <div>
            <div className="app-nav-drawer__shop">Brothers Machine Shop</div>
            <div className="app-nav-drawer__tag">Production Management</div>
          </div>
          <button type="button" className="app-nav-drawer__close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            ×
          </button>
        </div>
        <div className="app-nav-drawer__user">
          <div className="app-nav-drawer__avatar">
            <UserOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="app-nav-drawer__name">{user?.fullName}</div>
            <div className="app-nav-drawer__role">{roleLabel(user?.role)}</div>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{menu}</div>
        {logoutButton(false)}
      </Drawer>

      <Layout
        style={{
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Header
          className="app-shell__header"
          style={{
            padding: 0,
            background: NAVY,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: isPhone ? undefined : 68,
            lineHeight: 'normal',
            flexShrink: 0,
            width: '100%',
            margin: 0,
          }}
        >
          <div
            className={isPhone ? 'app-shell__header-inner app-shell__header-inner--phone' : 'app-shell__header-inner'}
          >
            {isPhone ? (
              <>
                <div className="app-shell__phone-copy">
                  <div className="app-shell__title">{meta.title || 'BMSC'}</div>
                  {meta.subtitle && <div className="app-shell__subtitle">{meta.subtitle}</div>}
                </div>
                <div className="app-shell__phone-actions">
                  {!onSchedule && (
                    <button
                      type="button"
                      className="app-shell__cal"
                      onClick={() => navigate('/schedule')}
                      aria-label="Schedule"
                      title="Schedule"
                    >
                      <CalendarOutlined />
                    </button>
                  )}
                  {user?.fullName && (
                    <Popover
                      trigger="click"
                      placement="bottomRight"
                      open={accountOpen}
                      onOpenChange={setAccountOpen}
                      arrow={{ pointAtCenter: true }}
                      content={accountPanel}
                      styles={{
                        container: {
                          padding: 12,
                          borderRadius: 14,
                          boxShadow: '0 8px 28px rgba(15,23,42,0.18)',
                        },
                      }}
                    >
                      <button type="button" className={`app-shell__who-pill${accountOpen ? ' is-open' : ''}`}>
                        <div className="app-shell__who-copy">
                          <div className="app-shell__who-name">{user.fullName}</div>
                          <div className="app-shell__who-role">{roleLabel(user.role)}</div>
                        </div>
                        <DownOutlined className="app-shell__who-caret" />
                      </button>
                    </Popover>
                  )}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Button
                    type="text"
                    icon={isCompact ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    onClick={() => {
                      if (isCompact) setMobileOpen(true);
                      else setCollapsed(!collapsed);
                    }}
                    aria-label={isCompact ? 'Open menu' : collapsed ? 'Expand menu' : 'Collapse menu'}
                    style={{ color: 'rgba(255,255,255,0.85)' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="app-shell__title">{meta.title}</div>
                    {meta.subtitle && <div className="app-shell__subtitle">{meta.subtitle}</div>}
                  </div>
                </div>
                <div className="app-shell__who">
                  <div className="app-shell__who-icon">
                    <UserOutlined />
                  </div>
                  <div className="app-shell__who-copy">
                    <div className="app-shell__who-name">{user?.fullName}</div>
                    <div className="app-shell__who-role">{roleLabel(user?.role)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </Header>
        <div className="app-shell__scroll">
          <Content className="app-shell__content">
            <Outlet />
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
                  onClick={() => navigate(tab.key)}
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
