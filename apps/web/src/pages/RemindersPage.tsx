import { useState } from "react";
import { useReminders } from "../hooks/useReminders.js";
import { ListingRow } from "../components/ListingRow.js";
import { Reader } from "../components/Reader.js";
import { compactDeadline } from "../lib/utils.js";

export function RemindersPage() {
  const { reminders, isLoading } = useReminders();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = reminders.find((l) => l.id === selectedId) ?? reminders[0] ?? null;

  if (isLoading) {
    return <PageShell><LoadingState /></PageShell>;
  }

  if (reminders.length === 0) {
    return (
      <PageShell>
        <div className="px-4 py-10 sm:px-6">
          <h2 className="text-xl font-black">No reminders set</h2>
          <p className="mt-2 text-sm leading-6 text-em">
            Set reminders on listings so you don't miss deadlines.
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
            {reminders.map((l) => (
              <div key={l.id}>
                <div className="flex items-center justify-between border-b border-ink/8 bg-paper/60 px-4 py-1.5 sm:px-6">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-em">
                    Reminder: {compactDeadline(l.reminder.remind_at)}
                  </span>
                  {l.reminder.note ? (
                    <span className="max-w-[180px] truncate text-xs text-em">{l.reminder.note}</span>
                  ) : null}
                </div>
                <ListingRow
                  listing={l}
                  selected={selected?.id === l.id}
                  onSelect={() => setSelectedId(l.id)}
                />
              </div>
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
          <h1 className="text-xs font-black uppercase tracking-[0.14em] text-em">Reminders</h1>
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
