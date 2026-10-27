import { formatShop } from '../../utils/shopTime';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { PrinterOutlined, ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { jobPrintBackPath } from './printNavigation';
import { clientsApi, jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useShopDetails } from '../../hooks/useShopDetails';
import type { Client, JobMaterialLine, JobOrder, Operation } from '../../types';
import { PrintDocument, SignatureBlock } from './PrintTemplate';
import { jobOrderPrintBlockers } from './jobOrderPrintReadiness';
import './jobOrderPrint.css';

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

/** "Mar 18 · 9:53 AM – 1:36 PM", or both dates when it runs past the day. */
function fmtSchedule(start?: string | null, end?: string | null) {
  if (!start || !end) return '—';
  const sameDay = formatShop(start, 'YYYY-MM-DD') === formatShop(end, 'YYYY-MM-DD');
  return sameDay
    ? `${formatShop(start, 'MMM D')} · ${formatShop(start, 'h:mm A')} – ${formatShop(end, 'h:mm A')}`
    : `${formatShop(start, 'MMM D h:mm A')} – ${formatShop(end, 'MMM D h:mm A')}`;
}

const PART_STAGE_LABEL: Record<string, string> = {
  RAW_MATERIAL: 'Raw material',
  CLIENT_SUPPLIED_ITEM: 'Client supplied item',
  WORK_IN_PROCESS: 'Work in process',
  CUT: 'Cut',
  BLANK: 'Blank',
  FORMED: 'Formed',
  MACHINED: 'Machined',
  ASSEMBLED: 'Assembled',
  HEAT_TREATED: 'Heat treated',
  FINISHED: 'Finished',
};

function orDash(v?: string | number | null) {
  return v == null || v === '' ? '—' : v;
}

function crewLines(op: Operation) {
  if (op.crew && op.crew.length > 1) {
    return op.crew.map((m) => (m.isLead ? `${m.fullName} (lead)` : m.fullName));
  }
  return [op.assignedWorkerName || '—'];
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
  // Materials needed that are not on a supplier order yet.
  const toOrder = (job.plannedMaterials || []).filter(
    (p) => (p.status === 'TO_ORDER' || p.status === 'PARTLY_ORDERED') && (p.remainingQuantity ?? 1) > 0,
  );
  const quantity =
    job.quantity != null ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}` : '—';
  const blockers = jobOrderPrintBlockers(job);
  const canPrint = blockers.length === 0;
  const targetTotal = ops.reduce((sum, op) => sum + (op.estimatedHours ?? 0), 0);
  const plannedFinish = ops.reduce<string | null>(
    (latest, op) => (op.scheduledEnd && (!latest || op.scheduledEnd > latest) ? op.scheduledEnd : latest),
    null,
  );
  const preparedBy = job.createdByName || user?.fullName;
  const preparedRole = job.createdByName ? job.createdByRole : user?.role;
  const preparedTitle = preparedRole ? ROLE_TITLE[preparedRole] || null : null;

  return (
    <PrintDocument
      shop={shop}
      wide
      toolbar={
        <>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(jobPrintBackPath())}
          >
            Back
          </Button>
          {user?.role === 'ADMIN' && (
            <Button icon={<EditOutlined />} onClick={() => navigate('/settings/shop')}>
              Edit shop details
            </Button>
          )}
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            disabled={!canPrint}
            onClick={() => window.print()}
          >
            Print
          </Button>
        </>
      }
    >
      {!canPrint ? (
        <div className="no-print jo-print-blocked">
          <Alert
            type="warning"
            showIcon
            message="This job order can't be printed yet"
            description={
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            }
          />
        </div>
      ) : null}
      <div className={canPrint ? undefined : 'jo-print-hidden'}>
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
          <span className="shop-print-label">Planned finish:</span> {fmtDateTime(plannedFinish)}
        </div>
        <div>
          <span className="shop-print-label">Job type:</span>{' '}
          {orDash(job.jobType ? JOB_TYPE_LABEL[job.jobType] || job.jobType : null)}
        </div>
        <div>
          <span className="shop-print-label">Quantity:</span> {quantity}
        </div>
        {job.partCondition ? (
          <div className="shop-print-fields__full">
            <span className="shop-print-label">Stage of the part:</span>{' '}
            {PART_STAGE_LABEL[job.partCondition] || job.partCondition}
          </div>
        ) : null}
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
          <col style={{ width: '5%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '27%' }} />
          <col style={{ width: '9%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Operation</th>
            <th>Machine unit</th>
            <th>Crew</th>
            <th>Schedule</th>
            <th>Target hrs</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op) => (
            <tr key={op.id || op.sequenceNo}>
              <td className="mid">{op.sequenceNo}</td>
              <td>{orDash(op.operationName)}</td>
              <td>{op.machineUnitLabel || (op.machineTypeId ? '—' : 'No machine')}</td>
              <td>
                {crewLines(op).map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </td>
              <td>{fmtSchedule(op.scheduledStart, op.scheduledEnd)}</td>
              <td className="num">{op.estimatedHours != null ? op.estimatedHours.toFixed(2) : '—'}</td>
            </tr>
          ))}
          {ops.length > 1 ? (
            <tr className="total">
              <td colSpan={5} className="num">
                Total target hours
              </td>
              <td className="num">{targetTotal.toFixed(2)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="shop-print-section">Materials</div>
      {materials.length === 0 && toOrder.length === 0 ? (
        <div>{job.materialStatus === 'NOT_REQUIRED' ? 'Not required.' : 'Not ordered yet.'}</div>
      ) : (
        <table className="shop-print-table shop-print-table--compact">
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Material</th>
              <th>Quantity</th>
              <th>Supplier</th>
              <th>Supplier PO #</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>
                  {orDash(m.materialName)}
                  {m.gradeOrSpec ? <div className="jo-print-sub">{m.gradeOrSpec}</div> : null}
                </td>
                <td className="num">
                  {m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : '—'}
                </td>
                <td>{orDash(m.supplierName)}</td>
                <td>{m.poNumber || (m.status === 'DRAFT' ? 'Not issued' : '—')}</td>
                <td>{materialStatus(m)}</td>
              </tr>
            ))}
            {toOrder.map((p) => (
              <tr key={`plan-${p.id}`}>
                <td>
                  {orDash(p.name)}
                  {p.gradeOrSpec || p.sizeSpec ? (
                    <div className="jo-print-sub">{[p.gradeOrSpec, p.sizeSpec].filter(Boolean).join(' · ')}</div>
                  ) : null}
                </td>
                <td className="num">
                  {(p.remainingQuantity ?? p.plannedQuantity) != null
                    ? `${p.remainingQuantity ?? p.plannedQuantity}${p.unit ? ` ${p.unit}` : ''}`
                    : '—'}
                </td>
                <td>—</td>
                <td>Not issued</td>
                <td>To order</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="shop-print-signatures">
        <SignatureBlock label="Prepared by:" name={preparedBy} title={preparedTitle} />
        <SignatureBlock
          label="Approved by:"
          name={shop.joApproverName}
          title={shop.joApproverTitle}
        />
      </div>

      <div className="jo-print-stamp">
        Printed {formatShop(new Date().toISOString(), 'MMM D, YYYY h:mm A')}
        {user?.fullName ? ` by ${user.fullName}` : ''}. The schedule can change after printing; the
        system has the latest.
      </div>
      </div>
    </PrintDocument>
  );
}
