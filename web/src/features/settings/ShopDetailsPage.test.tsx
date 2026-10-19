/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import ShopDetailsPage from './ShopDetailsPage';
import {
  PageHeaderActionsProvider,
  usePageHeaderActionsSlot,
} from '../../layouts/pageHeaderActions';

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

function HeaderActionsHost() {
  const actions = usePageHeaderActionsSlot();
  return <div data-testid="page-header-actions">{actions}</div>;
}

function renderPage(ui: ReactNode) {
  return render(
    <ConfigProvider>
      <MemoryRouter>
        <PageHeaderActionsProvider>
          <HeaderActionsHost />
          {ui}
        </PageHeaderActionsProvider>
      </MemoryRouter>
    </ConfigProvider>
  );
}

describe('ShopDetailsPage', () => {
  it('renders without throwing (no useBlocker / blank crash)', async () => {
    await act(async () => {
      renderPage(<ShopDetailsPage />);
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Brothers Machine')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /preview letterhead/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
    expect(screen.getByText('Letterhead')).toBeTruthy();
    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByText('Approvers')).toBeTruthy();
    expect(screen.getByText('Test email')).toBeTruthy();
  });

  it('opens letterhead preview modal reflecting unsaved shop name edits', async () => {
    await act(async () => {
      renderPage(<ShopDetailsPage />);
    });
    await waitFor(() => expect(screen.getByDisplayValue('Brothers Machine')).toBeTruthy());

    const nameInput = screen.getByLabelText(/shop name/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'New Shop Name' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /preview letterhead/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('letterhead-preview-sheet')).toBeTruthy();
      expect(document.querySelector('.shop-print-name')?.textContent).toContain('New Shop Name');
    });
  });
});
