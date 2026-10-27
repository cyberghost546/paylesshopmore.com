// src/pages/Dashboard/icons.jsx
//
// The sidebar's icons, inline rather than from public/icons.svg — that sprite
// holds the footer's social logos and nothing that suits a nav.
//
// All one family: 24×24 box, no fill, 1.8 stroke, round caps. Mixing icon
// sets is what makes a sidebar look assembled rather than designed.

function Icon({ children }) {
  return (
    <svg
      className="dashboardIcon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: every one of these sits beside its own text label.
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HouseIcon() {
  return (
    <Icon>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </Icon>
  );
}

export function FileIcon() {
  return (
    <Icon>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </Icon>
  );
}

export function MailIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </Icon>
  );
}

export function BoxIcon() {
  return (
    <Icon>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </Icon>
  );
}

export function UsersIcon() {
  return (
    <Icon>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h3a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.2a4.5 4.5 0 0 1 2.5 4V20" />
    </Icon>
  );
}

export function ReceiptIcon() {
  return (
    <Icon>
      {/* A torn-off slip: the zigzag foot is what tells it apart from the
          plain document FileIcon two rows above it in the nav. */}
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21Z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Icon>
  );
}

/** The dashboard tour's "Guide" button. */
export function HelpIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
    </Icon>
  );
}

export function BookmarkIcon() {
  return (
    <Icon>
      <path d="M6 3.5h12v17l-6-4-6 4Z" />
    </Icon>
  );
}

/** Django admin, in the sidebar's account block. */
export function GearIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </Icon>
  );
}

/** Back to the public website. */
export function GlobeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z" />
    </Icon>
  );
}

/** Sign out. */
export function SignOutIcon() {
  return (
    <Icon>
      <path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" />
      <path d="m16.5 8 4 4-4 4M20.5 12H10" />
    </Icon>
  );
}

/** Three bars: the monthly report. */
export function ChartIcon() {
  return (
    <Icon>
      <path d="M4 20h16" />
      <path d="M7 16v-5" />
      <path d="M12 16V7" />
      <path d="M17 16v-8" />
    </Icon>
  );
}

/** A shield with a tick: the System page (backups, error monitoring). */
export function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}
