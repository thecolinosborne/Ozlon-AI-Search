// Deno tests for the universal content extractors used by `analyze_content`
// and `get_email`. Run with `deno test` — no network or env required.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  base64UrlDecode,
  stripHtml,
  extractEmailBody,
  extractDocsText,
  extractSheetGrid,
  clip,
} from "./content-extract.ts";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.test("base64UrlDecode round-trips", () => {
  assertEquals(base64UrlDecode(b64url("Hello, world!")), "Hello, world!");
  assertEquals(base64UrlDecode(""), "");
});

Deno.test("stripHtml removes tags + decodes entities", () => {
  const html = `<p>Hello <b>World</b>&nbsp;&amp; friends</p><script>alert(1)</script>`;
  assertEquals(stripHtml(html).replace(/\s+/g, " ").trim(), "Hello World & friends");
});

Deno.test("extractEmailBody prefers text/plain at top level", () => {
  const payload = {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: b64url("plain wins") } },
      { mimeType: "text/html", body: { data: b64url("<p>html loses</p>") } },
    ],
  };
  assertEquals(extractEmailBody(payload), "plain wins");
});

Deno.test("extractEmailBody walks nested multipart/mixed -> alternative (Gemini Notes shape)", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("Gemini meeting notes body") } },
          { mimeType: "text/html", body: { data: b64url("<p>html version</p>") } },
        ],
      },
      { mimeType: "application/pdf", filename: "notes.pdf", body: { attachmentId: "x" } },
    ],
  };
  assertEquals(extractEmailBody(payload), "Gemini meeting notes body");
});

Deno.test("extractEmailBody falls back to HTML when no text/plain exists", () => {
  const payload = {
    mimeType: "multipart/alternative",
    parts: [{ mimeType: "text/html", body: { data: b64url("<p>html <b>only</b></p>") } }],
  };
  const result = extractEmailBody(payload);
  assert(result.includes("html"));
  assert(result.includes("only"));
  assert(!result.includes("<p>"));
});

Deno.test("extractEmailBody returns empty for null / empty payload", () => {
  assertEquals(extractEmailBody(undefined), "");
  assertEquals(extractEmailBody({}), "");
});

Deno.test("extractDocsText flattens textRuns + tables", () => {
  const doc = {
    title: "My Doc",
    body: {
      content: [
        { paragraph: { elements: [{ textRun: { content: "Line one.\n" } }] } },
        { paragraph: { elements: [{ textRun: { content: "Line two." } }] } },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  { content: [{ paragraph: { elements: [{ textRun: { content: "A" } }] } }] },
                  { content: [{ paragraph: { elements: [{ textRun: { content: "B" } }] } }] },
                ],
              },
            ],
          },
        },
      ],
    },
  };
  const out = extractDocsText(doc);
  assert(out.includes("# My Doc"));
  assert(out.includes("Line one."));
  assert(out.includes("Line two."));
  assert(out.includes("A | B"));
});

Deno.test("extractSheetGrid renders pipe-delimited table", () => {
  const values = [["Name", "Score"], ["Alice", 9], ["Bob", null]];
  assertEquals(extractSheetGrid(values), "Name | Score\nAlice | 9\nBob | ");
  assertEquals(extractSheetGrid([]), "(empty range)");
  assertEquals(extractSheetGrid(null), "(empty range)");
});

Deno.test("clip truncates with marker", () => {
  const big = "x".repeat(20000);
  const out = clip(big, 100);
  assertEquals(out.startsWith("x".repeat(100)), true);
  assert(out.includes("truncated"));
  assertEquals(clip("short", 100), "short");
});
