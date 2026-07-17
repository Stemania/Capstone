import { Grid, Layout, Menu, Button, Typography, Drawer, Avatar, Dropdown } from 'antd';
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
const { Text } = Typography;

const SIDEBAR_BG = '#0f1c2e';

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div style={{ padding: '20px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: collapsed ? 13 : 17, fontWeight: 800, letterSpacing: 0.5, color: '#fff', whiteSpace: 'nowrap' }}>
        {collapsed ? (
          <>M<span style={{ color: '#3b82f6' }}>L</span></>
        ) : (
          <>METAL<span style={{ color: '#3b82f6' }}>LINK</span> ERP</>
        )}
      </div>
      {!collapsed && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
          Brothers Machine Shop
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
  const pageTitle = menuItems.find((item) => item.key === selectedKey)?.label || '';

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
        style={{ background: SIDEBAR_BG }}
      >
        <Brand collapsed={collapsed} />
        {menu}
      </Sider>
      )}

      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        styles={{ body: { padding: 0, background: SIDEBAR_BG } }}
        width={240}
      >
        <Brand collapsed={false} />
        {menu}
      </Drawer>

      <Layout>
        <Header
          style={{
            padding: '0 20px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e2e8f0',
            height: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              icon={collapsed || isMobile ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => {
                if (isMobile) setMobileOpen(true);
                else setCollapsed(!collapsed);
              }}
            />
            <Text strong style={{ fontSize: 16 }}>{pageTitle}</Text>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <Avatar style={{ background: '#2563eb', fontWeight: 600 }} size={34}>
                {initials}
              </Avatar>
              {!isMobile && (
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.fullName}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {user?.role === 'ADMIN' ? 'Administrator' : 'Office Staff'}
                  </div>
                </div>
              )}
            </div>
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: 20,
            padding: 24,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
