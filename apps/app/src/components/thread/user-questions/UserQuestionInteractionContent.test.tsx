// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PendingInteractionUserQuestionQuestion } from "@bb/domain";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { UserQuestionAnswerForm } from "./UserQuestionInteractionContent";

const questionWithOther: PendingInteractionUserQuestionQuestion = {
  id: "path",
  prompt: "Which implementation path should I take?",
  shortLabel: "Path",
  multiSelect: false,
  options: [
    {
      value: "small",
      label: "Small patch",
      description: "Fix the active issue with minimal churn.",
    },
  ],
  allowFreeText: true,
};

afterEach(() => {
  cleanup();
});

describe("UserQuestionAnswerForm", () => {
  it("autogrows the Other answer textarea from a taller default height", () => {
    const { wrapper } = createQueryClientTestHarness();

    render(
      <UserQuestionAnswerForm
        interactionId="pi_question"
        questions={[questionWithOther]}
        threadId="thr_question"
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Other…" }));

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Path answer",
    });
    expect(textarea.style.height).toBe("84px");
    expect(textarea.style.minHeight).toBe("84px");

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 220,
    });
    fireEvent.change(textarea, {
      target: {
        value: "A longer custom answer that needs more vertical space.",
      },
    });

    expect(textarea.style.height).toBe("158px");
  });
});
