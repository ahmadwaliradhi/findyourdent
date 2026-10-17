import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  future: {
    // Vite's dev dependency scan starts from the client entry and every route module, so a
    // cold dev server finds every dependency up front instead of re-optimizing on the first
    // page load and reloading the page mid-interaction.
    unstable_optimizeDeps: true,
  },
} satisfies Config;
