import { Tabs } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import SuppliersPage from './SuppliersPage';
import SupplierOrdersPage from '../supplier-orders/SupplierOrdersPage';

const TABS = [
  { key: '/suppliers', label: 'Suppliers' },
  { key: '/supplier-orders', label: 'Orders' },
];

export default function SuppliersAndOrdersPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = pathname.startsWith('/supplier-orders') ? '/supplier-orders' : '/suppliers';

  return (
    <div>
      <Tabs activeKey={active} items={TABS} onChange={(key) => navigate(key)} />
      {active === '/supplier-orders' ? <SupplierOrdersPage /> : <SuppliersPage />}
    </div>
  );
}
