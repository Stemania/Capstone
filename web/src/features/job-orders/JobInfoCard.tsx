import { useState } from 'react';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { formatShop, shopToday, toShopDayjs } from '../../utils/shopTime';
import type { JobOrder } from '../../types';

function enumLabel(v?: string | null) {
  return v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—';
}

function dueHint(dueDate: string) {
  const days = toShopDayjs(dueDate).startOf('day').diff(shopToday().startOf('day'), 'day');
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, late: true };
  if (days === 0) return { text: 'Due today', late: false };
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, late: false };
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

/** Read-only summary of what Office Staff entered on the job order. */
export default function JobInfoCard({ job }: { job: JobOrder }) {
  const [open, setOpen] = useState(true);
  const due = job.dueDate ? dueHint(job.dueDate) : null;
  const materials = (job.rawMaterials || []).filter((m) => m.name?.trim());
  const description = job.description?.trim();
  const entered = job.createdAt
    ? `Entered${job.createdByName ? ` by ${job.createdByName}` : ''} · ${formatShop(job.createdAt, 'MMM D, YYYY')}`
    : null;

  const facts: { label: string; value: string; hint?: { text: string; late: boolean } | null }[] = [
    {
      label: 'Date required',
      value: job.dueDate ? formatShop(job.dueDate, 'MMM D, YYYY') : '—',
      hint: due,
    },
    {
      label: 'Quantity',
      value:
        job.quantity != null
          ? `${job.quantity}${job.unitOfMeasure ? ` ${job.unitOfMeasure}` : ''}`
          : '—',
    },
    { label: 'Amount', value: job.amount != null ? peso.format(job.amount) : '—' },
    {
      label: 'Client PO #',
      value: job.clientPoNumber || '—',
      hint: job.poDate ? { text: `PO date ${formatShop(job.poDate, 'MMM D, YYYY')}`, late: false } : null,
    },
  ];

  return (
    <section className={`jo-info${open ? '' : ' is-collapsed'}`} aria-label="Job information">
      <header className="jo-info__head">
        <div className="jo-info__heading">
          <div className="jo-info__tags">
            {job.jobType ? <span className="jo-info__tag">{enumLabel(job.jobType)}</span> : null}
          </div>
          <h2 className="jo-info__title">{job.title}</h2>
          <div className="jo-info__meta">
            <span className="jo-info__client">{job.clientName || 'No client'}</span>
            {!open && job.dueDate ? <span>Due {formatShop(job.dueDate, 'MMM D, YYYY')}</span> : null}
            {entered ? <span>{entered}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="jo-info__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide details' : 'Show details'} {open ? <UpOutlined /> : <DownOutlined />}
        </button>
      </header>

      {open ? (
        <>
          <dl className="jo-info__facts">
            {facts.map((f) => (
              <div key={f.label} className="jo-info__fact">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
                {f.hint ? (
                  <div className={`jo-info__hint${f.hint.late ? ' is-late' : ''}`}>{f.hint.text}</div>
                ) : null}
              </div>
            ))}
          </dl>

          <div className="jo-info__body">
            <div className="jo-info__block">
              <div className="jo-info__label">Description</div>
              {description ? (
                <p className="jo-info__desc">{description}</p>
              ) : (
                <p className="jo-info__empty">No description</p>
              )}
            </div>
            <div className="jo-info__block">
              <div className="jo-info__label">
                Raw materials{materials.length ? ` (${materials.length})` : ''}
              </div>
              {materials.length ? (
                <ul className="jo-info__materials">
                  {materials.map((m, i) => (
                    <li key={m.id || `${m.name}-${i}`}>
                      <span className="jo-info__mat-name">{m.name}</span>
                      <span className="jo-info__mat-qty">
                        {m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : '—'}
                      </span>
                      {m.fromStock ? <span className="jo-info__stock">In stock</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="jo-info__empty">No raw materials listed</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
