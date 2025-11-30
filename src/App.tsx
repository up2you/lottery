import React, { useState, useRef, useEffect } from 'react';
import { Camera, Share2, RefreshCw, ChevronLeft, Award, Delete, Calendar, Layers, Mic, MicOff, X, Image as ImageIcon, Clock, PlusCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import jsQR from 'jsqr';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
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
  const animationFrameRef = useRef<number>(0);

  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);

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

  // Audio Context for Beep Sound
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- Initialization Effects ---

  // Initialize Audio Context
  useEffect(() => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
        audioContextRef.current = new AudioContext();
    }
  }, []);

  const playBeep = (freq = 800, type: OscillatorType = 'sine', duration = 0.1) => {
    if (!audioContextRef.current) return;
    try {
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch(e) {
        console.error("Audio play failed", e);
    }
  };

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
            setTimeout(() => {
                alert(`🎉 注意！您的預存發票中有疑似中獎號碼：\n\n${winningNumbersStr}\n\n請前往「紀錄」頁面核對！`);
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
        stopCamera();
    }
    
    // 2. Stop Voice Playback immediately
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    // 3. Stop Voice Recognition (Microphone)
    if (activeTab !== Tab.Checker && isListening) {
        SpeechRecognition.stop();
        setIsListening(false);
    }
  }, [activeTab]);


  const generateNextPeriods = (currentPeriodStr: string): string[] => {
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

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    hasAlertedPendingWins.current = false; 
    
    try {
        const cloudData = await fetchWinningNumbersFromCloud();
        if (cloudData && cloudData.length > 0) {
            setAllLotteryData(cloudData);
            setWinningNumbers(cloudData[0]);
            setFuturePeriods(generateNextPeriods(cloudData[0].period));
            alert("已從雲端同步最新號碼！");
        } else {
            const appId = localStorage.getItem('appId');
            if (appId) {
                const term = "11310"; 
                const apiData = await fetchWinningNumbersFromAPI(term, appId);
                if (apiData) {
                    const newData = [...allLotteryData];
                    const idx = newData.findIndex(d => d.period === apiData.period);
                    if (idx >= 0) {
                        newData[idx] = apiData;
                    } else {
                        newData.unshift(apiData);
                    }
                    setAllLotteryData(newData);
                    alert("已透過 API 更新當期資料");
                } else {
                    alert("目前已是最新資料");
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

  const speakResult = (message: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.2;
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- Voice Recognition Logic (Native Plugin) ---
  
  useEffect(() => {
    // Listener for partial results from native plugin
    SpeechRecognition.removeAllListeners();
    
    SpeechRecognition.addListener('partialResults', (data: any) => {
        if (data.matches && data.matches.length > 0) {
            const rawText = data.matches[0];
            const digits = normalizeToDigits(rawText);
            
            if (digits) {
                setQuickInput(prev => {
                    let newVal = prev;
                    for (const char of digits) {
                        playBeep(1200, 'square', 0.05); // Beep on voice input
                        if (newVal.length >= 3) {
                            newVal = char; 
                        } else {
                            newVal += char;
                        }
                    }
                    return newVal;
                });
            }
        }
    });

    return () => {
        SpeechRecognition.removeAllListeners();
    };
  }, []);

  const toggleListening = async () => {
      // 檢查是否在原生平台
      if (!Capacitor.isNativePlatform()) {
          alert("語音輸入功能僅在手機 App 中可用");
          return;
      }

      try {
          const { available } = await SpeechRecognition.available();
          if (!available) {
              alert("此裝置不支援語音輸入功能");
              return;
          }

          if (isListening) {
              try {
                  await SpeechRecognition.stop();
                  setIsListening(false);
              } catch (e) {
                  console.error("Stop failed", e);
                  setIsListening(false);
              }
          } else {
              // 先檢查權限狀態
              const permissionResult = await SpeechRecognition.checkPermissions();
              
              if (permissionResult.speechRecognition !== 'granted') {
                  // 請求權限
                  const requestResult = await SpeechRecognition.requestPermissions();
                  if (requestResult.speechRecognition !== 'granted') {
                      alert("需要麥克風權限才能使用語音輸入");
                      return;
                  }
              }

              setIsListening(true);
              
              // Start listening
              await SpeechRecognition.start({
                  language: "zh-TW",
                  maxResults: 1,
                  prompt: "請唸出號碼...",
                  partialResults: true,
                  popup: false,
              });
          }
      } catch (e) {
          console.error("Voice operation failed", e);
          setIsListening(false);
          alert(`語音功能錯誤：${e instanceof Error ? e.message : '未知錯誤'}`);
      }
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


  // Quick Check Logic
  useEffect(() => {
    if (quickInput.length === 3) {
      let result = { potential: false, message: "沒中" };

      if (periodIndex === -1) {
        const results = allLotteryData.map(data => quickCheck3Digits(quickInput, data));
        const match = results.find(r => r.potential);
        if (match) {
          result = { potential: true, message: "注意中獎 (請核對期別)" };
        }
      } else {
        result = quickCheck3Digits(quickInput, winningNumbers);
      }

      setQuickResult(result);
      
      // TTS Logic
      if (result.potential) {
        playBeep(1000, 'sine', 0.2); // Success beep
        speakResult("注意中獎");
      } else {
        playBeep(300, 'sawtooth', 0.2); // Fail beep
        speakResult("沒中");
      }
    } else {
      setQuickResult(null);
    }
  }, [quickInput, winningNumbers, periodIndex, allLotteryData]);

  // Handle number pad input
  const handlePadInput = (value: string) => {
    playBeep(); // Keypad sound
    if (value === 'back') {
      setQuickInput(prev => prev.slice(0, -1));
      return;
    } 

    if (quickInput.length === 3) {
      setQuickInput(value);
    } else {
      setQuickInput(prev => prev + value);
    }
  };

  // --- QR Code & Camera Logic ---
  
  const tickCamera = () => {
      if (videoRef.current && canvasRef.current && isCameraOpen) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
              // 確保 canvas 尺寸與 video 一致
              const videoWidth = video.videoWidth;
              const videoHeight = video.videoHeight;
              
              if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
                  canvas.width = videoWidth;
                  canvas.height = videoHeight;
              }
              
              const ctx = canvas.getContext("2d", { 
                  willReadFrequently: true,
                  alpha: false  // 提升效能
              });
              
              if (ctx) {
                  // 繪製 video 到 canvas
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  
                  // 獲取圖像數據
                  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  
                  // QR Scan - 調整參數以提升辨識率
                  const code = jsQR(
                      imageData.data, 
                      imageData.width, 
                      imageData.height,
                      {
                          inversionAttempts: "attemptBoth"  // 嘗試兩種反轉
                      }
                  );

                  if (code && code.data) {
                      console.log("QR Code detected:", code.data); // 除錯用
                      const matched = code.data.match(/[A-Z]{2}(\d{8})/);
                      if (matched && matched[1]) {
                          const num = matched[1];
                          // Only update if different to avoid spam
                          if (num !== scannedNumber) {
                              playBeep(1500, 'square', 0.1);
                              handleManualFullCheck(num);
                          }
                      } else {
                          // 如果不是發票格式，也嘗試直接提取 8 位數字
                          const digitsOnly = code.data.replace(/\D/g, '');
                          if (digitsOnly.length === 8 && digitsOnly !== scannedNumber) {
                              console.log("Extracted 8 digits:", digitsOnly);
                              playBeep(1500, 'square', 0.1);
                              handleManualFullCheck(digitsOnly);
                          }
                      }
                  }
              }
          }
          // 使用 requestAnimationFrame 維持掃描迴圈
          animationFrameRef.current = requestAnimationFrame(tickCamera);
      }
  };


  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 }, // Lower resolution for better performance
          height: { ideal: 720 }
        }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = async () => {
           videoRef.current?.play();
           animationFrameRef.current = requestAnimationFrame(tickCamera); // Start scanning loop

           // AUTO-FOCUS
           const track = stream.getVideoTracks()[0];
           const capabilities = (track.getCapabilities && track.getCapabilities()) as any;
           
           if (capabilities && capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
             try {
               await track.applyConstraints({
                 advanced: [{ focusMode: 'continuous' } as any]
               });
             } catch (err) {}
           }
        };
      }
    } catch (err) {
      console.error("Camera start failed", err);
      alert("無法啟動相機");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
    }
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
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        const base64Data = base64.split(',')[1];
        
        // Don't stop camera, let user take multiple if needed
        processImageAnalysis(base64Data);
      }
    }
  };
  
  const processImageAnalysis = async (base64Data: string) => {
    setIsProcessing(true);
    setScanResult(null);

    try {
      const result = await geminiService.parseReceiptImage(base64Data);
      
      if (result && result.number) {
        handleManualFullCheck(result.number);
      } else {
        alert("無法辨識，請重試");
      }
    } catch (error) {
      console.error("Scanning failed", error);
      alert("分析失敗");
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


  // Manual Check
  const handleManualFullCheck = (num: string) => {
    setScannedNumber(num);
    let prizeResult: CheckResult;
    if (periodIndex === -1) {
         const results = allLotteryData.map(data => checkLotteryNumber(num, data));
         const winner = results.find(r => r.isWinner);
         prizeResult = winner || results[0];
    } else {
         prizeResult = checkLotteryNumber(num, winningNumbers);
    }
    setScanResult(prizeResult);

    if (prizeResult.isWinner) {
        playBeep(1000, 'sine', 0.3);
        speakResult(`恭喜中獎，${prizeResult.prizeType}`);
        addRecord(prizeResult, num);
    } else {
        playBeep(200, 'sawtooth', 0.2);
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

  const checkPendingStatus = (receipt: PendingReceipt): { status: 'pending' | 'win' | 'lost', message: string } => {
    const officialData = allLotteryData.find(d => d.period === receipt.period);
    if (!officialData) {
      return { status: 'pending', message: '等待開獎' };
    }
    const check = quickCheck3Digits(receipt.number, officialData);
    if (check.potential) {
      return { status: 'win', message: '注意！疑似中獎' };
    } else {
      return { status: 'lost', message: '未中獎' };
    }
  };


  // --- Views ---

  // 1. Checker View
  const renderChecker = () => (
    <div className="flex flex-col h-full bg-white relative">
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

  // 2. List View
  const renderList = () => {
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

            <div className="bg-[#eff5e9] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between border-l-4 border-primary shadow-sm">
                <div className="mb-2 md:mb-0">
                    <div className="text-gray-800 font-bold mb-1">特別獎 <span className="font-mono text-3xl ml-2">{currentDisplayNumbers.specialPrize}</span></div>
                    <div className="text-xs text-gray-500">8位數號碼相同：1000萬元</div>
                </div>
            </div>

            <div className="bg-[#eff5e9] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between border-l-4 border-primary shadow-sm">
                <div className="mb-2 md:mb-0">
                    <div className="text-gray-800 font-bold mb-1">特&nbsp;&nbsp;&nbsp;&nbsp;獎 <span className="font-mono text-3xl ml-2">{currentDisplayNumbers.grandPrize}</span></div>
                    <div className="text-xs text-gray-500">8位數號碼相同：200萬元</div>
                </div>
            </div>

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
      
      {isCameraOpen && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex justify-between items-center p-4 bg-black/50 absolute top-0 left-0 right-0 z-10">
            <span className="text-white font-medium">請將發票 QR Code 或號碼對準框內</span>
            <button onClick={stopCamera} className="text-white p-2 rounded-full hover:bg-white/20">
              <X size={28} />
            </button>
          </div>
          
          <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
             <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
             <canvas ref={canvasRef} className="hidden" />
             
             {/* Scanning Frame Guide */}
             <div className="relative w-64 h-64 border-2 border-primary shadow-[0_0_0_999px_rgba(0,0,0,0.7)] rounded-lg">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary -mb-1 -mr-1"></div>
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

  // 4. History View
  const renderHistory = () => (
    <div className="p-4 max-w-2xl mx-auto pb-24">
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
        <>
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
                   
                   let cardClass = "border-l-4 border-gray-300 bg-white opacity-80"; 
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
            <button 
              onClick={() => setActiveTab(Tab.History)}
              className={`flex-1 min-w-[20%] py-3 text-center border-b-4 transition-colors whitespace-nowrap ${activeTab === Tab.History ? 'border-yellow-400 text-white' : 'border-transparent text-primary-light hover:text-white hover:bg-primary-dark'}`}
            >
              紀錄
            </button>
         </div>
      </div>

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