import { Grid, Layout, Menu, Button, Drawer, Dropdown } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  FileTextOutlined,
  TeamOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const { Header, Sider, Content } = Layout;

const NAVY = '#0f1c2e';

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/job-orders': { title: 'Job Orders', subtitle: 'Create and manage production job orders' },
  '/users': { title: 'Users & Roles', subtitle: 'Manage accounts and worker skills' },
  '/tools': { title: 'Tools', subtitle: 'Tool registry and QR codes' },
  '/tool-events': { title: 'Tool Logs', subtitle: 'Borrow and return history' },
};

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div style={{ padding: '20px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
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
    );
  }

  if (isAdmin) {
    menuItems.push(
      { key: '/users', icon: <TeamOutlined />, label: 'Users & Roles' },
      { key: '/tools', icon: <ToolOutlined />, label: 'Tools' },
      { key: '/tool-events', icon: <UnorderedListOutlined />, label: 'Tool Logs' },
    );
  }

  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '';
  const meta = pageMeta[selectedKey] || { title: '', subtitle: '' };

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      style={{ background: 'transparent', border: 'none', padding: '8px' }}
      onClick={({ key }) => {
        navigate(key);
        setMobileOpen(false);
      }}
    />
  );

  const initials = user?.fullName
    ?.split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        collapsedWidth={0}
        width={230}
        style={{ background: NAVY }}
      >
        <Brand collapsed={collapsed} />
        {menu}
      </Sider>
      )}

      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        styles={{ body: { padding: 0, background: NAVY } }}
        width={240}
      >
        <Brand collapsed={false} />
        {menu}
      </Drawer>

      <Layout>
        <Header
          style={{
            padding: '0 20px',
            background: NAVY,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 68,
            lineHeight: 'normal',
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

          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Logout',
                  onClick: () => {
                    logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: '6px 12px 6px 6px',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {initials}
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
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: 16,
            padding: 20,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
            flex: 'none',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
