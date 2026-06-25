import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReminders } from "../hooks/useReminders.js";
import { daysUntil, toDatetimeLocal } from "../lib/utils.js";
import type { Listing } from "@rue/shared";

interface Props {
  listing: Listing;
  onClose: () => void;
}

export function ReminderDialog({ listing, onClose }: Props) {
  const { getReminder, upsert, remove } = useReminders();
  const existing = getReminder(listing.id);

  const defaultDate = useMemo(() => {
    if (listing.deadline) {
      const days = daysUntil(listing.deadline);
      if (days !== null && days > 4) {
        const d = new Date(listing.deadline);
        d.setDate(d.getDate() - 3);
        return d;
      }
      if (days !== null && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d;
      }
    }
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }, [listing.deadline]);

  const [remindAt, setRemindAt] = useState(
    existing ? toDatetimeLocal(new Date(existing.remind_at)) : toDatetimeLocal(defaultDate),
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    upsert({ listingId: listing.id, remindAt: new Date(remindAt).toISOString(), note: note || undefined });
    onClose();
  }

  function handleDelete() {
    remove(listing.id);
    onClose();
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(13,13,12,0.4)" }}
      onClick={handleOverlayClick}
    >
      <div className="w-full max-w-md border border-ink/20 bg-paper">
        <div className="border-b border-ink/15 px-5 py-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-em">
            {listing.org_name}
          </p>
          <h2 className="mt-1 text-base font-black leading-tight">{listing.title}</h2>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-5">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-em">
              Remind me on
            </span>
            <input
              type="datetime-local"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
              required
              className="mt-2 h-11 w-full border border-ink/20 bg-paper px-3 text-sm font-medium outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-em">
              Note (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why you saved this, what to check..."
              className="mt-2 w-full resize-none border border-ink/20 bg-paper px-3 py-2 text-sm font-medium outline-none focus:border-ink"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex h-10 flex-1 items-center justify-center border border-ink bg-ink text-sm font-black text-paper"
            >
              Save reminder
            </button>
            {existing && (
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-10 items-center justify-center border border-ink/20 px-4 text-sm font-black hover:border-ink"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 items-center justify-center border border-ink/20 px-4 text-sm font-black hover:border-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
