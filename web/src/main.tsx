import './utils/shopTime';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import AppRoutes from './routes/AppRoutes';
import { officeTheme, officeTouchTheme } from './theme/antTheme';
import { TOUCH_QUERY, useMediaQuery } from './hooks/useViewport';
import EmptyState from './components/ui/EmptyState';
import './index.css';
import './theme/theme.css';
import './components/ui/ui.css';
import './theme/responsive.css';

function ThemedApp({ children }: { children: ReactNode }) {
  const touch = useMediaQuery(TOUCH_QUERY);
  return (
    <ConfigProvider
      theme={touch ? officeTouchTheme : officeTheme}
      renderEmpty={(name) => <EmptyState compact title={name === 'Select' ? 'No matches' : 'Nothing here yet'} />}
    >
      {children}
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemedApp>
      <AppRoutes />
    </ThemedApp>
  </StrictMode>
);
