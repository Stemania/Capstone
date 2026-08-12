import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, message } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { SHOP_LETTERHEAD } from '../../constants/shopLetterhead';
import type { Client, JobOrder, Operation, RawMaterial } from '../../types';
import { ReportStamp, displayOrDash } from './ReportChrome';

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return dayjs(v).format('MMM D, YYYY');
}

function fmtWindow(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  const a = start ? dayjs(start).format('MMM D HH:mm') : '—';
  const b = end ? dayjs(end).format('MMM D HH:mm') : '—';
  return `${a} – ${b}`;
}

function clientContactLine(c: Client | null | undefined) {
  if (!c) return '—';
  const parts = [c.contact, c.email, c.mobileNumber].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export default function JobOrderPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobOrder | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await jobOrdersApi.get(id);
        if (cancelled) return;
        setJob(data);
        try {
          const { data: clients } = await clientsApi.list();
          if (!cancelled) {
            setClient(clients.find((c) => c.id === data.clientId) || null);
          }
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

  const ops = useMemo(
    () => [...(job?.operations || [])].sort((a, b) => a.sequenceNo - b.sequenceNo),
    [job]
  );
  const materials: RawMaterial[] = job?.rawMaterials || [];

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!job) {
    return <div style={{ padding: 24 }}>Job order not found.</div>;
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

        <h1 className="jo-print-title">Job Order</h1>

        <div className="jo-print-meta">
          <div>
            <strong>Job #</strong> {displayOrDash(job.jobNumber)}
          </div>
          <div>
            <strong>Date created</strong> {fmtDate(job.createdAt)}
          </div>
          <div>
            <strong>Client</strong> {displayOrDash(job.clientName || client?.name)}
          </div>
          <div>
            <strong>Client contact</strong> {clientContactLine(client)}
          </div>
          <div>
            <strong>Client PO #</strong> {displayOrDash(job.clientPoNumber)}
          </div>
          <div>
            <strong>PO date</strong> {fmtDate(job.poDate)}
          </div>
          <div>
            <strong>Date required</strong> {fmtDate(job.dueDate)}
          </div>
          <div>
            <strong>Job type</strong> {displayOrDash(job.jobType)}
          </div>
          <div>
            <strong>Material source</strong> {displayOrDash(job.materialSource)}
          </div>
          <div>
            <strong>Qty</strong>{' '}
            {job.quantity != null
              ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}`
              : '—'}
          </div>
        </div>

        <div className="jo-print-block">
          <strong>Title</strong>
          <div>{displayOrDash(job.title)}</div>
        </div>
        <div className="jo-print-block">
          <strong>Description</strong>
          <div>{displayOrDash(job.description)}</div>
        </div>

        <h2 className="jo-print-h2">Raw materials</h2>
        <table className="jo-print-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Qty</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr>
                <td colSpan={3}>—</td>
              </tr>
            ) : (
              materials.map((m, i) => (
                <tr key={`${m.name}-${i}`}>
                  <td>{displayOrDash(m.name)}</td>
                  <td>{m.quantity != null ? m.quantity : '—'}</td>
                  <td>{displayOrDash(m.unit)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2 className="jo-print-h2">Operations</h2>
        <table className="jo-print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operation</th>
              <th>Machine</th>
              <th>Worker</th>
              <th>Target hours</th>
              <th>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? (
              <tr>
                <td colSpan={6}>—</td>
              </tr>
            ) : (
              ops.map((op: Operation) => (
                <tr key={op.id || op.sequenceNo}>
                  <td>{op.sequenceNo}</td>
                  <td>{displayOrDash(op.operationName)}</td>
                  <td>
                    {displayOrDash(op.machineTypeName || op.machineTypeCode)}
                  </td>
                  <td>{displayOrDash(op.assignedWorkerName)}</td>
                  <td>{op.estimatedHours != null ? op.estimatedHours : '—'}</td>
                  <td>{fmtWindow(op.scheduledStart, op.scheduledEnd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="jo-print-signatures">
          <div className="jo-print-sig">
            <div className="jo-print-sig-line" />
            <div>Prepared by</div>
          </div>
          <div className="jo-print-sig">
            <div className="jo-print-sig-line" />
            <div>Approved by</div>
          </div>
          <div className="jo-print-sig">
            <div className="jo-print-sig-line" />
            <div>Received by</div>
          </div>
        </div>
      </article>
    </div>
  );
}
