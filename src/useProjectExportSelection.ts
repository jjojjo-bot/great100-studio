import { useRef, useState } from "react";
import type { ProjectData } from "./types";

type Selection = { open: boolean; ids: string[] };
const empty = (): Selection => ({ open: false, ids: [] });

// Each caller owns independent selections, outside project JSON and edit history.
export function useProjectExportSelection(project: ProjectData | null) {
  const drafts = useRef(new Map<string, Selection>());
  const [, redraw] = useState(0);
  const id = project?.id || "", selection = drafts.current.get(id) || empty();
  const update = (change: Partial<Selection>) => {
    if (!id) return;
    drafts.current.set(id, { ...(drafts.current.get(id) || empty()), ...change });
    redraw(value => value + 1);
  };
  return { ...selection, setOpen: (open: boolean) => update({ open }), select: (ids: string[]) => update({ ids: [...new Set(ids)] }) };
}
export type ProjectExportSelection = ReturnType<typeof useProjectExportSelection>;
