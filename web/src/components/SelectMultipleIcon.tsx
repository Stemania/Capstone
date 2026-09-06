/** Stacked checkboxes — select-multiple affordance. */
export default function SelectMultipleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="7.5"
        y="3.5"
        width="13"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="3.5"
        y="7.5"
        width="13"
        height="13"
        rx="2.5"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M7.25 14.1l2.1 2.1 4.4-4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
