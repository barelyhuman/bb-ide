/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: ["src/**/*.stories.tsx"],
  defaultStory: "",
  viteConfig: "./.ladle/vite.config.ts",
  addons: {
    theme: {
      defaultState: "dark",
    },
  },
};
