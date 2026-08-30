import { Progress } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

type ProgressPayload = {
  id: string;
  progress: number;
  finished: boolean;
  requestId: number;
};

function DatabaseLoader({ isLoading, tab }: { isLoading: boolean; tab: string | null }) {
  const [progress, setProgress] = useState(0);
  const latestRequest = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<ProgressPayload>("search_progress", ({ payload }) => {
      if (payload.id !== tab) return;
      if (payload.requestId < latestRequest.current) return;
      if (payload.requestId > latestRequest.current) {
        latestRequest.current = payload.requestId;
        setProgress(0);
      }
      if (payload.finished) {
        setProgress(0);
      } else {
        setProgress((current) => Math.max(current, payload.progress));
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
      latestRequest.current = 0;
    };
  }, [tab]);

  useEffect(() => {
    if (!isLoading) setProgress(0);
  }, [isLoading]);

  const isLoadingFromMemory = isLoading && progress === 0;

  return (
    <Progress
      animated={isLoadingFromMemory}
      value={isLoadingFromMemory ? 100 : progress}
      size="xs"
      mt="xs"
    />
  );
}

export default DatabaseLoader;
