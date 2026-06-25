import type { Org } from "@rue/shared";

interface Props {
  org: Org;
  selected: boolean;
  onSelect: () => void;
}

export function OrgRow({ org, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left sm:px-6 ${
        selected ? "bg-ink text-paper" : "hover:bg-ink/[0.04]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 text-[11px] font-black uppercase tracking-[0.12em] ${
              selected ? "text-paper/70" : "text-em"
            }`}
          >
            {org.category}
          </span>
          <span className={selected ? "text-paper/35" : "text-ink/25"}>/</span>
          <span
            className={`truncate text-xs font-medium ${selected ? "text-paper/75" : "text-em"}`}
          >
            {org.region ?? "global"}
          </span>
        </div>
        <h2 className="mt-1 truncate text-[15px] font-black leading-5 sm:text-base">{org.name}</h2>
        <div
          className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
            selected ? "text-paper/75" : "text-em"
          }`}
        >
          <span>posts {org.posts_publicly}</span>
          <span>{remoteLabel(org.has_remote)}</span>
          <span>{paidOrgLabel(org.has_paid)}</span>
        </div>
      </div>
      <div className="grid justify-items-end gap-1.5">
        <span className="border border-current px-2 py-1 text-xs font-black leading-none">
          {org.scrape_priority ?? "-"}
        </span>
        <span className={`text-xs font-black ${selected ? "text-paper/60" : "text-em"}`}>
          {org.addis_office === true ? "Addis" : org.addis_office === false ? "No office" : "-"}
        </span>
      </div>
    </button>
  );
}

function remoteLabel(value: Org["has_remote"]): string {
  if (value === "yes") return "remote";
  if (value === "sometimes") return "some remote";
  if (value === "no") return "not remote";
  return "remote unclear";
}

function paidOrgLabel(value: Org["has_paid"]): string {
  if (value === "yes") return "paid";
  if (value === "sometimes") return "sometimes paid";
  if (value === "no") return "unpaid";
  return "pay unclear";
}
