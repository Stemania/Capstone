import { formatShop } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { supplierOrdersApi } from '../../api/supplierOrders.api';
import { getErrorMessage } from '../../api/client';
import { useShopDetails } from '../../hooks/useShopDetails';
import type { SupplierOrderPrint } from '../../types';
import { PrintDocument, SignatureBlock } from './PrintTemplate';

/** The template has room for this many item rows; shorter orders keep the blank rows. */
const FORM_ROWS = 10;

const DELIVERY_MODE_LABEL: Record<string, string> = {
  PICKUP: 'Pick-up',
  DELIVERY: 'Delivery',
};

function fmtDate(v?: string | null) {
  return v ? formatShop(v, 'MMMM D, YYYY') : '';
}

function money(v?: number | null) {
  if (v == null) return '';
  return `₱${Number(v).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function qty(v: number) {
  return Number(v).toLocaleString('en-PH', { maximumFractionDigits: 4 });
}

function itemDescription(row: SupplierOrderPrint['rows'][number]) {
  if (row.isConsumable || !row.gradeOrSpec) return row.materialName;
  return `${row.materialName} – ${row.gradeOrSpec}`;
}

function SummaryRow({ label, amount, total }: { label: string; amount: number; total?: boolean }) {
  return (
    <tr className={total ? 'total' : undefined}>
      <td className="shop-print-label">{label}</td>
      <td />
      <td />
      <td />
      <td className="num">{money(amount)}</td>
    </tr>
  );
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
  const blankRows = Math.max(FORM_ROWS - data.rows.length, 0);

  return (
    <PrintDocument
      shop={shop}
      toolbar={
        <>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Print
          </Button>
        </>
      }
    >
      <div className="shop-print-doc-head">
        <h1 className="shop-print-doc-title">PURCHASE ORDER</h1>
        <div className="shop-print-doc-ref">PO # {order.poNumber}</div>
        <div className="shop-print-doc-ref">
          <span className="shop-print-label">DATE</span> {fmtDate(order.dateIssued)}
        </div>
      </div>

      <div className="shop-print-party">
        <div>
          <span className="shop-print-label">Supplier Name:</span> {supplier?.name}
        </div>
        <div>
          <span className="shop-print-label">Address:</span> {supplier?.address}
        </div>
      </div>

      <table className="shop-print-table">
        <colgroup>
          <col style={{ width: '44.8%' }} />
          <col style={{ width: '7.4%' }} />
          <col style={{ width: '8.1%' }} />
          <col style={{ width: '19.85%' }} />
          <col style={{ width: '19.85%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ITEM DESCRIPTION</th>
            <th>QTY</th>
            <th>UOM</th>
            <th>UNIT PRICE</th>
            <th>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.isConsumable}-${r.materialName}-${r.gradeOrSpec}-${r.unit}`}>
              <td>{itemDescription(r)}</td>
              <td className="mid">{qty(r.quantity)}</td>
              <td className="mid">{r.unit}</td>
              <td className="num">{money(r.unitCost)}</td>
              <td className="num">{money(r.amount)}</td>
            </tr>
          ))}
          {Array.from({ length: blankRows }, (_, i) => (
            <tr key={`blank-${i}`} className="blank">
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
          {data.vatRate ? (
            <>
              <SummaryRow label="SUBTOTAL" amount={data.subtotal} />
              <SummaryRow label={`VAT (${data.vatRate}%)`} amount={data.vatAmount} />
            </>
          ) : null}
          <SummaryRow label="TOTAL" amount={data.total} total />
        </tbody>
      </table>

      <ul className="shop-print-terms">
        <li>Terms of Payment: {order.termsOfPayment || 'PDC'}</li>
        <li>
          Mode of Delivery:{' '}
          {DELIVERY_MODE_LABEL[order.deliveryMode || 'DELIVERY'] || order.deliveryMode}
        </li>
      </ul>

      <div className="shop-print-signatures">
        <SignatureBlock
          label="Approved by:"
          name={shop.poApproverName}
          title={shop.poApproverTitle}
        />
      </div>
    </PrintDocument>
  );
}
