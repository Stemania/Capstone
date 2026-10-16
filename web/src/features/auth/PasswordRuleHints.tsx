/** Live checklist for the set/reset password forms. Display only — does not
 * change server rules. "Not a common password" is left to the field error. */

export function passwordHintState(password: string) {
  const value = password || '';
  return {
    length: value.length >= 8,
    mix:
      /[A-Za-z]/.test(value) &&
      (/[0-9]/.test(value) || /[^A-Za-z0-9]/.test(value)),
  };
}

export default function PasswordRuleHints({ password }: { password: string }) {
  const { length, mix } = passwordHintState(password);
  return (
    <ul className="password-hints" aria-live="polite">
      <li className={length ? 'is-met' : undefined}>8+ characters</li>
      <li className={mix ? 'is-met' : undefined}>Letter + number or symbol</li>
    </ul>
  );
}
