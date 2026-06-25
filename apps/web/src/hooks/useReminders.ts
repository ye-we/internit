import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthSession } from "../lib/auth-client.js";
import type { Listing } from "@rue/shared";

export type ReminderMeta = {
  id: string;
  remind_at: string;
  note: string | null;
};

export type ListingWithReminder = Listing & { reminder: ReminderMeta };

async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json();
}

export function useReminders() {
  const { isAuthenticated } = useAuthSession();
  const queryClient = useQueryClient();

  const query = useQuery<ListingWithReminder[]>({
    queryKey: ["reminders"],
    queryFn: () => apiFetch("/api/me/reminders"),
    enabled: isAuthenticated,
  });

  const reminderMap = useMemo(() => {
    const map = new Map<string, ReminderMeta>();
    for (const item of query.data ?? []) {
      map.set(item.id, item.reminder);
    }
    return map;
  }, [query.data]);

  const upsertMutation = useMutation({
    mutationFn: ({ listingId, remindAt, note }: { listingId: string; remindAt: string; note?: string }) =>
      apiFetch(`/api/listings/${listingId}/reminder`, "POST", { remind_at: remindAt, note }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (listingId: string) =>
      apiFetch(`/api/listings/${listingId}/reminder`, "DELETE"),
    onMutate: async (listingId) => {
      await queryClient.cancelQueries({ queryKey: ["reminders"] });
      const prev = queryClient.getQueryData<ListingWithReminder[]>(["reminders"]);
      queryClient.setQueryData<ListingWithReminder[]>(["reminders"], (old = []) =>
        old.filter((l) => l.id !== listingId),
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(["reminders"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["reminders"] }),
  });

  return {
    reminders: query.data ?? [],
    reminderMap,
    hasReminder: (id: string) => reminderMap.has(id),
    getReminder: (id: string) => reminderMap.get(id),
    upsert: upsertMutation.mutate,
    remove: removeMutation.mutate,
    isLoading: query.isLoading,
  };
}
