/**
 * Irrigation_Core Backend Script
 * Google Apps Script Web App Core Logic
 */

// 試算表分頁名稱定義
const SHEET_NAMES = {
  RECORD: '4. 儲蓄與分配紀錄',
  ASSET: '5. 帳戶資產淨值表',
  SUMMARY: '6. 銀行活儲水位與條件'
};

/**
 * HTTP GET 請求入口，渲染 Web App 主頁面
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('form')
    .setTitle('Irrigation_Core 資金調度系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 取得試算表實例
 * 優先使用 getActiveSpreadsheet
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 讀取「5. 帳戶資產淨值表」A/B/C 欄 (從第 5 列開始)，封裝為下拉選單選項 JSON
 * @returns {Object} JSON 格式選單架構
 */
function getAccountOptions() {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.ASSET);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.ASSET}`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 5) {
      return { success: true, data: [], totalNetWorth: 0 };
    }

    // A欄:銀行, B欄:帳戶, C欄:身兼名目用途, D欄:基準金額, E欄:當前名目餘額 (從第 5 列開始)
    const rangeValues = sheet.getRange(5, 1, lastRow - 4, 5).getValues();

    const optionsMap = [];
    let totalNetWorth = 0;

    rangeValues.forEach(row => {
      const bank = String(row[0] || '').trim();
      const account = String(row[1] || '').trim();
      const purpose = String(row[2] || '').trim();
      const rawBalance = row[4];
      const balance = (typeof rawBalance === 'number' && !isNaN(rawBalance))
        ? rawBalance
        : (parseFloat(rawBalance) || 0);

      if (bank && account && purpose) {
        optionsMap.push({
          bank: bank,
          account: account,
          purpose: purpose,
          balance: balance
        });
        totalNetWorth += balance;
      }
    });

    return {
      success: true,
      data: optionsMap,
      totalNetWorth: totalNetWorth
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '讀取帳戶選單資料失敗'
    };
  }
}

/**
 * 寫入交易紀錄至「4. 儲蓄與分配紀錄」
 * @param {Object} payload 交易資料
 * @returns {Object} 執行結果
 */
function recordTransaction(payload) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.RECORD);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.RECORD}`);
    }

    if (!payload || !payload.mode) {
      throw new Error('未提供有效的交易模式 (mode)');
    }

    const dateStr = payload.date || formatDate(new Date());

    if (payload.mode === 'single') {
      // 單筆記帳
      const { bank, account, purpose, type, amount, description } = payload;

      if (!bank || !account || !purpose) {
        throw new Error('請選擇完整帳戶資訊（銀行/帳戶/名目）');
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('請輸入大於 0 的有效金額');
      }

      const income = type === 'income' ? numAmount : '';
      const expense = type === 'expense' ? numAmount : '';

      sheet.appendRow([
        dateStr,
        bank,
        account,
        purpose,
        description || '',
        income,
        expense
      ]);

      return {
        success: true,
        message: '單筆記帳已成功寫入！'
      };

    } else if (payload.mode === 'transfer') {
      // 資金平移 (轉出 & 轉入)
      const {
        fromBank, fromAccount, fromPurpose,
        toBank, toAccount, toPurpose,
        amount, description
      } = payload;

      if (!fromBank || !fromAccount || !fromPurpose || !toBank || !toAccount || !toPurpose) {
        throw new Error('請選擇完整的轉出與轉入帳戶資訊');
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('請輸入大於 0 的有效金額');
      }

      const baseDesc = description ? ` [${description}]` : '';

      // 1. 轉出筆 (支)
      sheet.appendRow([
        dateStr,
        fromBank,
        fromAccount,
        fromPurpose,
        `資金平移 ➔ 轉出至 ${toBank}-${toAccount}(${toPurpose})${baseDesc}`,
        '',
        numAmount
      ]);

      // 2. 轉入筆 (收)
      sheet.appendRow([
        dateStr,
        toBank,
        toAccount,
        toPurpose,
        `資金平移 ⬅ 來自 ${fromBank}-${fromAccount}(${fromPurpose})${baseDesc}`,
        numAmount,
        ''
      ]);

      return {
        success: true,
        message: '資金平移兩筆紀錄已成功寫入！'
      };

    } else {
      throw new Error(`未知交易模式: ${payload.mode}`);
    }

  } catch (error) {
    return {
      success: false,
      error: error.message || '寫入交易資料失敗'
    };
  }
}

/**
 * 輔助函式：格式化日期為 YYYY/MM/DD
 */
function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * 自動年終數據封存與壓縮
 * 實現交易資料備份至獨立的全新試算表檔案、資產初始金額固化，並清空歷史流水帳。
 */
function archiveAndCompressYearly() {
  try {
    const ss = getSpreadsheet();
    let ui;
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {
      Logger.log("無法取得 UI 介面，將略過彈窗提示。");
    }

    // 1. 取得當前年份，設定備份檔名稱
    const currentYear = new Date().getFullYear();
    const backupFileName = `${currentYear}_歷史紀錄`;

    // 取得當前試算表所在的資料夾
    const currentFileId = ss.getId();
    let folder = null;
    try {
      const currentFile = DriveApp.getFileById(currentFileId);
      const parents = currentFile.getParents();
      if (parents.hasNext()) {
        folder = parents.next();
      }
    } catch (e) {
      Logger.log("無法存取雲端硬碟資料夾資訊：" + e.message);
    }

    // 2. 防呆機制：檢查該資料夾（或雲端硬碟中）是否已有同名檔案
    let fileExists = false;
    if (folder) {
      const folderFiles = folder.getFilesByName(backupFileName);
      if (folderFiles.hasNext()) {
        fileExists = true;
      }
    } else {
      const driveFiles = DriveApp.getFilesByName(backupFileName);
      if (driveFiles.hasNext()) {
        fileExists = true;
      }
    }

    if (fileExists) {
      const msg = `備份失敗：備份檔案「${backupFileName}」已存在，請勿重複備份！\n（若上一次執行逾時中斷，請先前往雲端硬碟刪除該未完成之備份檔，再重新執行）`;
      if (ui) {
        ui.alert(msg);
      } else {
        Logger.log(msg);
      }
      return;
    }

    // 3. 歷史備份：複製分頁「4. 儲蓄與分配紀錄」到新建的獨立試算表檔案中
    const recordSheet = ss.getSheetByName(SHEET_NAMES.RECORD);
    if (!recordSheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.RECORD}`);
    }

    // 建立新的試算表檔案
    const backupSS = SpreadsheetApp.create(backupFileName);
    const newSheet = recordSheet.copyTo(backupSS);
    newSheet.setName(backupFileName);

    // 刪除新檔預設的空白分頁 (工作表1 或 Sheet1)
    const defaultSheet = backupSS.getSheetByName("工作表1") || backupSS.getSheetByName("Sheet1");
    if (defaultSheet) {
      backupSS.deleteSheet(defaultSheet);
    }

    // 將新建立的備份檔移至與當前檔案相同的資料夾
    if (folder) {
      try {
        const backupFile = DriveApp.getFileById(backupSS.getId());
        backupFile.moveTo(folder);
      } catch (e) {
        Logger.log("移動檔案至目標資料夾失敗，備份檔將留在根目錄：" + e.message);
      }
    }

    // 4. 金額固化：
    // 讀取分頁「5. 帳戶資產淨值表」第 5 列起「E 欄」 (當前名目餘額) 的計算結果純數值
    // 將這些純數值覆蓋寫入「D 欄」 (初始金額/過去累積)
    const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);
    if (!assetSheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.ASSET}`);
    }

    const assetLastRow = assetSheet.getLastRow();
    if (assetLastRow >= 5) {
      const numRows = assetLastRow - 4;
      // D 欄為第 4 欄，E 欄為第 5 欄
      const currentBalances = assetSheet.getRange(5, 5, numRows, 1).getValues();
      assetSheet.getRange(5, 4, numRows, 1).setValues(currentBalances);
    }

    // 強制寫入並計算，確保初始金額已固化
    SpreadsheetApp.flush();

    // 5. 清空舊帳：
    // 清空分頁「4. 儲蓄與分配紀錄」第 2 列以後的所有交易明細（保留第 1 列標題欄）
    const recordLastRow = recordSheet.getLastRow();
    if (recordLastRow >= 2) {
      const lastColumn = recordSheet.getLastColumn() || 7;
      // 優先使用 clearContent 進行極速清空內容，防止公式大量重算導致逾時
      recordSheet.getRange(2, 1, recordLastRow - 1, lastColumn).clearContent();
      
      // 強制寫入清空結果，讓 SUMIFS 計算一次性歸零
      SpreadsheetApp.flush();

      // 嘗試刪除多餘列以保持版面乾淨。若列數極多，我們透過 try-catch 確保萬一逾時也不會中斷主程序
      try {
        recordSheet.deleteRows(2, recordLastRow - 1);
      } catch (err) {
        Logger.log("刪除多餘列時逾時或失敗（已成功清空內容）：" + err.message);
      }
    }

    // 6. 提示訊息：完成後跳出警示框提示作業成功完成
    const successMsg = `年終數據封存與壓縮作業已成功完成！\n1. 已建立獨立備份檔案「${backupFileName}」\n2. 已將帳戶初始金額固化\n3. 已清空當前交易明細。`;
    if (ui) {
      ui.alert(successMsg);
    } else {
      Logger.log(successMsg);
    }
  } catch (error) {
    const errorMsg = `年終備份作業失敗：${error.message || error}`;
    let ui;
    try { ui = SpreadsheetApp.getUi(); } catch (e) {}
    if (ui) {
      ui.alert(errorMsg);
    } else {
      Logger.log(errorMsg);
    }
  }
}








