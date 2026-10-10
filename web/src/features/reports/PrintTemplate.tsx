import type { ReactNode } from 'react';
import type { ShopDetails } from '../../api/shopDetails.api';

const BAR_SEGMENTS = ['gold', 'black', 'gold', 'black'] as const;

function ShopBar() {
  return (
    <div className="shop-print-bar" aria-hidden>
      {BAR_SEGMENTS.map((tone, i) => (
        <span key={i} className={`shop-print-bar__seg shop-print-bar__seg--${tone}`} />
      ))}
    </div>
  );
}

function PrintHeader({ shop }: { shop: ShopDetails }) {
  return (
    <header className="shop-print-header">
      <div className="shop-print-header__row">
        <img className="shop-print-logo" src="/logo.png" alt="" />
        <div className="shop-print-header__text">
          <div className="shop-print-name">{shop.shopName}</div>
          {shop.tagline ? <div className="shop-print-tagline">{shop.tagline}</div> : null}
        </div>
      </div>
      <ShopBar />
    </header>
  );
}

function PrintFooter({ shop }: { shop: ShopDetails }) {
  const contacts = [
    shop.telephone && `Telephone no. ${shop.telephone}`,
    shop.mobileNumbers && `Mobile No: ${shop.mobileNumbers}`,
    shop.email && `Email add: ${shop.email}`,
  ].filter(Boolean) as string[];
  return (
    <footer className="shop-print-footer">
      <ShopBar />
      {shop.address ? <div className="shop-print-address">{shop.address}</div> : null}
      {contacts.length ? (
        <div className="shop-print-contacts">
          {contacts.map((c, i) => (
            <span key={c}>
              {i > 0 ? <span className="shop-print-sep"> - </span> : null}
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

/**
 * A Letter-size printout on the shop's template. The header and footer are
 * fixed when printing, so the browser repeats them on every page; the empty
 * table head and foot keep page content clear of them.
 */
export function PrintDocument({
  shop,
  toolbar,
  wide,
  children,
}: {
  shop: ShopDetails;
  toolbar: ReactNode;
  /** Narrower side margins for wide tables. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="shop-print-page">
      <div className="no-print shop-print-toolbar">{toolbar}</div>
      <div className="shop-print-sheet">
        <PrintHeader shop={shop} />
        <table className="shop-print-frame">
          <thead>
            <tr>
              <td>
                <div className="shop-print-header-space" />
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td>
                <div className="shop-print-footer-space" />
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
                <main className={`shop-print-body${wide ? ' shop-print-body--wide' : ''}`}>
                  {children}
                </main>
              </td>
            </tr>
          </tbody>
        </table>
        <PrintFooter shop={shop} />
      </div>
    </div>
  );
}

/** Signature space, the name in bold and the title under it. */
export function SignatureBlock({
  label,
  name,
  title,
}: {
  label: string;
  name?: string | null;
  title?: string | null;
}) {
  return (
    <div className="shop-print-signature">
      <div>{label}</div>
      <div className="shop-print-signature__space" />
      <div className="shop-print-signature__name">{name || '\u00a0'}</div>
      {title ? <div>{title}</div> : null}
    </div>
  );
}
