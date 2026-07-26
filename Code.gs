/**
 * Irrigation_Core Backend Script
 * Google Apps Script Web App Core Logic
 */

// 試算表分頁名稱定義
const SHEET_NAMES = {
  RECORD: '4. 儲蓄與分配紀錄',
  ASSET: '5. 帳戶資產淨值表'
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
      return { success: true, data: [] };
    }

    // A欄:銀行, B欄:帳戶, C欄:身兼名目用途 (從第 5 列開始)
    const rangeValues = sheet.getRange(5, 1, lastRow - 4, 3).getValues();

    const optionsMap = [];
    rangeValues.forEach(row => {
      const bank = String(row[0] || '').trim();
      const account = String(row[1] || '').trim();
      const purpose = String(row[2] || '').trim();

      if (bank && account && purpose) {
        optionsMap.push({
          bank: bank,
          account: account,
          purpose: purpose
        });
      }
    });

    return {
      success: true,
      data: optionsMap
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
        `資金平移(轉出) -> ${toBank}-${toAccount}(${toPurpose})${baseDesc}`,
        '',
        numAmount
      ]);

      // 2. 轉入筆 (收)
      sheet.appendRow([
        dateStr,
        toBank,
        toAccount,
        toPurpose,
        `資金平移(轉入) <- ${fromBank}-${fromAccount}(${fromPurpose})${baseDesc}`,
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
