# Irrigation_Core Project Handbook

## ① Project Vision
建立一套個人自動化資產與資金調度系統（Irrigation_Core）。
透過實體銀行帳戶與名目用途的二維結構，精準控管高利活儲、資金流轉與預備金分配。
搭配 Google Apps Script (GAS) Web App 介面，提供極簡、防呆且支援「單筆記帳」與「資金平移（一轉出、一轉入）」的雙模式輸入介面，達到 100% 現金流即時對齊與低摩擦力維護。

---

## ② System Architecture
* **數據層 (Database)**: Google Sheets（儲存日常流水帳與帳戶資產主檔）。
* **邏輯/運算層 (Backend)**: Google Apps Script (GAS)（處理 Web App HTTP 請求、選單資料拉取、當前餘額算術與試算表讀寫，以及年終數據封存與壓縮歸檔）。
* **使用者介面層 (Frontend/UI)**: 
  * GitHub Pages 無標籤包裹層 (`index.html`)：提供無警告橫幅之全螢幕極致體驗。
  * GAS Web App 表單 (`form.html`)：Mobile-First 現代介面，具備動態下拉選單、資金平移模式、即時餘額 Badge 與各帳戶餘額查詢。
* **隱私/防護/權限層 (Security/Privacy)**: `robots.txt` + `meta robots` 嚴格禁止所有搜尋引擎與爬蟲索引/收錄；`appsscript.json` 配置 `ANYONE_ANONYMOUS` 免去第三方 Cookie 401 權限問題。
* **開發環境 (DevOps)**: 本地 IDE + Clasp/Git (Antigravity) <-> Google Apps Script Cloud & GitHub Pages.

---

## ③ Database Schema

### 分頁 4：`4. 儲蓄與分配紀錄`（日常流水帳，資料從第 2 列開始）
* **A 欄**: `交易日期` (YYYY/MM/DD)
* **B 欄**: `實體銀行` (下拉選單，對應分頁 5 A 欄)
* **C 欄**: `實體戶頭` (下拉選單，對應分頁 5 B 欄)
* **D 欄**: `名目帳戶` (下拉選單，對應分頁 5 C 欄)
* **E 欄**: `交易項目說明` (文字)
* **F 欄**: `收 (+)` (數字)
* **G 欄**: `支 (-)` (數字)

### 分頁 5：`5. 帳戶資產淨值表`（資產主檔與自動計價，資料從第 5 列開始）
* **A 欄**: `銀行` (實體銀行名稱，如：臺銀、永豐)
* **B 欄**: `帳戶` (實體帳戶類別，如：數位、一般)
* **C 欄**: `身兼名目用途` (專屬用途，如：日常花銷、預備金)
* **D 欄**: `初始金額/過去累積` (基準金額)
* **E 欄**: `當前名目餘額` (動態計算公式)
  * **E5 公式**: `=D5 + SUMIFS('4. 儲蓄與分配紀錄'!$F:$F, '4. 儲蓄與分配紀錄'!$B:$B, A5, '4. 儲蓄與分配紀錄'!$C:$C, B5, '4. 儲蓄與分配紀錄'!$D:$D, C5) - SUMIFS('4. 儲蓄與分配紀錄'!$G:$G, '4. 儲蓄與分配紀錄'!$B:$B, A5, '4. 儲蓄與分配紀錄'!$C:$C, B5, '4. 儲蓄與分配紀錄'!$D:$D, C5)`

### 分頁 6：`6. 銀行活儲水位與條件`（資料庫解耦獨立表，資料從第 2 列開始）
* **A 欄**: `銀行` (實體銀行名稱)
* **B 欄**: `帳戶類別` (實體帳戶類別)
* **C 欄**: `當前累計總額` (動態跨表加總公式)
  * **C2 公式**: `=SUMIFS('5. 帳戶資產淨值表'!$E:$E, '5. 帳戶資產淨值表'!$A:$A, A2, '5. 帳戶資產淨值表'!$B:$B, B2)`
* **D 欄**: `高利計息上限` (數字)
* **E 欄**: `滿額狀態` (動態計算公式與百分比格式)
  * **E2 公式**: `=IF(D2>0, C2/D2, "---")`
* **F 欄**: `目前利率 / 條件` (文字說明)

---

## ④ Function Library
* `doGet(e)`: 渲染 Web App 主頁面 (`form.html`)。
* `getAccountOptions()`: 讀取「5. 帳戶資產淨值表」A~E 欄 (從第 5 列起)，打包為包含當前餘額與總資產淨值之動態 JSON (`{ data, totalNetWorth }`)。
* `recordTransaction(payload)`: 處理單筆記帳與資金平移（雙筆紀錄），寫入「4. 儲蓄與分配紀錄」。
* `archiveAndCompressYearly()`: 執行自動化年終數據封存與壓縮，包含檢查備份分頁是否重複、複製封存分頁、固化初始金額與清空流水帳。

---

## ⑤ Decision Engine
* **資金平移邏輯**: 當使用者切換至「資金平移」模式時，系統必須將其拆解為兩筆記錄同時寫入分頁 4：
  1. 轉出帳戶：寫入筆記，金額填入 `G 欄 (支)`（說明格式：`資金平移 ➔ 轉出至 {目標帳戶}`）。
  2. 轉入帳戶：寫入筆記，金額填入 `F 欄 (收)`（說明格式：`資金平移 ⬅ 來自 {來源帳戶}`）。
* **平帳原則**: 若遇到歷史利息、回饋或難以對齊的零頭，不回溯查帳，直接於分頁 4 建立「歷史利息與現金回饋平帳」調整項校正 E 欄當前餘額。
* **年終數據封存與壓縮邏輯**:
  * **封存機制**: 自動建立獨立的全新備份試算表檔（檔名：`YYYY_歷史紀錄`，如：`2026_歷史紀錄`），完整備份分頁 `4. 儲蓄與分配紀錄` 至該備份檔，隨後將其移入與主試算表相同的雲端硬碟資料夾。
  * **金額固化**: 將 `5. 帳戶資產淨值表` 第 5 列起之 E 欄當前餘額以「僅貼上值」寫入 D 欄作為新年度的初始金額。
  * **清空邏輯**: 清空 `4. 儲蓄與分配紀錄` 自第 2 列起的所有交易明細（保留第 1 列標題欄與格式）。
  * **防呆安全閥**: 雲端硬碟資料夾若已存在同名備份檔，即強制中止以防重複封存。清空流程優先使用 `clearContent` 清空資料，並使用 `try-catch` 限制 `deleteRows` 移除空列時因公式重算導致的逾時風險。
* **範疇邊界**: 第一階段 MVP 僅處理「實體帳戶扣款/轉帳/提撥」，信用卡消費與兩階段核銷暫不併入 Web App，維持現行獨立追蹤。

---

## ⑥ AI Agents
無

---

## ⑦ Dashboard / UI
* **GitHub Pages 無標籤包裹層 (`index.html`)**:
  * 徹底遮罩 GAS 官方預設之警告橫幅。
  * 支援 iOS/Android PWA 「新增至主畫面」全螢幕體驗。
  * 配置「3D 財富金幣 + 翡翠水滴」質感 App Icon (`favicon.png` / `apple-touch-icon.png`)。
  * 具備 GAS Web App 網址自動記憶與重新設定機制。
* **GAS Web App 表單 (`form.html`)**:
  * 包含模式切換按鈕：`[單筆記帳]` / `[資金平移]` / `[餘額查詢]`。
  * 動態三階連動下拉選單（銀行 -> 帳戶 -> 名目用途）。
  * 記帳選擇帳戶時自動浮現該帳戶之「當前餘額」動態提示 Badge。
  * 「餘額查詢」分頁：包含總資產淨值卡片、一鍵手動刷新按鈕、三階連動下拉選單篩選器與餘額卡片列表。
  * 輸入欄位：交易日期、金額、項目說明。
  * 支援同帳戶轉帳防呆與非同步 Toast 提示。

---

## ⑧ Coding Rules
* 一次只修改一個檔案。
* 程式碼修改遵循：修改 -> 測試 -> PASS -> 更新 Handbook。
* 不使用 Developer Language 作為 UI 標籤，介面使用一般使用者理解之用語。
* 前後端資料傳遞採用 JSON 格式。

---

## ⑨ Current Sprint
* **Sprint 目標**: 完成資料庫解耦重構，將分頁 5 右側「銀行總額統計表」獨立至全新分頁 6。
* **已完成項目**:
  * [x] 完成試算表分頁 4 與分頁 5 的架構大洗牌與 `SUMIFS` 核心公式對齊。
  * [x] 完成 7 月歷史資料輸入與舊帳戶零頭平帳。
  * [x] 本地專案建立與 Clasp clone 至 `Irrigation_Core` 資料夾。
  * [x] 完成 `Code.gs` 後端核心邏輯（`doGet`, `getAccountOptions`, `recordTransaction` API）。
  * [x] 完成 `form.html` 前端介面（雙模式切換、動態連動下拉選單、防呆與非同步送出）。
  * [x] 完成 GitHub Pages 無標籤包裹層 (`index.html`)、嚴格防搜尋引擎收錄 (`robots.txt` & `meta robots`) 與 3D 財富 App Icon (`favicon.png` / `apple-touch-icon.png`)。
  * [x] 修正跨平台檔名大小寫問題，完成 GitHub Pages 部署與端到端 (E2E) 測試驗收。
  * [x] 完成 `Code.gs` 讀取 E 欄名目餘額與計算總資產淨值 API。
  * [x] 完成 `form.html` 增設 `[餘額查詢]` 模式頁籤、總資產淨值卡片、三階連動篩選器與記帳即時餘額 Badge。
  * [x] 完成 `appsscript.json` 權限層修正 (`ANYONE_ANONYMOUS`) 與 Release `@4` 正式發布。
  * [x] 在 `Code.gs` 中實作 `archiveAndCompressYearly()` 函數，完成金額固化與舊帳清空。
  * [x] 在 `Code.gs` 中實作並執行 `migrateBankSummaryToNewSheet()` 一次性遷移函數，完成分頁 6 建置、動態公式注入與分頁 5 右側欄位清理。
* **目前停止位置**: 已完成試算表架構重構（資料庫解耦）與分頁 6 動態公式建置。
* **下一步施工位置**: 進行新版分頁 6 的實機調度與活儲水位維護測試。

---

## ⑩ Current Version
`v1.3.0` (資料庫解耦重構：獨立「6. 銀行活儲水位與條件」分頁)

---

## ⑪ Roadmap
* **Milestone 1**: GAS 後端 API 開發（`Code.gs` 讀取分頁 5 選單 & 寫入分頁 4）。
* **Milestone 2**: HTML/JS 前端 UI 開發（`form.html`，支援單筆與資金平移切換）。
* **Milestone 3**: 部署 Web App 與 GitHub Pages 無標籤包裹層，進行 E2E 驗收。
* **Milestone 4**: 手機端隨時查詢各銀行/戶頭/名目用途餘額與動態即時餘額顯示 (`v1.1.0`)。
* **Milestone 5**: 資料庫解耦重構（獨立「6. 銀行活儲水位與條件」分頁與跨表動態加總，`v1.3.1`）。

---

## ⑫ Development Log
### 2026/07/26
* **專案起頭與環境建置**：完成本地 `Irrigation_Core` 專案初始化、Git / GitHub 遠端倉庫綁定與 Clasp 環境 Clone。
* **Handbook 建立**：建立專案規格手冊 [HANDBOOK.MD](file:///f:/Projects/Irrigation_Core/HANDBOOK.MD)，收錄二維架構、Database Schema 與公式規範。
* **後端邏輯開發 (Code.gs)**：實作 `doGet` (渲染 `form.html`)、`getAccountOptions` (動態選單 JSON) 與 `recordTransaction` (單筆及資金平移拆解寫入分頁 4)。
* **前端 UI 開發 (form.html)**：打造 Mobile-First 玻璃擬物風格 UI，支援「單筆記帳」與「資金平移」雙模式切換、動態三階連動下拉選單、防呆與非同步 Toast 提示。
* **無標籤 GitHub Pages 包裹層 (index.html)**：建立 GitHub Pages 獨立包裹層，徹底蓋住 GAS 官方預設警告標籤。
* **隱私防護與 3D 財富 Icon**：配置 `robots.txt` 與 `meta robots` 嚴格禁止搜尋引擎收錄；設計「3D 財富金幣 + 翡翠水滴」App Icon (`favicon.png`, `apple-touch-icon.png`)。
* **跨平台檔名大小寫修復**：解決 Windows 與 Linux 大小寫檔名相容問題，將 GitHub Pages 首頁強行正名為全小寫 `index.html`，順利解決 404 問題並完成端到端 (E2E) 測試驗收。

### 2026/07/31
* **新增 .gitignore 排除檔**：建立根目錄 [.gitignore](file:///f:/Projects/Irrigation_Core/.gitignore)，排除 Python 暫存檔 (`__pycache__`, `.venv`)、Node log 與編輯器設定。
* **後端資產餘額 API 升級 (Code.gs)**：擴充 `getAccountOptions()` API 讀取「5. 帳戶資產淨值表」E 欄當前名目餘額與加總 `totalNetWorth` 總資產金額。
* **前端手機端餘額查詢與即時提示 (form.html)**：
  * 新增 `[餘額查詢]` 模式頁籤、💎 總資產淨值卡片與 🔄 手動一鍵刷新按鈕。
  * 提供與記帳模式一致的三階連動下拉選單（銀行 ➔ 戶頭 ➔ 名目用途）篩選過濾卡片清單。
  * 記帳模式選定帳戶時動態浮現當前餘額提示 Badge。
* **GAS 權限與多重帳號修復 (appsscript.json)**：新增 `webapp` 清單屬性，設定 `access: ANYONE_ANONYMOUS` 解決跨站 iframe 401 錯誤與 Google 第三方 Cookie 限制。
* **正式發布與部署**：執行 `clasp push` / `clasp deploy` 發布至 Release `@4` 並完成 Git 提交推送到 GitHub。

### 2026/08/05
* **自動年終數據封存與壓縮 (Code.gs)**：
  * 新增 `archiveAndCompressYearly()` API，實作 DriveApp 同資料夾防呆機制，建立獨立備份檔（格式：`YYYY_歷史紀錄`，如 `2026_歷史紀錄`）且自動移除預設空白頁。
  * 實作**極速清空優化**：優先調用 `clearContent()` 並執行 `SpreadsheetApp.flush()` 使 `SUMIFS` 公式即時歸零，最後在 `try-catch` 安全保護下執行 `deleteRows` 移除空列，徹底解決 Google 試算表重算引發的超時問題（Exceeded maximum execution time）。
  * 實作**金額固化強制同步**：將資產淨值表 E 欄當前餘額固化寫入 D 欄後，即時進行 `SpreadsheetApp.flush()` 確保同步。
  * 更新 [HANDBOOK.MD](file:///f:/Projects/Irrigation_Core/HANDBOOK.MD) 的架構說明、決策引擎邏輯與版本號至 `v1.2.0`。

### 2026/08/15
* **優化資金平移交易說明文字 (Code.gs)**：
  * 將原本容易混淆的 `資金平移(轉出) ->` 與 `資金平移(轉入) <-` 格式，優化為選用「選項 1」：
    * 轉出端：`資金平移 ➔ 轉出至 {目標帳戶}`
    * 轉入端：`資金平移 ⬅ 來自 {來源帳戶}`
  * 提昇使用者於試算表中查閱交易紀錄時的閱讀直觀度與明確性。

### 2026/10/09
* **資料庫解耦與試算表架構重構 (Code.gs)**：
  * 實作一次性遷移函數 `migrateBankSummaryToNewSheet()`，建立獨立分頁 `6. 銀行活儲水位與條件`。
  * 實作對應修復函數 `fixBankSummarySheet()`，精準修正 A 欄【銀行】與 B 欄【帳戶】拆分清單（如：永豐/大戶、台企/Hokii、臺銀/數位...共 13 筆實體與數位帳戶條件）。
  * 重新注入 C 欄 `=SUMIFS('5. 帳戶資產淨值表'!$E:$E, '5. 帳戶資產淨值表'!$A:$A, A2, '5. 帳戶資產淨值表'!$B:$B, B2)` 與 E 欄 `=IF(D2>0, C2/D2, "---")` 動態百分比公式，順利解決跨表加總為 0 之問題。
  * 更新 [HANDBOOK.MD](file:///f:/Projects/Irrigation_Core/HANDBOOK.MD) 並升級版本號至 `v1.3.1`。





