/**
 * Irrigation_Core Backend Script
 * Google Apps Script Web App Core Logic
 */

// 試算表分頁名稱定義
const SHEET_NAMES = {
  RECORD: '4. 儲蓄與分配紀錄',
  ASSET: '5. 帳戶資產淨值表',
  SUMMARY: '6. 銀行活儲水位與條件',
  CC_RECORD: '7. 信用卡消費明細',
  CC_CARDS: '8. 信用卡卡片主檔'
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

    // 讀取「8. 信用卡卡片主檔」，提取有效卡片清單（發卡銀行、卡片暱稱、末四碼、卡片辨識全名）
    const cardSheet = ss.getSheetByName(SHEET_NAMES.CC_CARDS);
    const creditCards = [];
    if (cardSheet) {
      const cardLastRow = cardSheet.getLastRow();
      if (cardLastRow >= 2) {
        const cardValues = cardSheet.getRange(2, 1, cardLastRow - 1, 10).getValues();
        cardValues.forEach(r => {
          const bank = String(r[0] || '').trim();
          const nick = String(r[1] || '').trim();
          const last4 = String(r[2] || '').trim();
          const fullName = String(r[3] || '').trim();
          const status = String(r[8] || '').trim();

          if (bank && status !== '已停用') {
            const displayName = fullName || (nick ? `${nick}${last4 ? ` (${last4})` : ''}` : bank);
            creditCards.push({
              bank: bank,
              nick: nick,
              last4: last4,
              fullName: displayName
            });
          }
        });
      }
    }

    // 提煉不重複的名目用途清單供信用卡扣款名目使用
    const purposeSet = new Set();
    optionsMap.forEach(item => {
      if (item.purpose) purposeSet.add(item.purpose);
    });
    const deductPurposes = Array.from(purposeSet);

    // 讀取「7. 信用卡消費明細」，動態提取消費項目 (E 欄) 與支付通道 (F 欄) 的資料驗證選項
    const recordSheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    let creditItems = [];
    let creditChannels = [];

    function extractValidationOptions(range) {
      if (!range) return [];
      try {
        const val = range.getDataValidation();
        if (!val) return [];
        const type = val.getCriteriaType();
        const vals = val.getCriteriaValues();
        if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST && vals && vals[0]) {
          return vals[0].map(v => String(v || '').trim()).filter(Boolean);
        } else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE && vals && vals[0]) {
          const rangeVals = vals[0].getValues();
          return rangeVals.map(r => String(r[0] || '').trim()).filter(Boolean);
        }
      } catch (err) {
        Logger.log('extractValidationOptions 讀取異常: ' + err.message);
      }
      return [];
    }

    if (recordSheet) {
      creditItems = extractValidationOptions(recordSheet.getRange('E2'));
      if (creditItems.length === 0) {
        creditItems = extractValidationOptions(recordSheet.getRange('E3'));
      }

      creditChannels = extractValidationOptions(recordSheet.getRange('F2'));
      if (creditChannels.length === 0) {
        creditChannels = extractValidationOptions(recordSheet.getRange('F3'));
      }
    }

    // 若未設定或讀取為空，提供預設選項安全 fallback
    if (!creditItems || creditItems.length === 0) {
      creditItems = ['悠遊卡加值', '台鐵票', '高鐵票', '超商消費', '外食餐飲', '日常用品', '生鮮超市', '加油', '訂閱服務', '其他'];
    }
    if (!creditChannels || creditChannels.length === 0) {
      creditChannels = ['實體刷卡', 'LINE Pay', '街口支付', 'Apple Pay', '悠遊卡/一卡通', '網路購物', '其他'];
    }

    creditItems = [...new Set(creditItems)];
    creditChannels = [...new Set(creditChannels)];

    return {
      success: true,
      data: optionsMap,
      totalNetWorth: totalNetWorth,
      creditCards: creditCards,
      deductPurposes: deductPurposes,
      creditItems: creditItems,
      creditChannels: creditChannels
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
 * 寫入信用卡刷卡交易紀錄至「7. 信用卡消費明細」
 * @param {Object} payload 信用卡交易資料
 * @returns {Object} 執行結果
 */
function recordCreditCardTransaction(payload) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);
    }

    if (!payload) {
      throw new Error('未提供交易資料');
    }

    const date = payload.date; // YYYY/MM/DD or YYYY-MM-DD
    const bank = String(payload.bank || '').trim();
    const card = String(payload.card || '').trim();
    const item = String(payload.item || '').trim();
    const channel = String(payload.channel || '').trim();
    const amount = parseFloat(payload.amount);
    const purpose = String(payload.purpose || '').trim();
    const note = String(payload.note || '').trim();

    if (!date) throw new Error('請選擇消費日期');
    if (!bank) throw new Error('請選擇發卡銀行');
    if (!card) throw new Error('請選擇卡片');
    if (!item) throw new Error('請選擇消費項目');
    if (!channel) throw new Error('請選擇支付通道');
    if (isNaN(amount) || amount <= 0) throw new Error('請輸入有效的消費金額（需大於 0）');

    // 格式化日期為 YYYY/MM/DD
    const formattedDate = date.replace(/-/g, '/');

    // 計算帳單週期 (若有傳入則使用，否則依據消費日期預設為 YYYY-MM)
    const billCycle = payload.billCycle || formattedDate.substring(0, 7).replace('/', '-');

    // 取得寫入位置：從第 2 列起往下搜尋第一個「消費日期與發卡銀行皆為空」的真正空白列
    // 避免因 A 欄 Checkbox 或預設驗證導致 getLastRow 誤判為 500+ 列
    let targetRow = 2;
    const maxRows = sheet.getMaxRows();
    const lastRow = sheet.getLastRow();
    const rowsToCheck = Math.max(lastRow, 2) - 1;

    if (rowsToCheck > 0) {
      const checkValues = sheet.getRange(2, 2, rowsToCheck, 2).getValues();
      let foundEmpty = false;
      for (let i = 0; i < checkValues.length; i++) {
        const d = checkValues[i][0];
        const b = checkValues[i][1];
        if ((d === '' || d === null || d === undefined) &&
            (b === '' || b === null || b === undefined)) {
          targetRow = i + 2;
          foundEmpty = true;
          break;
        }
      }
      if (!foundEmpty) {
        targetRow = rowsToCheck + 2;
      }
    }

    if (targetRow > maxRows) {
      sheet.insertRowsAfter(maxRows, targetRow - maxRows);
    }

    // 12 欄結構定義：
    // A: 帳單核對 (FALSE)
    // B: 消費日期
    // C: 發卡銀行
    // D: 卡片
    // E: 消費項目
    // F: 支付通道
    // G: 消費金額
    // H: 撥款狀態 ('待撥款')
    // I: 撥款調度日期 ('')
    // J: 帳單週期 (billCycle)
    // K: 對應扣款名目 (purpose)
    // L: 備註 (note)
    const rowData = [
      false,         // A: 帳單核對
      formattedDate, // B: 消費日期
      bank,          // C: 發卡銀行
      card,          // D: 卡片
      item,          // E: 消費項目
      channel,       // F: 支付通道
      amount,        // G: 消費金額
      '待撥款',      // H: 撥款狀態
      '',            // I: 撥款調度日期
      billCycle,     // J: 帳單週期
      purpose,       // K: 對應扣款名目
      note           // L: 備註
    ];

    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

    // 確保 A 欄配置原生 Checkbox 資料驗證
    const checkboxRule = SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .build();
    sheet.getRange(targetRow, 1).setDataValidation(checkboxRule).setHorizontalAlignment('center');

    // 確保 B 欄日期與 G 欄金額格式
    sheet.getRange(targetRow, 2).setNumberFormat('yyyy/mm/dd').setHorizontalAlignment('center');
    sheet.getRange(targetRow, 7).setNumberFormat('#,##0');
    sheet.getRange(targetRow, 8).setHorizontalAlignment('center');

    SpreadsheetApp.flush();

    return {
      success: true,
      message: `刷卡紀錄已成功寫入！金額：$${amount.toLocaleString()}（${card} - ${item}）`
    };
  } catch (error) {
    Logger.log('recordCreditCardTransaction 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '刷卡紀錄寫入失敗'
    };
  }
}

/**
 * 讀取「4. 儲蓄與分配紀錄」工作表最後 N 筆資料（預設 25 筆），依時間倒序傳回 JSON 陣列
 * @param {number} [limit=25] 讀取筆數上限
 * @returns {Object} 包含交易紀錄陣列之 JSON 物件
 */
function getRecentTransactions(limit) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.RECORD);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.RECORD}`);
    }

    const lastRow = sheet.getLastRow();
    // 分頁第 1 列為標題列，資料從第 2 列開始
    if (lastRow <= 1) {
      return { success: true, data: [] };
    }

    const maxCount = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : 25;
    const totalDataRows = lastRow - 1;
    const fetchCount = Math.min(maxCount, totalDataRows);
    const startRow = lastRow - fetchCount + 1;

    // A: 交易日期, B: 實體銀行, C: 實體戶頭, D: 名目帳戶, E: 交易項目說明, F: 收 (+), G: 支 (-)
    const values = sheet.getRange(startRow, 1, fetchCount, 7).getValues();

    const transactions = [];

    // 依時間倒序（最新記錄排在最前）
    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const rawDate = row[0];
      let formattedDate = '';
      if (rawDate instanceof Date) {
        formattedDate = formatDate(rawDate);
      } else if (rawDate) {
        formattedDate = String(rawDate).trim();
      }

      const bank = String(row[1] || '').trim();
      const account = String(row[2] || '').trim();
      const purpose = String(row[3] || '').trim();
      const description = String(row[4] || '').trim();

      const rawIncome = row[5];
      const rawExpense = row[6];

      const hasIncome = rawIncome !== '' && rawIncome !== null && !isNaN(Number(rawIncome)) && Number(rawIncome) > 0;
      const hasExpense = rawExpense !== '' && rawExpense !== null && !isNaN(Number(rawExpense)) && Number(rawExpense) > 0;

      let type = 'expense';
      let amount = 0;

      if (hasIncome) {
        type = 'income';
        amount = Number(rawIncome);
      } else if (hasExpense) {
        type = 'expense';
        amount = Number(rawExpense);
      } else {
        const incVal = Number(rawIncome) || 0;
        const expVal = Number(rawExpense) || 0;
        if (incVal > expVal) {
          type = 'income';
          amount = incVal;
        } else {
          type = 'expense';
          amount = expVal;
        }
      }

      transactions.push({
        date: formattedDate,
        bank: bank,
        account: account,
        purpose: purpose,
        description: description,
        type: type,
        amount: amount,
        income: hasIncome ? Number(rawIncome) : null,
        expense: hasExpense ? Number(rawExpense) : null
      });
    }

    return {
      success: true,
      data: transactions
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '讀取交易紀錄失敗'
    };
  }
}

/**
 * 讀取「7. 信用卡消費明細」最新 N 筆資料（預設 30 筆），依時間倒序傳回 JSON 陣列與待撥款總額
 * @param {number} [limit=30] 讀取筆數上限
 * @param {string} [statusFilter=''] 撥款狀態篩選 ('待撥款' | '已撥款' | '')
 * @returns {Object} 包含信用卡交易陣列與待撥款總額之 JSON 物件
 */
function getCreditCardTransactions(limit, statusFilter) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return {
        success: true,
        pendingAmount: 0,
        data: []
      };
    }

    const totalDataRows = lastRow - 1;
    // 讀取 A 到 L (12 欄)
    const allValues = sheet.getRange(2, 1, totalDataRows, 12).getValues();

    let pendingAmount = 0;
    const collected = [];

    // 計算待撥款總額，並倒序收集符合條件的資料
    for (let i = allValues.length - 1; i >= 0; i--) {
      const row = allValues[i];
      const isChecked = Boolean(row[0]);
      const rawDate = row[1];
      let formattedDate = '';
      if (rawDate instanceof Date) {
        formattedDate = formatDate(rawDate);
      } else if (rawDate) {
        formattedDate = String(rawDate).trim();
      }

      const bank = String(row[2] || '').trim();
      const card = String(row[3] || '').trim();
      const item = String(row[4] || '').trim();
      const channel = String(row[5] || '').trim();
      const amount = Number(row[6]) || 0;
      const status = String(row[7] || '').trim() || '待撥款';
      const transferDate = row[8] instanceof Date ? formatDate(row[8]) : String(row[8] || '').trim();
      const billCycle = String(row[9] || '').trim();
      const purpose = String(row[10] || '').trim();
      const note = String(row[11] || '').trim();

      // 累計待撥款總額（全表待撥款總合）
      if (status === '待撥款') {
        pendingAmount += amount;
      }

      // 排除全空白列
      if (!bank && !card && !amount) {
        continue;
      }

      // 撥款狀態篩選
      if (statusFilter && status !== statusFilter) {
        continue;
      }

      collected.push({
        checked: isChecked,
        date: formattedDate,
        bank: bank,
        card: card,
        item: item,
        channel: channel,
        amount: amount,
        status: status,
        transferDate: transferDate,
        billCycle: billCycle,
        purpose: purpose,
        note: note
      });
    }

    const maxCount = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : 30;
    const data = collected.slice(0, maxCount);

    return {
      success: true,
      pendingAmount: pendingAmount,
      data: data
    };
  } catch (error) {
    Logger.log('getCreditCardTransactions 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '讀取信用卡消費紀錄失敗',
      pendingAmount: 0,
      data: []
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

/**
 * 一次性初始化信用卡資料庫分頁：
 * 1. 讀取「5. 帳戶資產淨值表」提取不重複實體銀行清單
 * 2. 建立分頁「8. 信用卡卡片主檔」並自動帶入銀行與公式
 * 3. 建立分頁「7. 信用卡消費明細」並配置資料驗證下拉選單
 */
function initCreditCardSheetsWithAutoBanks() {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      throw new Error('無法取得試算表實例');
    }

    // 1. 動態讀取分頁 5 主檔
    const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);
    if (!assetSheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.ASSET}`);
    }

    const assetLastRow = assetSheet.getLastRow();
    if (assetLastRow < 5) {
      throw new Error(`分頁「${SHEET_NAMES.ASSET}」無足夠資料列 (列數 < 5)`);
    }

    // 讀取 A:銀行, B:帳戶, C:身兼名目用途 (從第 5 列開始)
    const assetValues = assetSheet.getRange(5, 1, assetLastRow - 4, 3).getValues();
    const bankSet = new Set();
    const defaultAccountMap = {};

    assetValues.forEach(row => {
      const bank = String(row[0] || '').trim();
      const account = String(row[1] || '').trim();
      const purpose = String(row[2] || '').trim();

      if (bank && 
          !bank.includes('合計') && 
          !bank.includes('總額') && 
          !bank.includes('淨值') && 
          !bank.includes('小計') && 
          !bank.includes('統計') && 
          !bank.includes('資產')) {
        bankSet.add(bank);

        if (!defaultAccountMap[bank]) {
          defaultAccountMap[bank] = account;
        }
        // 若在分頁 5 有找到「信用卡扣繳戶」，優先採用
        if (purpose.includes('信用卡') || purpose.includes('扣繳') || account.includes('扣繳')) {
          defaultAccountMap[bank] = account;
        }
      }
    });

    const bankList = Array.from(bankSet);
    if (bankList.length === 0) {
      throw new Error('未從分頁 5 讀取到任何實體銀行名稱');
    }

    const headerBgColor = '#1e3a8a'; // 深海藍底
    const headerFontColor = '#ffffff'; // 白字

    // 2. 建立分頁：「8. 信用卡卡片主檔」
    let cardSheet = ss.getSheetByName(SHEET_NAMES.CC_CARDS);
    if (!cardSheet) {
      cardSheet = ss.insertSheet(SHEET_NAMES.CC_CARDS);
    } else {
      const curLastRow = cardSheet.getLastRow();
      if (curLastRow >= 2) {
        cardSheet.getRange(2, 1, curLastRow - 1, 10).clearContent();
      }
    }

    cardSheet.setFrozenRows(1);

    const cardHeaders = [
      '發卡銀行', '卡片暱稱', '卡號末四碼', '卡片辨識全名',
      '每月結帳日', '每月繳款截止日', '扣繳銀行', '扣繳帳戶', '狀態', '備註/權益'
    ];

    // 設定標題列格式
    const cardHeaderRange = cardSheet.getRange(1, 1, 1, cardHeaders.length);
    cardHeaderRange.setValues([cardHeaders])
      .setBackground(headerBgColor)
      .setFontColor(headerFontColor)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');

    // 自動帶入資料（A2 開始）
    const cardDataRows = [];
    for (let i = 0; i < bankList.length; i++) {
      const b = bankList[i];
      const rowIdx = i + 2;
      const formulaFullName = `=IF(B${rowIdx}<>"", B${rowIdx} & " (" & C${rowIdx} & ")", "")`;
      const deductBank = b;
      const formulaDeductAccount = `=IF(G${rowIdx}<>"", IFERROR(INDEX(FILTER('5. 帳戶資產淨值表'!$B$5:$B, '5. 帳戶資產淨值表'!$A$5:$A=G${rowIdx}, '5. 帳戶資產淨值表'!$C$5:$C="信用卡扣繳戶"), 1), IFERROR(XLOOKUP(G${rowIdx}, '5. 帳戶資產淨值表'!$A$5:$A, '5. 帳戶資產淨值表'!$B$5:$B), "")), "")`;
      cardDataRows.push([
        b,                    // 發卡銀行
        '',                   // 卡片暱稱
        '',                   // 卡號末四碼
        formulaFullName,      // 卡片辨識全名
        '',                   // 每月結帳日
        '',                   // 每月繳款截止日
        deductBank,           // 扣繳銀行
        formulaDeductAccount, // 扣繳帳戶
        '使用中',              // 狀態
        ''                    // 備註/權益
      ]);
    }

    if (cardDataRows.length > 0) {
      cardSheet.getRange(2, 1, cardDataRows.length, cardHeaders.length).setValues(cardDataRows);
    }

    // 設定資料驗證
    // A 欄 (發卡銀行) 與 G 欄 (扣繳銀行) 動態開放範圍連動分頁 5 A 欄
    const bankRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(assetSheet.getRange('A5:A'), true)
      .setAllowInvalid(true)
      .build();
    cardSheet.getRange('A2:A500').setDataValidation(bankRule);
    cardSheet.getRange('G2:G500').setDataValidation(bankRule);

    // I 欄 (狀態)
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['使用中', '已停用'], true)
      .setAllowInvalid(false)
      .build();
    cardSheet.getRange('I2:I100').setDataValidation(statusRule);

    // 欄寬自訂優化
    cardSheet.setColumnWidth(1, 110); // 發卡銀行
    cardSheet.setColumnWidth(2, 120); // 卡片暱稱
    cardSheet.setColumnWidth(3, 100); // 卡號末四碼
    cardSheet.setColumnWidth(4, 160); // 卡片辨識全名
    cardSheet.setColumnWidth(5, 110); // 每月結帳日
    cardSheet.setColumnWidth(6, 130); // 每月繳款截止日
    cardSheet.setColumnWidth(7, 110); // 扣繳銀行
    cardSheet.setColumnWidth(8, 120); // 扣繳帳戶
    cardSheet.setColumnWidth(9, 90);  // 狀態
    cardSheet.setColumnWidth(10, 180); // 備註/權益

    // 3. 建立並升級分頁：「7. 信用卡消費明細」為 12 欄標準結構
    upgradeCreditCardCheckMechanism();

    SpreadsheetApp.flush();

    return {
      success: true,
      message: '信用卡模組分頁初始化成功！',
      bankCount: bankList.length,
      banks: bankList,
      sheetCreated: {
        cards: SHEET_NAMES.CC_CARDS,
        records: SHEET_NAMES.CC_RECORD
      }
    };
  } catch (error) {
    Logger.log('initCreditCardSheetsWithAutoBanks 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '信用卡模組分頁初始化失敗'
    };
  }
}

/**
 * 設定並升級分頁「7. 信用卡消費明細」之逐筆對帳 Check 與批次撥款機制：
 * 1. 調整標題列欄位結構（A: 帳單核對 ~ L: 備註）
 * 2. 注入 Google Sheets 原生 Checkbox 核取方塊
 * 3. 設定下拉選單與欄位格式（銀行/卡片/名目跨表連動）
 * 4. 頂部凍結區注入「已核對待撥款總額」看板公式
 * 5. 配置條件式格式：
 *    - A 欄為 TRUE 時，B~G 欄自動變為深灰色文字並加上刪除線
 *    - H 欄為「已撥款」時，A~L 欄自動變為淡灰底色
 */
function upgradeCreditCardCheckMechanism() {
  try {
    const ss = getSpreadsheet();
    if (!ss) throw new Error('無法取得試算表實例');

    const recordSheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!recordSheet) throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);

    const cardSheet = ss.getSheetByName(SHEET_NAMES.CC_CARDS);
    const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);

    recordSheet.setFrozenRows(1);

    // 1. 標題列結構定義 (A~L 欄)
    const headers = [
      '帳單核對',      // A
      '消費日期',      // B
      '發卡銀行',      // C
      '卡片',          // D
      '消費項目',      // E
      '支付通道',      // F
      '消費金額',      // G
      '撥款狀態',      // H
      '撥款調度日期',  // I
      '帳單週期',      // J
      '對應扣款名目',  // K
      '備註'           // L
    ];

    const headerBgColor = '#1e3a8a';
    const headerFontColor = '#ffffff';

    // 寫入 A1:L1 標題
    recordSheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground(headerBgColor)
      .setFontColor(headerFontColor)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');

    // 頂部看板摘要（M1: 標籤, N1: 公式）
    recordSheet.getRange('M1')
      .setValue('已核對待撥款總額')
      .setBackground('#065f46')
      .setFontColor('#a7f3d0')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');

    recordSheet.getRange('N1')
      .setFormula('=SUMIFS(G:G, A:A, TRUE, H:H, "待撥款")')
      .setBackground('#064e3b')
      .setFontColor('#34d399')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setNumberFormat('$#,##0');

    // 2. A 欄：插入原生 Checkbox 核取方塊 (A2:A500)
    const checkboxRule = SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .build();
    recordSheet.getRange('A2:A500')
      .setDataValidation(checkboxRule)
      .setHorizontalAlignment('center');

    // 3. 欄位格式化與資料驗證
    // B 欄 (消費日期): 日期格式
    recordSheet.getRange('B2:B500')
      .setNumberFormat('yyyy/mm/dd')
      .setHorizontalAlignment('center');

    // C 欄 (發卡銀行): 下拉選單連動分頁 8 A 欄動態開放範圍 (A2:A)
    if (cardSheet) {
      const bankRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(cardSheet.getRange('A2:A'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('C2:C500').setDataValidation(bankRule);
    }

    // D 欄 (卡片): 下拉選單連動分頁 8 D 欄動態開放範圍 (D2:D, 卡片辨識全名)
    if (cardSheet) {
      const cardRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(cardSheet.getRange('D2:D'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('D2:D500').setDataValidation(cardRule);
    }

    // E 欄 (消費項目): 下拉選單（常用項目推薦，允許自由輸入自訂項目）
    recordSheet.getRange('E2:E500').clearDataValidations();
    const commonItems = ['悠遊卡加值', '台鐵票', '高鐵票', '超商消費', '外食餐飲', '日常用品', '生鮮超市', '加油', '訂閱服務', '其他'];
    const itemRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(commonItems, true)
      .setAllowInvalid(true)
      .build();
    recordSheet.getRange('E2:E500').setDataValidation(itemRule);

    // F 欄 (支付通道): 下拉選單（獨立設定，徹底解除與 E 欄的合併）
    recordSheet.getRange('F2:F500').clearDataValidations();
    const channels = ['實體刷卡', 'LINE Pay', '街口支付', 'Apple Pay', '悠遊卡/一卡通', '網路購物', '其他'];
    const channelRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(channels, true)
      .setAllowInvalid(true)
      .build();
    recordSheet.getRange('F2:F500').setDataValidation(channelRule);

    // G 欄 (消費金額): 數字千分位格式
    recordSheet.getRange('G2:G500').setNumberFormat('#,##0');

    // H 欄 (撥款狀態): 下拉選單 (待撥款 / 已撥款)
    const dispatchRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['待撥款', '已撥款'], true)
      .setAllowInvalid(false)
      .build();
    recordSheet.getRange('H2:H500')
      .setDataValidation(dispatchRule)
      .setHorizontalAlignment('center');

    // I 欄 (撥款調度日期): 日期格式
    recordSheet.getRange('I2:I500')
      .setNumberFormat('yyyy/mm/dd')
      .setHorizontalAlignment('center');

    // J 欄 (帳單週期): 純文字格式
    recordSheet.getRange('J2:J500')
      .setNumberFormat('@')
      .setHorizontalAlignment('center');

    // K 欄 (對應扣款名目): 下拉選單連動分頁 5 C 欄名目用途動態開放範圍 (C5:C)
    if (assetSheet) {
      const purposeRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(assetSheet.getRange('C5:C'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('K2:K500').setDataValidation(purposeRule);
    }

    // 4. 設定欄寬自訂優化
    recordSheet.setColumnWidth(1, 80);   // A: 帳單核對
    recordSheet.setColumnWidth(2, 110);  // B: 消費日期
    recordSheet.setColumnWidth(3, 110);  // C: 發卡銀行
    recordSheet.setColumnWidth(4, 160);  // D: 卡片
    recordSheet.setColumnWidth(5, 160);  // E: 消費項目
    recordSheet.setColumnWidth(6, 120);  // F: 支付通道
    recordSheet.setColumnWidth(7, 110);  // G: 消費金額
    recordSheet.setColumnWidth(8, 100);  // H: 撥款狀態
    recordSheet.setColumnWidth(9, 120);  // I: 撥款調度日期
    recordSheet.setColumnWidth(10, 110); // J: 帳單週期
    recordSheet.setColumnWidth(11, 140); // K: 對應扣款名目
    recordSheet.setColumnWidth(12, 180); // L: 備註
    recordSheet.setColumnWidth(13, 140); // M: 看板標籤
    recordSheet.setColumnWidth(14, 120); // N: 看板金額

    // 5. 配置條件式格式
    // 規則 1: 當 H 欄為「已撥款」時，A~L 欄套用淡灰底色 (#f1f5f9) 與淡灰文字 (#64748b)
    const ruleDispatched = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$H2="已撥款"')
      .setBackground('#f1f5f9')
      .setFontColor('#64748b')
      .setRanges([recordSheet.getRange('A2:L500')])
      .build();

    // 規則 2: 當 A 欄為 TRUE（已勾選核對）時，B~G 欄自動變為深灰色文字 (#9ca3af) 並加上刪除線
    const ruleChecked = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$A2=TRUE')
      .setFontColor('#9ca3af')
      .setStrikethrough(true)
      .setRanges([recordSheet.getRange('B2:G500')])
      .build();

    recordSheet.setConditionalFormatRules([ruleDispatched, ruleChecked]);

    SpreadsheetApp.flush();

    return {
      success: true,
      message: '分頁「7. 信用卡消費明細」對帳與撥款機制升級成功！',
      sheet: SHEET_NAMES.CC_RECORD,
      columnsCount: headers.length,
      headers: headers
    };
  } catch (error) {
    Logger.log('upgradeCreditCardCheckMechanism 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '升級分頁 7 失敗'
    };
  }
}

/**
 * 輔助函式：批次將指定銀行且已勾選帳單核對 (A 欄為 TRUE) 之待撥款交易更新為已撥款
 * @param {string} targetBank 目標發卡銀行（如：'永豐'、'富邦'，若傳入 'ALL' 或留空則針對全部已勾選銀行）
 * @param {string} [transferDate] 撥款調度日期（預設為今天 YYYY/MM/DD）
 * @returns {Object} 執行結果與更新筆數
 */
function batchMarkAsTransferred(targetBank, transferDate) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!sheet) {
      throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, updatedCount: 0, message: '目前尚無交易明細' };
    }

    const dateStr = transferDate || formatDate(new Date());
    // 讀取 A 欄 (核對)、C 欄 (發卡銀行)、H 欄 (撥款狀態)
    const rangeValues = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

    const rowsToUpdate = [];
    const filterBank = targetBank ? String(targetBank).trim() : '';

    for (let i = 0; i < rangeValues.length; i++) {
      const row = rangeValues[i];
      const isChecked = row[0] === true || String(row[0]).toUpperCase() === 'TRUE';
      const bank = String(row[2] || '').trim();
      const status = String(row[7] || '').trim();

      const bankMatch = !filterBank || filterBank === 'ALL' || bank === filterBank;
      const statusMatch = status === '待撥款' || status === '';

      if (isChecked && bankMatch && statusMatch) {
        rowsToUpdate.push(i + 2); // 實際列號 (1-based, header is row 1)
      }
    }

    if (rowsToUpdate.length === 0) {
      return {
        success: true,
        updatedCount: 0,
        message: `未找到符合條件（${filterBank || '全部銀行'}、已勾選核對且待撥款）的交易`
      };
    }

    // 批次寫入 H 欄 (已撥款) 與 I 欄 (撥款調度日期)
    rowsToUpdate.forEach(rowIdx => {
      sheet.getRange(rowIdx, 8).setValue('已撥款');
      sheet.getRange(rowIdx, 9).setValue(dateStr);
    });

    SpreadsheetApp.flush();

    return {
      success: true,
      updatedCount: rowsToUpdate.length,
      updatedRows: rowsToUpdate,
      bank: filterBank || '全部銀行',
      transferDate: dateStr,
      message: `已成功批次更新 ${rowsToUpdate.length} 筆交易為「已撥款」，撥款日期：${dateStr}`
    };
  } catch (error) {
    Logger.log('batchMarkAsTransferred 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '批次撥款更新失敗'
    };
  }
}

/**
 * 升級分頁「8. 信用卡卡片主檔」H 欄【扣繳帳戶】：
 * 將 H 欄改為自動化連動公式，依據 G 欄扣繳銀行自動至分頁 5 查找對應帳戶（優先比對「信用卡扣繳戶」名目）。
 * 支援手動覆蓋或自訂特殊帳戶。
 */
function upgradeCardDeductAccountFormula() {
  try {
    const ss = getSpreadsheet();
    if (!ss) throw new Error('無法取得試算表實例');

    const cardSheet = ss.getSheetByName(SHEET_NAMES.CC_CARDS);
    if (!cardSheet) throw new Error(`找不到分頁: ${SHEET_NAMES.CC_CARDS}`);

    const lastRow = Math.max(cardSheet.getLastRow(), 25);
    const formulas = [];

    for (let r = 2; r <= Math.max(lastRow, 100); r++) {
      const formula = `=IF(G${r}<>"", IFERROR(INDEX(FILTER('5. 帳戶資產淨值表'!$B$5:$B, '5. 帳戶資產淨值表'!$A$5:$A=G${r}, '5. 帳戶資產淨值表'!$C$5:$C="信用卡扣繳戶"), 1), IFERROR(XLOOKUP(G${r}, '5. 帳戶資產淨值表'!$A$5:$A, '5. 帳戶資產淨值表'!$B$5:$B), "")), "")`;
      formulas.push([formula]);
    }

    cardSheet.getRange(2, 8, formulas.length, 1).setFormulas(formulas);
    SpreadsheetApp.flush();

    return {
      success: true,
      message: '分頁「8. 信用卡卡片主檔」H 欄扣繳帳戶連動公式設定成功！',
      rowsUpdated: formulas.length
    };
  } catch (error) {
    Logger.log('upgradeCardDeductAccountFormula 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '扣繳帳戶公式升級失敗'
    };
  }
}

/**
 * 從「5. 帳戶資產淨值表」讀取各銀行所屬帳戶清單與推薦扣繳帳戶
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss 試算表實例
 * @returns {Object} { [bankName]: { accounts: string[], preferred: string } }
 */
function getBankAccountsMapFromAssetSheet(ss) {
  const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);
  if (!assetSheet) return {};

  const lastRow = assetSheet.getLastRow();
  if (lastRow < 5) return {};

  // A 欄: 銀行, B 欄: 帳戶, C 欄: 名目用途
  const values = assetSheet.getRange(5, 1, lastRow - 4, 3).getValues();
  const bankMap = {};

  values.forEach(row => {
    const bank = String(row[0] || '').trim();
    const account = String(row[1] || '').trim();
    const purpose = String(row[2] || '').trim();

    if (bank && account &&
        !bank.includes('合計') &&
        !bank.includes('總額') &&
        !bank.includes('淨值') &&
        !bank.includes('小計') &&
        !bank.includes('統計') &&
        !bank.includes('資產')) {

      if (!bankMap[bank]) {
        bankMap[bank] = { accounts: [], preferred: '' };
      }

      if (!bankMap[bank].accounts.includes(account)) {
        bankMap[bank].accounts.push(account);
      }

      // 若名目包含「信用卡」或「扣繳」，優先設為預設扣繳帳戶
      if (purpose.includes('信用卡') || purpose.includes('扣繳') || account.includes('扣繳')) {
        bankMap[bank].preferred = account;
      }
    }
  });

  // 若未標註信用卡扣繳，預設為第一個帳戶
  Object.keys(bankMap).forEach(bank => {
    if (!bankMap[bank].preferred && bankMap[bank].accounts.length > 0) {
      bankMap[bank].preferred = bankMap[bank].accounts[0];
    }
  });

  return bankMap;
}

/**
 * 更新單列 H 欄（扣繳帳戶）之連動下拉選單與預設值
 * @param {GoogleAppsScript.Spreadsheet.Sheet} cardSheet 卡片主檔分頁
 * @param {number} row 列號
 * @param {string} bank 銀行名稱
 * @param {Object} [bankMap] 預先提取的銀行帳戶映射表（選填）
 */
function updateCardAccountDropdownForRow(cardSheet, row, bank, bankMap) {
  if (!cardSheet || row < 2) return;

  const ss = cardSheet.getParent();
  if (!bankMap) {
    bankMap = getBankAccountsMapFromAssetSheet(ss);
  }

  const cellH = cardSheet.getRange(row, 8);
  const cleanBank = String(bank || '').trim();

  // 若無指定銀行或分頁 5 無對應帳戶，套用分頁 5 B 欄動態開放範圍 $B$5:$B
  if (!cleanBank || !bankMap[cleanBank] || bankMap[cleanBank].accounts.length === 0) {
    const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);
    if (assetSheet) {
      const openRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(assetSheet.getRange('B5:B'), true)
        .setAllowInvalid(true)
        .build();
      cellH.setDataValidation(openRule);
    } else {
      cellH.clearDataValidations();
    }
    return;
  }

  const info = bankMap[cleanBank];
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(info.accounts, true)
    .setAllowInvalid(true)
    .build();

  cellH.setDataValidation(rule);

  const curVal = String(cellH.getValue() || '').trim();
  const curFormula = cellH.getFormula();

  // 若原先為公式、為空、或當前值不屬於該銀行的帳戶清單，則自動帶入推薦帳戶
  if (curFormula || !curVal || !info.accounts.includes(curVal)) {
    cellH.setValue(info.preferred || info.accounts[0]);
  }
}

/**
 * 試算表編輯事件觸發器 (Simple Trigger)
 * 1. 當使用者在「8. 信用卡卡片主檔」修改 G 欄（扣繳銀行）時，即時更新該列 H 欄（扣繳帳戶）之連動下拉選單
 * 2. 當使用者在「5. 帳戶資產淨值表」新增/修改銀行、帳戶或名目用途時，自動同步刷新全域下拉驗證清單
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();

    // 1. 若在「8. 信用卡卡片主檔」編輯 G 欄（扣繳銀行）
    if (sheetName === SHEET_NAMES.CC_CARDS) {
      const row = e.range.getRow();
      const col = e.range.getColumn();

      // 僅監聽 G 欄（第 7 欄：扣繳銀行）且列數 >= 2
      if (col === 7 && row >= 2) {
        const bank = e.range.getValue();
        updateCardAccountDropdownForRow(sheet, row, bank);
      }
    } 
    // 2. 若在「5. 帳戶資產淨值表」編輯銀行、帳戶或名目 (第 5 列起，A/B/C 欄)
    else if (sheetName === SHEET_NAMES.ASSET) {
      const row = e.range.getRow();
      const col = e.range.getColumn();
      if (row >= 5 && (col === 1 || col === 2 || col === 3)) {
        refreshCardAccountDropdowns();
      }
    }
  } catch (err) {
    Logger.log('onEdit 執行失敗: ' + err.message);
  }
}

/**
 * 一次性修復與批次刷新分頁「8. 信用卡卡片主檔」與「7. 信用卡消費明細」下拉選單：
 * 1. 分頁 8 A 欄 (發卡銀行) 與 G 欄 (扣繳銀行)：動態開放範圍連動 '5. 帳戶資產淨值表'!$A$5:$A
 * 2. 分頁 8 H 欄 (扣繳帳戶)：預設開放範圍 '5. 帳戶資產淨值表'!$B$5:$B，並針對已選銀行注入最新連動過濾清單
 * 3. 分頁 7 C 欄 (發卡銀行)：動態開放範圍連動 '8. 信用卡卡片主檔'!$A$2:$A
 * 4. 分頁 7 D 欄 (卡片)：動態開放範圍連動 '8. 信用卡卡片主檔'!$D$2:$D
 * 5. 分頁 7 K 欄 (對應扣款名目)：動態開放範圍連動 '5. 帳戶資產淨值表'!$C$5:$C
 */
function refreshCardAccountDropdowns() {
  try {
    const ss = getSpreadsheet();
    if (!ss) throw new Error('無法取得試算表實例');

    const cardSheet = ss.getSheetByName(SHEET_NAMES.CC_CARDS);
    if (!cardSheet) throw new Error(`找不到分頁: ${SHEET_NAMES.CC_CARDS}`);

    const assetSheet = ss.getSheetByName(SHEET_NAMES.ASSET);
    if (!assetSheet) throw new Error(`找不到分頁: ${SHEET_NAMES.ASSET}`);

    const recordSheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);

    // 1. 分頁 8：A 欄 (發卡銀行) 與 G 欄 (扣繳銀行) 動態開放範圍 $A$5:$A
    const bankOpenRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(assetSheet.getRange('A5:A'), true)
      .setAllowInvalid(true)
      .build();
    cardSheet.getRange('A2:A500').setDataValidation(bankOpenRule);
    cardSheet.getRange('G2:G500').setDataValidation(bankOpenRule);

    // 2. 分頁 8：H 欄預設開放範圍 $B$5:$B
    const accountOpenRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(assetSheet.getRange('B5:B'), true)
      .setAllowInvalid(true)
      .build();
    cardSheet.getRange('H2:H500').setDataValidation(accountOpenRule);

    // 讀取分頁 5 最新銀行與帳戶映射表（依據 getLastRow 動態取得邊界）
    const bankMap = getBankAccountsMapFromAssetSheet(ss);
    const lastRow = Math.max(cardSheet.getLastRow(), 2);

    const updatedRows = [];
    for (let r = 2; r <= lastRow; r++) {
      const bank = String(cardSheet.getRange(r, 7).getValue() || '').trim();
      if (bank && bankMap[bank] && bankMap[bank].accounts.length > 0) {
        updateCardAccountDropdownForRow(cardSheet, r, bank, bankMap);
        const acc = cardSheet.getRange(r, 8).getValue();
        const choices = bankMap[bank].accounts;
        updatedRows.push({ row: r, bank, account: acc, availableChoices: choices });
      }
    }

    // 3. 分頁 7：同步確保連動下拉選單皆採用動態開放範圍
    if (recordSheet) {
      // C 欄 (發卡銀行) 連動分頁 8 A 欄開放範圍 A2:A
      const recBankRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(cardSheet.getRange('A2:A'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('C2:C500').setDataValidation(recBankRule);

      // D 欄 (卡片) 連動分頁 8 D 欄開放範圍 D2:D
      const recCardRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(cardSheet.getRange('D2:D'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('D2:D500').setDataValidation(recCardRule);

      // E 欄 (消費項目) 與 F 欄 (支付通道) 確保獨立驗證
      const commonItems = ['悠遊卡加值', '台鐵票', '高鐵票', '超商消費', '外食餐飲', '日常用品', '生鮮超市', '加油', '訂閱服務', '其他'];
      const recItemRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(commonItems, true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('E2:E500').setDataValidation(recItemRule);

      const channels = ['實體刷卡', 'LINE Pay', '街口支付', 'Apple Pay', '悠遊卡/一卡通', '網路購物', '其他'];
      const recChannelRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(channels, true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('F2:F500').setDataValidation(recChannelRule);

      // K 欄 (對應扣款名目) 連動分頁 5 C 欄開放範圍 C5:C
      const recPurposeRule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(assetSheet.getRange('C5:C'), true)
        .setAllowInvalid(true)
        .build();
      recordSheet.getRange('K2:K500').setDataValidation(recPurposeRule);
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      message: `分頁 8 與分頁 7 動態開放範圍驗證清單全域更新成功！`,
      cardRowsProcessed: updatedRows.length,
      bankCountInAssetSheet: Object.keys(bankMap).length,
      bankMap: bankMap,
      details: updatedRows
    };
  } catch (error) {
    Logger.log('refreshCardAccountDropdowns 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '刷新動態下拉選單失敗'
    };
  }
}

/**
 * 一次性修復/分離分頁「7. 信用卡消費明細」中 E 欄（消費項目）與 F 欄（支付通道）的下拉選單：
 * 避免因歷史欄位位移導致 Google Sheets 自動合併二者資料驗證規則。
 */
function fixCreditCardSheetValidation() {
  try {
    const ss = getSpreadsheet();
    if (!ss) throw new Error('無法取得試算表實例');
    const recordSheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!recordSheet) throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);

    // 1. 先清除 E 欄與 F 欄的所有舊資料驗證，徹底解除兩欄在 Google Sheets 內部的規則綁定
    recordSheet.getRange('E2:E1000').clearDataValidations();
    recordSheet.getRange('F2:F1000').clearDataValidations();

    // 2. E 欄（消費項目）：配置常用項目清單，並允許自訂值輸入
    const commonItems = ['悠遊卡加值', '台鐵票', '高鐵票', '超商消費', '外食餐飲', '日常用品', '生鮮超市', '加油', '訂閱服務', '其他'];
    const itemRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(commonItems, true)
      .setAllowInvalid(true)
      .build();
    recordSheet.getRange('E2:E1000').setDataValidation(itemRule);

    // 3. F 欄（支付通道）：配置獨立的支付通道清單
    const channels = ['實體刷卡', 'LINE Pay', '街口支付', 'Apple Pay', '悠遊卡/一卡通', '網路購物', '其他'];
    const channelRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(channels, true)
      .setAllowInvalid(true)
      .build();
    recordSheet.getRange('F2:F1000').setDataValidation(channelRule);

    SpreadsheetApp.flush();
    Logger.log('分頁 7 消費項目與支付通道資料驗證已成功獨立分離！');
    return {
      success: true,
      message: '分頁 7 消費項目與支付通道資料驗證已成功獨立分離！'
    };
  } catch (error) {
    Logger.log('fixCreditCardSheetValidation 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '修復資料驗證失敗'
    };
  }
}

/**
 * 檢查並修復分頁「7. 信用卡消費明細」中因 Checkbox 或預設驗證導致資料被寫在第 500+ 列的落單紀錄，
 * 自動將其移回從第 2 列起連續排列。
 */
function fixCreditCardRecordsRowPosition() {
  try {
    const ss = getSpreadsheet();
    if (!ss) throw new Error('無法取得試算表實例');
    const sheet = ss.getSheetByName(SHEET_NAMES.CC_RECORD);
    if (!sheet) throw new Error(`找不到分頁: ${SHEET_NAMES.CC_RECORD}`);

    const maxRows = sheet.getMaxRows();
    if (maxRows < 2) return { success: true, message: '分頁列數小於 2，無需調整' };

    // 讀取從第 2 列到最後一列的所有資料 (12 欄: A~L)
    const allValues = sheet.getRange(2, 1, maxRows - 1, 12).getValues();

    const validRows = [];
    const strayRowIndexes = [];

    for (let i = 0; i < allValues.length; i++) {
      const row = allValues[i];
      const actualRowNumber = i + 2;
      const date = row[1];
      const bank = String(row[2] || '').trim();
      const card = String(row[3] || '').trim();
      const amount = Number(row[6]) || 0;

      // 若有消費日期、發卡銀行或金額，視為有效交易紀錄
      if (date || bank || card || amount > 0) {
        validRows.push(row);
        if (actualRowNumber > validRows.length + 1) {
          strayRowIndexes.push(actualRowNumber);
        }
      }
    }

    if (validRows.length === 0) {
      return {
        success: true,
        message: '分頁 7 目前尚無任何已填寫的刷卡資料。'
      };
    }

    if (strayRowIndexes.length === 0) {
      return {
        success: true,
        message: `分頁 7 目前共有 ${validRows.length} 筆資料，且已依序從第 2 列起排列正常。`
      };
    }

    // 將所有有效資料依序重新寫入第 2 列起
    sheet.getRange(2, 1, validRows.length, 12).setValues(validRows);

    // 清除原本被填寫在下方的落單列 (從 validRows.length + 2 列到 maxRows)
    const rowsToClear = maxRows - validRows.length - 1;
    if (rowsToClear > 0) {
      sheet.getRange(validRows.length + 2, 1, rowsToClear, 12).clearContent();
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      movedCount: validRows.length,
      strayOriginalRows: strayRowIndexes,
      message: `已成功將位於第 ${strayRowIndexes.join(', ')} 列的 ${validRows.length} 筆刷卡紀錄自動移回從第 2 列起排列！`
    };
  } catch (error) {
    Logger.log('fixCreditCardRecordsRowPosition 失敗: ' + error.message);
    return {
      success: false,
      error: error.message || '重整刷卡紀錄列位置失敗'
    };
  }
}










