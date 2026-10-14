import { Link } from 'react-router-dom';
import './LoginPage.css';

const CONTACT_EMAIL = 'acibojanvie110@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <div className="login-page login-page--scroll">
      <div className="login-page__bg" aria-hidden />
      <div className="login-page__veil" aria-hidden />
      <div className="login-card login-card--wide">
        <div className="login-card__header">
          <img className="login-card__logo" src="/logo.png" alt="Brothers Machine Shop logo" />
          <div className="login-card__brand">Brothers Machine Shop</div>
          <div className="login-card__subtitle">Production Scheduling System</div>
        </div>
        <div className="login-card__body privacy-policy">
          <h1 className="login-card__title">
            Privacy Policy – Brothers Machine Shop Production Scheduling System
          </h1>

          <h2>What we collect</h2>
          <ul>
            <li>User account details of shop staff (name, email, mobile number, and role).</li>
            <li>Client names, email addresses, and mobile numbers.</li>
            <li>Job order and production records.</li>
          </ul>

          <h2>Why we collect it</h2>
          <p>
            We use this information to schedule work, monitor production, and send clients
            job-status updates by email or SMS.
          </p>

          <h2>How we store and share it</h2>
          <p>
            Data is stored in a secured cloud database. We do not sell it or share it with anyone,
            except our email provider (Gmail) and SMS provider (UniSMS), and only so they can
            deliver notifications.
          </p>

          <h2>Your choices</h2>
          <p>
            Clients can ask to stop receiving updates, or to have their contact details removed, by
            contacting the shop.
          </p>

          <h2>Data Privacy Act</h2>
          <p>
            We handle personal information in compliance with the Data Privacy Act of 2012
            (Republic Act No. 10173).
          </p>

          <h2>Contact</h2>
          <p>
            For privacy questions or requests, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <p className="privacy-policy__back">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
