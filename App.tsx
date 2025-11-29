import React, { useState, useRef, useEffect } from 'react';
import { Camera, Share2, RefreshCw, ChevronLeft, Award, Delete, Calendar, Layers, Mic, MicOff, X, Image as ImageIcon, Clock, PlusCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { WinningNumbers, CheckResult, WinningRecord, PendingReceipt } from './types';
import { checkLotteryNumber, quickCheck3Digits } from './utils/lotteryLogic';
import { WINNING_NUMBERS_DATA } from './constants';
import NumberSettings from './components/NumberSettings';
import { geminiService } from './services/geminiService';
import { fetchWinningNumbersFromAPI, fetchWinningNumbersFromCloud } from './services/lotteryService';

enum Tab {
  Checker,   // 對獎機
  List,      // 號碼單
  Scanner,   // 掃描
  Settings,  // 設定
  History    // 紀錄 (中獎 + 預存)
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.Checker);
  
  // Data State
  // We use a state for the source of truth now, initialized with the static constant
  const [allLotteryData, setAllLotteryData] = useState<WinningNumbers[]>(WINNING_NUMBERS_DATA);

  // periodIndex: -1 indicates "Check All (4 Months)", otherwise index in allLotteryData
  const [periodIndex, setPeriodIndex] = useState(0);
  const [winningNumbers, setWinningNumbers] = useState<WinningNumbers>(WINNING_NUMBERS_DATA[0]);
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Quick Check (Checker) State
  const [quickInput, setQuickInput] = useState("");
  const [quickResult, setQuickResult] = useState<{ potential: boolean; message: string } | null>(null);

  // Scanner State
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanResult, setScanResult] = useState<CheckResult | null>(null);
  const [scannedNumber, setScannedNumber] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Custom Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(isListening); // To track state inside callbacks
  const recognitionRef = useRef<any>(null);

  // History & Pending State
  const [history, setHistory] = useState<WinningRecord[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  const [historySubTab, setHistorySubTab] = useState<'winning' | 'pending'>('winning');
  
  // Pending Input State
  const [pendingInput, setPendingInput] = useState("");
  const [selectedPendingPeriod, setSelectedPendingPeriod] = useState("");
  const [futurePeriods, setFuturePeriods] = useState<string[]>([]);
  
  // Track if we have already alerted about pending wins to avoid spamming on every render
  const hasAlertedPendingWins = useRef(false);

  // --- Initialization Effects ---

  // 1. Load LocalStorage Data
  useEffect(() => {
    const savedHistory = localStorage.getItem('winning_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
    const savedPending = localStorage.getItem('pending_receipts');
    if (savedPending) {
      setPendingReceipts(JSON.parse(savedPending));
    }
    
    // Initial future periods generation
    setFuturePeriods(generateNextPeriods(WINNING_NUMBERS_DATA[0].period));

    // 2. Fetch Cloud Data on Mount
    const initCloudData = async () => {
        const cloudData = await fetchWinningNumbersFromCloud();
        if (cloudData && cloudData.length > 0) {
            setAllLotteryData(cloudData);
            setWinningNumbers(cloudData[0]); // Default to latest
            setFuturePeriods(generateNextPeriods(cloudData[0].period));
            console.log("App initialized with cloud data");
        }
    };
    initCloudData();
  }, []);

  // Save Pending to LocalStorage
  useEffect(() => {
    localStorage.setItem('pending_receipts', JSON.stringify(pendingReceipts));
  }, [pendingReceipts]);

  // Update winning numbers when period index changes or data updates
  useEffect(() => {
    if (periodIndex === -1) {
      // Keep displaying the latest numbers in background or just use the first one for safety
      if (allLotteryData.length > 0) {
          setWinningNumbers(allLotteryData[0]);
      }
    } else {
      if (allLotteryData[periodIndex]) {
          setWinningNumbers(allLotteryData[periodIndex]);
      }
    }
    setQuickInput(""); // Clear input when switching months
    setQuickResult(null);
  }, [periodIndex, allLotteryData]);

  // --- Check Pending Wins on Data Update ---
  useEffect(() => {
    if (allLotteryData.length > 0 && pendingReceipts.length > 0 && !hasAlertedPendingWins.current) {
        // Find pending receipts that match the NEW data
        const winners = pendingReceipts.filter(r => {
            const officialData = allLotteryData.find(d => d.period === r.period);
            if (officialData) {
                const check = quickCheck3Digits(r.number, officialData);
                return check.potential;
            }
            return false;
        });

        if (winners.length > 0) {
            hasAlertedPendingWins.current = true;
            const winningNumbersStr = winners.map(w => w.number).join(', ');
            // Use setTimeout to allow UI to settle
            setTimeout(() => {
                alert(`🎉 注意！您的預存發票中有疑似中獎號碼：\n\n${winningNumbersStr}\n\n請前往「紀錄」頁面核對！`);
                // Optionally switch to History tab
                setActiveTab(Tab.History);
                setHistorySubTab('pending');
            }, 1500);
        }
    }
  }, [allLotteryData, pendingReceipts]);

  // --- Resource Cleanup on Tab Change ---
  useEffect(() => {
    // 1. Stop Camera when leaving Scanner tab
    if (activeTab !== Tab.Scanner) {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsCameraOpen(false);
    }
    
    // 2. Stop Voice Playback immediately
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    // 3. Stop Voice Recognition (Microphone) to save battery/privacy
    // Only stop if we are NOT in Checker tab (since voice input is for Checker)
    if (activeTab !== Tab.Checker && isListeningRef.current) {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch(e) {}
        }
        setIsListening(false);
    }
  }, [activeTab]);


  // Generate next 2 periods based on current latest
  const generateNextPeriods = (currentPeriodStr: string): string[] => {
    // Expected format: "113年 09-10月"
    try {
      const yearMatch = currentPeriodStr.match(/(\d+)年/);
      const monthMatch = currentPeriodStr.match(/(\d+)-(\d+)月/);
      
      if (!yearMatch || !monthMatch) return ["下期待定", "下下期待定"];

      let year = parseInt(yearMatch[1]);
      let startMonth = parseInt(monthMatch[1]);

      const results = [];
      for (let i = 0; i < 2; i++) {
        startMonth += 2;
        if (startMonth > 12) {
          startMonth = 1;
          year++;
        }
        
        const endMonth = startMonth + 1;
        const pad = (n: number) => n.toString().padStart(2, '0');
        results.push(`${year}年 ${pad(startMonth)}-${pad(endMonth)}月`);
      }
      return results;
    } catch (e) {
      return ["下期待定", "下下期待定"];
    }
  };

  // Handle Data Refresh
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    hasAlertedPendingWins.current = false; // Allow alert again on manual refresh
    
    try {
        // 1. Try Cloud Fetch First (Global Update)
        const cloudData = await fetchWinningNumbersFromCloud();
        if (cloudData && cloudData.length > 0) {
            setAllLotteryData(cloudData);
            setWinningNumbers(cloudData[0]);
            setFuturePeriods(generateNextPeriods(cloudData[0].period));
            alert("已從雲端同步最新號碼！");
        } else {
            // 2. Fallback to specific API fetch if cloud fails (e.g. for development testing with AppID)
            const appId = localStorage.getItem('appId');
            if (appId) {
                // Convert current period string to API term format (e.g. 113年 09-10月 -> 11310)
                // This logic tries to fetch the *current* period again to check for updates
                const term = "11310"; // Hardcoded for demo, logic exists in update-lottery.mjs
                const apiData = await fetchWinningNumbersFromAPI(term, appId);
                if (apiData) {
                    // Update the first item in our list
                    const newData = [...allLotteryData];
                    // Check if exists
                    const idx = newData.findIndex(d => d.period === apiData.period);
                    if (idx >= 0) {
                        newData[idx] = apiData;
                    } else {
                        newData.unshift(apiData);
                    }
                    setAllLotteryData(newData);
                    alert("已透過 API 更新當期資料");
                } else {
                    alert("目前已是最新資料 (雲端/API 無新資料)");
                }
            } else {
                alert("已檢查雲端更新 (無新資料)");
            }
        }
    } catch (e) {
        console.error(e);
        alert("更新失敗，請檢查網路");
    } finally {
        setIsRefreshing(false);
    }
  };

  // Voice Feedback Helper
  const speakResult = (message: string) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.2; // Slightly faster
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- Voice Recognition Logic ---
  
  // 1. Initialize Recognition Instance Once
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'cmn-Hant-TW'; // Traditional Chinese (Taiwan)

        recognition.onresult = (event: any) => {
            const lastResultIndex = event.results.length - 1;
            const transcript = event.results[lastResultIndex][0].transcript;
            console.log('Voice Input:', transcript);
            
            const digits = normalizeToDigits(transcript);
            if (digits) {
                setQuickInput(prev => {
                    let newVal = prev;
                    for (const char of digits) {
                        if (newVal.length >= 3) {
                            newVal = char; // Auto reset start new
                        } else {
                            newVal += char;
                        }
                    }
                    return newVal;
                });
            }
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            if (event.error === 'not-allowed') {
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            if (isListeningRef.current) {
                try {
                    recognition.start();
                } catch (e) {
                    console.log("Restart failed", e);
                }
            }
        };

        recognitionRef.current = recognition;
    }
  }, []);

  // 2. Handle Start/Stop based on State
  useEffect(() => {
      isListeningRef.current = isListening;
      
      if (!recognitionRef.current) return;

      if (isListening) {
          try {
              recognitionRef.current.start();
          } catch (e) {
              // Already started or busy
          }
      } else {
          try {
              recognitionRef.current.stop();
          } catch (e) {
              // Already stopped
          }
      }
  }, [isListening]);

  const toggleListening = () => {
      if (!recognitionRef.current) {
          alert("您的瀏覽器不支援語音辨識功能");
          return;
      }
      setIsListening(!isListening);
  };

  const normalizeToDigits = (text: string): string => {
      const map: {[key: string]: string} = {
          '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
          '六': '6', '七': '7', '八': '8', '九': '9', '零': '0',
          '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
          '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
      };
      
      let result = '';
      for (const char of text) {
          if (map[char]) {
              result += map[char];
          } else if (/\d/.test(char)) {
              result += char;
          }
      }
      return result;
  };


  // Quick Check Logic & Side Effects
  useEffect(() => {
    if (quickInput.length === 3) {
      let result = { potential: false, message: "沒中" };

      if (periodIndex === -1) {
        // Check ALL periods available in allLotteryData
        const results = allLotteryData.map(data => quickCheck3Digits(quickInput, data));
        // If any period has a potential win, we consider it a win
        const match = results.find(r => r.potential);
        if (match) {
          result = { potential: true, message: "注意中獎 (請核對期別)" };
        }
      } else {
        // Check single period
        result = quickCheck3Digits(quickInput, winningNumbers);
      }

      setQuickResult(result);
      
      // TTS Logic
      if (result.potential) {
        speakResult("注意中獎");
      } else {
        speakResult("沒中");
      }
    } else {
      setQuickResult(null);
    }
  }, [quickInput, winningNumbers, periodIndex, allLotteryData]);

  // Handle number pad input
  const handlePadInput = (value: string) => {
    if (value === 'back') {
      setQuickInput(prev => prev.slice(0, -1));
      return;
    } 

    // Logic for Auto-Reset on 4th digit
    if (quickInput.length === 3) {
      // If we already have 3 digits, the next number starts a NEW entry
      setQuickInput(value);
      // Check logic will run automatically via useEffect when length becomes 3 again later
    } else {
      // Normal append
      setQuickInput(prev => prev + value);
    }
  };

  // --- Image Processing & Camera Logic ---

  const processImageAnalysis = async (base64Data: string) => {
    setIsProcessing(true);
    setScanResult(null);
    setScannedNumber("");

    try {
      const result = await geminiService.parseReceiptImage(base64Data);
      
      if (result && result.number) {
        setScannedNumber(result.number);
        
        let prizeResult: CheckResult;
        if (periodIndex === -1) {
             const results = allLotteryData.map(data => checkLotteryNumber(result.number, data));
             const winner = results.find(r => r.isWinner);
             prizeResult = winner || results[0];
        } else {
             prizeResult = checkLotteryNumber(result.number, winningNumbers);
        }
        
        setScanResult(prizeResult);

        // Voice Feedback for Scan Result
        if (prizeResult.isWinner) {
            speakResult(`恭喜中獎，${prizeResult.prizeType}`);
            addRecord(prizeResult, result.number);
        } else {
            speakResult("可惜沒中");
        }

      } else {
        alert("無法辨識發票號碼，請確認圖片清晰度。");
      }
    } catch (error) {
      console.error("Scanning failed", error);
      alert("掃描失敗，請稍後再試。");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await fileToBase64(file);
      const base64Data = base64.split(',')[1]; 
      await processImageAnalysis(base64Data);
    } catch (error) {
      console.error("File processing failed", error);
      alert("檔案處理失敗");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Camera Functions
  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = async () => {
           videoRef.current?.play();
           
           // AUTO-FOCUS Implementation
           const track = stream.getVideoTracks()[0];
           const capabilities = (track.getCapabilities && track.getCapabilities()) as any;
           
           if (capabilities && capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
             try {
               await track.applyConstraints({
                 advanced: [{ focusMode: 'continuous' } as any]
               });
               console.log("Continuous auto-focus enabled");
             } catch (err) {
               console.warn("Failed to apply focus constraint", err);
             }
           }
        };
      }
    } catch (err) {
      console.error("Camera start failed", err);
      alert("無法啟動相機，請確認權限或改用上傳圖片功能。");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        const base64Data = base64.split(',')[1];
        
        stopCamera();
        processImageAnalysis(base64Data);
      }
    }
  };

  // Manual Check
  const handleManualFullCheck = (num: string) => {
    let prizeResult: CheckResult;
    if (periodIndex === -1) {
         const results = allLotteryData.map(data => checkLotteryNumber(num, data));
         const winner = results.find(r => r.isWinner);
         prizeResult = winner || results[0];
    } else {
         prizeResult = checkLotteryNumber(num, winningNumbers);
    }
    setScanResult(prizeResult);
    setScannedNumber(num);

    // Voice Feedback for Manual Full Check
    if (prizeResult.isWinner) {
        speakResult(`恭喜中獎，${prizeResult.prizeType}`);
        addRecord(prizeResult, num);
    } else {
        speakResult("可惜沒中");
    }
  };

  // --- Winning History Logic ---
  const addRecord = (result: CheckResult, number: string) => {
    const newRecord: WinningRecord = {
      id: Date.now(),
      date: new Date().toLocaleDateString('zh-TW'),
      period: periodIndex === -1 ? "合併對獎" : winningNumbers.period,
      number,
      prizeType: result.prizeType,
      amount: getAmountFromPrize(result.prizeType)
    };
    const newHistory = [newRecord, ...history];
    setHistory(newHistory);
    localStorage.setItem('winning_history', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    if (confirm("確定要清除所有中獎紀錄嗎？")) {
      setHistory([]);
      localStorage.removeItem('winning_history');
    }
  };

  const getAmountFromPrize = (type: string) => {
    if (type.includes('1,000萬')) return '1,000萬元';
    if (type.includes('200萬')) return '200萬元';
    if (type.includes('20萬')) return '20萬元';
    if (type.includes('4萬')) return '4萬元';
    if (type.includes('1萬')) return '1萬元';
    if (type.includes('4,000')) return '4,000元';
    if (type.includes('1,000')) return '1,000元';
    if (type.includes('200')) return '200元';
    return '0元';
  };

  // --- Pending Receipt Logic ---
  const addPendingReceipt = () => {
    if (pendingInput.length !== 3) {
      alert("請輸入3碼數字");
      return;
    }
    if (!selectedPendingPeriod) {
      // Default to first available future period if not selected
      if (futurePeriods.length > 0) {
        // proceed with futurePeriods[0]
      } else {
         alert("請選擇期別");
         return;
      }
    }

    const periodToUse = selectedPendingPeriod || futurePeriods[0];

    const newReceipt: PendingReceipt = {
      id: Date.now(),
      number: pendingInput,
      period: periodToUse,
      dateAdded: new Date().toLocaleDateString('zh-TW')
    };
    
    setPendingReceipts([newReceipt, ...pendingReceipts]);
    setPendingInput("");
  };

  const deletePendingReceipt = (id: number) => {
    const updated = pendingReceipts.filter(r => r.id !== id);
    setPendingReceipts(updated);
  };

  // Check if a pending receipt has now been drawn and if it won
  const checkPendingStatus = (receipt: PendingReceipt): { status: 'pending' | 'win' | 'lost', message: string } => {
    // 1. Find if this period exists in our official data (use allLotteryData)
    const officialData = allLotteryData.find(d => d.period === receipt.period);
    
    if (!officialData) {
      return { status: 'pending', message: '等待開獎' };
    }

    // 2. Check logic
    const check = quickCheck3Digits(receipt.number, officialData);
    if (check.potential) {
      return { status: 'win', message: '注意！疑似中獎' };
    } else {
      return { status: 'lost', message: '未中獎' };
    }
  };


  // --- Views ---

  // 1. Checker View (對獎機)
  const renderChecker = () => (
    <div className="flex flex-col h-full bg-white relative">
      {/* ... existing checker UI ... */}
      {/* Month Selector Overlay */}
      {isMonthSelectorOpen && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-primary p-4 text-white text-lg font-bold text-center">
              選擇對獎月份
            </div>
            <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {allLotteryData.map((data, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setPeriodIndex(idx);
                    setIsMonthSelectorOpen(false);
                  }}
                  className={`w-full p-4 text-left flex justify-between items-center active:bg-gray-50 ${periodIndex === idx ? 'bg-[#eff5e9] text-primary font-bold' : 'text-gray-700'}`}
                >
                  <span>{data.period}</span>
                  {periodIndex === idx && <Award size={20} />}
                </button>
              ))}
              
              {/* 4 Months Option */}
              <button
                  onClick={() => {
                    setPeriodIndex(-1);
                    setIsMonthSelectorOpen(false);
                  }}
                  className={`w-full p-4 text-left flex justify-between items-center active:bg-gray-50 ${periodIndex === -1 ? 'bg-[#eff5e9] text-primary font-bold' : 'text-gray-700'}`}
                >
                  <div className="flex items-center">
                    <Layers size={20} className="mr-2 text-primary" />
                    <span>四個月一起對 (兩期)</span>
                  </div>
                  {periodIndex === -1 && <Award size={20} />}
                </button>

            </div>
            <button 
              onClick={() => setIsMonthSelectorOpen(false)}
              className="w-full p-3 text-center text-gray-500 hover:bg-gray-100 border-t mt-2"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Top Input Area */}
      <div className="bg-[#eff5e9] border-[3px] border-primary rounded-xl m-4 p-6 text-center relative shadow-inner h-40 flex flex-col justify-center items-center transition-colors">
        
        {/* Voice Input Toggle Button */}
        <button 
            onClick={toggleListening}
            className={`absolute right-2 top-2 flex items-center gap-2 px-3 py-1.5 rounded-full transition-all shadow-sm border ${isListening ? 'bg-red-50 border-red-200 text-red-600 ring-2 ring-red-100' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
            <div className={`relative flex items-center justify-center ${isListening ? 'animate-pulse' : ''}`}>
               {isListening ? <Mic size={18} /> : <MicOff size={18} />}
            </div>
            <span className="text-xs font-medium">{isListening ? '聆聽中' : '語音輸入'}</span>
        </button>

        {quickInput ? (
           <div className="text-7xl font-mono font-bold text-gray-800 tracking-widest">
             {quickInput}
           </div>
        ) : (
          <div className="text-3xl text-gray-400 font-medium tracking-wide">
             {isListening ? "請唸出號碼..." : "請輸入發票後3碼"}
          </div>
        )}
        
        {/* Result Overlay */}
        {quickResult && (
            <div className={`absolute bottom-2 left-0 w-full text-center text-xl ${quickResult.potential ? 'text-red-600 font-bold animate-bounce' : 'text-gray-500'}`}>
               {quickResult.message}
            </div>
        )}
      </div>

      {/* Info Text */}
      {periodIndex === -1 ? (
        <div className="px-6 space-y-2 mb-4">
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
                <h3 className="text-primary font-bold text-lg mb-1 flex items-center justify-center">
                    <Layers size={20} className="mr-2"/> 兩期合併對獎模式
                </h3>
                <p className="text-sm text-gray-600">
                    正在同時核對最近兩期發票
                </p>
                <div className="flex justify-center gap-2 mt-2">
                    {allLotteryData.slice(0, 2).map((d, i) => (
                        <span key={i} className="text-xs bg-white px-2 py-1 rounded text-primary-dark border border-primary/30">
                            {d.period}
                        </span>
                    ))}
                </div>
            </div>
            <div className="text-center text-xs text-gray-400">
                若語音提示「注意中獎」，請核對該張發票期別是否相符
            </div>
        </div>
      ) : (
        <div className="px-6 text-sm text-primary-dark space-y-1 mb-2 font-medium">
            <div className="flex justify-between items-center mb-2">
            <span className="bg-primary text-white px-2 py-0.5 rounded text-xs">{winningNumbers.period}</span>
            <span className="text-gray-500 text-xs">語音已啟用</span>
            </div>
            <div className="flex justify-between">
            <span>特別 獎：{winningNumbers.specialPrize}</span>
            </div>
            <div className="flex justify-between">
            <span>特 &nbsp;&nbsp;&nbsp; 獎：{winningNumbers.grandPrize}</span>
            </div>
            <div>
            頭 &nbsp;&nbsp;&nbsp; 獎：
            {winningNumbers.firstPrize.map((n, i) => (
                <span key={i} className="mr-1">{n}{i < winningNumbers.firstPrize.length-1 ? '、' : ''}</span>
            ))}
            </div>
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
            <span className="text-gray-600 text-xs whitespace-nowrap">增開六獎:</span>
            {winningNumbers.additionalSixthPrize.map((n, i) => (
                <span key={i} className="text-red-600 font-bold text-xs">{n}</span>
            ))}
            </div>
        </div>
      )}

      {/* Keypad */}
      <div className="flex-1 p-2 grid grid-cols-3 gap-2 bg-gray-100 mt-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            onClick={() => handlePadInput(num.toString())}
            className="bg-primary hover:bg-primary-dark active:scale-95 text-white text-4xl font-bold rounded-lg shadow-[0_4px_0_0_rgba(93,133,51,1)] active:shadow-none active:translate-y-1 flex items-center justify-center transition-all"
          >
            {num}
          </button>
        ))}
        
        {/* Month Button (Replaces Clear) */}
        <button
          onClick={() => setIsMonthSelectorOpen(true)}
          className="bg-yellow-500 hover:bg-yellow-600 active:scale-95 text-white text-lg font-bold rounded-lg shadow-[0_4px_0_0_#b45309] active:shadow-none active:translate-y-1 flex flex-col items-center justify-center transition-all"
        >
          <Calendar size={24} className="mb-1" />
          <span>月份</span>
        </button>

        <button
          onClick={() => handlePadInput("0")}
          className="bg-primary hover:bg-primary-dark active:scale-95 text-white text-4xl font-bold rounded-lg shadow-[0_4px_0_0_rgba(93,133,51,1)] active:shadow-none active:translate-y-1 flex items-center justify-center transition-all"
        >
          0
        </button>
        
        <button
          onClick={() => handlePadInput("back")}
          className="bg-gray-400 hover:bg-gray-500 active:scale-95 text-white rounded-lg shadow-[0_4px_0_0_#6b7280] active:shadow-none active:translate-y-1 flex items-center justify-center transition-all"
        >
          <Delete size={36} />
        </button>
      </div>
    </div>
  );

  // 2. List View (號碼單)
  const renderList = () => {
    // Helper to render numbers with last 3 highlighted
    const renderSplitNumber = (num: string) => {
        const head = num.slice(0, 5);
        const tail = num.slice(5);
        return (
            <span className="font-mono text-2xl font-bold tracking-widest text-gray-800">
                {head}<span className="text-red-600">{tail}</span>
            </span>
        );
    };

    const displayIndex = periodIndex === -1 ? 0 : periodIndex;
    const currentDisplayNumbers = allLotteryData[displayIndex] || allLotteryData[0];

    return (
        <div className="p-4 space-y-4 pb-24 max-w-2xl mx-auto">
            {/* Period Selector in List View */}
            <div className="flex justify-center mb-2 overflow-x-auto">
                 <div className="bg-white rounded-lg shadow-sm p-1 inline-flex border border-gray-200">
                    {allLotteryData.map((data, idx) => (
                        <button
                            key={idx}
                            onClick={() => setPeriodIndex(idx)}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${displayIndex === idx ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            {data.period}
                        </button>
                    ))}
                 </div>
            </div>
            
            <div className="text-center mb-4">
                <a 
                   href="https://www.einvoice.nat.gov.tw/portal/btc/mobile/btc503w/search" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className="inline-flex items-center text-sm text-primary hover:underline bg-white px-3 py-1 rounded-full shadow-sm border border-primary/20"
                >
                   前往財政部官網查詢 <ChevronLeft size={14} className="rotate-180 ml-1"/>
                </a>
            </div>

            {/* Special Prize */}
            <div className="bg-[#eff5e9] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between border-l-4 border-primary shadow-sm">
                <div className="mb-2 md:mb-0">
                    <div className="text-gray-800 font-bold mb-1">特別獎 <span className="font-mono text-3xl ml-2">{currentDisplayNumbers.specialPrize}</span></div>
                    <div className="text-xs text-gray-500">8位數號碼相同：1000萬元</div>
                </div>
            </div>

            {/* Grand Prize */}
            <div className="bg-[#eff5e9] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between border-l-4 border-primary shadow-sm">
                <div className="mb-2 md:mb-0">
                    <div className="text-gray-800 font-bold mb-1">特&nbsp;&nbsp;&nbsp;&nbsp;獎 <span className="font-mono text-3xl ml-2">{currentDisplayNumbers.grandPrize}</span></div>
                    <div className="text-xs text-gray-500">8位數號碼相同：200萬元</div>
                </div>
            </div>

            {/* First Prize Group */}
            <div className="bg-[#eff5e9] rounded-xl p-4 border-l-4 border-primary shadow-sm flex">
                <div className="flex-1">
                    <div className="flex flex-col gap-2 mb-2">
                        {currentDisplayNumbers.firstPrize.map((num, i) => (
                            <div key={i} className="flex items-center">
                                {renderSplitNumber(num)}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 border-l border-gray-300 pl-4 text-xs text-gray-600 space-y-1 leading-relaxed">
                   <p><span className="font-bold text-gray-800">頭獎</span>→8位數號碼相同：20萬元</p>
                   <p>二獎→末7號碼相同者：4萬元</p>
                   <p>三獎→末6號碼相同者：1萬元</p>
                   <p>四獎→末5號碼相同者：4千元</p>
                   <p>五獎→末4號碼相同者：1千元</p>
                   <p>六獎→末3號碼相同者：2百元</p>
                </div>
            </div>

            {/* Additional Sixth Prize */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center">
                <div className="w-16 font-bold text-gray-800">增開<br/>六獎</div>
                <div className="flex-1 flex gap-4">
                    {currentDisplayNumbers.additionalSixthPrize.map((num, i) => (
                         <span key={i} className="font-mono text-2xl font-bold text-gray-800">{num}</span>
                    ))}
                    {currentDisplayNumbers.additionalSixthPrize.length === 0 && <span className="text-gray-400">無</span>}
                </div>
                <div className="text-xs text-gray-500">末3位號碼相同:200元</div>
            </div>

             {/* Quick Summary */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 text-center">
               <h3 className="font-bold text-gray-800 mb-4 text-lg">快速整理</h3>
               <div className="grid grid-cols-2 gap-4">
                  <div className="border-r border-gray-200">
                     <div className="text-gray-500 text-sm mb-1">末三碼百位數</div>
                     <div className="text-red-600 text-3xl font-bold font-mono">
                        {Array.from(new Set(
                            [...currentDisplayNumbers.firstPrize.map(n => n.slice(-3, -2)), 
                             ...currentDisplayNumbers.additionalSixthPrize.map(n => n.slice(0, 1))]
                        )).sort().join(',')}
                     </div>
                  </div>
                  <div>
                     <div className="text-gray-500 text-sm mb-1">末三碼個位數</div>
                     <div className="text-red-600 text-3xl font-bold font-mono">
                        {Array.from(new Set(
                            [...currentDisplayNumbers.firstPrize.map(n => n.slice(-1)), 
                             ...currentDisplayNumbers.additionalSixthPrize.map(n => n.slice(-1))]
                        )).sort().join(',')}
                     </div>
                  </div>
               </div>
            </div>
        </div>
    );
  };

  // 3. Scanner View
  const renderScanner = () => (
    <div className="flex flex-col items-center p-6 max-w-md mx-auto space-y-6">
      
      {/* Camera Fullscreen Overlay */}
      {isCameraOpen && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex justify-between items-center p-4 bg-black/50 absolute top-0 left-0 right-0 z-10">
            <span className="text-white font-medium">請將發票號碼對準框內</span>
            <button onClick={stopCamera} className="text-white p-2 rounded-full hover:bg-white/20">
              <X size={28} />
            </button>
          </div>
          
          <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
             <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
             <canvas ref={canvasRef} className="hidden" />
             
             {/* Scanning Frame Guide */}
             <div className="relative w-64 h-32 border-2 border-primary shadow-[0_0_0_999px_rgba(0,0,0,0.7)] rounded-lg">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-primary -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-primary -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-primary -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-primary -mb-1 -mr-1"></div>
                {/* Moving Line */}
                <div className="absolute top-0 left-0 w-full h-0.5 bg-primary shadow-[0_0_10px_#78A843] animate-[scan_2s_ease-in-out_infinite]"></div>
             </div>
          </div>

          <div className="h-32 bg-black/80 flex items-center justify-center pb-4">
             <button 
               onClick={captureImage} 
               className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-white/20 active:bg-primary transition-colors"
             >
                <div className="w-12 h-12 bg-white rounded-full"></div>
             </button>
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className="w-full grid grid-cols-2 gap-4">
        <button 
          onClick={startCamera}
          className="flex flex-col items-center justify-center p-6 bg-primary text-white rounded-xl shadow-md hover:bg-primary-dark active:scale-95 transition-all"
        >
          <Camera size={40} className="mb-2" />
          <span className="font-bold">開啟相機</span>
        </button>

        <label className="flex flex-col items-center justify-center p-6 bg-white text-primary border-2 border-primary rounded-xl shadow-sm hover:bg-gray-50 active:scale-95 transition-all cursor-pointer">
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileUpload} 
          />
          <ImageIcon size={40} className="mb-2" />
          <span className="font-bold">相簿上傳</span>
        </label>
      </div>

      {/* Processing State */}
      {isProcessing && (
         <div className="fixed inset-0 bg-black/50 z-40 flex flex-col items-center justify-center">
            <div className="bg-white p-6 rounded-xl flex flex-col items-center shadow-2xl">
               <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
               <p className="text-gray-800 font-medium animate-pulse">AI 辨識中...</p>
            </div>
         </div>
      )}

      <div className="w-full bg-white p-4 rounded-xl shadow-sm mt-4">
        <p className="text-xs text-gray-500 mb-2 font-medium">手動輸入完整8碼驗證</p>
        <div className="flex gap-2">
          <input 
            type="text" 
            maxLength={8}
            placeholder="輸入號碼"
            className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded text-center font-mono text-xl tracking-widest outline-none focus:ring-2 focus:ring-primary"
            onChange={(e) => {
               const val = e.target.value.replace(/\D/g, '');
               if(val.length <= 8) setScannedNumber(val);
            }}
            value={scannedNumber}
          />
          <button 
            onClick={() => handleManualFullCheck(scannedNumber)}
            disabled={scannedNumber.length !== 8}
            className="bg-primary text-white px-6 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-dark transition-colors"
          >
            檢查
          </button>
        </div>
      </div>

      {scanResult && (
        <div className={`w-full rounded-xl p-6 shadow-md border-l-8 ${scanResult.isWinner ? 'bg-red-50 border-red-500' : 'bg-white border-gray-300'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-2xl tracking-widest text-gray-800 font-bold">{scannedNumber}</span>
            {scanResult.isWinner && <Award size={28} className="text-red-500" />}
          </div>
          <h3 className={`text-xl font-bold mb-1 ${scanResult.isWinner ? 'text-red-600' : 'text-gray-500'}`}>
            {scanResult.prizeType}
          </h3>
          <p className="text-sm text-gray-600">
            {scanResult.description}
          </p>
        </div>
      )}
    </div>
  );

  // 4. History View (Modified to include Pending)
  const renderHistory = () => (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Sub-Tabs Switcher */}
      <div className="flex justify-center mb-6">
        <div className="bg-gray-200 p-1 rounded-lg inline-flex">
          <button
            onClick={() => setHistorySubTab('winning')}
            className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${
              historySubTab === 'winning' 
              ? 'bg-white text-primary shadow-sm' 
              : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            中獎紀錄
          </button>
          <button
            onClick={() => setHistorySubTab('pending')}
            className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${
              historySubTab === 'pending' 
              ? 'bg-white text-primary shadow-sm' 
              : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            預存發票
          </button>
        </div>
      </div>

      {historySubTab === 'winning' ? (
        // --- Winning History List ---
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center">
               <Award className="mr-2 text-primary" /> 歷史中獎
            </h2>
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-sm text-red-500 hover:text-red-700 underline">
                清除紀錄
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-dashed border-gray-300">
               <Award size={48} className="mx-auto mb-2 opacity-50" />
               <p>目前還沒有中獎紀錄</p>
               <p className="text-xs mt-1">中獎時會自動儲存於此</p>
            </div>
          ) : (
            <div className="space-y-3">
               {history.map((record) => (
                 <div key={record.id} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-primary flex justify-between items-center">
                    <div>
                       <div className="text-xs text-gray-500 mb-1">{record.date} • {record.period}</div>
                       <div className="font-mono text-xl font-bold text-gray-800 tracking-widest">{record.number}</div>
                       <div className="text-primary font-bold text-sm mt-1">{record.prizeType}</div>
                    </div>
                    <div className="text-right">
                       <div className="text-lg font-bold text-red-600">{record.amount}</div>
                    </div>
                 </div>
               ))}
            </div>
          )}
        </>
      ) : (
        // --- Pending Receipts View ---
        <>
          {/* Add Pending Input */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 mb-6">
             <h3 className="font-bold text-gray-800 mb-3 flex items-center">
               <Clock size={18} className="mr-2 text-primary" /> 預存下期發票
             </h3>
             <div className="grid gap-3">
                <select 
                   value={selectedPendingPeriod}
                   onChange={(e) => setSelectedPendingPeriod(e.target.value)}
                   className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                >
                   {futurePeriods.map((p, i) => (
                      <option key={i} value={p}>{p}</option>
                   ))}
                </select>
                <div className="flex gap-2">
                   <input
                      type="text"
                      maxLength={3}
                      placeholder="輸入末3碼"
                      value={pendingInput}
                      onChange={(e) => {
                         const val = e.target.value.replace(/\D/g, '');
                         if(val.length <= 3) setPendingInput(val);
                      }}
                      className="flex-1 p-2 border border-gray-300 rounded-lg text-center font-mono text-xl tracking-widest outline-none focus:ring-2 focus:ring-primary"
                   />
                   <button 
                      onClick={addPendingReceipt}
                      className="bg-primary text-white px-4 rounded-lg flex items-center justify-center hover:bg-primary-dark"
                   >
                      <PlusCircle size={20} />
                   </button>
                </div>
             </div>
          </div>

          <div className="space-y-3">
             {pendingReceipts.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                   <Clock size={40} className="mx-auto mb-2 opacity-50" />
                   <p>無預存發票</p>
                </div>
             ) : (
                pendingReceipts.map((receipt) => {
                   const check = checkPendingStatus(receipt);
                   
                   let cardClass = "border-l-4 border-gray-300 bg-white opacity-80"; // Lost/Gray
                   let statusColor = "text-gray-500";
                   let StatusIcon = X;

                   if (check.status === 'pending') {
                      cardClass = "border-l-4 border-yellow-400 bg-white";
                      statusColor = "text-yellow-600";
                      StatusIcon = Clock;
                   } else if (check.status === 'win') {
                      cardClass = "border-l-4 border-red-500 bg-red-50";
                      statusColor = "text-red-600 font-bold animate-pulse";
                      StatusIcon = AlertCircle;
                   }

                   return (
                      <div key={receipt.id} className={`p-4 rounded-xl shadow-sm flex justify-between items-center ${cardClass}`}>
                         <div>
                            <div className="text-xs text-gray-500 mb-1">{receipt.period}</div>
                            <div className="font-mono text-2xl font-bold text-gray-800 tracking-widest">{receipt.number}</div>
                            <div className={`text-xs mt-1 flex items-center ${statusColor}`}>
                               <StatusIcon size={14} className="mr-1" />
                               {check.message}
                            </div>
                         </div>
                         <button 
                            onClick={() => deletePendingReceipt(receipt.id)}
                            className="text-gray-300 hover:text-red-500 p-2"
                         >
                            <Delete size={20} />
                         </button>
                      </div>
                   );
                })
             )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-[#f5f7f2] text-gray-800 font-sans flex flex-col overflow-hidden">
      
      {/* Top Header */}
      <div className="bg-primary text-white shadow-md z-20">
         {/* Main Bar */}
         <div className="flex items-center justify-between px-4 h-12">
            <ChevronLeft size={24} className="cursor-pointer" />
            <h1 className="text-lg font-medium">
                {periodIndex === -1 ? '統一發票 (四個月一起對)' : `統一發票 ${winningNumbers.period}`}
            </h1>
            <div className="flex gap-3">
               <button 
                 onClick={handleRefresh}
                 disabled={isRefreshing}
                 className="p-1 rounded-full hover:bg-white/20 disabled:opacity-50 transition-colors"
               >
                 <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
               </button>
               <Share2 size={20} className="cursor-pointer hover:opacity-80" />
            </div>
         </div>

         {/* Navigation Tabs */}
         <div className="flex text-sm font-medium overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setActiveTab(Tab.Checker)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.Checker ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              對獎機
            </button>
            <button 
              onClick={() => setActiveTab(Tab.List)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.List ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              號碼單
            </button>
            <button 
              onClick={() => setActiveTab(Tab.Scanner)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.Scanner ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              掃描
            </button>
             <button 
              onClick={() => setActiveTab(Tab.Settings)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.Settings ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              設定
            </button>
            {/* Added History Tab */}
            <button 
              onClick={() => setActiveTab(Tab.History)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.History ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              紀錄
            </button>
         </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === Tab.Checker && renderChecker()}
        {activeTab === Tab.List && renderList()}
        {activeTab === Tab.Scanner && renderScanner()}
        {activeTab === Tab.Settings && (
          <NumberSettings 
            numbers={winningNumbers} 
            onCancel={() => setActiveTab(Tab.List)}
            onSave={(newNums) => {
              setWinningNumbers(newNums);
              setActiveTab(Tab.List);
            }}
          />
        )}
        {activeTab === Tab.History && renderHistory()}
      </main>

    </div>
  );
};

export default App;