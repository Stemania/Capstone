import { formatShop } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { getErrorMessage } from '../../api/client';
import { useShopDetails } from '../../hooks/useShopDetails';
import type { SupplierOrderPrint } from '../../types';
import { ReportStamp, displayOrDash } from './ReportChrome';
import { ApproverSignature, ShopLetterhead } from './ShopLetterhead';

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return formatShop(v, 'MMM D, YYYY');
}

function money(v?: number | null) {
  if (v == null) return '—';
  return `₱${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function qty(v: number) {
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function SupplierOrderPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const shop = useShopDetails();
  const [data, setData] = useState<SupplierOrderPrint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    supplierOrdersApi
      .print(id)
      .then(({ data: d }) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <Alert type="warning" showIcon message={error || 'Supplier order not found.'} />
        <Button style={{ marginTop: 12 }} icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    );
  }

  const { order, supplier } = data;
  const supplierContact = supplier
    ? [supplier.contactPerson, supplier.phone, supplier.email].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="jo-print-page">
      <div className="no-print" style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <article className="jo-print-sheet">
        <ShopLetterhead details={shop} />

        <ReportStamp />

        <h1 className="jo-print-title">Purchase Order</h1>

        <div className="jo-print-meta">
          <div>
            <strong>PO #</strong> {displayOrDash(order.poNumber)}
          </div>
          <div>
            <strong>Date issued</strong> {fmtDate(order.dateIssued)}
          </div>
          <div>
            <strong>Supplier</strong> {displayOrDash(supplier?.name)}
          </div>
          <div>
            <strong>Expected delivery</strong> {fmtDate(order.expectedDeliveryDate)}
          </div>
          <div>
            <strong>Address</strong> {displayOrDash(supplier?.address)}
          </div>
          <div>
            <strong>Contact</strong> {displayOrDash(supplierContact)}
          </div>
        </div>

        <h2 className="jo-print-h2">Items</h2>
        <table className="jo-print-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>#</th>
              <th>Material</th>
              <th style={{ width: 130 }}>Grade / spec</th>
              <th style={{ width: 100, textAlign: 'right' }}>Qty</th>
              <th style={{ width: 110, textAlign: 'right' }}>Unit cost</th>
              <th style={{ width: 120, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.materialName}-${r.gradeOrSpec}-${r.unit}-${r.unitCost}`}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.materialName}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {r.jobNumbers.length ? `For ${r.jobNumbers.join(', ')}` : 'Consumable restock'}
                  </div>
                </td>
                <td>{displayOrDash(r.gradeOrSpec)}</td>
                <td style={{ textAlign: 'right' }}>
                  {qty(r.quantity)} {r.unit}
                </td>
                <td style={{ textAlign: 'right' }}>{money(r.unitCost)}</td>
                <td style={{ textAlign: 'right' }}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ textAlign: 'right' }}>
                <strong>Subtotal</strong>
              </td>
              <td style={{ textAlign: 'right' }}>{money(data.subtotal)}</td>
            </tr>
            {data.vatRate ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'right' }}>
                  <strong>VAT ({data.vatRate}%)</strong>
                </td>
                <td style={{ textAlign: 'right' }}>{money(data.vatAmount)}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={5} style={{ textAlign: 'right' }}>
                <strong>Total</strong>
              </td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(data.total)}</td>
            </tr>
          </tfoot>
        </table>

        {order.notes ? (
          <div style={{ marginTop: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            <strong>Notes:</strong> {order.notes}
          </div>
        ) : null}

        <div className="jo-print-signatures">
          <div className="jo-print-sig">
            <div style={{ minHeight: 14 }}>{displayOrDash(order.preparedByName)}</div>
            <div className="jo-print-sig-line" />
            <div>Prepared by</div>
          </div>
          <ApproverSignature name={shop.poApproverName} title={shop.poApproverTitle} />
        </div>
      </article>
    </div>
  );
}
