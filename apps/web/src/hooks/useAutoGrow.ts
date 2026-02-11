import { useCallback, type RefObject } from "react"

const MIN_HEIGHT = 60
const MAX_HEIGHT = 160

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>) {
  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`
  }, [ref])

  return resize
}
