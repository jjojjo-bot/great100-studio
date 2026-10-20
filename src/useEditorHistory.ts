import { useRef, useState } from "react";
import { EditorHistory } from "./editor-history";

export function useEditorHistory() {
  const history = useRef(new EditorHistory());
  const [, update] = useState(0);
  return { history: history.current, refresh: () => update(value => value + 1) };
}
