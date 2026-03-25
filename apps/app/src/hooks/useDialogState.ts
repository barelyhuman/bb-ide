import { useCallback, useState } from "react";

export function useDialogState<T>() {
  const [target, setTarget] = useState<T | null>(null);

  const onOpen = useCallback((nextTarget: T) => {
    setTarget(nextTarget);
  }, []);

  const onClose = useCallback(() => {
    setTarget(null);
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setTarget(null);
    }
  }, []);

  return {
    isOpen: target !== null,
    onClose,
    onOpen,
    onOpenChange,
    setTarget,
    target,
  };
}
