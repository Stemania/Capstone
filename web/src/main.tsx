import './utils/shopTime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import AppRoutes from './routes/AppRoutes';
import { officeTheme } from './theme/antTheme';
import EmptyState from './components/ui/EmptyState';
import './index.css';
import './theme/theme.css';
import './components/ui/ui.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={officeTheme}
      renderEmpty={(name) => <EmptyState compact title={name === 'Select' ? 'No matches' : 'Nothing here yet'} />}
    >
      <AppRoutes />
    </ConfigProvider>
  </StrictMode>
);
