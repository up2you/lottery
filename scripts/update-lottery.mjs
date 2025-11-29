import fs from 'fs';
import path from 'path';
import https from 'https';
import process from 'process';

// --- 設定 ---
// 這裡讀取 GitHub Secrets 中的 AppID，或是本地環境變數
const APP_ID = process.env.INVOICE_APP_ID; 
const API_URL = "https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invapp/InvApp";
// Use path.resolve to avoid process.cwd() typing issues in some environments
const DATA_FILE_PATH = path.resolve('public', 'lottery-data.json');

// --- 輔助函式 ---

// 1. 計算當期期別 (例如現在是 11月，應該要抓 09-10月，如果是 1月，抓 11-12月)
function getCurrentTerm() {
  const now = new Date();
  let year = now.getFullYear() - 1911;
  let month = now.getMonth() + 1; // 1-12

  // 開獎日通常是單數月的 25 號，開的是「上兩個月」的獎
  // 例如 11/25 開 9-10月
  // 為了保險起見，我們計算「上一期」
  
  // 若 month 是 1, 2 => 去年 11-12 (但通常 1/25 開 11-12)
  // 若 month 是 3, 4 => 今年 01-02
  
  let targetYear = year;
  let targetMonthEnd = month - 1; 
  
  // 調整月份邏輯以符合偶數月結尾
  if (targetMonthEnd % 2 !== 0) {
    targetMonthEnd -= 1;
  }
  
  if (targetMonthEnd === 0) {
    targetMonthEnd = 12;
    targetYear -= 1;
  }

  // 格式化為 API 需要的 Term，例如 11310
  // Use string concatenation to avoid template literal issues in some environments
  const term = "" + targetYear + targetMonthEnd.toString().padStart(2, '0');
  
  // 格式化為顯示用的 Period，例如 "113年 09-10月"
  const monthStart = targetMonthEnd - 1;
  const periodDisplay = "" + targetYear + "年 " + monthStart.toString().padStart(2, '0') + "-" + targetMonthEnd.toString().padStart(2, '0') + "月";

  return { term, periodDisplay };
}

// 2. 呼叫 API
function fetchLotteryData(term) {
  return new Promise((resolve, reject) => {
    if (!APP_ID) {
      reject(new Error("找不到 APP_ID，請在 GitHub Secrets 設定 INVOICE_APP_ID"));
      return;
    }

    // Use string concatenation instead of template literals for better compatibility
    const url = API_URL + "?version=0.5&type=HP&invTerm=" + term + "&appID=" + APP_ID;
    console.log("正在查詢期別: " + term + " ...");

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === '200') {
            resolve(json);
          } else {
            reject(new Error("API 回傳錯誤: " + (json.msg || 'Unknown error')));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

// 3. 轉換資料格式
function transformData(apiData, periodDisplay) {
  return {
    period: periodDisplay,
    specialPrize: apiData.superPrizeNo || "",
    grandPrize: apiData.spcPrizeNo || "",
    firstPrize: [
      apiData.firstPrizeNo1,
      apiData.firstPrizeNo2,
      apiData.firstPrizeNo3
    ].filter(Boolean),
    additionalSixthPrize: [
      apiData.sixthPrizeNo1,
      apiData.sixthPrizeNo2,
      apiData.sixthPrizeNo3
    ].filter(Boolean)
  };
}

// --- 主程式 ---
async function main() {
  try {
    const { term, periodDisplay } = getCurrentTerm();
    
    // 1. 讀取現有檔案
    let currentData = [];
    if (fs.existsSync(DATA_FILE_PATH)) {
      currentData = JSON.parse(fs.readFileSync(DATA_FILE_PATH, 'utf-8'));
    }

    // 2. 檢查是否已經有這期的資料 (避免重複寫入)
    const exists = currentData.find(d => d.period === periodDisplay);
    
    // 強制更新模式：即使存在也更新 (因為有時候剛開獎只有部分號碼，後來會補齊)
    // 這裡我們抓取新資料
    console.log("準備抓取 " + periodDisplay + " (Term: " + term + ") 的資料...");
    
    // 注意：若沒有 APP_ID (例如在開發環境測試)，這裡會報錯。
    // 為了演示，我們加入一個模擬資料 fallback，實際部署時請確保有 APP_ID
    let newData;
    try {
        const apiData = await fetchLotteryData(term);
        newData = transformData(apiData, periodDisplay);
    } catch (e) {
        console.warn("抓取失敗 (可能是沒有 AppID 或未開獎):", e.message);
        console.log("⚠️ 注意：若您在 GitHub Actions 執行，請確認 Secrets 設定正確。");
        return; // 失敗則不更新檔案
    }

    // 3. 更新陣列
    // 移除舊的同名期別 (如果有的話)
    const otherData = currentData.filter(d => d.period !== periodDisplay);
    
    // 將新資料放在最前面
    const updatedData = [newData, ...otherData];

    // 4. 寫回檔案
    // 確保目錄存在
    const dir = path.dirname(DATA_FILE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(updatedData, null, 2));
    console.log("✅ 成功更新 lottery-data.json！最新期別: " + periodDisplay);

  } catch (error) {
    console.error("❌ 腳本執行錯誤:", error);
    process.exit(1);
  }
}

main();