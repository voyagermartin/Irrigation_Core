# Irrigation_Core Project Handbook

## ① Project Vision
建立一套個人自動化資產與資金調度系統（Irrigation_Core）。
透過實體銀行帳戶與名目用途的二維結構，精準控管高利活儲、資金流轉與預備金分配。
搭配 Google Apps Script (GAS) Web App 介面，提供極簡、防呆且支援「單筆記帳」與「資金平移（一轉出、一轉入）」的雙模式輸入介面，達到 100% 現金流即時對齊與低摩擦力維護。

---

## ② System Architecture
* **數據層 (Database)**: Google Sheets（儲存日常流水帳與帳戶資產主檔）。
* **邏輯/運算層 (Backend)**: Google Apps Script (GAS)（處理 Web App HTTP 請求、選單資料拉取與試算表讀寫）。
* **使用者介面層 (Frontend/UI)**: GAS Web App (HTML/CSS/JS)（支援手機與桌面板，具備動態下拉選單與資金平移模式）。
* **開發環境 (DevOps)**: 本地 IDE + Clasp/Git (Antigravity) <-> Google Apps Script Cloud.

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

---

## ④ Function Library
* `doGet(e)`: 渲染 Web App 主頁面 (`Index.html`)。
* `getAccountOptions()`: 讀取「5. 帳戶資產淨值表」A/B/C 欄 (從第 5 列起)，打包為動態連動選單 JSON。
* `recordTransaction(payload)`: 處理單筆記帳與資金平移（雙筆紀錄），寫入「4. 儲蓄與分配紀錄」。

---

## ⑤ Decision Engine
* **資金平移邏輯**: 當使用者切換至「資金平移」模式時，系統必須將其拆解為兩筆記錄同時寫入分頁 4：
  1. 轉出帳戶：寫入筆記，金額填入 `G 欄 (支)`。
  2. 轉入帳戶：寫入筆記，金額填入 `F 欄 (收)`。
* **平帳原則**: 若遇到歷史利息、回饋或難以對齊的零頭，不回溯查帳，直接於分頁 4 建立「歷史利息與現金回饋平帳」調整項校正 E 欄當前餘額。
* **範疇邊界**: 第一階段 MVP 僅處理「實體帳戶扣款/轉帳/提撥」，信用卡消費與兩階段核銷暫不併入 Web App，維持現行獨立追蹤。

---

## ⑥ AI Agents
無

---

## ⑦ Dashboard / UI
* **GAS Web App 表單**:
  * 包含模式切換按鈕：`[單筆記帳]` / `[資金平移]`。
  * 動態連動下拉選單（銀行 -> 帳戶 -> 名目）。
  * 輸入欄位：交易日期、金額、項目說明。
  * 手機優化 Web 介面。

---

## ⑧ Coding Rules
* 一次只修改一個檔案。
* 程式碼修改遵循：修改 -> 測試 -> PASS -> 更新 Handbook。
* 不使用 Developer Language 作為 UI 標籤，介面使用一般使用者理解之用語。
* 前後端資料傳遞採用 JSON 格式。

---

## ⑨ Current Sprint
* **Sprint 目標**: 建立第一個版本的 GAS Web App（`Code.gs` 與 `Index.html`），實現下拉選單拉取與資料寫入分頁 4。
* **已完成項目**:
  * [x] 完成試算表分頁 4 與分頁 5 的架構大洗牌與 `SUMIFS` 核心公式對齊。
  * [x] 完成 7 月歷史資料輸入與舊帳戶零頭平帳。
  * [x] 本地專案建立與 Clasp clone 至 `Irrigation_Core` 資料夾。
  * [x] 完成 `Code.gs` 後端核心邏輯（`doGet`, `getAccountOptions`, `recordTransaction` API）。
  * [x] 完成 `Index.html` / `form.html` 前端介面（雙模式切換、動態連動下拉選單、防呆與非同步送出）。
  * [x] 完成 GitHub Pages 無標籤包裹層 (`index.html`)、嚴格防搜尋引擎收錄 (`robots.txt` & `meta robots`) 與「財富增值質感 3D App Icon` (Favicon / Apple Touch Icon)。
  * [x] 修正 Windows / Linux 檔名大小寫相容問題（獨立 `index.html` 首頁與 `form.html` 表單）。
* **目前停止位置**: 已完成 GAS Web App 第一版與 GitHub Pages 無標籤包裹層建置，包含檔名大小寫修正與 Clasp / Git 部署。
* **下一步施工位置**: 進行端到端 (E2E) 手機新增至主畫面極速記帳體驗驗收。

---

## ⑩ Current Version
`v0.3.1-beta` (解決跨平台檔名大小寫相容與無標籤 PWA 整合)

---

## ⑪ Roadmap
* **Milestone 1**: GAS 後端 API 開發（`Code.gs` 讀取分頁 5 選單 & 寫入分頁 4）。
* **Milestone 2**: HTML/JS 前端 UI 開發（`Index.html`，支援單筆與資金平移切換）。
* **Milestone 3**: 部署 Web App，進行端到端（E2E）實測驗收。
* **Milestone 4**: 手機桌面捷徑整合與日常營運體驗優化。
