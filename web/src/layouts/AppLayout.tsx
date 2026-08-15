import { Grid, Layout, Menu, Button, Drawer } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
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
  '/users': { title: 'Users & Roles', subtitle: 'Manage accounts and worker skills' },
  '/tools': { title: 'Inventory', subtitle: 'Stock levels, QR codes, and usage' },
  '/settings/scoring-weights': {
    title: 'Worker ranking',
    subtitle: 'Set how skill, availability, workload, and past performance matter',
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
      <div style={{ fontSize: collapsed ? 13 : 16, fontWeight: 800, letterSpacing: 0.3, color: '#fff', whiteSpace: 'nowrap' }}>
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

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
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
      { key: '/settings/scoring-weights', icon: <SettingOutlined />, label: 'Worker ranking' },
    );
  }

  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '';
  const meta =
    location.pathname.startsWith('/users/') && location.pathname !== '/users'
      ? { title: 'Worker Profile', subtitle: 'Skills and weekly schedule' }
      : /^\/job-orders\/[^/]+$/.test(location.pathname)
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
      inlineCollapsed={collapsed && !isMobile}
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

  return (
    <Layout style={{ height: '100%', overflow: 'hidden' }}>
      {!isMobile && (
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
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
        styles={{ body: { padding: 0, background: NAVY, display: 'flex', flexDirection: 'column', height: '100%' } }}
        width={240}
      >
        <Brand collapsed={false} />
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
          style={{
            padding: '0 20px',
            background: NAVY,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 68,
            lineHeight: 'normal',
            flexShrink: 0,
            borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Button
              type="text"
              icon={collapsed || isMobile ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => {
                if (isMobile) setMobileOpen(true);
                else setCollapsed(!collapsed);
              }}
              style={{ color: 'rgba(255,255,255,0.75)' }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: '#fff',
                  fontSize: 17,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta.title}
              </div>
              {meta.subtitle && !isMobile && (
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
                  {meta.subtitle}
                </div>
              )}
            </div>
          </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 999,
                padding: '6px 14px 6px 6px',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UserOutlined />
              </div>
              {!isMobile && (
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{user?.fullName}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                    {user?.role === 'ADMIN' ? 'Administrator' : 'Office Staff'}
                  </div>
                </div>
              )}
            </div>
        </Header>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            background: '#f1f5f9',
          }}
        >
          <Content
            style={{
              margin: 16,
              padding: 20,
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
            }}
          >
            <Outlet />
          </Content>
        </div>
      </Layout>
    </Layout>
  );
}
