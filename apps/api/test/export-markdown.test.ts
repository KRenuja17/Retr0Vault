import { describe, expect, it } from "vitest";

import type { ReferenceResponse } from "@retr0vault/shared";

import {
  fencedText, markdownFile, markdownText, renderReferenceExport, renderVocabularyExport,
} from "../src/export/markdown.js";

const reference: ReferenceResponse = {
  id: "10000000-0000-4000-8000-000000000001", title: "Quiet Study",
  sourceType: "image", sourceUrl: null,
  originalPath: "originals/10000000-0000-4000-8000-000000000001.png",
  thumbnailPath: "thumbnails/10000000-0000-4000-8000-000000000001.webp",
  designTypeId: null, designDNA: "editorial × silence", designThesis: "Space gives the subject authority",
  designBrief: "Keep the composition quiet.\nLet one subject lead.", imageRecipe: "[SUBJECT] in an open field",
  motionBrief: null, assetBrief: null, analysisStatus: "pending", analysisJson: null,
  protectedFields: [], image: { width: 1, height: 1, format: "png" }, tags: [], collectionIds: [], frames: [],
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Markdown rendering", () => {
  it("renders a complete, clean single-reference document with explicit missing values", () => {
    const file = renderReferenceExport([{ reference, designType: null }]);
    expect(file.content).toBe([
      "# Retr0Vault Reference Export",
      "Use these references as visual principles, not as instructions to copy a source literally. Missing metadata is marked explicitly; no analysis is generated during export.",
      "## Quiet Study",
      "- Reference ID: 10000000-0000-4000-8000-000000000001\n- Design type: Unassigned\n- Analysis status: pending\n- Source URL: Not provided.",
      "### Design DNA\n\neditorial × silence",
      "### Design Thesis\n\nSpace gives the subject authority",
      "### Visual Vocabulary\n\nNot provided.",
      "### Design Brief\n\n```text\nKeep the composition quiet.\nLet one subject lead.\n```",
      "### Image Recipe\n\n```text\n[SUBJECT] in an open field\n```",
      "### Motion Brief\n\nNot provided.",
      "### Asset Brief\n\nNot provided.",
    ].join("\n\n") + "\n");
    expect(file.filename).toMatch(/^retr0vault-references-[a-f0-9]{16}\.md$/);
    expect(file.content).not.toMatch(/undefined|null|\r/);
  });

  it("renders stored HTML, links, headings and control characters as inert text", () => {
    const value = '<script>alert(1)</script>\r\n# heading\u0000\u202e\n[x](javascript:alert(1))';
    expect(markdownText(value)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;\n\\# heading\n\\[x\\](javascript:alert(1))');
    const content = renderReferenceExport([{ reference: { ...reference, title: value }, designType: null }]).content;
    expect(content).not.toContain("<script>");
    expect(content).not.toContain("\n# heading");
    expect(content).not.toContain("[x](javascript:");
  });

  it("preserves prose punctuation while escaping Markdown block syntax", () => {
    expect(markdownText("Use warm paper (not white).\n1. One\n- Two\n---\n===\n# Heading"))
      .toBe("Use warm paper (not white).\n1\\. One\n\\- Two\n\\-\\-\\-\n\\=\\=\\=\n\\# Heading");
  });

  it("uses fences longer than source backticks and retains copyable recipes", () => {
    expect(fencedText("[SUBJECT]\r\n```\n# text\n````")).toBe("`````text\n[SUBJECT]\n```\n# text\n````\n`````");
    expect(fencedText("` ".repeat(150_000))).toMatch(/^```text/);
  });

  it("handles structured manual analysis without losing nested dimension data", () => {
    const content = renderReferenceExport([{ reference: { ...reference,
      analysisJson: { palette: { primary: "ochre", percent: 70 }, typography: ["large serif"], motion: [] },
    }, designType: null }]).content;
    expect(content).toContain('### Colour\n\n```json\n{\n  "primary": "ochre",\n  "percent": 70\n}\n```');
    expect(content).toContain("### Typography\n\n- large serif");
    expect(content).toContain("### Motion\n\nNot provided.");
  });

  it("creates deterministic content-derived filenames and LF-only output", () => {
    const first = renderReferenceExport([{ reference, designType: null }]);
    expect(renderReferenceExport([{ reference, designType: null }])).toEqual(first);
    const updated = renderReferenceExport([{ reference: { ...reference, designBrief: "Changed" }, designType: null }]);
    expect(updated.filename).not.toBe(first.filename);
    expect(first.filename).not.toMatch(/[\\/:\r\n ]/);
    expect(first.content.endsWith("\n")).toBe(true);
  });

  it("limits output by UTF-8 byte size", () => {
    expect(() => markdownFile("references", ["é".repeat(4 * 1_024 * 1_024)]))
      .toThrow(expect.objectContaining({ statusCode: 413, code: "EXPORT_TOO_LARGE" }));
  });

  it("does not include non-vocabulary reference fields in vocabulary-only exports", () => {
    const file = renderVocabularyExport([{ reference, designType: null }], []);
    expect(file.content).toBe("# Retr0Vault Visual Vocabulary\n\nNo vocabulary provided.\n");
    expect(file.content).not.toContain(reference.title);
    expect(file.content).not.toContain(reference.id);
  });
});
