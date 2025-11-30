import { CheckResult, PrizeType, WinningNumbers } from '../types';

export const checkLotteryNumber = (invoiceNumber: string, winningNumbers: WinningNumbers): CheckResult => {
  if (!/^\d{8}$/.test(invoiceNumber)) {
    return {
      isWinner: false,
      prizeType: PrizeType.Error,
      matchedDigits: 0,
      description: "請輸入完整8位數號碼"
    };
  }

  // 1. Check Special Prize (特別獎) - Must match all 8
  if (invoiceNumber === winningNumbers.specialPrize) {
    return { isWinner: true, prizeType: PrizeType.Special, matchedDigits: 8, description: "8碼全中！恭喜獲得1,000萬元" };
  }

  // 2. Check Grand Prize (特獎) - Must match all 8
  if (invoiceNumber === winningNumbers.grandPrize) {
    return { isWinner: true, prizeType: PrizeType.Grand, matchedDigits: 8, description: "8碼全中！恭喜獲得200萬元" };
  }

  // 3. Check First Prize Group (頭獎 ~ 六獎)
  for (const firstPrizeNum of winningNumbers.firstPrize) {
    // Check match length from the end
    let matchCount = 0;
    for (let i = 1; i <= 8; i++) {
      if (invoiceNumber.slice(-i) === firstPrizeNum.slice(-i)) {
        matchCount = i;
      } else {
        break;
      }
    }

    if (matchCount === 8) return { isWinner: true, prizeType: PrizeType.First, matchedDigits: 8, description: "8碼全中！恭喜獲得20萬元" };
    if (matchCount === 7) return { isWinner: true, prizeType: PrizeType.Second, matchedDigits: 7, description: "末7碼相符！恭喜獲得4萬元" };
    if (matchCount === 6) return { isWinner: true, prizeType: PrizeType.Third, matchedDigits: 6, description: "末6碼相符！恭喜獲得1萬元" };
    if (matchCount === 5) return { isWinner: true, prizeType: PrizeType.Fourth, matchedDigits: 5, description: "末5碼相符！恭喜獲得4,000元" };
    if (matchCount === 4) return { isWinner: true, prizeType: PrizeType.Fifth, matchedDigits: 4, description: "末4碼相符！恭喜獲得1,000元" };
    if (matchCount === 3) return { isWinner: true, prizeType: PrizeType.Sixth, matchedDigits: 3, description: "末3碼相符！恭喜獲得200元" };
  }

  // 4. Check Additional Sixth Prize (增開六獎) - Match exactly last 3
  const suffix3 = invoiceNumber.slice(-3);
  if (winningNumbers.additionalSixthPrize.includes(suffix3)) {
    return { isWinner: true, prizeType: PrizeType.Sixth, matchedDigits: 3, description: "增開六獎！末3碼相符，恭喜獲得200元" };
  }

  return {
    isWinner: false,
    prizeType: PrizeType.None,
    matchedDigits: 0,
    description: "可惜沒中，再接再厲！"
  };
};

// Quick check for the manual 3-digit input
// Returns true if there is a POTENTIAL win (matches endings of major prizes OR matches additional prize)
export const quickCheck3Digits = (suffix: string, winningNumbers: WinningNumbers): { potential: boolean; message: string } => {
  if (!/^\d{3}$/.test(suffix)) {
    return { potential: false, message: "" };
  }

  // Check against Additional Sixth Prize (Direct Win)
  if (winningNumbers.additionalSixthPrize.includes(suffix)) {
    return { potential: true, message: "中獎！符合增開六獎 (200元)" };
  }

  // Check against First Prize endings (Potential Win)
  for (const firstPrizeNum of winningNumbers.firstPrize) {
    if (firstPrizeNum.endsWith(suffix)) {
      return { potential: true, message: "有機會！末3碼符合頭獎組，請核對完整號碼" };
    }
  }
  
  // Note: Special and Grand prizes require full match, but usually people check last 3 first.
  // Technically if last 3 match Special/Grand, it's worth checking, but official rule is usually checking First Prize suffixes first.
  // However, for UX, if it matches the ending of Special/Grand, we should also alert.
  if (winningNumbers.specialPrize.endsWith(suffix)) {
      return { potential: true, message: "有機會！末3碼符合特別獎，請核對完整號碼" };
  }
  if (winningNumbers.grandPrize.endsWith(suffix)) {
      return { potential: true, message: "有機會！末3碼符合特獎，請核對完整號碼" };
  }

  return { potential: false, message: "沒中" };
};
