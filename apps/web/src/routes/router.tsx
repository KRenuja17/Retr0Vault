import type { RouteObject } from "react-router-dom";

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
import { LoginRoute } from "./LoginRoute";
import { MotionRoute, MotionStudyRoute } from "./MotionRoute";
import { FrontDoorRoute, RequireSession, RootLayout } from "./RootLayout";

/**
 * Route shell for Retr0Vault.
 *
 * `/` is the front door and `/login` the strong room behind it; both are open
 * to anyone. Every other room needs a session. `/reference/:id` is a sibling
 * of the catalogue so a reference stays linkable, with its sheet layered over
 * the catalogue it was opened from.
 */
export const routes: readonly RouteObject[] = [
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <FrontDoorRoute /> },
      { path: "login", element: <LoginRoute /> },
      {
        element: (
          <RequireSession>
            <AppShell />
          </RequireSession>
        ),
        children: [
          { path: "all", element: <AllRoute /> },
          { path: "type/:slug", element: <DesignTypeRoute /> },
          { path: "collections", element: <CollectionIndex /> },
          { path: "collection/:slug", element: <CollectionRoute /> },
          { path: "reference/:id", element: <ReferenceRoute /> },
          /*
           * The Motion section: recordings of references that are also in the
           * catalogue, studied for how the site moves. The sheet is layered over
           * the Motion grid exactly as a reference sheet is over the catalogue.
           */
          { path: "motion", element: <MotionRoute /> },
          { path: "motion/:referenceId", element: <MotionStudyRoute /> },
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
    ],
  },
];
