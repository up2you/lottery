export interface WinningNumbers {
  period: string; // e.g., "112年 09-10月"
  specialPrize: string; // 特別獎 (1000萬) - 8 digits
  grandPrize: string; // 特獎 (200萬) - 8 digits
  firstPrize: string[]; // 頭獎 (20萬) - Array of 8 digits strings
  additionalSixthPrize: string[]; // 增開六獎 (200元) - Array of 3 digits strings
}

export enum PrizeType {
  Special = '特別獎 (1,000萬元)',
  Grand = '特獎 (200萬元)',
  First = '頭獎 (20萬元)',
  Second = '二獎 (4萬元)',
  Third = '三獎 (1萬元)',
  Fourth = '四獎 (4,000元)',
  Fifth = '五獎 (1,000元)',
  Sixth = '六獎 (200元)',
  None = '沒中獎',
  Error = '格式錯誤',
}

export interface CheckResult {
  isWinner: boolean;
  prizeType: PrizeType;
  matchedDigits: number; // How many digits matched at the end
  description: string;
}

export interface ReceiptScanResult {
  number: string;
  period?: string;
}

export interface WinningRecord {
  id: number;
  date: string;
  period: string;
  number: string;
  prizeType: string;
  amount: string;
}

export interface PendingReceipt {
  id: number;
  number: string; // 3 digits
  period: string;
  dateAdded: string;
}