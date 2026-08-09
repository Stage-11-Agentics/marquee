import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  plugins: [cloudflare()],
  resolve: {
    alias: [
      { find: "react/jsx-dev-runtime", replacement: "preact/jsx-dev-runtime" },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react", replacement: "preact/compat" },
    ],
  },
});
