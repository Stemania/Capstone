import { ConfigProvider, theme as antdTheme } from 'antd';
import {
  LogoutOutlined,
  UnorderedListOutlined,
  QrcodeOutlined,
  ToolOutlined,
  SunOutlined,
  MoonOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export interface WorkerPalette {
  bg: string;
  card: string;
  cardBorder: string;
  navBg: string;
  headerBg: string;
  headerText: string;
  accent: string;
  accentSoft: string;
  green: string;
  greenSoft: string;
  amber: string;
  red: string;
  text: string;
  textSecondary: string;
  chipBg: string;
  shadow: string;
  inputBg: string;
}

const darkPalette: WorkerPalette = {
  bg: '#0b1526',
  card: '#13223a',
  cardBorder: '#1e3251',
  navBg: '#0f1c2e',
  headerBg: '#0f1c2e',
  headerText: '#ffffff',
  accent: '#3b82f6',
  accentSoft: '#60a5fa',
  green: '#22c55e',
  greenSoft: 'rgba(34,197,94,0.15)',
  amber: '#f59e0b',
  red: '#ef4444',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  chipBg: 'rgba(255,255,255,0.06)',
  shadow: 'none',
  inputBg: '#13223a',
};

const lightPalette: WorkerPalette = {
  bg: '#f1f5f9',
  card: '#ffffff',
  cardBorder: '#e2e8f0',
  navBg: '#ffffff',
  headerBg: '#0f1c2e',
  headerText: '#ffffff',
  accent: '#2563eb',
  accentSoft: '#3b82f6',
  green: '#16a34a',
  greenSoft: 'rgba(22,163,74,0.12)',
  amber: '#d97706',
  red: '#dc2626',
  text: '#0f172a',
  textSecondary: '#64748b',
  chipBg: '#f1f5f9',
  shadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  inputBg: '#ffffff',
};

type WorkerMode = 'dark' | 'light';

interface WorkerThemeValue {
  colors: WorkerPalette;
  mode: WorkerMode;
  toggleMode: () => void;
  logout: () => void;
}

const WorkerThemeContext = createContext<WorkerThemeValue>({
  colors: lightPalette,
  mode: 'light',
  toggleMode: () => {},
  logout: () => {},
});

export function useWorkerTheme() {
  return useContext(WorkerThemeContext);
}

export function WorkerPageHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const { colors, mode, toggleMode, logout } = useWorkerTheme();

  return (
    <header
      style={{
        background: colors.headerBg,
        color: colors.headerText,
        padding: '16px 16px 18px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              background: 'none',
              border: 'none',
              color: colors.headerText,
              fontSize: 18,
              padding: '4px 4px 0 0',
              cursor: 'pointer',
            }}
          >
            <LeftOutlined />
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
        {right}
        <button
          onClick={toggleMode}
          aria-label="Toggle theme"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            color: colors.headerText,
            width: 36,
            height: 36,
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
        <button
          onClick={logout}
          aria-label="Logout"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            color: colors.headerText,
            width: 36,
            height: 36,
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          <LogoutOutlined />
        </button>
      </div>
    </header>
  );
}

export default function WorkerLayout() {
  const { logout: authLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<WorkerMode>(
    () => (localStorage.getItem('workerTheme') as WorkerMode) || 'light'
  );

  const colors = mode === 'dark' ? darkPalette : lightPalette;
  const isScan = location.pathname.startsWith('/scan');

  const toggleMode = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    localStorage.setItem('workerTheme', next);
  };

  const logout = () => {
    authLogout();
    navigate('/login');
  };

  const tabs = [
    { key: '/my-assignments', label: 'Jobs', icon: <UnorderedListOutlined style={{ fontSize: 22 }} /> },
    { key: '/scan', label: 'Scan', icon: <QrcodeOutlined style={{ fontSize: 26 }} />, center: true },
    { key: '/my-tools', label: 'Tools', icon: <ToolOutlined style={{ fontSize: 22 }} /> },
  ];

  return (
    <WorkerThemeContext.Provider value={{ colors, mode, toggleMode, logout }}>
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
            background: isScan ? '#000' : colors.bg,
            color: colors.text,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <main style={{ flex: 1, paddingBottom: 88, overflowY: 'auto' }}>
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
              padding: '8px 0',
              paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
              zIndex: 20,
              boxShadow: mode === 'light' ? '0 -2px 10px rgba(15,23,42,0.04)' : 'none',
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
                      width: 58,
                      height: 58,
                      borderRadius: '50%',
                      marginTop: -26,
                      border: `3px solid ${colors.navBg}`,
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
                    gap: 2,
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
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
