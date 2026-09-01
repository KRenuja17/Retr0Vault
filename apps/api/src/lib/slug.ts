import { ApiError } from "../errors.js";

export function slugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "slug: Provide a slug when the name cannot be converted to one",
    );
  }

  return slug.slice(0, 100).replace(/-+$/g, "");
}
