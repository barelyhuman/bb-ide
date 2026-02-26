import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { CornerDownLeft, Loader2, Mic, MicOff, Paperclip, Square, X } from "lucide-react"
import type { ProjectFileSuggestion } from "@beanbag/agent-core"
import { Button } from "@/components/ui/button"
import { useAutoGrow } from "@/hooks/useAutoGrow"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import type { PromptDraftAttachment } from "@/lib/prompt-draft"
import { cn } from "@/lib/utils"
import { findActiveFileMention, insertFileMention, type ActiveFileMention } from "./file-mention"

const PROMPTBOX_MIN_HEIGHT = 68
const PROMPTBOX_MAX_HEIGHT = 158

type SubmitMode = "enter" | "mod-enter"

interface PromptBoxProps {
  id?: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  className?: string
  footerStart?: ReactNode
  isSubmitting?: boolean
  submitDisabled?: boolean
  submitTitle?: string
  submitMode?: SubmitMode
  isRunning?: boolean
  onStop?: () => void
  autoFocus?: boolean
  mentionSuggestions?: ProjectFileSuggestion[]
  mentionLoading?: boolean
  mentionError?: boolean
  onMentionQueryChange?: (query: string | null) => void
  attachments?: PromptDraftAttachment[]
  isAttaching?: boolean
  attachmentError?: string | null
  onAttachFiles?: (files: File[]) => void | Promise<void>
  onRemoveAttachment?: (path: string) => void
}

interface DismissedMentionRange {
  start: number
  end: number
  hasLeftRange: boolean
}

export function PromptBox({
  id,
  value,
  onChange,
  onSubmit,
  placeholder = "What do you want to build?",
  className,
  footerStart,
  isSubmitting = false,
  submitDisabled = false,
  submitTitle = "Submit (Enter)",
  submitMode = "enter",
  isRunning = false,
  onStop,
  autoFocus = false,
  mentionSuggestions = [],
  mentionLoading = false,
  mentionError = false,
  onMentionQueryChange,
  attachments = [],
  isAttaching = false,
  attachmentError = null,
  onAttachFiles,
  onRemoveAttachment,
}: PromptBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  const resizeTextarea = useAutoGrow(textareaRef, {
    minHeight: PROMPTBOX_MIN_HEIGHT,
    maxHeight: PROMPTBOX_MAX_HEIGHT,
  })
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const mentionKeyRef = useRef("")
  const dismissedMentionRef = useRef<DismissedMentionRange | null>(null)
  const [activeMention, setActiveMention] = useState<ActiveFileMention | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)

  useEffect(() => {
    if (!textareaRef.current) return
    resizeTextarea(textareaRef.current)
  }, [resizeTextarea, value])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const syncMentionState = useCallback((textarea: HTMLTextAreaElement) => {
    const caretPosition = textarea.selectionStart ?? textarea.value.length
    const dismissedMention = dismissedMentionRef.current

    if (dismissedMention) {
      const isWithinDismissedRange =
        caretPosition >= dismissedMention.start &&
        caretPosition <= dismissedMention.end

      if (!isWithinDismissedRange) {
        dismissedMentionRef.current = {
          ...dismissedMention,
          hasLeftRange: true,
        }
      } else if (dismissedMention.hasLeftRange) {
        dismissedMentionRef.current = null
      }
    }

    const shouldSuppressMention = Boolean(
      dismissedMentionRef.current &&
        caretPosition >= dismissedMentionRef.current.start &&
        caretPosition <= dismissedMentionRef.current.end &&
        !dismissedMentionRef.current.hasLeftRange
    )

    const nextMention = shouldSuppressMention
      ? null
      : findActiveFileMention(textarea.value, caretPosition)
    const nextKey = nextMention
      ? `${nextMention.start}:${nextMention.end}:${nextMention.query}`
      : ""
    if (nextKey !== mentionKeyRef.current) {
      mentionKeyRef.current = nextKey
      setSelectedMentionIndex(0)
    }
    setActiveMention(nextMention)

    onMentionQueryChange?.(nextMention ? nextMention.query : null)
  }, [onMentionQueryChange])

  useEffect(() => {
    if (!textareaRef.current) return
    syncMentionState(textareaRef.current)
  }, [syncMentionState, value])

  const trimmedValue = value.trim()
  const hasAttachments = attachments.length > 0
  const hasSubmittableInput = trimmedValue.length > 0 || hasAttachments
  const showStop = Boolean(isRunning && onStop && !hasSubmittableInput)
  const canSubmit = hasSubmittableInput && !isSubmitting && !submitDisabled
  const hasMentionContext = activeMention !== null
  const showMentionMenu = hasMentionContext
  const activeMentionQuery = activeMention?.query.trim() ?? ""
  const showQueryHint = activeMentionQuery.length === 0

  useEffect(() => {
    if (mentionSuggestions.length === 0) {
      setSelectedMentionIndex(0)
      return
    }
    if (selectedMentionIndex >= mentionSuggestions.length) {
      setSelectedMentionIndex(0)
    }
  }, [mentionSuggestions.length, selectedMentionIndex])

  useEffect(() => {
    mentionItemRefs.current = mentionItemRefs.current.slice(0, mentionSuggestions.length)
  }, [mentionSuggestions.length])

  useEffect(() => {
    if (!showMentionMenu || mentionSuggestions.length === 0) return
    const selectedItem = mentionItemRefs.current[selectedMentionIndex]
    if (!selectedItem) return
    selectedItem.scrollIntoView({
      block: "nearest",
    })
  }, [mentionSuggestions.length, selectedMentionIndex, showMentionMenu])

  const applyMention = useCallback((item: ProjectFileSuggestion) => {
    const textarea = textareaRef.current
    if (!textarea || !activeMention) return

    const mentionStart = activeMention.start
    const mentionEnd = mentionStart + item.path.length + 1
    const replacement = insertFileMention(value, activeMention, item.path)
    onChange(replacement.value)
    mentionKeyRef.current = ""
    dismissedMentionRef.current = {
      start: mentionStart,
      end: mentionEnd,
      hasLeftRange: false,
    }
    setActiveMention(null)
    setSelectedMentionIndex(0)
    onMentionQueryChange?.(null)

    requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current
      if (!nextTextarea) return
      nextTextarea.focus()
      nextTextarea.setSelectionRange(
        replacement.caretPosition,
        replacement.caretPosition,
      )
      resizeTextarea(nextTextarea)
    })
  }, [activeMention, onChange, onMentionQueryChange, resizeTextarea, value])

  const insertVoiceTranscript = useCallback((transcript: string) => {
    const normalizedTranscript = transcript.replace(/\s+/g, " ").trim()
    if (normalizedTranscript.length === 0) return

    const textarea = textareaRef.current
    const currentValue = valueRef.current
    if (!textarea) {
      const nextValue =
        currentValue.length === 0 || /\s$/.test(currentValue)
          ? `${currentValue}${normalizedTranscript}`
          : `${currentValue} ${normalizedTranscript}`
      onChange(nextValue)
      return
    }

    const selectionStart = textarea.selectionStart ?? currentValue.length
    const selectionEnd = textarea.selectionEnd ?? selectionStart
    const before = currentValue.slice(0, selectionStart)
    const after = currentValue.slice(selectionEnd)
    const needsLeadingWhitespace = before.length > 0 && !/\s$/.test(before)
    const needsTrailingWhitespace = after.length > 0 && !/^\s/.test(after)
    const insertedText =
      `${needsLeadingWhitespace ? " " : ""}${normalizedTranscript}${needsTrailingWhitespace ? " " : ""}`
    const nextValue = `${before}${insertedText}${after}`
    const nextCursor = before.length + insertedText.length

    onChange(nextValue)
    requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current
      if (!nextTextarea) return
      nextTextarea.focus()
      nextTextarea.setSelectionRange(nextCursor, nextCursor)
      resizeTextarea(nextTextarea)
      syncMentionState(nextTextarea)
    })
  }, [onChange, resizeTextarea, syncMentionState])

  const voiceInput = useVoiceInput({
    onTranscript: insertVoiceTranscript,
  })

  const emitAttachmentFiles = useCallback((files: File[]) => {
    if (!onAttachFiles || files.length === 0) return
    void onAttachFiles(files)
  }, [onAttachFiles])

  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return
      emitAttachmentFiles(Array.from(fileList))
      event.target.value = ""
    },
    [emitAttachmentFiles],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    voiceInput.stop()
    onSubmit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu) {
      if (event.key === "ArrowDown" && mentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedMentionIndex((prev) => (prev + 1) % mentionSuggestions.length)
        return
      }
      if (event.key === "ArrowUp" && mentionSuggestions.length > 0) {
        event.preventDefault()
        setSelectedMentionIndex((prev) =>
          (prev + mentionSuggestions.length - 1) % mentionSuggestions.length
        )
        return
      }
      if ((event.key === "Enter" || event.key === "Tab") && mentionSuggestions.length > 0) {
        event.preventDefault()
        const selected = mentionSuggestions[selectedMentionIndex] ?? mentionSuggestions[0]
        if (selected) {
          applyMention(selected)
        }
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        mentionKeyRef.current = ""
        setActiveMention(null)
        onMentionQueryChange?.(null)
        return
      }
    }

    const withModifier = event.metaKey || event.ctrlKey
    const isSubmitKey =
      submitMode === "mod-enter"
        ? withModifier && event.key === "Enter"
        : event.key === "Enter" && !event.shiftKey

    if (!isSubmitKey) return
    event.preventDefault()
    if (!canSubmit) return
    voiceInput.stop()
    onSubmit()
  }

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={(event) => {
        if (!onAttachFiles) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (!onAttachFiles) return
        event.preventDefault()
        if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) return
        emitAttachmentFiles(Array.from(event.dataTransfer.files))
      }}
      className={cn("relative w-full rounded-lg border border-input bg-background pb-2", className)}
    >
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          resizeTextarea(event.target)
          syncMentionState(event.target)
        }}
        onClick={(event) => {
          syncMentionState(event.currentTarget)
        }}
        onSelect={(event) => {
          syncMentionState(event.currentTarget)
        }}
        onBlur={() => {
          mentionKeyRef.current = ""
          if (dismissedMentionRef.current) {
            dismissedMentionRef.current = {
              ...dismissedMentionRef.current,
              hasLeftRange: true,
            }
          }
          setActiveMention(null)
          onMentionQueryChange?.(null)
        }}
        onPaste={(event) => {
          if (!onAttachFiles) return
          const clipboardItems = Array.from(event.clipboardData?.items ?? [])
          const pastedFiles = clipboardItems
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null)

          if (pastedFiles.length === 0) return
          event.preventDefault()
          emitAttachmentFiles(pastedFiles)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        autoFocus={autoFocus}
        className="w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
        style={{
          minHeight: `${PROMPTBOX_MIN_HEIGHT}px`,
          maxHeight: `${PROMPTBOX_MAX_HEIGHT}px`,
        }}
      />

      {showMentionMenu ? (
        <div className="mx-3 mb-1 mt-1 overflow-hidden rounded-md border border-border/70 bg-popover text-popover-foreground shadow-sm">
          <div className="max-h-48 overflow-y-auto p-1">
            {showQueryHint ? (
              <div className="rounded px-2 py-1.5 text-xs text-muted-foreground">
                Type to search project files
              </div>
            ) : mentionLoading ? (
              <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Searching files...</span>
              </div>
            ) : mentionError ? (
              <div className="rounded px-2 py-1.5 text-xs text-destructive">
                Couldn&apos;t load files for this project
              </div>
            ) : mentionSuggestions.length > 0 ? (
              mentionSuggestions.map((item, index) => {
                const isSelected = index === selectedMentionIndex
                return (
                  <button
                    key={`${item.path}-${index}`}
                    ref={(element) => {
                      mentionItemRefs.current[index] = element
                    }}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyMention(item)
                    }}
                    className={cn(
                      "w-full truncate rounded px-2 py-1.5 text-left text-xs",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/70"
                    )}
                    title={item.path}
                  >
                    {item.path}
                  </button>
                )
              })
            ) : (
              <div className="rounded px-2 py-1.5 text-xs text-muted-foreground">
                No matching files
              </div>
            )}
          </div>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mx-3 mb-1 mt-1 flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.path}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
            >
              <span className="truncate">{attachment.name}</span>
              {onRemoveAttachment ? (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.path)}
                  className="rounded p-0.5 hover:bg-background/70"
                  title={`Remove ${attachment.name}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {attachmentError ? (
        <div className="mx-3 mb-1 mt-1 text-xs text-destructive">
          {attachmentError}
        </div>
      ) : null}

      <div className="flex flex-row items-center gap-3 px-3.5 pt-1.5">
        <div className="flex min-w-0 flex-1 flex-row items-center gap-1">
          {footerStart}
          {voiceInput.statusLabel ? (
            <span
              className={cn(
                "ml-1 truncate text-xs",
                voiceInput.state === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {voiceInput.statusLabel}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-row items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Attach files"
            disabled={!onAttachFiles || isAttaching}
            onClick={() => attachmentInputRef.current?.click()}
            className="size-auto h-8 px-2 transition-all"
          >
            {isAttaching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant={voiceInput.state === "error" ? "secondary" : "ghost"}
            title={
              !voiceInput.isSupported
                ? "Voice input is not supported in this browser"
                : voiceInput.isListening
                  ? "Stop voice input"
                  : "Start voice input"
            }
            disabled={!voiceInput.isSupported}
            onClick={() => {
              if (voiceInput.isListening) {
                voiceInput.stop()
              } else {
                voiceInput.start()
              }
            }}
            className="size-auto h-8 px-2 transition-all"
          >
            {voiceInput.isListening ? (
              <MicOff className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
          </Button>
          {showStop ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              title="Stop run"
              onClick={onStop}
              className="size-auto h-8 px-2 transition-all"
            >
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              variant="default"
              title={submitTitle}
              disabled={!canSubmit}
              className="size-auto h-8 px-2 transition-all"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CornerDownLeft className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
