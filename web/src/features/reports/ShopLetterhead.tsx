import type { ShopDetails } from '../../api/shopDetails.api';
import { shopContactLine } from '../../constants/shopLetterhead';

/** Printout letterhead from the Admin's shop details. */
export function ShopLetterhead({ details }: { details: ShopDetails }) {
  const contact = shopContactLine(details);
  return (
    <header className="jo-print-letterhead">
      <div className="jo-print-shop-name">{details.shopName}</div>
      {details.tagline ? <div className="jo-print-shop-line">{details.tagline}</div> : null}
      {details.address ? <div className="jo-print-shop-line">{details.address}</div> : null}
      {contact ? <div className="jo-print-shop-line">{contact}</div> : null}
    </header>
  );
}

/** Signature block with the approver's name over the line and title under it. */
export function ApproverSignature({ name, title }: { name?: string; title?: string }) {
  return (
    <div className="jo-print-sig">
      <div style={{ minHeight: 14, fontWeight: 600 }}>{name || ''}</div>
      <div className="jo-print-sig-line" />
      <div>Approved by</div>
      {title ? <div style={{ fontSize: 11, color: '#475569' }}>{title}</div> : null}
    </div>
  );
}
