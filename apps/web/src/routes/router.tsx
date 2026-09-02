import { Navigate, type RouteObject } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";

import {
  AllRoute,
  CollectionRoute,
  DesignTypeRoute,
  NotFoundRoute,
  ReferenceRoute,
} from "./CatalogueRoute";
import { FoundationRoute } from "./FoundationRoute";

/**
 * Route shell for Retr0Vault. `/reference/:id` is a sibling of the catalogue
 * so a reference stays linkable; the modal presentation is layered over it in
 * the phase that builds the detail view.
 */
export const routes: readonly RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/all" replace /> },
      { path: "all", element: <AllRoute /> },
      { path: "type/:slug", element: <DesignTypeRoute /> },
      { path: "collection/:slug", element: <CollectionRoute /> },
      { path: "reference/:id", element: <ReferenceRoute /> },
      { path: "foundation", element: <FoundationRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
];
