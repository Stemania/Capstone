import { ConfigProvider, Popover, theme as antdTheme } from 'antd';
import {
  LogoutOutlined,
  UnorderedListOutlined,
  QrcodeOutlined,
  ToolOutlined,
  CalendarOutlined,
  LeftOutlined,
  DownOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { confirmLogout } from '../utils/confirmLogout';

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

interface WorkerThemeValue {
  colors: WorkerPalette;
  logout: () => void;
}

const WorkerThemeContext = createContext<WorkerThemeValue>({
  colors: lightPalette,
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
  showSchedule = true,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Schedule shortcut in the old dark-mode slot. Hide on the schedule page itself. */
  showSchedule?: boolean;
}) {
  const { colors, logout } = useWorkerTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onSchedule = location.pathname.startsWith('/schedule');
  const [accountOpen, setAccountOpen] = useState(false);

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
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: '#0f1c2e',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          <UserOutlined />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: 1.25,
              wordBreak: 'break-word',
            }}
          >
            {user?.fullName}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Worker</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setAccountOpen(false);
          logout();
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '11px 12px',
          border: 'none',
          borderRadius: 10,
          background: '#611020',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <LogoutOutlined />
        Log out
      </button>
    </div>
  );

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              flexShrink: 0,
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
        {showSchedule && !onSchedule && (
          <button
            type="button"
            onClick={() => navigate('/schedule')}
            aria-label="Schedule"
            title="Schedule"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              color: colors.headerText,
              width: 36,
              height: 36,
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 16,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
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
            <button
              type="button"
              style={{
                maxWidth: 168,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '7px 8px 7px 12px',
                flexShrink: 0,
                background: 'rgba(255,255,255,0.1)',
                border: accountOpen ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
                borderRadius: 999,
                color: colors.headerText,
                cursor: 'pointer',
              }}
            >
              <div style={{ minWidth: 0, textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {user.fullName}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>Worker</div>
              </div>
              <DownOutlined style={{ fontSize: 11, opacity: 0.75, flexShrink: 0 }} />
            </button>
          </Popover>
        )}
      </div>
    </header>
  );
}

export default function WorkerLayout() {
  const { logout: authLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const colors = lightPalette;
  const isScan = location.pathname.startsWith('/scan');

  const logout = () => {
    confirmLogout(() => {
      authLogout();
      navigate('/login');
    }, 'You will need to sign in again to see your jobs.');
  };

  const tabs = [
    {
      key: '/my-assignments',
      label: 'Jobs',
      icon: <UnorderedListOutlined style={{ fontSize: 24 }} />,
    },
    {
      key: '/scan',
      label: 'Scan',
      icon: <QrcodeOutlined style={{ fontSize: 28 }} />,
      center: true,
    },
    {
      key: '/my-tools',
      label: 'Tools',
      icon: <ToolOutlined style={{ fontSize: 24 }} />,
    },
  ];

  return (
    <WorkerThemeContext.Provider value={{ colors, logout }}>
      <ConfigProvider
        theme={{
          algorithm: antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: colors.accent,
            colorBgContainer: colors.card,
            borderRadius: 12,
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
            fontWeightStrong: 700,
          },
        }}
      >
        <div
          style={{
            height: '100%',
            background: isScan ? '#000' : colors.bg,
            color: colors.text,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <main style={{ flex: 1, paddingBottom: 100, overflowY: 'auto' }}>
            <Outlet />
          </main>

          <nav
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              gap: 72,
              background: colors.navBg,
              borderTop: `1px solid ${colors.cardBorder}`,
              padding: '6px 24px',
              paddingBottom: 'calc(6px + env(safe-area-inset-bottom))',
              zIndex: 20,
              boxShadow: '0 -2px 10px rgba(15,23,42,0.04)',
              height: 'calc(56px + env(safe-area-inset-bottom))',
              overflow: 'visible',
            }}
          >
            {tabs.map((tab) => {
              const active =
                tab.key === '/my-assignments'
                  ? location.pathname.startsWith('/my-assignments') ||
                    location.pathname.startsWith('/job-orders/')
                  : location.pathname.startsWith(tab.key);

              if (tab.center) {
                return (
                  <div
                    key={tab.key}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      width: 72,
                      height: '100%',
                      position: 'relative',
                      overflow: 'visible',
                      paddingBottom: 2,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => navigate(tab.key)}
                      aria-label={tab.label}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        position: 'absolute',
                        bottom: 22,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        border: `3px solid ${colors.navBg}`,
                        background: colors.accent,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(37,99,235,0.35)',
                        zIndex: 2,
                      }}
                    >
                      {tab.icon}
                    </button>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        color: active ? colors.accent : colors.textSecondary,
                        whiteSpace: 'nowrap',
                        lineHeight: 1.2,
                        position: 'relative',
                        zIndex: 1,
                      }}
                    >
                      {tab.label}
                    </span>
                  </div>
                );
              }

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => navigate(tab.key)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: active ? colors.accent : colors.textSecondary,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    padding: '4px 12px 2px',
                    height: '100%',
                    minWidth: 64,
                    flexShrink: 0,
                  }}
                >
                  {tab.icon}
                  <span style={{ lineHeight: 1.2 }}>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </ConfigProvider>
    </WorkerThemeContext.Provider>
  );
}
