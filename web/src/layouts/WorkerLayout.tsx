import { ConfigProvider, theme as antdTheme } from 'antd';
import { LogoutOutlined, UnorderedListOutlined, QrcodeOutlined, ToolOutlined } from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export const workerColors = {
  bg: '#0f1214',
  card: '#1b1f23',
  cardBorder: '#2a2f35',
  green: '#22c55e',
  red: '#ef4444',
  textSecondary: '#9ca3af',
};

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function WorkerLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { key: '/my-assignments', label: 'Jobs', icon: <UnorderedListOutlined style={{ fontSize: 22 }} /> },
    { key: '/scan', label: 'Scan', icon: <QrcodeOutlined style={{ fontSize: 26 }} />, center: true },
    { key: '/my-tools', label: 'Tools', icon: <ToolOutlined style={{ fontSize: 22 }} /> },
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: workerColors.green,
          colorBgContainer: workerColors.card,
          borderRadius: 12,
        },
      }}
    >
      <div
        style={{
          minHeight: '100dvh',
          background: workerColors.bg,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            background: workerColors.bg,
            position: 'sticky',
            top: 0,
            zIndex: 10,
            borderBottom: `1px solid ${workerColors.cardBorder}`,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: workerColors.green,
              color: '#06240f',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {user ? initials(user.fullName) : '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.fullName}
            </div>
            <div style={{ fontSize: 12, color: workerColors.textSecondary }}>Production Worker</div>
          </div>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: workerColors.green,
              boxShadow: `0 0 6px ${workerColors.green}`,
            }}
          />
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: workerColors.textSecondary,
              fontSize: 20,
              padding: 8,
              cursor: 'pointer',
            }}
            aria-label="Logout"
          >
            <LogoutOutlined />
          </button>
        </header>

        <main style={{ flex: 1, padding: 16, paddingBottom: 96, overflowY: 'auto' }}>
          <Outlet />
        </main>

        <nav
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            background: '#15181b',
            borderTop: `1px solid ${workerColors.cardBorder}`,
            padding: '10px 0',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
            zIndex: 20,
          }}
        >
          {tabs.map((tab) => {
            const active = location.pathname.startsWith(tab.key);
            if (tab.center) {
              return (
                <button
                  key={tab.key}
                  onClick={() => navigate(tab.key)}
                  aria-label={tab.label}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    marginTop: -28,
                    border: 'none',
                    background: workerColors.green,
                    color: '#06240f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(34,197,94,0.45)',
                    cursor: 'pointer',
                  }}
                >
                  {tab.icon}
                </button>
              );
            }
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: active ? workerColors.green : workerColors.textSecondary,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 20px',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </ConfigProvider>
  );
}
