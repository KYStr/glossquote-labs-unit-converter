# GlossQuote-Labs — 常用單位換算 / Unit Converter

正式網站 / Live website: [繁體中文](https://units.glossquote.com/index.html) · [English](https://units.glossquote.com/en/index.html)

## 繁體中文

GlossQuote-Labs 常用單位換算讓你在瀏覽器中快速換算數值，並查看結果與使用的公式。提供 5 類、共 20 個固定單位：長度、面積、質量、容量與溫度。

- 輸入數值或更改單位時即時更新結果與公式。
- 互換來源與目標單位時保留原輸入數值，再重新換算。
- 清除輸入、結果與錯誤時保留目前類別及兩端單位。
- 可切換繁體中文與英文；切換語言會清空輸入。
- 換算在瀏覽器本機完成，不需帳號或 API。輸入只留在目前頁面的記憶體中；重新載入會回到空白狀態。

## English

GlossQuote-Labs Unit Converter quickly converts values in your browser and shows the result and formula. It supports 20 fixed units across five categories: length, area, mass, volume, and temperature.

- Results and formulas update as you type or change a unit.
- Swapping the source and target units keeps the entered value and recalculates it.
- Clear removes the value, result, and errors while keeping the selected category and units.
- Switch between Traditional Chinese and English; switching languages clears the input.
- Conversion runs in the browser. No account or API is required. Input stays in the current page's memory and resets when the page reloads.

## 本機預覽 / Local preview

需要 Node.js 24 或更新版本。此專案沒有 runtime dependencies，無需執行 `npm install`。從儲存庫根目錄啟動本機預覽：

Requires Node.js 24 or later. There are no runtime dependencies and `npm install` is not required. Run the local preview from the repository root:

```sh
npm run dev
```

Open one of these complete URLs in your browser:

- [繁體中文頁面 / Traditional Chinese](http://127.0.0.1:4173/index.html)
- [English page](http://127.0.0.1:4173/en/index.html)

開發伺服器只綁定 `127.0.0.1:4173`。根路徑 `/` 不會導向首頁，會回傳 404；請使用上方完整頁面路徑。按 `Ctrl+C` 停止預覽。

The preview server binds only to `127.0.0.1:4173`. The root path `/` does not redirect and returns 404; use one of the complete page paths above. Press `Ctrl+C` to stop the preview.

## Commands

```sh
npm run dev
npm run test
npm run check
npm run build
```

在 Windows PowerShell 中，將上列 `npm` 換成 `npm.cmd`，例如 `npm.cmd run dev`。測試使用 Node.js 內建的 `node:test`，以離線假資料執行。`npm run build` 會從 `public/` 產生 `dist/`；`dist/` 是可重建產物，已排除追蹤，也不會部署網站。

On Windows PowerShell, use `npm.cmd` in place of `npm`, for example `npm.cmd run dev`. Tests use Node's built-in `node:test` with offline fake data. `npm run build` generates `dist/` from `public/`; `dist/` is reproducible output, is not tracked, and does not deploy the site.

## Source layout

- [`public/`](public/) — Traditional Chinese and English pages, styles, and browser modules.
- [`scripts/`](scripts/) — Local preview, source checks, and build scripts.
- [`test/`](test/) — Offline automated tests.
- [`package.json`](package.json) — Node.js version requirement and project commands.

## 驗證狀態 / Verification status

發布副本於 2026-09-29 實際通過 58/58 項離線自動測試、19 個來源檔的 check，以及產生 9 個靜態檔的 build；`dist/` 與 `public/` 逐檔一致。IAB（應用程式內瀏覽器）的核心操作及 320 CSS px 版面也已驗。這些結果不代表完整 MVP 驗收已完成。

人工待驗項仍為 NOT RUN：

- 以真實瀏覽器頁面縮放控制檢查 200% 縮放。
- 輔助技術／螢幕閱讀器及 BFCache 返回流程。
- DevTools Network／storage 檢查與離線行為。
- 其他瀏覽器及實際行動裝置。

On 2026-09-29, this publishing copy passed 58/58 offline automated tests, a check covering 19 source files, and a build producing 9 static files; `dist/` matches `public/` file by file. Core interactions and the 320 CSS px layout were also checked in the in-app browser (IAB). These results do not mean the full MVP acceptance is complete.

Manual checks remain **NOT RUN**: real browser page zoom at 200%; assistive technology/screen reader and BFCache return behavior; DevTools Network/storage inspection and offline behavior; and additional browsers and physical mobile devices.

## 邊界修正 / Boundary correction — 2026-09-29

修正稽核 F-01：輸入 `1e-12`，將 mm→km、m²→km²、mg→kg、mL→m³ 換算時，現在正確得到 `1e-18`。非溫度換算以已解析 Number 的標準十進位值及固定十進位係數判定結果範圍，再處理合法邊界的浮點偏移；真正超界仍拒絕，顯示仍為最多12位有效數字的近似值。新增回歸測試涵蓋上下界等值與相鄰內外值。四组案例也已在兩語原始 HTTP 頁面實測，共8組通過。

Audit F-01 is fixed: input `1e-12` now correctly produces `1e-18` for mm→km, m²→km², mg→kg, and mL→m³. Non-temperature range checks use the parsed Number's canonical decimal value and the fixed decimal factors, then normalize floating-point drift at valid boundaries. Truly out-of-range results remain rejected; displayed results remain approximate with at most 12 significant digits. Regression tests cover exact limits and adjacent inside/outside values. All eight language/case combinations also passed on the original pages served over local HTTP.

## 發布與搜尋收錄 / Hosting and search indexing

2026-10-07 已正式部署於免費 Cloudflare Static Assets，32 項 HTTPS GET/HEAD/轉址/404/MIME/安全標頭/SEO 驗證通過，11 份公開檔案與正式建置完全一致。繁中、英文的 1 m → 100 cm 與首頁、日期工具互連已實測。實作通過 65 項離線測試；上列人工待驗項保留。繁中為`/index.html`，英文為`/en/index.html`。原始碼與預設建置保留 `noindex, nofollow`，明確正式建置才產生self-canonical、雙語hreflang、x-default、robots與sitemap。

Deployed on free Cloudflare Static Assets on 2026-10-07. All 32 live HTTPS checks passed and all 11 public assets match the reviewed production build byte for byte. Both language versions convert 1 m to 100 cm and link to the matching-language homepage and date tool. The implementation passed 65 offline tests; the manual checks above remain pending. Traditional Chinese uses `/index.html` and English uses `/en/index.html`. Source and default builds remain noindex previews. Explicit production builds emit canonical URLs, bilingual hreflang, x-default, robots and sitemap.

```sh
npm run build -- --production --cloudflare --site-url https://units.glossquote.com/
npm run check -- --production --cloudflare --site-url https://units.glossquote.com/
```

Cloudflare模式產生13檔，包含安全標頭及三個301別名轉址；預設預覽為9檔。`wrangler.jsonc`使用純Static Assets、html_handling none、未知路徑404，workers.dev／預覽網址／自訂日誌／追蹤均關閉。不新增產品依賴。GitHub push與Wrangler正式部署是兩個獨立步驟；未配置Git自動部署。搜尋引擎實際收錄尚未驗證。

Cloudflare builds contain 13 files, including security headers and three permanent alias redirects; previews contain 9 files. Static-only hosting preserves explicit index.html URLs, returns 404 for unknown paths, and disables workers.dev, preview URLs, custom logs and tracking. No product dependency is added. GitHub source publication and Wrangler deployment are separate; automatic Git deployment is not configured. Actual search-engine indexing is unverified.

家族導覽 / Family navigation: 頂部與頁尾可前往同語言[所有工具](https://glossquote.com/index.html)與[日期計算](https://date.glossquote.com/index.html)，不攜帶輸入或追蹤參數。Only six exact family page URLs are allowed as navigation anchors. Remote scripts, styles, images, forms, and link pings remain rejected.

## 授權 / License

目前未指定授權條款，本儲存庫不包含 `LICENSE` 檔。

No license terms are specified. No `LICENSE` file is included.
