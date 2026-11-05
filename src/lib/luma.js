/**
 * Helpers for Luma's public web API, shared by the background worker and the
 * unit tests. The page and the content script never call Luma directly: the
 * public endpoints only allow https://luma.com as a CORS origin, so the
 * background worker fetches them with the extension's host permission.
 *
 * Dependency-free and side-effect free, like the other `lib/` scripts.
 */
(() => {
  "use strict";

  const SOURCE_RE = /\b(usr|cal)-[A-Za-z0-9]+/;

  /** Return { kind: "user" | "calendar", id } for an API ID or luma.com URL. */
  function parseSource(raw) {
    const match = SOURCE_RE.exec(String(raw || ""));
    if (!match) return null;
    const id = match[0];
    return { kind: id.startsWith("usr-") ? "user" : "calendar", id };
  }

  function apiBase(baseUrl) {
    return String(baseUrl || "https://api.luma.com").replace(/\/+$/, "");
  }

  /**
   * Mirrors `services/luma.py::_source_request` in the web app:
   *   user:     /user/profile/events-hosting?user_api_id=…
   *   calendar: /calendar/get-items?calendar_api_id=…
   */
  function listUrl(baseUrl, source, options = {}) {
    const params = new URLSearchParams(
      source.kind === "user"
        ? { user_api_id: source.id, period: "future" }
        : { calendar_api_id: source.id, period: "future" },
    );
    if (options.limit) params.set("pagination_limit", String(options.limit));
    if (options.cursor) params.set("pagination_cursor", options.cursor);

    const path = source.kind === "user" ? "/user/profile/events-hosting" : "/calendar/get-items";
    return `${apiBase(baseUrl)}${path}?${params.toString()}`;
  }

  function eventUrl(baseUrl, eventId) {
    return `${apiBase(baseUrl)}/event/get?event_api_id=${encodeURIComponent(eventId)}`;
  }

  /** Flatten a Luma ProseMirror/TipTap document to readable plain text. */
  function flattenDescription(node) {
    if (typeof node === "string") return node;
    if (!node || typeof node !== "object") return "";

    const type = node.type;
    if (type === "text") return String(node.text || "");
    if (type === "hard_break") return "\n";
    if (type === "image") {
      const attrs = node.attrs;
      return attrs && typeof attrs === "object" ? String(attrs.alt || "") : "";
    }

    const children = node.content;
    const inner = Array.isArray(children)
      ? children.map((child) => flattenDescription(child)).join("")
      : "";

    if (type === "paragraph" || type === "heading" || type === "blockquote" || type === "code_block") {
      return `${inner}\n\n`;
    }
    if (type === "list_item") return `• ${inner.trim()}\n`;
    if (type === "bullet_list" || type === "ordered_list") return `${inner}\n`;
    return inner;
  }

  function normalizeDescription(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  globalThis.OneJobLuma = {
    eventUrl,
    flattenDescription,
    listUrl,
    normalizeDescription,
    parseSource,
  };
})();
