import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthSession } from "../lib/auth-client.js";
import type { Listing } from "@rue/shared";

async function apiFetch(path: string, method = "GET") {
  const res = await fetch(path, { method });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json();
}

export function useBookmarks() {
  const { isAuthenticated } = useAuthSession();
  const queryClient = useQueryClient();

  const query = useQuery<Listing[]>({
    queryKey: ["bookmarks"],
    queryFn: () => apiFetch("/api/me/bookmarks"),
    enabled: isAuthenticated,
  });

  const bookmarkedIds = useMemo(
    () => new Set(query.data?.map((l) => l.id) ?? []),
    [query.data],
  );

  const mutation = useMutation({
    mutationFn: async ({ listing, add }: { listing: Listing; add: boolean }) => {
      await apiFetch(`/api/listings/${listing.id}/bookmark`, add ? "POST" : "DELETE");
    },
    onMutate: async ({ listing, add }) => {
      await queryClient.cancelQueries({ queryKey: ["bookmarks"] });
      const prev = queryClient.getQueryData<Listing[]>(["bookmarks"]);
      queryClient.setQueryData<Listing[]>(["bookmarks"], (old = []) =>
        add ? [...old, listing] : old.filter((l) => l.id !== listing.id),
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(["bookmarks"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });

  return {
    bookmarks: query.data ?? [],
    bookmarkedIds,
    isBookmarked: (id: string) => bookmarkedIds.has(id),
    toggle: (listing: Listing) => {
      const add = !bookmarkedIds.has(listing.id);
      mutation.mutate({ listing, add });
    },
    isLoading: query.isLoading,
  };
}
