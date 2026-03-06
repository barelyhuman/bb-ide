import { useState } from "react";
import type { UIUserMessage } from "@beanbag/agent-core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";

export function UserMessageRow({
  message,
  projectId,
}: {
  message: UIUserMessage;
  projectId?: string;
}) {
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(null);
  const attachments: string[] = [];
  if (message.attachments?.localFiles) {
    const count = message.attachments.localFiles;
    attachments.push(`${count} local file${count === 1 ? "" : "s"}`);
  }

  const imageSources = [
    ...(message.attachments?.imageUrls ?? []),
    ...(message.attachments?.localImagePaths ?? []),
  ];

  const hasMultipleImages = imageSources.length > 1;
  const currentImageSrc =
    expandedImageIndex !== null && imageSources[expandedImageIndex]
      ? toUserAttachmentImageSrc(imageSources[expandedImageIndex], projectId)
      : null;

  return (
    <>
      <div className="group w-full py-2" style={{ overflowAnchor: "none" }}>
        <div className="ml-auto w-fit max-w-[80%]">
          <div className="rounded-md bg-primary/10 p-2 text-sm leading-relaxed text-foreground">
            {message.text ? (
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            ) : (
              <p className="text-muted-foreground">Sent attachments</p>
            )}

            {imageSources.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap justify-end gap-2">
                {imageSources.map((source, index) => (
                  <button
                    key={`${source}-${index}`}
                    type="button"
                    className="cursor-zoom-in overflow-hidden rounded-md border border-primary/30 bg-background/70"
                    onClick={() => setExpandedImageIndex(index)}
                  >
                    <img
                      src={toUserAttachmentImageSrc(source, projectId)}
                      alt={`Attached image ${index + 1}`}
                      className="h-20 max-w-36 object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : null}

            {attachments.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                {attachments.map((attachment) => (
                  <Badge
                    key={attachment}
                    variant="outline"
                    className="rounded-full border-primary/30 bg-background/70 px-2 py-0 ui-text-2xs text-muted-foreground"
                  >
                    {attachment}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {currentImageSrc ? (
        <Dialog open={true} onOpenChange={(open) => !open && setExpandedImageIndex(null)}>
          <DialogContent className="flex h-[90vh] w-[90vw] max-w-[90vw] items-center justify-center border-none bg-transparent p-0 shadow-none [&>button]:hidden">
            <DialogTitle className="sr-only">Attached image preview</DialogTitle>
            <img
              src={currentImageSrc}
              alt="Attached image"
              className="max-h-[82vh] max-w-[90vw] rounded bg-background/95 object-contain"
            />

            {hasMultipleImages ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
                  onClick={() => {
                    setExpandedImageIndex((index) => {
                      if (index === null) return index;
                      return index === 0 ? imageSources.length - 1 : index - 1;
                    });
                  }}
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/60 hover:text-white"
                  onClick={() => {
                    setExpandedImageIndex((index) => {
                      if (index === null) return index;
                      return index === imageSources.length - 1 ? 0 : index + 1;
                    });
                  }}
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
  );
}
