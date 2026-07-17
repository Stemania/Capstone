import { Grid, Layout, Menu, Button, Typography, Drawer } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  FileTextOutlined,
  TeamOutlined,
  ToolOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

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
      { key: '/users', icon: <TeamOutlined />, label: 'Users' },
      { key: '/tools', icon: <ToolOutlined />, label: 'Tools' },
      { key: '/tool-events', icon: <UnorderedListOutlined />, label: 'Tool Logs' },
    );
  }

  const selectedKey = menuItems.find((item) => location.pathname.startsWith(item.key))?.key || '';

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={({ key }) => {
        navigate(key);
        setMobileOpen(false);
      }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        collapsedWidth={0}
      >
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <Text strong style={{ color: '#fff', fontSize: collapsed ? 12 : 16 }}>
            {collapsed ? 'BMSC' : 'Brothers Machine Shop'}
          </Text>
        </div>
        {menu}
      </Sider>
      )}

      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        styles={{ body: { padding: 0, background: '#001529' } }}
        width={240}
      >
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <Text strong style={{ color: '#fff' }}>Brothers Machine Shop</Text>
        </div>
        {menu}
      </Drawer>

      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => {
              if (isMobile) setMobileOpen(true);
              else setCollapsed(!collapsed);
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>
              <UserOutlined /> {user?.fullName}
            </span>
            <Button icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/login'); }}>
              Logout
            </Button>
          </div>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
