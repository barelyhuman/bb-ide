import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface ConversationMarkdownProps {
  content: string
  className?: string
}

function extractMarkdownImageUrls(markdown: string): string[] {
  const imageUrls: string[] = []
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  let match: RegExpExecArray | null = markdownImagePattern.exec(markdown)
  while (match) {
    const imageUrl = match[1]
    if (imageUrl) {
      imageUrls.push(imageUrl)
    }
    match = markdownImagePattern.exec(markdown)
  }
  return imageUrls
}

export function ConversationMarkdown({ content, className }: ConversationMarkdownProps) {
  const imageUrls = useMemo(() => extractMarkdownImageUrls(content), [content])
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(null)

  const showPreviousImage = useCallback(() => {
    setExpandedImageIndex((currentIndex) => {
      if (currentIndex === null || imageUrls.length <= 1) return currentIndex
      return currentIndex === 0 ? imageUrls.length - 1 : currentIndex - 1
    })
  }, [imageUrls.length])

  const showNextImage = useCallback(() => {
    setExpandedImageIndex((currentIndex) => {
      if (currentIndex === null || imageUrls.length <= 1) return currentIndex
      return currentIndex === imageUrls.length - 1 ? 0 : currentIndex + 1
    })
  }, [imageUrls.length])

  useEffect(() => {
    if (expandedImageIndex === null || imageUrls.length <= 1) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        showPreviousImage()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        showNextImage()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [expandedImageIndex, imageUrls.length, showNextImage, showPreviousImage])

  return (
    <>
      <div className={cn("max-w-none break-words text-sm leading-relaxed text-foreground", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className: codeClassName, children, ...props }: any) {
              const codeText = String(children ?? "").replace(/\n$/, "")
              const languageMatch = /language-(\w+)/.exec(codeClassName || "")
              const language = languageMatch?.[1]
              const isBlock = codeText.includes("\n")
              if (isBlock) {
                return (
                  <pre className="my-2 overflow-x-auto rounded-md border border-border/70 bg-muted/35 p-3">
                    <code className={cn("font-mono ui-text-sm", language ? `language-${language}` : "")} {...props}>
                      {codeText}
                    </code>
                  </pre>
                )
              }
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em]" {...props}>
                  {children}
                </code>
              )
            },
            pre({ children }: any) {
              return <>{children}</>
            },
            p({ children }: any) {
              return <p className="mb-2 last:mb-0 text-foreground">{children}</p>
            },
            ul({ children }: any) {
              return <ul className="mb-2 list-disc pl-5 text-foreground">{children}</ul>
            },
            ol({ children }: any) {
              return <ol className="mb-2 list-decimal pl-5 text-foreground">{children}</ol>
            },
            li({ children }: any) {
              return <li className="mb-1 text-foreground">{children}</li>
            },
            blockquote({ children }: any) {
              return (
                <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
                  {children}
                </blockquote>
              )
            },
            table({ children }: any) {
              return (
                <div className="my-2 overflow-x-auto">
                  <table className="min-w-full border border-border/80">{children}</table>
                </div>
              )
            },
            thead({ children }: any) {
              return <thead className="bg-muted/40">{children}</thead>
            },
            th({ children }: any) {
              return <th className="border border-border/80 px-2 py-1 text-left font-medium">{children}</th>
            },
            td({ children }: any) {
              return <td className="border border-border/80 px-2 py-1">{children}</td>
            },
            a({ children, href, ...props }: any) {
              return (
                <a
                  href={href}
                  className="underline underline-offset-2 break-all"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              )
            },
            img({ src, alt }: any) {
              const imageUrl = typeof src === "string" ? src : ""
              if (!imageUrl) return null
              const imageIndex = imageUrls.indexOf(imageUrl)
              return (
                <img
                  src={imageUrl}
                  alt={typeof alt === "string" ? alt : "Image"}
                  className="my-2 max-h-96 max-w-full cursor-zoom-in rounded-md border border-border/60 object-contain"
                  loading="lazy"
                  onClick={() => setExpandedImageIndex(imageIndex >= 0 ? imageIndex : 0)}
                />
              )
            },
            hr() {
              return <hr className="my-4 border-t border-border/70" />
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {expandedImageIndex !== null && imageUrls[expandedImageIndex] ? (
        <Dialog open={true} onOpenChange={(open) => !open && setExpandedImageIndex(null)}>
          <DialogContent className="max-w-[90vw] border-none bg-transparent p-0 shadow-none [&>button]:hidden">
            <DialogTitle className="sr-only">Expanded image preview</DialogTitle>
            <div className="relative flex items-center justify-center">
              <img
                src={imageUrls[expandedImageIndex]}
                alt="Expanded image"
                className="max-h-[82vh] max-w-[90vw] rounded bg-background/95 object-contain"
              />
            </div>

            {imageUrls.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
                  onClick={showPreviousImage}
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
                  onClick={showNextImage}
                >
                  <ChevronRight className="size-5" />
                </Button>
              </>
            ) : null}

            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 size-9 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
              >
                <X className="size-5" />
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
