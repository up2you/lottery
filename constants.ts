import { WinningNumbers } from './types';

export const WINNING_NUMBERS_DATA: WinningNumbers[] = [
  {
    period: "113年 09-10月",
    specialPrize: "12345678", // 特別獎
    grandPrize: "87654321",   // 特獎
    firstPrize: [             // 頭獎
      "11112222",
      "33334444",
      "55556666"
    ],
    additionalSixthPrize: [   // 增開六獎
      "999",
      "888"
    ]
  },
  {
    period: "113年 07-08月", // Previous period mock
    specialPrize: "98765432", 
    grandPrize: "23456789",   
    firstPrize: [             
      "12121212",
      "34343434",
      "56565656"
    ],
    additionalSixthPrize: [   
      "111",
      "222"
    ]
  }
];

export const DEFAULT_WINNING_NUMBERS = WINNING_NUMBERS_DATA[0];