export function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-full w-full"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d="M3 1.5h10v13l-5-3.25L3 14.5V1.5z" />
    </svg>
  );
}

export function BellIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-full w-full"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.25L2 10.5h12l-1.5-2.25V6A4.5 4.5 0 0 0 8 1.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" fill="none" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5V10M5 4.5l3-3 3 3M3 9.5v5h10v-5" />
    </svg>
  );
}
