import { Typography } from 'antd';
import type { JobOrder } from '../../types';
import './bookletGuide.css';

const { Text } = Typography;

function peso(v: number | null | undefined) {
  return v == null
    ? '—'
    : v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * What to write on the shop's BIR-registered sales invoice booklet, filled in
 * from the job order. Read-only: the system never issues the invoice itself.
 */
export default function BookletGuide({
  job,
}: {
  job: Pick<JobOrder, 'clientName' | 'quantity' | 'unitOfMeasure' | 'title' | 'amount' | 'clientPoNumber' | 'jobNumber'>;
}) {
  const qty = job.quantity && job.quantity > 0 ? job.quantity : 1;
  const unit = job.quantity && job.quantity > 0 ? job.unitOfMeasure || 'pcs' : 'lot';
  const unitPrice = job.amount != null ? Math.round((job.amount / qty) * 100) / 100 : null;
  const copy = (v: string | number | null | undefined) =>
    v == null || v === '' ? { text: '' } : { text: String(v) };

  return (
    <div className="bk-guide" aria-label="Copy to the sales invoice booklet">
      <div className="bk-guide__head">
        <strong>Copy to the booklet</strong>
        <span>Write these on the sales invoice, then enter its red number below.</span>
      </div>
      <div className="bk-guide__sheet">
        <div className="bk-guide__line">
          <span className="bk-guide__label">Sold to</span>
          <Text className="bk-guide__val" copyable={copy(job.clientName)}>
            {job.clientName || '—'}
          </Text>
        </div>
        <table className="bk-guide__table">
          <thead>
            <tr>
              <th>Qty</th>
              <th>Unit</th>
              <th>Articles</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="num">{qty}</td>
              <td>{unit}</td>
              <td>
                <Text copyable={copy(job.title)}>{job.title}</Text>
                {job.clientPoNumber ? <div className="bk-guide__ref">Ref. PO {job.clientPoNumber}</div> : null}
              </td>
              <td className="num">
                <Text copyable={copy(unitPrice != null ? unitPrice.toFixed(2) : null)}>{peso(unitPrice)}</Text>
              </td>
              <td className="num">
                <Text copyable={copy(job.amount != null ? job.amount.toFixed(2) : null)}>{peso(job.amount)}</Text>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="num">
                Total amount due
              </td>
              <td className="num">
                <strong>₱{peso(job.amount)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
        <div className="bk-guide__note">
          From {job.jobNumber || 'the job order'}. TIN, address, terms and the VAT lines are filled in on
          the booklet as usual.
        </div>
      </div>
    </div>
  );
}
