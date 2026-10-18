/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import ShopDetailsPage from './ShopDetailsPage';

vi.mock('../../api/shopDetails.api', () => ({
  shopDetailsApi: {
    get: () =>
      Promise.resolve({
        data: {
          shopName: 'Brothers Machine',
          tagline: 'Fab work',
          address: 'Malvar',
          telephone: '(043) 1',
          mobileNumbers: '0917',
          email: 'shop@test.local',
          poApproverName: 'Greg',
          poApproverTitle: 'GM',
          joApproverName: 'Gary',
          joApproverTitle: 'Prod',
          updatedAt: '2026-10-06T03:07:00Z',
        },
      }),
    update: (data: unknown) => Promise.resolve({ data }),
  },
}));

vi.mock('../../api/notifications.api', () => ({
  notificationsApi: {
    sendTest: () => Promise.resolve({ data: { status: 'SENT' } }),
  },
}));

vi.mock('../../hooks/useShopDetails', () => ({
  invalidateShopDetails: () => undefined,
}));

describe('ShopDetailsPage', () => {
  it('renders without throwing (no useBlocker / blank crash)', async () => {
    await act(async () => {
      render(
        <ConfigProvider>
          <MemoryRouter>
            <ShopDetailsPage />
          </MemoryRouter>
        </ConfigProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Brothers Machine')).toBeTruthy();
    });
    expect(screen.getByLabelText('Letterhead preview')).toBeTruthy();
    expect(document.querySelector('.shop-print-name')?.textContent).toContain('Brothers Machine');
  });

  it('updates the letterhead preview when the shop name changes', async () => {
    await act(async () => {
      render(
        <ConfigProvider>
          <MemoryRouter>
            <ShopDetailsPage />
          </MemoryRouter>
        </ConfigProvider>
      );
    });
    await waitFor(() => expect(screen.getByDisplayValue('Brothers Machine')).toBeTruthy());

    const nameInput = screen.getByLabelText(/shop name/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'New Shop Name' } });
    });

    await waitFor(() => {
      expect(document.querySelector('.shop-print-name')?.textContent).toContain('New Shop Name');
    });
  });
});
