import { bool, envsafe } from "envsafe";
import { defaultFeatureFlags, type FeatureFlags } from "@bb/domain";

const rawFeatureFlagConfig = envsafe({
  BB_FF_ASK_USER_QUESTION: bool({
    desc: "Enable the Ask User Question feature",
    default: defaultFeatureFlags.askUserQuestion,
  }),
});

export const featureFlags: FeatureFlags = {
  askUserQuestion: rawFeatureFlagConfig.BB_FF_ASK_USER_QUESTION,
};
