import { describe, expect, it } from "vitest";
import { getImageLightboxKeyAction } from "../src/thread-timeline/ImageLightbox.js";

interface TestKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
}

function createKeyboardEvent(
  key: string,
  overrides: Partial<TestKeyboardEvent> = {},
): TestKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
    ...overrides,
  };
}

describe("ImageLightbox keyboard handling", () => {
  it("keeps Escape active when only a single image is open", () => {
    expect(
      getImageLightboxKeyAction({
        event: createKeyboardEvent("Escape"),
        hasNavigation: false,
      }),
    ).toBe("close");
  });

  it("ignores navigation keys when previous and next controls are unavailable", () => {
    expect(
      getImageLightboxKeyAction({
        event: createKeyboardEvent("ArrowLeft"),
        hasNavigation: false,
      }),
    ).toBeNull();
    expect(
      getImageLightboxKeyAction({
        event: createKeyboardEvent("ArrowRight"),
        hasNavigation: false,
      }),
    ).toBeNull();
  });
});
