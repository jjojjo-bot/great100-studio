import type { ProjectData, Scene } from "./types";

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
        .map(value => {
          const edited = after.get(value.id);
          if (!edited) return value;
          return field === "scenes" ? mergeSceneChanges(before.get(value.id) as Scene | undefined, edited as Scene, value as Scene)
            : merge(before.get(value.id), edited, value);
        });
      const ids = new Set(result.map(value => (value as { id: string }).id));
      for (const value of next) if (!before.has(value.id) && !ids.has(value.id)) result.push(value);
      // Only an explicit structural edit changes scene order. A late callback whose
      // scene order is unchanged from its base keeps the latest order intact.
      if (field === "scenes" && !same(base.map(value => value.id), next.map(value => value.id))) {
        const rank = new Map(next.map((value, index) => [value.id, index]));
        result.sort((left, right) => (rank.get((left as Scene).id) ?? next.length) - (rank.get((right as Scene).id) ?? next.length));
      }
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

export function mergeSceneChanges(base: Scene | undefined, next: Scene, current: Scene): Scene {
  if (base && Number.isFinite(base.start_sec) && Number.isFinite(current.start_sec) && base.start_sec !== current.start_sec
    && base.start_sec === next.start_sec && base.end_sec === next.end_sec && base.number === next.number) {
    // A callback made before a move still speaks in the old absolute caption
    // times. Compare both its base and result in the scene's current origin.
    const shift = Math.round(current.start_sec! * 1000) - Math.round(base.start_sec! * 1000);
    const rebase = (scene: Scene) => ({ ...scene, captions: scene.captions?.map(block => ({ ...block,
      start_sec: (Math.round(block.start_sec * 1000) + shift) / 1000, end_sec: (Math.round(block.end_sec * 1000) + shift) / 1000 })) });
    return merge(rebase(base), rebase(next), current) as Scene;
  }
  return merge(base, next, current) as Scene;
}

export function mergeProjectChanges(base: ProjectData | null, next: ProjectData, current: ProjectData): ProjectData {
  if (!base || base.id !== next.id || current.id !== next.id) return next;
  return merge(base, next, current) as ProjectData;
}
