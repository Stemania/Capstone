import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import AppRoutes from './routes/AppRoutes';
import { ADMIN_SEED_TOKENS, adminThemeComponents } from './theme/adminTheme';
import { antThemeToken } from './theme/tokens';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          ...antThemeToken,
          borderRadius: 8,
          ...ADMIN_SEED_TOKENS,
        },
        components: adminThemeComponents,
      }}
    >
      <AppRoutes />
    </ConfigProvider>
  </StrictMode>
);
