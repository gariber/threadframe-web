import { defineConfig } from "vite";

// base: "./" 讓成品可以放在網域根目錄或子路徑（GitHub Pages）都能運作。
// 建置時間直接烤進程式碼。手機瀏覽器的快取很容易讓人以為「改了沒生效」，
// 畫面上有版本才分得出是快取還是真的沒部署。
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify(`${BUILD_ID} UTC`),
  },
  plugins: [
    {
      // 一併輸出 version.json，讓已載入的頁面能主動察覺自己是舊版。
      // 資產檔名有雜湊、可以永久快取，真正會過期的只有 index.html。
      name: "emit-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ build: `${BUILD_ID} UTC` }),
        });
      },
    },
  ],
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
