import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const designTypes = sqliteTable(
  "design_types",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    deployFor: text("deploy_for").notNull(),
    risk: text("risk").notNull(),
    briefBlock: text("brief_block").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("design_types_slug_unique").on(table.slug),
    index("design_types_sort_order_index").on(table.sortOrder),
    check("design_types_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const designTypeRules = sqliteTable(
  "design_type_rules",
  {
    id: text("id").primaryKey(),
    designTypeId: text("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["principle", "avoid"] }).notNull(),
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_rules_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_rules_order_unique").on(
      table.designTypeId,
      table.kind,
      table.sortOrder,
    ),
    check(
      "design_type_rules_kind_check",
      sql`${table.kind} in ('principle', 'avoid')`,
    ),
    check(
      "design_type_rules_text_nonempty",
      sql`length(trim(${table.text})) > 0`,
    ),
    check(
      "design_type_rules_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const designTypeVocabulary = sqliteTable(
  "design_type_vocabulary",
  {
    id: text("id").primaryKey(),
    designTypeId: text("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_vocabulary_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_vocabulary_order_unique").on(
      table.designTypeId,
      table.sortOrder,
    ),
    uniqueIndex("design_type_vocabulary_term_unique").on(
      table.designTypeId,
      table.term,
    ),
    check(
      "design_type_vocabulary_term_nonempty",
      sql`length(trim(${table.term})) > 0`,
    ),
    check(
      "design_type_vocabulary_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("collections_slug_unique").on(table.slug),
    index("collections_sort_order_index").on(table.sortOrder),
    check("collections_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const databaseSchema = {
  appMetadata,
  collections,
  designTypeRules,
  designTypeVocabulary,
  designTypes,
};
