import { WinningNumbers } from '../types';

// 官方 API 文件參考: https://www.einvoice.nat.gov.tw/home/DownLoad?fileName=1510206773173_0.pdf
const API_BASE_URL = "https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invapp/InvApp";

// 雲端靜態檔案位置
// 使用 raw.githubusercontent.com 直接訪問檔案（推薦，更可靠）
// 或者使用 GitHub Pages: https://up2you.github.io/lottery/lottery-data.json
const CLOUD_DATA_URL = "https://raw.githubusercontent.com/up2you/lottery/main/public/lottery-data.json";

/**
 * 從雲端 (GitHub) 抓取預先產生好的 JSON 檔
 */
export const fetchWinningNumbersFromCloud = async (): Promise<WinningNumbers[] | null> => {
  console.log("[LotteryService] Checking for cloud updates...", CLOUD_DATA_URL);
  try {
    const response = await fetch(CLOUD_DATA_URL + "?t=" + new Date().getTime(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // 在 Capacitor 環境中可能需要這個
      cache: 'no-cache'
    });
    
    console.log("[LotteryService] Response status:", response.status, response.statusText);
    
    if (!response.ok) {
       console.warn(`Cloud data not found or accessible. Status: ${response.status}`);
       return null;
    }
    
    const data = await response.json();
    console.log("[LotteryService] Received data:", data);
    
    if (Array.isArray(data) && data.length > 0 && data[0].period) {
       console.log("[LotteryService] Cloud data loaded successfully.", data[0].period);
       return data as WinningNumbers[];
    }
    
    console.warn("[LotteryService] Invalid data format");
    return null;
  } catch (error) {
    console.error("[LotteryService] Cloud fetch failed:", error);
    // 顯示更詳細的錯誤資訊
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.error("可能是 CORS 問題或網路連線問題");
    }
    return null;
  }
};

/**
 * 模擬或真實抓取中獎號碼 (Client-side API call)
 * 保留此功能給「進階設定」填入 AppID 的使用者直接呼叫
 */
export const fetchWinningNumbersFromAPI = async (term: string, appId?: string): Promise<WinningNumbers | null> => {
  console.log(`[LotteryService] Client-side fetch for ${term}...`);

  if (!appId) {
     console.log("No AppID provided for client-side fetch.");
     return null;
  }

  try {
    // Note: This will likely fail due to CORS unless user has a proxy or browser extension
    const url = `${API_BASE_URL}?version=0.5&type=HP&invTerm=${term}&appID=${appId}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === '200') {
      return parseApiDataToWinningNumbers(data);
    }
    
    console.warn("API Error:", data.msg);
    return null;

  } catch (error) {
    console.error("[LotteryService] Client-side API error:", error);
    return null;
  }
};

const parseApiDataToWinningNumbers = (data: any): WinningNumbers => {
  const formatPeriod = (ym: string) => {
     // 11310 -> 113年 09-10月
     const y = ym.substring(0, 3);
     const m = parseInt(ym.substring(3));
     const mStart = (m - 1).toString().padStart(2, '0');
     const mEnd = m.toString().padStart(2, '0');
     return `${y}年 ${mStart}-${mEnd}月`;
  };

  return {
    period: formatPeriod(data.invoYm), 
    specialPrize: data.superPrizeNo,
    grandPrize: data.spcPrizeNo,
    firstPrize: [data.firstPrizeNo1, data.firstPrizeNo2, data.firstPrizeNo3].filter(Boolean),
    additionalSixthPrize: [data.sixthPrizeNo1, data.sixthPrizeNo2, data.sixthPrizeNo3].filter(Boolean)
  };
};
