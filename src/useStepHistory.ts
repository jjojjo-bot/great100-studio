import { useEffect, useRef } from "react";

interface StudioLocation {
  step: number;
  projectId?: string;
}

// Record screen changes without changing the URL or the stored project data.
export function useStepHistory(step: number, projectId: string | undefined, restore: (location: StudioLocation) => void) {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const lastLocation = useRef<StudioLocation>({ step, projectId });

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, great100: lastLocation.current }, "");
    const onPopState = (event: PopStateEvent) => {
      const saved = event.state?.great100;
      const location: StudioLocation = saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 8
        ? { step: saved.step, projectId: typeof saved.projectId === "string" ? saved.projectId : undefined }
        : { step: 0 };
      lastLocation.current = location;
      restoreRef.current(location);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const previous = lastLocation.current;
    if (previous.step === step && previous.projectId === projectId) return;
    const location = { step, projectId };
    lastLocation.current = location;
    window.history.pushState({ ...window.history.state, great100: location }, "");
  }, [step, projectId]);
}
