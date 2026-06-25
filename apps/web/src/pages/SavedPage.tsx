import { useState } from "react";
import { useBookmarks } from "../hooks/useBookmarks.js";
import { ListingRow } from "../components/ListingRow.js";
import { Reader } from "../components/Reader.js";

export function SavedPage() {
  const { bookmarks, isLoading } = useBookmarks();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = bookmarks.find((l) => l.id === selectedId) ?? bookmarks[0] ?? null;

  if (isLoading) {
    return <PageShell><LoadingState /></PageShell>;
  }

  if (bookmarks.length === 0) {
    return (
      <PageShell>
        <div className="px-4 py-10 sm:px-6">
          <h2 className="text-xl font-black">No saved listings</h2>
          <p className="mt-2 text-sm leading-6 text-em">
            Bookmark listings from Discover and they'll appear here.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[minmax(340px,30%)_minmax(0,1fr)]">
        <section className="border-b border-ink/15 lg:min-h-[calc(100vh-49px)] lg:border-b-0 lg:border-r">
          <div className="divide-y divide-ink/10">
            {bookmarks.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                selected={selected?.id === l.id}
                onSelect={() => setSelectedId(l.id)}
              />
            ))}
          </div>
        </section>
        <section className="min-w-0">{selected ? <Reader listing={selected} /> : null}</section>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-ink/15 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-[1500px]">
          <h1 className="text-xs font-black uppercase tracking-[0.14em] text-em">Saved listings</h1>
        </div>
      </div>
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="px-4 py-10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-em">Loading</p>
    </div>
  );
}
