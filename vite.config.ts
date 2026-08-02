import { defineConfig } from "vite";

// base: "./" 讓成品可以放在網域根目錄或子路徑（GitHub Pages）都能運作。
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
