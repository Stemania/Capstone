import { formatShop } from '../../utils/shopTime';
import { useEffect, useState } from 'react';
import { Button, Spin, message } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { SHOP_LETTERHEAD } from '../../constants/shopLetterhead';
import type { Client, JobOrder, SalesInvoice } from '../../types';
import { ReportStamp, displayOrDash } from './ReportChrome';

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

function clientContactLine(c: Client | null | undefined) {
  if (!c) return '—';
  const parts = [c.contact, c.email, c.mobileNumber].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export default function SalesInvoicePrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobOrder | null>(null);
  const [invoice, setInvoice] = useState<SalesInvoice | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: jobData }, { data: inv }] = await Promise.all([
          jobOrdersApi.get(id),
          jobOrdersApi.getInvoice(id),
        ]);
        if (cancelled) return;
        setJob(jobData);
        setInvoice(inv);
        try {
          const { data: clients } = await clientsApi.list();
          if (!cancelled) setClient(clients.find((c) => c.id === inv.clientId) || null);
        } catch {
          if (!cancelled) setClient(null);
        }
      } catch (err) {
        if (!cancelled) message.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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
  if (!job || !invoice) {
    return <div style={{ padding: 24 }}>No sales invoice has been issued for this job.</div>;
  }

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
        <header className="jo-print-letterhead">
          <div className="jo-print-shop-name">{SHOP_LETTERHEAD.legalName}</div>
          {SHOP_LETTERHEAD.addressLines.map((line) => (
            <div key={line} className="jo-print-shop-line">
              {line}
            </div>
          ))}
        </header>

        <ReportStamp />

        <h1 className="jo-print-title">Sales Invoice</h1>

        <div className="jo-print-meta">
          <div>
            <strong>Invoice #</strong> {invoice.invoiceNumber}
          </div>
          <div>
            <strong>Invoice date</strong> {fmtDate(invoice.invoiceDate)}
          </div>
          <div>
            <strong>Bill to</strong> {displayOrDash(invoice.clientName || job.clientName)}
          </div>
          <div>
            <strong>Client contact</strong> {clientContactLine(client)}
          </div>
          <div>
            <strong>Job order #</strong> {displayOrDash(job.jobNumber)}
          </div>
          <div>
            <strong>Client PO #</strong> {displayOrDash(job.clientPoNumber)}
          </div>
        </div>

        <h2 className="jo-print-h2">Particulars</h2>
        <table className="jo-print-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ fontWeight: 600 }}>{displayOrDash(job.title)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{invoice.description}</div>
              </td>
              <td>
                {job.quantity != null
                  ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}`
                  : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>{money(invoice.subtotal)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: 'right' }}>
                <strong>Subtotal</strong>
              </td>
              <td style={{ textAlign: 'right' }}>{money(invoice.subtotal)}</td>
            </tr>
            {invoice.vatRate ? (
              <tr>
                <td colSpan={2} style={{ textAlign: 'right' }}>
                  <strong>VAT ({invoice.vatRate}%)</strong>
                </td>
                <td style={{ textAlign: 'right' }}>{money(invoice.vatAmount)}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={2} style={{ textAlign: 'right' }}>
                <strong>Total amount due</strong>
              </td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="jo-print-signatures">
          <div className="jo-print-sig">
            <div style={{ minHeight: 14 }}>{displayOrDash(invoice.preparedByName)}</div>
            <div className="jo-print-sig-line" />
            <div>Prepared by</div>
          </div>
          <div className="jo-print-sig">
            <div style={{ minHeight: 14 }} />
            <div className="jo-print-sig-line" />
            <div>Approved by</div>
          </div>
          <div className="jo-print-sig">
            <div style={{ minHeight: 14 }} />
            <div className="jo-print-sig-line" />
            <div>Received by</div>
          </div>
        </div>
      </article>
    </div>
  );
}
