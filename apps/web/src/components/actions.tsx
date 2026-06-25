import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthSession } from "../lib/auth-client.js";
import { useBookmarks } from "../hooks/useBookmarks.js";
import { useReminders } from "../hooks/useReminders.js";
import { useToast } from "../lib/toast.js";
import { BookmarkIcon, BellIcon, ShareIcon } from "./icons.js";
import { ReminderDialog } from "./ReminderDialog.js";
import type { Listing } from "@rue/shared";

type Variant = "row" | "detail";

interface ActionButtonProps {
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  selected?: boolean;
  title: string;
  variant?: Variant;
  children: React.ReactNode;
}

function ActionButton({ onClick, active, selected, title, variant = "row", children }: ActionButtonProps) {
  const size = variant === "row" ? "h-6 w-6" : "h-9 w-9";
  const activeClass = active
    ? selected
      ? "border-paper/70 bg-paper/10"
      : "border-ink bg-ink text-paper"
    : "border-current/25 opacity-50 hover:opacity-100";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center border p-1 transition-opacity ${size} ${activeClass}`}
    >
      {children}
    </button>
  );
}

interface Props {
  listing: Listing;
  selected?: boolean;
  variant?: Variant;
}

export function BookmarkButton({ listing, selected, variant = "row" }: Props) {
  const { isAuthenticated } = useAuthSession();
  const { isBookmarked, toggle } = useBookmarks();
  const navigate = useNavigate();
  const active = isBookmarked(listing.id);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAuthenticated) {
      navigate(`/signin?from=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    toggle(listing);
  }

  return (
    <ActionButton
      onClick={handleClick}
      active={active}
      selected={selected}
      title={active ? "Remove bookmark" : "Bookmark"}
      variant={variant}
    >
      <BookmarkIcon filled={active} />
    </ActionButton>
  );
}

export function ReminderButton({ listing, selected, variant = "row" }: Props) {
  const { isAuthenticated } = useAuthSession();
  const { hasReminder } = useReminders();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const active = hasReminder(listing.id);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAuthenticated) {
      navigate(`/signin?from=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <ActionButton
        onClick={handleClick}
        active={active}
        selected={selected}
        title={active ? "Edit reminder" : "Set reminder"}
        variant={variant}
      >
        <BellIcon filled={active} />
      </ActionButton>
      {open && <ReminderDialog listing={listing} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShareButton({ listing, selected, variant = "row" }: Props) {
  const { show } = useToast();

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `${window.location.origin}/listing/${listing.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: listing.title, url });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    show("Link copied");
  }

  return (
    <ActionButton onClick={handleClick} selected={selected} title="Share" variant={variant}>
      <ShareIcon />
    </ActionButton>
  );
}
