import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import AppRoutes from './routes/AppRoutes';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 8,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          colorBgLayout: '#f1f5f9',
        },
        components: {
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
          },
        },
      }}
    >
      <AppRoutes />
    </ConfigProvider>
  </StrictMode>
);
