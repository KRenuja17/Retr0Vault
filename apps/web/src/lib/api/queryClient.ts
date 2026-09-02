import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client";

/**
 * Local-first defaults: the API is a process on this machine, so data is cheap
 * to re-read but there is no point retrying a 4xx or a dead port more than once.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry(failureCount, error) {
          if (error instanceof ApiError) {
            if (error.isOffline) {
              return failureCount < 1;
            }
            if (error.statusCode >= 400 && error.statusCode < 500) {
              return false;
            }
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
