import { Archive, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../src/primitives/ui/button.js";

export default {
  title: "Primitives/Button",
};

const variants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const sizes = ["sm", "default", "lg", "icon"] as const;

export function Variants() {
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        {variants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant === "destructive" ? <Trash2 /> : <Check />}
            {variant}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {sizes.map((size) => (
          <Button
            key={size}
            size={size}
            aria-label={size === "icon" ? "Add item" : undefined}
          >
            {size === "icon" ? <Plus /> : <Archive />}
            {size === "icon" ? null : size}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled outline
        </Button>
      </div>
    </div>
  );
}
