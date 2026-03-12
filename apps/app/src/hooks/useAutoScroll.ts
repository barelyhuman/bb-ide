import { useRef, useCallback, useEffect, useLayoutEffect, useState } from "react"
import {
  DEFAULT_SCROLL_STICK_THRESHOLD_PX,
  getScrollAnimationBehavior,
} from "@beanbag/ui-core";

const SMOOTH_AUTO_SCROLL_MAX_DELTA_PX = 160

function shouldShowScrollToBottom(el: HTMLDivElement): boolean {
  const maxScrollOffset = el.scrollHeight - el.clientHeight
  if (maxScrollOffset <= DEFAULT_SCROLL_STICK_THRESHOLD_PX) {
    return false
  }
  const distanceFromBottom = maxScrollOffset - el.scrollTop
  return distanceFromBottom > DEFAULT_SCROLL_STICK_THRESHOLD_PX
}

export function useAutoScroll(dep: unknown, resetDep?: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [isStickingToBottom, setIsStickingToBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const stickRef = useRef(true)
  const scheduledFrameRef = useRef<number | null>(null)

  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
    setContainerElement((currentElement) =>
      currentElement === element ? currentElement : element)
  }, [])

  const setStickyState = useCallback((nextValue: boolean) => {
    stickRef.current = nextValue
    setIsStickingToBottom((currentValue) =>
      currentValue === nextValue ? currentValue : nextValue)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    // Manual/programmatic scroll requests should restore sticky-bottom mode.
    // Use an immediate jump so follow-up renders can't outrun a smooth animation.
    setStickyState(true)
    el.scrollTop = el.scrollHeight
    setShowScrollToBottom(false)
  }, [setStickyState])

  const scrollToBottomWithAnimation = useCallback(() => {
    const el = containerRef.current
    if (!el || !stickRef.current) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom <= 0) {
      return
    }

    const behavior =
      distanceFromBottom <= SMOOTH_AUTO_SCROLL_MAX_DELTA_PX
        ? getScrollAnimationBehavior()
        : "auto"

    el.scrollTo({
      top: el.scrollHeight,
      behavior,
    })
  }, [])

  const scrollToBottomIfSticking = useCallback(() => {
    scrollToBottomWithAnimation()
  }, [scrollToBottomWithAnimation])

  const scheduleScrollToBottomIfSticking = useCallback(() => {
    if (typeof window === "undefined") {
      scrollToBottomIfSticking()
      return
    }

    if (scheduledFrameRef.current !== null) {
      return
    }

    scheduledFrameRef.current = window.requestAnimationFrame(() => {
      scheduledFrameRef.current = null
      scrollToBottomIfSticking()
      const el = containerRef.current
      if (el) {
        setShowScrollToBottom(shouldShowScrollToBottom(el))
      }
    })
  }, [scrollToBottomIfSticking])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nextStickyState = distanceFromBottom <= DEFAULT_SCROLL_STICK_THRESHOLD_PX
    setStickyState(nextStickyState)
    setShowScrollToBottom(shouldShowScrollToBottom(el))
  }, [setStickyState])

  useEffect(() => {
    scheduleScrollToBottomIfSticking()
    return () => {
      if (scheduledFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(scheduledFrameRef.current)
        scheduledFrameRef.current = null
      }
    }
  }, [containerElement, dep, scheduleScrollToBottomIfSticking])

  useEffect(() => {
    const el = containerElement
    if (!el || typeof window === "undefined") return

    const schedule = () => {
      scheduleScrollToBottomIfSticking()
    }

    let mutationObserver: MutationObserver | undefined
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        schedule()
      })
      mutationObserver.observe(el, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })
    }

    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        schedule()
      })
      resizeObserver.observe(el)
    }

    window.addEventListener("resize", schedule)

    return () => {
      mutationObserver?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", schedule)
      if (scheduledFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledFrameRef.current)
        scheduledFrameRef.current = null
      }
    }
  }, [containerElement, scheduleScrollToBottomIfSticking])

  useLayoutEffect(() => {
    if (resetDep === undefined) return
    scrollToBottom()

    if (typeof window === "undefined") {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [containerElement, resetDep, scrollToBottom])

  return {
    containerRef,
    containerElement,
    setContainerRef,
    handleScroll,
    scrollToBottom,
    isStickingToBottom,
    showScrollToBottom,
  }
}
