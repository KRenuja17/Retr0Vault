import { Navigate, type RouteObject } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { AddReferenceView } from "@/components/ingest/AddReferenceView";
import { CollectionIndex } from "@/components/collections/CollectionIndex";
import { CompareRoute } from "@/components/compare/CompareRoute";
import { DirectionRoute } from "@/components/direction/DirectionRoute";

import {
  AllRoute,
  CollectionRoute,
  DesignTypeRoute,
  NotFoundRoute,
  ReferenceRoute,
} from "./CatalogueRoute";

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
      { path: "collections", element: <CollectionIndex /> },
      { path: "collection/:slug", element: <CollectionRoute /> },
      { path: "reference/:id", element: <ReferenceRoute /> },
      /*
       * The multi-reference sheets are full pages, not layers over the
       * catalogue: their selection lives in `?refs=`, so each one survives a
       * refresh and can be linked.
       */
      { path: "compare", element: <CompareRoute /> },
      { path: "direction", element: <DirectionRoute /> },
      { path: "add", element: <AddReferenceView /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
];
