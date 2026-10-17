import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  optimizeDeps: {
    // Loaded with import() on submit or sign-in, so the dev server would otherwise
    // discover them late and reload the page mid-interaction.
    include: ["firebase/app", "firebase/app-check", "firebase/auth"],
  },
  ssr: {
    // Workspace package shipped as TypeScript source: bundle it into the server build.
    noExternal: ["@findyourdent/contracts"],
  },
});
