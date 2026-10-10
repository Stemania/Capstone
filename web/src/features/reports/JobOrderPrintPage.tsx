import { formatShop } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Button, Spin, message } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useShopDetails } from '../../hooks/useShopDetails';
import type { Client, JobMaterialLine, JobOrder, Operation } from '../../types';
import { PrintDocument, SignatureBlock } from './PrintTemplate';

const JOB_TYPE_LABEL: Record<string, string> = {
  FABRICATION: 'Fabrication',
  MODIFICATION: 'Modification',
  REPAIR: 'Repair',
};

const MATERIAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'On draft PO',
  ORDERED: 'Ordered',
  RECEIVED: 'Received',
  CONSUMED: 'Consumed',
};

const ROLE_TITLE: Record<string, string> = {
  ADMIN: 'Administrator',
  OFFICE_STAFF: 'Office Staff',
  PRODUCTION_WORKER: 'Production Worker',
};

function fmtDate(v?: string | null) {
  return v ? formatShop(v, 'MMMM D, YYYY') : '—';
}

function fmtDateTime(v?: string | null) {
  return v ? formatShop(v, 'MMM D, YYYY h:mm A') : '—';
}

function orDash(v?: string | number | null) {
  return v == null || v === '' ? '—' : v;
}

function crewText(op: Operation) {
  if (op.crew && op.crew.length > 1) {
    return op.crew.map((m) => (m.isLead ? `${m.fullName} (lead)` : m.fullName)).join(', ');
  }
  return orDash(op.assignedWorkerName);
}

function materialStatus(line: JobMaterialLine) {
  if (line.dateReceived && line.status !== 'CONSUMED') return 'Received';
  return MATERIAL_STATUS_LABEL[line.status] || line.status;
}

export default function JobOrderPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const shop = useShopDetails();
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
        if (!data.clientName) {
          try {
            const { data: clients } = await clientsApi.list();
            if (!cancelled) setClient(clients.find((c) => c.id === data.clientId) || null);
          } catch {
            if (!cancelled) setClient(null);
          }
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

  const materials = job.materialLines || [];
  const quantity =
    job.quantity != null ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}` : '—';

  return (
    <PrintDocument
      shop={shop}
      wide
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
        <h1 className="shop-print-doc-title">JOB ORDER</h1>
        <div className="shop-print-doc-ref">JO # {orDash(job.jobNumber)}</div>
        <div className="shop-print-doc-ref">
          <span className="shop-print-label">DATE</span> {fmtDate(job.createdAt)}
        </div>
      </div>

      <div className="shop-print-fields">
        <div>
          <span className="shop-print-label">Client:</span>{' '}
          {orDash(job.clientName || client?.name)}
        </div>
        <div>
          <span className="shop-print-label">Date required:</span> {fmtDate(job.dueDate)}
        </div>
        <div>
          <span className="shop-print-label">Client PO #:</span> {orDash(job.clientPoNumber)}
        </div>
        <div>
          <span className="shop-print-label">PO date:</span> {fmtDate(job.poDate)}
        </div>
        <div>
          <span className="shop-print-label">Job type:</span>{' '}
          {orDash(job.jobType ? JOB_TYPE_LABEL[job.jobType] || job.jobType : null)}
        </div>
        <div>
          <span className="shop-print-label">Quantity:</span> {quantity}
        </div>
        <div className="shop-print-fields__full">
          <span className="shop-print-label">Title:</span> {orDash(job.title)}
        </div>
        <div className="shop-print-fields__full" style={{ whiteSpace: 'pre-wrap' }}>
          <span className="shop-print-label">Description:</span> {orDash(job.description)}
        </div>
      </div>

      <div className="shop-print-section">Operations</div>
      <table className="shop-print-table shop-print-table--compact">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '22%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Operation</th>
            <th>Machine unit</th>
            <th>Crew</th>
            <th>Scheduled start</th>
            <th>Scheduled end</th>
            <th>Target hours</th>
            <th>Instructions</th>
          </tr>
        </thead>
        <tbody>
          {ops.length === 0 ? (
            <tr>
              <td colSpan={8}>No operations planned yet.</td>
            </tr>
          ) : (
            ops.map((op) => (
              <tr key={op.id || op.sequenceNo}>
                <td className="mid">{op.sequenceNo}</td>
                <td>{orDash(op.operationName)}</td>
                <td>{orDash(op.machineUnitLabel || op.machineTypeName || op.machineTypeCode)}</td>
                <td>{crewText(op)}</td>
                <td>{fmtDateTime(op.scheduledStart)}</td>
                <td>{fmtDateTime(op.scheduledEnd)}</td>
                <td className="num">{orDash(op.estimatedHours)}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{op.notes?.trim() || ''}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="shop-print-section">Materials</div>
      {materials.length === 0 ? (
        <div>
          {job.materialStatus === 'NOT_REQUIRED'
            ? 'Not required (client-supplied or from stock).'
            : 'Not ordered yet.'}
        </div>
      ) : (
        <table className="shop-print-table shop-print-table--compact">
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Material</th>
              <th>Grade</th>
              <th>Quantity</th>
              <th>UOM</th>
              <th>Supplier</th>
              <th>PO #</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>{orDash(m.materialName)}</td>
                <td>{orDash(m.gradeOrSpec)}</td>
                <td className="num">{orDash(m.quantity)}</td>
                <td className="mid">{orDash(m.unit)}</td>
                <td>{orDash(m.supplierName)}</td>
                <td>{m.poNumber || (m.status === 'DRAFT' ? 'Not issued' : '—')}</td>
                <td>{materialStatus(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="shop-print-signatures">
        <SignatureBlock
          label="Prepared by:"
          name={user?.fullName}
          title={user ? ROLE_TITLE[user.role] : null}
        />
        <SignatureBlock
          label="Approved by:"
          name={shop.joApproverName}
          title={shop.joApproverTitle}
        />
      </div>
    </PrintDocument>
  );
}
