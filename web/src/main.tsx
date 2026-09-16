import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import AppRoutes from './routes/AppRoutes';
import { ADMIN_SEED_TOKENS, adminThemeComponents } from './theme/adminTheme';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 8,
          // Same bundled Inter as Flutter (400–800)
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
          fontWeightStrong: 700,
          colorBgLayout: '#f1f5f9',
          ...ADMIN_SEED_TOKENS,
        },
        components: adminThemeComponents,
      }}
    >
      <AppRoutes />
    </ConfigProvider>
  </StrictMode>
);
