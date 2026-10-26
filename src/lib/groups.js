/**
 * Turns Nexudus resource payloads into the menu model used by content.js.
 */
(() => {
  "use strict";

  const config = globalThis.NXPlusConfig;

  function slugForType(systemResourceType) {
    return config.resourceTypeSlugs[Number(systemResourceType)] || null;
  }

  function typeLabel(slug) {
    const entry = Object.entries(config.resourceTypeSlugs).find(([, value]) => value === slug);
    const id = entry ? Number(entry[0]) : null;
    return (id && config.resourceTypeLabels[id]) || slug.replace(/-/g, " ");
  }

  /** "Machines: 3D printing" -> "3D printing" (only when asked to). */
  function displayGroupName(groupName, stripPrefix) {
    const name = String(groupName || "").trim();
    if (!stripPrefix) return name;
    const match = /^[^:]{1,40}:\s*(.+)$/.exec(name);
    return match ? match[1].trim() : name;
  }

  function resourcesFromPayload(payload) {
    if (!payload) return [];
    return payload.Resources || payload.NetworkResources || [];
  }

  /**
   * Flat list of bookable resources: [{ id, name, group, type }].
   *
   * `name` is trimmed for display; `group` keeps the exact API string (some
   * values end with a space) because it is used verbatim in filter links.
   */
  function resourceListFromPayload(payload) {
    const result = [];
    for (const resource of resourcesFromPayload(payload)) {
      const id = resource.Id != null ? String(resource.Id) : "";
      const slug = slugForType(resource.SystemResourceType);
      if (!id || !slug) continue;
      result.push({
        id,
        name: String(resource.Name ?? "").trim(),
        group: String(resource.GroupName ?? ""),
        type: slug,
      });
    }
    return result;
  }

  /**
   * slug -> sorted unique group names, straight from the API payload.
   *
   * Names are kept exactly as the API returns them (some end with a space):
   * the portal filters resources with an exact string comparison against
   * `GroupName`, so trimming here would silently drop every resource.
   */
  function groupsBySlugFromPayload(payload) {
    const bySlug = new Map();
    for (const resource of resourcesFromPayload(payload)) {
      const slug = slugForType(resource.SystemResourceType);
      const group = String(resource.GroupName ?? "");
      if (!slug || !group.trim()) continue;
      if (!bySlug.has(slug)) bySlug.set(slug, new Set());
      bySlug.get(slug).add(group);
    }
    const result = {};
    for (const [slug, groups] of bySlug) result[slug] = [...groups].sort((a, b) => a.localeCompare(b));
    return result;
  }

  /**
   * @param {Record<string, string[]>} groupsBySlug
   * @param {{slug: string, label?: string}[]} types  preferred order (usually from the portal menu)
   * @param {{stripPrefix?: boolean, hideEmptyTypes?: boolean}} options
   */
  function buildMenuModel(groupsBySlug, types, options = {}) {
    const { stripPrefix = true, hideEmptyTypes = true } = options;
    const seen = new Set();
    const ordered = [];

    for (const type of types || []) {
      if (!type || !type.slug || seen.has(type.slug)) continue;
      seen.add(type.slug);
      ordered.push({ slug: type.slug, label: type.label || typeLabel(type.slug) });
    }

    const leftovers = Object.keys(groupsBySlug || {}).filter((slug) => !seen.has(slug));
    for (const slug of leftovers) ordered.push({ slug, label: typeLabel(slug) });

    // Stable sort by the configured order; unlisted types keep their input order.
    ordered.sort((a, b) => rank(a.slug) - rank(b.slug));

    const model = [];
    for (const type of ordered) {
      const groups = (groupsBySlug?.[type.slug] || []).map((name) => ({
        name,
        label: displayGroupName(name, stripPrefix),
      }));
      if (!groups.length && hideEmptyTypes) continue;
      model.push({ slug: type.slug, label: type.label, groups });
    }
    return model;
  }

  function rank(slug) {
    const index = config.resourceTypeOrder.indexOf(slug);
    return index === -1 ? config.resourceTypeOrder.length : index;
  }

  globalThis.NXPlusGroups = {
    slugForType,
    typeLabel,
    displayGroupName,
    resourcesFromPayload,
    resourceListFromPayload,
    groupsBySlugFromPayload,
    buildMenuModel,
  };
})();
