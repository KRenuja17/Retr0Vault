import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { createQueryClient } from "@/lib/api/queryClient";

import { routes } from "./routes/router";

const queryClient = createQueryClient();
const router = createBrowserRouter([...routes]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
