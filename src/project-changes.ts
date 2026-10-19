import type { ProjectData } from "./types";

const same = (left: unknown, right: unknown) => Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Apply only the fields changed by a callback, rather than its stale project snapshot.
function merge(base: unknown, next: unknown, current: unknown, field = ""): unknown {
  if (same(base, next)) return current;
  if (Array.isArray(base) && Array.isArray(next) && Array.isArray(current)) {
    if ([...base, ...next, ...current].every(value => object(value) && typeof value.id === "string")) {
      const before = new Map(base.map(value => [value.id, value]));
      const after = new Map(next.map(value => [value.id, value]));
      const result = current.filter(value => !before.has(value.id) || after.has(value.id))
        .map(value => after.has(value.id) ? merge(before.get(value.id), after.get(value.id), value) : value);
      const ids = new Set(result.map(value => (value as { id: string }).id));
      for (const value of next) if (!before.has(value.id) && !ids.has(value.id)) result.push(value);
      return result;
    }
    if (field.endsWith("history")) {
      const added = next.filter(value => !base.some(old => same(old, value)));
      return [...current, ...added.filter(value => !current.some(old => same(old, value)))];
    }
  }
  if (object(base) && object(next) && object(current)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!same(base[key], next[key])) result[key] = merge(base[key], next[key], current[key], key);
    }
    return result;
  }
  return next;
}

export function mergeProjectChanges(base: ProjectData | null, next: ProjectData, current: ProjectData): ProjectData {
  if (!base || base.id !== next.id || current.id !== next.id) return next;
  return merge(base, next, current) as ProjectData;
}
