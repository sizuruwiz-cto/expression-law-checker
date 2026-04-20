"use client";

import { useState, useRef, ChangeEvent, useEffect } from "react";
import { 
  Sparkles, CheckCircle2, AlertTriangle, AlertOctagon, 
  Copy, Loader2, RefreshCw, Upload, Link, FileText, Image as ImageIcon, X, Settings2, Info,
  ChevronDown, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type RiskLevel = "CRITICAL" | "WARNING" | "SAFE";
type InputTab = "text" | "url" | "file";
type InstagramUrlMode = "full" | "split";
type CheckType = "yakki" | "tokusho" | "internal";

const CHECK_SHORT: Record<CheckType, string> = {
  yakki: "薬機法",
  tokusho: "特商法",
  internal: "社内ルール",
};

const CHECK_ACTION_LABEL: Record<CheckType, string> = {
  yakki: "薬機法で解析する",
  tokusho: "特商法で解析する",
  internal: "社内ルールで解析する",
};

interface CheckResult {
  originalText: string;
  visualContext?: string;
  riskLevel: RiskLevel;
  reason: string;
  suggestions: string[];
  mediaIndex?: number;
  timestamp?: string;
}

interface PreviewMedia {
  url: string;
  type: "IMAGE" | "VIDEO";
}

interface ApiResponse {
  results: CheckResult[];
  summary: string;
  previewUrls?: PreviewMedia[];
  caption?: string;
  checkType?: CheckType;
}

interface FileData {
  data: string;
  type: string;
  name: string;
  duration?: number;
  frames?: { data: string; timeSec: number }[];
}

export default function Home() {
  const [checkType, setCheckType] = useState<CheckType>("yakki");
  const [activeTab, setActiveTab] = useState<InputTab>("text");
  const [inputText, setInputText] = useState("");
  const [url, setUrl] = useState("");
  const [instagramUrlMode, setInstagramUrlMode] = useState<InstagramUrlMode>("full");
  const [instagramUsername, setInstagramUsername] = useState("");
  const [instagramPostRef, setInstagramPostRef] = useState("");
  const [files, setFiles] = useState<FileData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const handleSeek = (mediaIndex: number | undefined, timestamp: string | undefined) => {
    if (mediaIndex === undefined || !timestamp) return;
    
    // 最初の数値をシーク位置とする（例: "12-15" -> 12, "12, 30" -> 12）
    const match = timestamp.match(/(\d+)/);
    if (match) {
      const time = parseInt(match[1], 10);
      const video = videoRefs.current[mediaIndex];
      if (video) {
        video.currentTime = time;
        video.play().catch(() => {}); // 再生開始（ブラウザ制限で失敗することもあるが無視）
        video.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // 解析完了時に自動スクロールとレイアウト変更
  useEffect(() => {
    if (results && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      if (window.innerWidth >= 1280) {
        setIsInputCollapsed(true);
      }
    }
  }, [results]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newFiles: FileData[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const base64 = await fileToBase64(file);
      const fileData: FileData = {
        data: base64,
        type: file.type,
        name: file.name
      };

      if (file.type.startsWith("video/")) {
        const { frames, duration } = await extractVideoFrames(file);
        fileData.duration = duration;
        fileData.frames = frames;
      }

      newFiles.push(fileData);
    }
    setFiles(prev => [...prev, ...newFiles]);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const extractVideoFrames = (file: File): Promise<{ frames: { data: string; timeSec: number }[]; duration: number }> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.preload = "auto";

      video.onloadedmetadata = () => {
        const duration = video.duration;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;

        const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;

        // 動画のフレーム抽出間隔を2秒に固定
        const interval = 2;

        const times: number[] = [];
        for (let t = 0; t < duration; t += interval) {
          times.push(Math.round(t));
        }

        const frames: { data: string; timeSec: number }[] = [];
        let idx = 0;

        const captureFrame = () => {
          if (idx >= times.length) {
            URL.revokeObjectURL(url);
            resolve({ frames, duration });
            return;
          }
          video.currentTime = times[idx];
        };

        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({
            data: canvas.toDataURL("image/jpeg", 0.5),
            timeSec: times[idx]
          });
          idx++;
          captureFrame();
        };

        captureFrame();
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ frames: [], duration: 0 });
      };
    });
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCheck = async () => {
    setIsLoading(true);
    setError(null);
    setResults(null);
    setIsInputCollapsed(false);

    try {
      let finalFiles = activeTab === "file" ? files : [];
      let finalText = activeTab === "text" ? inputText : "";
      let instagramGraphMediaUrls: string[] = [];
      let instagramGraphMediaTypes: string[] = [];

      // Instagram URL 解析（メディアは Graph の URL のみを /api/check に渡し、サーバーで取得。Vercel のペイロード制限を避ける）
      const instagramInfoBody =
        activeTab === "url" && instagramUrlMode === "full" && url.trim()
          ? { url: url.trim() }
          : activeTab === "url" &&
              instagramUrlMode === "split" &&
              instagramUsername.trim() &&
              instagramPostRef.trim()
            ? {
                username: instagramUsername.trim(),
                postUrlOrShortcode: instagramPostRef.trim(),
              }
            : null;

      if (instagramInfoBody) {
        const infoRes = await fetch("/api/instagram-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(instagramInfoBody),
        });

        if (!infoRes.ok) {
          const errorData = await infoRes.json();
          throw new Error(errorData.error || "Instagram情報の取得に失敗しました。");
        }

        const info = await infoRes.json();
        finalText = info.caption || "";

        if (info.media_items && info.media_items.length > 0) {
          instagramGraphMediaUrls = info.media_items
            .map((item: { media_url?: string }) => item.media_url)
            .filter((u: string | undefined): u is string => Boolean(u));
          instagramGraphMediaTypes = info.media_items.map(
            (item: { media_type?: string }) => item.media_type || "IMAGE"
          );
        }
      }

      const checkBody =
        instagramGraphMediaUrls.length > 0
          ? {
              checkType,
              text: finalText,
              instagramGraphMediaUrls,
              instagramGraphMediaTypes,
            }
          : { checkType, text: finalText, files: finalFiles };

      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkBody),
      });

      if (!response.ok) {
        let msg = "解析中にエラーが発生しました。";
        try {
          const errorData = await response.json();
          msg = (errorData as { error?: string }).error || msg;
        } catch {
          const t = await response.text();
          if (t) msg = t.slice(0, 240);
        }
        throw new Error(msg);
      }

      const data = (await response.json()) as ApiResponse;

      const previewUrls: PreviewMedia[] =
        data.previewUrls && data.previewUrls.length > 0
          ? data.previewUrls
          : instagramGraphMediaUrls.length > 0
            ? instagramGraphMediaUrls.map((u, i) => ({
                url: u,
                type:
                  instagramGraphMediaTypes[i] === "VIDEO" ||
                  instagramGraphMediaTypes[i] === "REELS"
                    ? "VIDEO"
                    : "IMAGE",
              }))
            : finalFiles.map((f) => ({
                url: f.data,
                type: f.type.startsWith("video/") ? "VIDEO" : "IMAGE",
              }));

      setResults({ ...data, previewUrls });
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラーが発生しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const [expandedIndices, setExpandedIndices] = useState<number[]>([]);

  useEffect(() => {
    setResults(null);
    setError(null);
    setExpandedIndices([]);
    setIsInputCollapsed(false);
  }, [checkType]);

  const toggleAccordion = (index: number) => {
    setExpandedIndices(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const effectiveCheckType = results?.checkType ?? checkType;
  const filteredResults = results
    ? results.results.filter((r) =>
        effectiveCheckType === "yakki"
          ? r.riskLevel === "CRITICAL"
          : r.riskLevel === "CRITICAL" || r.riskLevel === "WARNING"
      )
    : [];
  
  // 重複を排除 (originalText と reason が同じものをマージ)
  const uniqueResults = filteredResults.reduce((acc: CheckResult[], curr) => {
    const existing = acc.find(r => r.originalText === curr.originalText && r.reason === curr.reason);
    if (!existing) {
      acc.push({ ...curr });
    } else {
      // 既存の箇所情報に新しい情報を追記する
      if (curr.visualContext && existing.visualContext !== curr.visualContext) {
        if (!existing.visualContext?.includes(curr.visualContext)) {
          existing.visualContext = `${existing.visualContext}, ${curr.visualContext}`;
        }
      }
      // タイムスタンプ情報を統合する
      if (curr.timestamp && existing.timestamp !== curr.timestamp) {
        if (!existing.timestamp?.includes(curr.timestamp)) {
          existing.timestamp = existing.timestamp 
            ? `${existing.timestamp}, ${curr.timestamp}` 
            : curr.timestamp;
        }
      }
    }
    return acc;
  }, []);

  const isAccordionMode = uniqueResults.length >= 2;

  // 新規解析時にアコーディオンをリセット（必要に応じて全閉に）
  useEffect(() => {
    if (results) {
      setExpandedIndices([]);
    }
  }, [results]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getRiskStyles = (level: RiskLevel) => {
    switch (level) {
      case "CRITICAL": return "border-red-200 bg-red-50 text-red-900";
      case "WARNING": return "border-amber-200 bg-amber-50 text-amber-900";
      default: return "border-slate-200 bg-slate-50 text-slate-900";
    }
  };

  const getRiskIcon = (level: RiskLevel) => {
    switch (level) {
      case "CRITICAL": return <AlertOctagon className="w-6 h-6 text-red-600" />;
      case "WARNING": return <AlertTriangle className="w-6 h-6 text-amber-600" />;
      default: return <CheckCircle2 className="w-6 h-6 text-emerald-600" />;
    }
  };

  const isSplitView = results || isLoading || error;
  const isInputOnly = !isSplitView;

  const instagramTabReady =
    instagramUrlMode === "full"
      ? url.trim().length > 0
      : instagramUsername.trim().length > 0 && instagramPostRef.trim().length > 0;

  return (
    <div className="h-dvh min-h-0 bg-slate-50 font-sans text-slate-900 overflow-hidden flex flex-col">
      <div className={cn(
        "mx-auto px-4 transition-all duration-500 ease-in-out flex flex-col flex-1 w-full min-h-0 overflow-hidden",
        isSplitView ? "pt-6 pb-6 max-w-[1600px] md:px-12" : "pt-3 pb-3 md:pt-4 md:pb-4 max-w-3xl md:px-6"
      )}>
        <header className={cn(
          "shrink-0 transition-all duration-500",
          isSplitView ? "mb-10 pt-2 text-center md:text-left border-b border-slate-200 pb-6" : "mb-3 md:mb-4 text-center"
        )}>
          <div className={cn(
            "inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-100",
            isInputOnly ? "mb-1.5" : "mb-4",
            isInputOnly && "mx-auto"
          )}>
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">AI-Powered Analysis</span>
          </div>
          
          <h1 className={cn(
            "font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900",
            isInputOnly ? "text-2xl md:text-3xl mb-1.5" : "text-3xl md:text-4xl mb-3"
          )}>
            表現・法令チェッカー
          </h1>
          
          <p className={cn(
            "text-slate-500 max-w-2xl font-medium",
            isInputOnly ? "mx-auto text-xs md:text-sm leading-snug" : "text-sm md:text-base leading-relaxed"
          )}>
            薬機法・特商法・社内ルールのいずれかを選び、SNS投稿や動画を解析。<br className="hidden sm:block" />
            AIが修正案を提案し、コンプライアンスをサポートします。
          </p>
        </header>

        <main className={cn(
          "grid grid-cols-1 transition-all duration-500 flex-1 min-h-0",
          isSplitView
            ? "gap-6 overflow-y-auto xl:overflow-hidden xl:overflow-x-hidden xl:grid-cols-12 xl:grid-rows-1 xl:[grid-template-rows:minmax(0,1fr)] items-stretch min-h-0"
            : "max-w-2xl mx-auto w-full items-stretch overflow-hidden"
        )}>
          {/* LEFT: Input Section */}
          <section className={cn(
            "transition-all duration-500 min-h-0 flex flex-col",
            isSplitView
              ? cn(
                  "min-h-0 xl:h-full xl:min-h-0 xl:overflow-hidden",
                  results ? (isInputCollapsed ? "xl:col-span-1" : "xl:col-span-3") : "xl:col-span-4"
                )
              : "w-full flex-1"
          )}>
            <div className={cn(
              "bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all flex flex-col min-h-0",
              isInputOnly && "flex-1",
              isSplitView && !isInputCollapsed && "xl:flex-1 xl:min-h-0 xl:h-full",
              isInputCollapsed && results ? "p-4 text-center cursor-pointer hover:bg-slate-100 sticky top-0" : "p-0"
            )}
            onClick={() => isInputCollapsed && setIsInputCollapsed(false)}
            >
              {isInputCollapsed && results ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <Settings2 className="w-6 h-6 text-slate-400" />
                  <span className="[writing-mode:vertical-rl] font-bold text-[10px] tracking-widest text-slate-400 uppercase">INPUT SETTINGS</span>
                </div>
              ) : (
                <>
                  <div className={cn(
                    "border-b border-slate-200 bg-slate-50/30 space-y-1.5 shrink-0",
                    isInputOnly ? "p-3 md:p-3.5" : "p-4 md:p-5 space-y-2"
                  )}>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">チェック種別</p>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                      {(["yakki", "tokusho", "internal"] as CheckType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={isLoading}
                          onClick={() => setCheckType(t)}
                          className={cn(
                            "flex-1 px-3 rounded-xl text-sm font-bold border-2 transition-all text-center",
                            isInputOnly ? "min-h-10 py-2" : "min-h-[44px] py-2.5",
                            checkType === t
                              ? "border-blue-600 bg-blue-50 text-blue-800 shadow-sm"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                            isLoading && "opacity-60 cursor-not-allowed"
                          )}
                        >
                          {CHECK_SHORT[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex border-b border-slate-200 bg-slate-50/50 shrink-0">
                    {(["text", "url", "file"] as InputTab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-2 text-sm font-medium transition-all border-b-2",
                          isInputOnly ? "py-2" : "py-3",
                          activeTab === tab 
                            ? "bg-white border-blue-600 text-blue-600" 
                            : "border-transparent text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {tab === "text" && <FileText className="w-4 h-4" />}
                        {tab === "url" && <Link className="w-4 h-4" />}
                        {tab === "file" && <Upload className="w-4 h-4" />}
                        {tab === "text" ? "テキスト解析" : tab === "url" ? "Instagram URL" : "画像・動画"}
                      </button>
                    ))}
                    {results && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsInputCollapsed(true); }}
                        className="p-3 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div
                    className={cn(
                      "flex flex-col min-h-0 flex-1",
                      isInputOnly ? "p-3 md:p-4" : "p-6",
                      isSplitView && "min-h-0 xl:overflow-hidden"
                    )}
                  >
                    <div
                      className={cn(
                        "flex flex-col min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar",
                        isInputOnly && "min-h-0",
                        isSplitView && "xl:min-h-0 xl:pb-2"
                      )}
                    >
                    <AnimatePresence mode="wait">
                      {activeTab === "text" && (
                        <motion.div
                          key="text"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className={cn(
                            "flex flex-col min-h-0",
                            isInputOnly ? "flex-1 gap-2" : "space-y-4"
                          )}
                        >
                          <label className="block text-sm font-semibold text-slate-700 shrink-0">テロップや広告文を入力してください</label>
                          <textarea
                            className={cn(
                              "w-full p-3 md:p-4 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all resize-none outline-none text-slate-800 leading-relaxed text-sm",
                              isInputOnly ? "min-h-[72px] flex-1" : "h-48"
                            )}
                            placeholder="例：1週間で10kg痩せるサプリ！"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            disabled={isLoading}
                          />
                        </motion.div>
                      )}

                      {activeTab === "url" && (
                        <motion.div key="url" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                          <div className="flex flex-col gap-2">
                            <span className="text-sm font-semibold text-slate-700">入力方法</span>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => setInstagramUrlMode("full")}
                                className={cn(
                                  "flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
                                  instagramUrlMode === "full"
                                    ? "border-blue-600 bg-blue-50 text-blue-800"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                                  isLoading && "opacity-60 cursor-not-allowed"
                                )}
                              >
                                投稿URLをそのまま
                              </button>
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => setInstagramUrlMode("split")}
                                className={cn(
                                  "flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all",
                                  instagramUrlMode === "split"
                                    ? "border-blue-600 bg-blue-50 text-blue-800"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                                  isLoading && "opacity-60 cursor-not-allowed"
                                )}
                              >
                                ユーザー名＋投稿URL／ID
                              </button>
                            </div>
                          </div>

                          {instagramUrlMode === "full" ? (
                            <>
                              <label className="block text-sm font-semibold text-slate-700">Instagramの投稿URLを入力してください</label>
                              <input
                                type="url"
                                className="w-full p-4 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-slate-800 text-sm"
                                placeholder="https://www.instagram.com/ユーザー名/p/ABC123XYZ/"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                disabled={isLoading}
                              />
                              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <p className="text-[10px] text-slate-600 leading-relaxed flex gap-2">
                                  <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <span>
                                    <strong>URLの取得方法:</strong> 投稿を右クリックしてコピー。
                                  </span>
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <label className="block text-sm font-semibold text-slate-700">
                                アカウントのユーザー名
                              </label>
                              <input
                                type="text"
                                autoComplete="off"
                                className="w-full p-4 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-slate-800 text-sm"
                                placeholder="例: my_brand_official（@は省略可）"
                                value={instagramUsername}
                                onChange={(e) => setInstagramUsername(e.target.value)}
                                disabled={isLoading}
                              />
                              <label className="block text-sm font-semibold text-slate-700">
                                投稿の URL または投稿 ID（ショートコード）
                              </label>
                              <input
                                type="text"
                                className="w-full p-4 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-slate-800 text-sm"
                                placeholder="例: https://www.instagram.com/p/DXG6SJvj7d5/?hl=ja または DXG6SJvj7d5"
                                value={instagramPostRef}
                                onChange={(e) => setInstagramPostRef(e.target.value)}
                                disabled={isLoading}
                              />
                              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <p className="text-[10px] text-slate-600 leading-relaxed flex gap-2">
                                  <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <span>
                                    共有メニューから「リンクをコピー」でも短い URL になります。ブラウザのアドレス欄の&nbsp;
                                    <code className="text-[10px] bg-white px-1 rounded border border-slate-200">/p/〜</code>
                                    &nbsp;の後ろが投稿 ID です。
                                  </span>
                                </p>
                              </div>
                            </>
                          )}
                        </motion.div>
                      )}

                      {activeTab === "file" && (
                        <motion.div key="file" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                          <label className="block text-sm font-semibold text-slate-700">投稿前の成果物（画像・動画）をアップロード</label>
                          <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50 transition-all"
                          >
                            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-xs text-slate-600 font-medium">クリックしてファイルを選択</p>
                            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} disabled={isLoading} />
                          </div>

                          {files.length > 0 && (
                            <div className="grid grid-cols-3 gap-2 mt-4">
                              {files.map((file, idx) => (
                                <div key={idx} className="relative group rounded-lg overflow-hidden aspect-square border border-slate-200">
                                  {file.type.startsWith("image/") ? (
                                    <img src={file.data} alt={file.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                                      <ImageIcon className="w-6 h-6 text-slate-400" />
                                    </div>
                                  )}
                                  <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full hover:bg-black/70 transition-colors">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    </div>

                    <button
                      onClick={handleCheck}
                      disabled={
                        isLoading ||
                        (activeTab === "text" && !inputText.trim()) ||
                        (activeTab === "url" && !instagramTabReady) ||
                        (activeTab === "file" && files.length === 0)
                      }
                      className={cn(
                        "shrink-0 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 rounded-full transition-all active:scale-[0.98]",
                        isInputOnly ? "mt-3 min-h-11 py-2.5" : "mt-6 py-3",
                        (isLoading ||
                          (activeTab === "text" && !inputText.trim()) ||
                          (activeTab === "url" && !instagramTabReady) ||
                          (activeTab === "file" && files.length === 0)) &&
                          "opacity-50 cursor-not-allowed bg-slate-400"
                      )}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {CHECK_SHORT[checkType]}を解析中…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          {CHECK_ACTION_LABEL[checkType]}
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* RIGHT: Results Section */}
          <AnimatePresence mode="wait">
            {(isLoading || results || error) && (
              <motion.section 
                ref={resultsRef} 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={cn(
                  "transition-all duration-500 min-h-0 h-full overflow-y-auto overflow-x-hidden custom-scrollbar pb-10 xl:min-h-0",
                  results ? (isInputCollapsed ? "xl:col-span-11" : "xl:col-span-9") : "xl:col-span-8"
                )}
              >
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                      <p className="text-sm font-bold text-slate-600 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        {CHECK_SHORT[checkType]}のチェックを実行しています…
                      </p>
                      <div className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />
                      <div className="h-[500px] bg-white rounded-xl border border-slate-200 animate-pulse" />
                    </motion.div>
                  ) : results ? (
                    <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
                      
                      {/* Summary Area */}
                      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-2 h-full bg-blue-600" />
                        <div className="flex items-start gap-6">
                          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-6 h-6 text-blue-600" />
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <h3 className="text-lg font-bold text-slate-900">AIによる解析総評</h3>
                              <span className="text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                {CHECK_SHORT[effectiveCheckType]}
                              </span>
                            </div>
                            <p className="text-slate-600 leading-relaxed font-medium">{results.summary}</p>
                          </div>
                        </div>
                      </div>

                      {/* Desktop Dashboard Side-by-Side */}
                      <div className={cn(
                        "grid grid-cols-1 gap-8",
                        (results.previewUrls && results.previewUrls.length > 0) || results.caption ? "lg:grid-cols-12" : ""
                      )}>
                        {/* Media Column (Sticky on Desktop) */}
                        {((results.previewUrls && results.previewUrls.length > 0) || results.caption) && (
                          <div className="lg:col-span-5">
                            <div className="sticky top-8 space-y-4">
                              <div className="flex items-center justify-between px-2">
                                <h3 className="text-base font-bold text-slate-700 flex items-center gap-2">
                                  {results.previewUrls && results.previewUrls.length > 0 ? (
                                    <><ImageIcon className="w-5 h-5 text-blue-500" /> 解析対象メディア（全 {results.previewUrls.length} 枚）</>
                                  ) : (
                                    <><FileText className="w-5 h-5 text-blue-500" /> 解析対象コンテンツ</>
                                  )}
                                </h3>
                              </div>
                              
                              {results.previewUrls && results.previewUrls.length > 0 && (
                                <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
                                  {results.previewUrls.map((pMedia, pIdx) => {
                                    const isVideo = pMedia.type === "VIDEO";
                                    const mediaFitClass =
                                      "w-full max-h-[min(68dvh,720px)] h-auto object-contain";
                                    return (
                                      <div key={pIdx} className="relative flex-shrink-0 w-64 md:w-80 group snap-start">
                                        <div className="rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden bg-slate-100 flex items-center justify-center min-h-[120px] group-hover:border-blue-400 transition-all">
                                          {isVideo ? (
                                            <video 
                                              ref={(el) => { videoRefs.current[pIdx] = el; }}
                                              src={pMedia.url} 
                                              controls
                                              playsInline
                                              className={cn(mediaFitClass, "bg-black")}
                                            />
                                          ) : (
                                            <img 
                                              src={pMedia.url} 
                                              alt={`Preview ${pIdx + 1}`} 
                                              className={mediaFitClass}
                                            />
                                          )}
                                        </div>
                                        <div className="absolute top-3 left-3 bg-blue-600 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg border-2 border-white pointer-events-none">
                                          #{pIdx + 1}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {results.caption && (
                                <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
                                  <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> 投稿キャプション / 解析テキスト
                                  </h4>
                                  <div className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                                    {results.caption}
                                  </div>
                                </div>
                              )}
                              
                              {results.previewUrls && results.previewUrls.length > 0 && (
                                <div className="p-4 bg-slate-100/50 rounded-xl border border-slate-200 text-center">
                                  <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
                                    メディアを横にスクロールして各内容を確認できます。<br/>右側の「時間」をクリックすると動画の該当箇所へシークします。
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Risk Cards Column */}
                        <div className={cn(
                          "space-y-6",
                          (results.previewUrls && results.previewUrls.length > 0) || results.caption ? "lg:col-span-7" : "lg:col-span-12"
                        )}>
                          <h3 className="text-base font-bold text-slate-700 flex items-center gap-2 px-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" /> 検出されたリスク項目
                          </h3>
                          
                          <div className="space-y-4">
                            {uniqueResults.map((result, idx) => {
                              const isExpanded = !isAccordionMode || expandedIndices.includes(idx);
                              return (
                                <motion.div 
                                  key={idx} 
                                  layout
                                  className={cn(
                                    "p-6 rounded-3xl border-2 shadow-sm transition-all",
                                    getRiskStyles(result.riskLevel),
                                    isAccordionMode && "cursor-pointer hover:shadow-md"
                                  )}
                                  onClick={() => isAccordionMode && toggleAccordion(idx)}
                                >
                                  {/* Header Row: Always visible */}
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                      <div className={cn(
                                        "w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center shadow-sm border border-white flex-shrink-0",
                                        result.riskLevel === "CRITICAL" ? "bg-red-100" : "bg-amber-100"
                                      )}>
                                        {getRiskIcon(result.riskLevel)}
                                      </div>
                                      <div>
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                          <span className={cn(
                                            "text-[10px] font-black tracking-widest uppercase px-3 py-0.5 rounded-full border",
                                            result.riskLevel === "CRITICAL" ? "bg-red-600 text-white border-red-700" : "bg-amber-500 text-white border-amber-600"
                                          )}>
                                            {result.riskLevel}
                                          </span>
                                        </div>
                                        <h4 className="text-base md:text-lg font-bold tracking-tight">「{result.originalText}」</h4>
                                      </div>
                                    </div>
                                    
                                    {isAccordionMode && (
                                      <motion.div
                                        animate={{ rotate: isExpanded ? 180 : 0 }}
                                        transition={{ duration: 0.3 }}
                                        className="p-2 bg-white/50 rounded-full"
                                      >
                                        <ChevronDown className="w-5 h-5 opacity-40" />
                                      </motion.div>
                                    )}
                                  </div>
                                  
                                  {/* Expandable Content */}
                                  <AnimatePresence initial={false}>
                                    {isExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
                                        className="overflow-hidden"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="pt-8 flex flex-wrap gap-3">
                                          {result.visualContext && !result.timestamp && (
                                            <div className="inline-flex items-center gap-2 bg-white/60 px-3 py-1.5 rounded-xl border border-current/10 self-start text-sm font-bold">
                                              <ImageIcon className="w-4 h-4 opacity-60" />
                                              <span>箇所: {result.visualContext}</span>
                                            </div>
                                          )}

                                          {result.timestamp && (
                                            <div className="flex flex-wrap gap-2">
                                              {result.timestamp.split(",").map((ts, tsIdx) => (
                                                <button 
                                                  key={tsIdx}
                                                  onClick={(e) => { e.stopPropagation(); handleSeek(result.mediaIndex, ts.trim()); }}
                                                  className="inline-flex items-center gap-2 bg-blue-100/60 text-blue-900 px-3 py-1.5 rounded-xl border border-blue-200/50 self-start text-xs font-bold hover:bg-blue-200/80 transition-all active:scale-[0.98]"
                                                >
                                                  <Clock className="w-3.5 h-3.5 opacity-60" />
                                                  <span>{ts.trim()}秒付近</span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div className="pt-6 space-y-8">
                                            <div>
                                              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                <Info className="w-4 h-4 text-slate-400" />
                                                {effectiveCheckType === "yakki"
                                                  ? "法的根拠と指摘理由"
                                                  : "根拠と指摘理由"}
                                              </p>
                                              <p className="text-sm md:text-base leading-relaxed font-bold bg-white/50 p-6 rounded-2xl border border-white shadow-inner min-h-[120px]">
                                                {result.reason}
                                              </p>
                                            </div>

                                            {result.suggestions.length > 0 && (
                                              <div className="space-y-3">
                                                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                  <RefreshCw className="w-4 h-4 text-slate-400" />
                                                  {effectiveCheckType === "tokusho"
                                                    ? "表示の修正案・追記案"
                                                    : effectiveCheckType === "internal"
                                                      ? "修正案（言い換え・対応）"
                                                      : "安全な言い換え案"}
                                                </p>
                                                <div className="grid grid-cols-1 gap-2">
                                                  {result.suggestions.map((suggestion, sIdx) => (
                                                    <button
                                                      key={sIdx}
                                                      onClick={() => copyToClipboard(suggestion)}
                                                      className="group flex items-center justify-between gap-4 p-4 bg-white hover:bg-blue-600 hover:text-white rounded-2xl shadow-sm border border-slate-200 transition-all active:scale-[0.98]"
                                                    >
                                                      <span className="text-sm font-bold text-left">{suggestion}</span>
                                                      <Copy className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                                                    </button>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </motion.div>
                              );
                            })}
                            
                            {uniqueResults.length === 0 && (
                              <div className="p-16 bg-white border border-slate-200 rounded-[3rem] text-center shadow-sm">
                                <div className="w-20 h-20 bg-emerald-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                                </div>
                                <p className="text-xl font-bold text-slate-900 tracking-tight">
                                  {effectiveCheckType === "yakki"
                                    ? "重大な法的リスクは見つかりませんでした"
                                    : "CRITICAL / WARNING 相当の指摘はありませんでした"}
                                </p>
                                <p className="text-slate-500 text-sm mt-2 font-medium">
                                  {effectiveCheckType === "yakki"
                                    ? "現在のガイドラインにおいて安全圏内です。"
                                    : "選択したチェック種別の基準で大きな問題は検出されませんでした。"}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : error ? (
                    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-red-50 border border-red-100 rounded-2xl p-12 text-center shadow-inner">
                      <AlertOctagon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                      <p className="text-red-900 font-bold mb-2">解析エラーが発生しました</p>
                      <p className="text-red-700 text-sm">{error}</p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.section>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
