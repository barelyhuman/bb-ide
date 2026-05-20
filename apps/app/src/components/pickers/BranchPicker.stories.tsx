import { BranchPicker, type BranchPickerProps } from "./BranchPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Branch Picker",
};

const branches = [
  "main",
  "develop",
  "staging",
  "bb/feat/review-flow",
  "bb/fix/timeline-pagination",
  "bb/implement-server-daemon-protocol-simplification-thr_qfk8ksbxkk",
] as const;

const noop = () => {};

type BranchPickerStoryConfig = Omit<
  BranchPickerProps,
  "onChange" | "options" | "variant"
>;

interface BranchPickerStoryRowProps {
  label: string;
  hint: string;
  picker: BranchPickerStoryConfig;
  variant?: BranchPickerProps["variant"];
}

const currentCheckoutPicker: BranchPickerStoryConfig = {
  value: null,
  currentBranch: "main",
  currentOptionLabel: "Current: main",
  currentOptionTitle: "Use the current checkout without switching branches",
  triggerLabel: "Current (main)",
  triggerTitle: "Current: main",
  menuKind: "checkout",
  onClear: noop,
  onCreate: noop,
  modal: false,
};

const branchFromPicker: BranchPickerStoryConfig = {
  value: null,
  currentBranch: "main",
  currentOptionLabel: "main",
  currentOptionTitle: "Branch from: main",
  triggerLabel: "Branch from: main",
  triggerTitle: "Branch from: main",
  menuKind: "base",
  onClear: noop,
  modal: false,
};

const mergeBasePicker: BranchPickerStoryConfig = {
  value: "main",
  modal: false,
};

function BranchPickerStoryRow({
  label,
  hint,
  picker,
  variant,
}: BranchPickerStoryRowProps) {
  return (
    <StoryRow label={label} hint={hint}>
      <BranchPicker
        {...picker}
        options={branches}
        variant={variant}
        onChange={noop}
      />
    </StoryRow>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="190px">
      <BranchPickerStoryRow
        label="choosing current/checkout"
        hint="work locally in the current checkout or switch branches"
        picker={currentCheckoutPicker}
      />
      <BranchPickerStoryRow
        label="choosing branch from"
        hint="pick the base branch for a new worktree"
        picker={branchFromPicker}
      />
      <BranchPickerStoryRow
        label="choosing a merge base"
        hint="pick a comparison branch for an existing worktree"
        picker={mergeBasePicker}
      />
      <BranchPickerStoryRow
        label="minimal current/checkout"
        hint="minimal trigger for local checkout choice"
        picker={currentCheckoutPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="minimal branch from"
        hint="minimal trigger for new worktree base"
        picker={branchFromPicker}
        variant="minimal"
      />
      <BranchPickerStoryRow
        label="minimal merge base"
        hint="minimal trigger for comparison branch"
        picker={mergeBasePicker}
        variant="minimal"
      />
    </StoryCard>
  );
}
