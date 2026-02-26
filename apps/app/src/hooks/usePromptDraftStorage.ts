import { useCallback, useEffect, useMemo, useState } from "react";
import type { PromptDraftAttachment, PromptDraftState } from "@/lib/prompt-draft";
import {
  emptyPromptDraftState,
  parsePromptDraftStorage,
  serializePromptDraftStorage,
} from "@/lib/prompt-draft";

const PROMPT_DRAFT_STORAGE_PREFIX = "beanbag.promptbox.contents";
const PROMPT_DRAFT_STORAGE_VERSION = "3";

interface PromptDraftScope {
  projectId?: string | null;
  threadId?: string | null;
}

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function readPromptDraft(storageKey: string | null): PromptDraftState {
  if (!storageKey || typeof window === "undefined") {
    return emptyPromptDraftState();
  }
  const rawValue = window.localStorage.getItem(storageKey);
  return parsePromptDraftStorage(rawValue);
}

function writePromptDraft(storageKey: string | null, value: PromptDraftState): void {
  if (!storageKey || typeof window === "undefined") return;
  const serialized = serializePromptDraftStorage(value);
  if (!serialized) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, serialized);
}

export function getPromptDraftStorageKey({
  projectId,
  threadId,
}: PromptDraftScope): string | null {
  if (!projectId) return null;
  const normalizedProjectId = normalizeStorageSegment(projectId);
  if (threadId) {
    const normalizedThreadId = normalizeStorageSegment(threadId);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-${normalizedProjectId}-${normalizedThreadId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  return `${PROMPT_DRAFT_STORAGE_PREFIX}-${normalizedProjectId}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

export function usePromptDraftStorage(scope: PromptDraftScope) {
  const storageKey = useMemo(
    () =>
      getPromptDraftStorageKey({
        projectId: scope.projectId,
        threadId: scope.threadId,
      }),
    [scope.projectId, scope.threadId],
  );
  const [draft, setDraft] = useState<PromptDraftState>(() => readPromptDraft(storageKey));

  useEffect(() => {
    setDraft(readPromptDraft(storageKey));
  }, [storageKey]);

  const setDraftAndPersist = useCallback(
    (nextDraft: PromptDraftState) => {
      setDraft(nextDraft);
      writePromptDraft(storageKey, nextDraft);
    },
    [storageKey],
  );

  const setText = useCallback((nextText: string) => {
    setDraft((prevDraft) => {
      const nextDraft = {
        ...prevDraft,
        text: nextText,
      };
      writePromptDraft(storageKey, nextDraft);
      return nextDraft;
    });
  }, [storageKey]);

  const appendText = useCallback((chunk: string) => {
    const normalizedChunk = chunk.replace(/\s+/g, " ").trim();
    if (normalizedChunk.length === 0) return;

    setDraft((prevDraft) => {
      const trimmedCurrent = prevDraft.text.trimEnd();
      const nextText =
        trimmedCurrent.length === 0
          ? normalizedChunk
          : `${trimmedCurrent} ${normalizedChunk}`;
      const nextDraft = {
        ...prevDraft,
        text: nextText,
      };
      writePromptDraft(storageKey, nextDraft);
      return nextDraft;
    });
  }, [storageKey]);

  const addAttachment = useCallback((attachment: PromptDraftAttachment) => {
    setDraft((prevDraft) => {
      const alreadyExists = prevDraft.attachments.some(
        (existingAttachment) => existingAttachment.path === attachment.path,
      );
      const nextDraft = alreadyExists
        ? prevDraft
        : {
            ...prevDraft,
            attachments: [...prevDraft.attachments, attachment],
          };
      writePromptDraft(storageKey, nextDraft);
      return nextDraft;
    });
  }, [storageKey]);

  const removeAttachment = useCallback((path: string) => {
    setDraft((prevDraft) => {
      const nextAttachments = prevDraft.attachments.filter(
        (attachment) => attachment.path !== path,
      );
      if (nextAttachments.length === prevDraft.attachments.length) {
        return prevDraft;
      }
      const nextDraft = {
        ...prevDraft,
        attachments: nextAttachments,
      };
      writePromptDraft(storageKey, nextDraft);
      return nextDraft;
    });
  }, [storageKey]);

  const clear = useCallback(() => {
    setDraftAndPersist(emptyPromptDraftState());
  }, [setDraftAndPersist]);

  const setAttachments = useCallback((attachments: PromptDraftAttachment[]) => {
    setDraft((prevDraft) => {
      const nextDraft = {
        ...prevDraft,
        attachments,
      };
      writePromptDraft(storageKey, nextDraft);
      return nextDraft;
    });
  }, [storageKey]);

  return {
    storageKey,
    value: draft.text,
    text: draft.text,
    attachments: draft.attachments,
    setValue: setText,
    setText,
    setAttachments,
    appendText,
    addAttachment,
    removeAttachment,
    clear,
  };
}
