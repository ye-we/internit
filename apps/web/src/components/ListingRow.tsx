import type { Listing } from "@rue/shared";
import { daysUntil, daysLabel, compactDeadline, payLabel } from "../lib/utils.js";
import { BookmarkButton, ReminderButton, ShareButton } from "./actions.js";

interface Props {
  listing: Listing;
  selected: boolean;
  onSelect: () => void;
}

export function ListingRow({ listing, selected, onSelect }: Props) {
  const days = daysUntil(listing.deadline);

  return (
    <div
      className={`w-full px-4 py-3 text-left sm:px-6 ${
        selected ? "bg-ink text-paper" : "hover:bg-ink/[0.04]"
      } ${listing.status !== "active" && !selected ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="grid w-full grid-cols-[1fr_auto] gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`shrink-0 text-[11px] font-black uppercase tracking-[0.12em] ${
                selected ? "text-paper/70" : "text-em"
              }`}
            >
              {listing.source}
            </span>
            <span className={selected ? "text-paper/35" : "text-ink/25"}>/</span>
            <span
              className={`truncate text-xs font-medium ${selected ? "text-paper/75" : "text-em"}`}
            >
              {listing.org_name}
            </span>
          </div>

          <h2 className="mt-1 truncate text-[15px] font-black leading-5 sm:text-base">
            {listing.title}
          </h2>

          <div
            className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
              selected ? "text-paper/75" : "text-em"
            }`}
          >
            <span>{compactDeadline(listing.deadline)}</span>
            <span>{listing.location ?? "Location unclear"}</span>
            <span>{payLabel(listing.is_paid)}</span>
            {listing.status !== "active" ? <span>{listing.status}</span> : null}
          </div>
        </div>

        <div className="grid justify-items-end gap-1.5">
          <span className="border border-current px-2 py-1 text-xs font-black leading-none">
            {listing.fit_score}
          </span>
          <span
            className={`text-xs font-black ${
              days !== null && days <= 7
                ? selected
                  ? "text-paper"
                  : "text-ink"
                : selected
                  ? "text-paper/60"
                  : "text-em"
            }`}
          >
            {daysLabel(days)}
          </span>
        </div>
      </button>

      <div
        className={`mt-2 flex items-center gap-1.5 border-t pt-2 ${
          selected ? "border-paper/10" : "border-ink/8"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <BookmarkButton listing={listing} selected={selected} />
        <ReminderButton listing={listing} selected={selected} />
        <ShareButton listing={listing} selected={selected} />
      </div>
    </div>
  );
}
