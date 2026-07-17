import { ConfigProvider, theme as antdTheme } from 'antd';
import {
  LogoutOutlined,
  UnorderedListOutlined,
  QrcodeOutlined,
  ToolOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { createContext, useContext, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export interface WorkerPalette {
  bg: string;
  card: string;
  cardBorder: string;
  navBg: string;
  accent: string;
  accentSoft: string;
  green: string;
  red: string;
  text: string;
  textSecondary: string;
  chipBg: string;
}

const darkPalette: WorkerPalette = {
  bg: '#0b1526',
  card: '#13223a',
  cardBorder: '#1e3251',
  navBg: '#0f1c2e',
  accent: '#3b82f6',
  accentSoft: '#60a5fa',
  green: '#22c55e',
  red: '#ef4444',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  chipBg: 'rgba(255,255,255,0.06)',
};

const lightPalette: WorkerPalette = {
  bg: '#f1f5f9',
  card: '#ffffff',
  cardBorder: '#e2e8f0',
  navBg: '#ffffff',
  accent: '#2563eb',
  accentSoft: '#3b82f6',
  green: '#16a34a',
  red: '#dc2626',
  text: '#0f172a',
  textSecondary: '#64748b',
  chipBg: '#f1f5f9',
};

type WorkerMode = 'dark' | 'light';

const WorkerThemeContext = createContext<{ colors: WorkerPalette; mode: WorkerMode }>({
  colors: darkPalette,
  mode: 'dark',
});

export function useWorkerTheme() {
  return useContext(WorkerThemeContext);
}

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
  const [mode, setMode] = useState<WorkerMode>(
    () => (localStorage.getItem('workerTheme') as WorkerMode) || 'dark'
  );

  const colors = mode === 'dark' ? darkPalette : lightPalette;

  const toggleMode = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    localStorage.setItem('workerTheme', next);
  };

  const tabs = [
    { key: '/my-assignments', label: 'Jobs', icon: <UnorderedListOutlined style={{ fontSize: 22 }} /> },
    { key: '/scan', label: 'Scan', icon: <QrcodeOutlined style={{ fontSize: 26 }} />, center: true },
    { key: '/my-tools', label: 'Tools', icon: <ToolOutlined style={{ fontSize: 22 }} /> },
  ];

  const iconButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: colors.textSecondary,
    fontSize: 20,
    padding: 8,
    cursor: 'pointer',
  };

  return (
    <WorkerThemeContext.Provider value={{ colors, mode }}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: colors.accent,
            colorBgContainer: colors.card,
            borderRadius: 12,
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          },
        }}
      >
        <div
          style={{
            minHeight: '100dvh',
            background: colors.bg,
            color: colors.text,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 16px',
              background: colors.navBg,
              position: 'sticky',
              top: 0,
              zIndex: 10,
              borderBottom: `1px solid ${colors.cardBorder}`,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: colors.accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 15,
                marginRight: 4,
              }}
            >
              {user ? initials(user.fullName) : '?'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.fullName}
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary }}>Production Worker</div>
            </div>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: colors.green,
              }}
            />
            <button onClick={toggleMode} style={iconButtonStyle} aria-label="Toggle theme">
              {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            </button>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              style={iconButtonStyle}
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
              background: colors.navBg,
              borderTop: `1px solid ${colors.cardBorder}`,
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
                      background: colors.accent,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
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
                    color: active ? colors.accent : colors.textSecondary,
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
    </WorkerThemeContext.Provider>
  );
}
