import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BIOLOGY_PAIRS,
  BiologyCategory,
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
  DifficultyLevel,
} from './data/biologyPairs';
import {
  ANSWERS_PER_LEVEL,
  BoardState,
  CORRECT_BONUS_SECONDS,
  INITIAL_SECONDS,
  MAX_DIFFICULTY,
  WRONG_PENALTY_SECONDS,
  createInitialBoard,
  getDifficultyForCorrectCount,
  getPoolForCategory,
  replaceMatchedPair,
} from './utils/gameEngine';
import { soundManager } from './utils/sound';

type GameStatus = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';

interface FeedbackBanner {
  id: number;
  type: 'correct' | 'wrong';
  text: string;
}

interface SlotFlash {
  type: 'correct' | 'wrong';
  leftIdx: number;
  rightIdx: number;
}

interface MistakeRecord {
  id: string;
  prompt: string;
  correctAnswer: string;
  chosenAnswer: string;
}

const RIGHT_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const HIGH_SCORE_STORAGE_KEY = 'bio_match_best_score_v1';

export default function App() {
  const [status, setStatus] = useState<GameStatus>('TITLE_MENU');
  const [category, setCategory] = useState<'all' | BiologyCategory>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [board, setBoard] = useState<BoardState>(() => createInitialBoard('all'));
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);

  const [remainingMs, setRemainingMs] = useState<number>(INITIAL_SECONDS * 1000);
  const remainingMsRef = useRef<number>(INITIAL_SECONDS * 1000);
  const lastFrameRef = useRef<number | null>(null);
  const lastTickSecondRef = useRef<number>(INITIAL_SECONDS);

  const [correctCount, setCorrectCount] = useState<number>(0);
  const correctCountRef = useRef<number>(0);
  const [wrongCount, setWrongCount] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(0);
  const [bonusSecondsEarned, setBonusSecondsEarned] = useState<number>(0);
  const [penaltySecondsLost, setPenaltySecondsLost] = useState<number>(0);
  const [mistakes, setMistakes] = useState<MistakeRecord[]>([]);

  const [slotFlash, setSlotFlash] = useState<SlotFlash | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<FeedbackBanner | null>(null);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const flashTimeoutRef = useRef<number | null>(null);
  const pendingReplaceRef = useRef<{
    leftIdx: number;
    rightIdx: number;
    targetDifficulty: DifficultyLevel;
  } | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
  }, []);

  const commitPendingReplacement = useCallback(() => {
    if (pendingReplaceRef.current) {
      const { leftIdx, rightIdx, targetDifficulty } = pendingReplaceRef.current;
      pendingReplaceRef.current = null;
      setBoard((prev) =>
        replaceMatchedPair(prev, leftIdx, rightIdx, category, targetDifficulty)
      );
    }
  }, [category]);

  const finishGame = useCallback(
    () => {
      clearPendingTimeout();
      pendingReplaceRef.current = null;
      remainingMsRef.current = 0;
      setRemainingMs(0);
      setSelectedLeft(null);
      setSelectedRight(null);
      setSlotFlash(null);
      setStatus('GAME_OVER');
      soundManager.playFinish();

      const finalCorrectCount = correctCountRef.current;
      setBestScore((prevBest) => {
        const nextBest = Math.max(prevBest, finalCorrectCount);
        try {
          localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(nextBest));
        } catch {
          // Ignore storage restrictions
        }
        return nextBest;
      });
    },
    [clearPendingTimeout]
  );

  const startGame = useCallback(
    (targetCategory: 'all' | BiologyCategory = category) => {
      clearPendingTimeout();
      pendingReplaceRef.current = null;
      const freshBoard = createInitialBoard(targetCategory);
      setBoard(freshBoard);
      setSelectedLeft(null);
      setSelectedRight(null);
      setSlotFlash(null);
      setFeedbackBanner(null);
      correctCountRef.current = 0;
      setCorrectCount(0);
      setWrongCount(0);
      setStreak(0);
      setBestStreak(0);
      setBonusSecondsEarned(0);
      setPenaltySecondsLost(0);
      setMistakes([]);

      const initialMs = INITIAL_SECONDS * 1000;
      remainingMsRef.current = initialMs;
      lastTickSecondRef.current = INITIAL_SECONDS;
      lastFrameRef.current = performance.now();
      setRemainingMs(initialMs);
      setStatus('PLAYING');
      soundManager.playSelect();
    },
    [category, clearPendingTimeout]
  );

  // High-precision countdown loop during active play
  useEffect(() => {
    if (status !== 'PLAYING') {
      lastFrameRef.current = null;
      return;
    }

    lastFrameRef.current = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const prev = lastFrameRef.current ?? now;
      const elapsed = now - prev;
      lastFrameRef.current = now;

      const nextMs = Math.max(0, remainingMsRef.current - elapsed);
      remainingMsRef.current = nextMs;
      setRemainingMs(nextMs);

      const ceilSec = Math.ceil(nextMs / 1000);
      if (ceilSec !== lastTickSecondRef.current && ceilSec > 0 && ceilSec <= 5) {
        soundManager.playTick();
      }
      lastTickSecondRef.current = ceilSec;

      if (nextMs <= 0) {
        window.clearInterval(intervalId);
        finishGame();
      }
    }, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status, finishGame]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearPendingTimeout();
    };
  }, [clearPendingTimeout]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundManager.enabled = next;
  };

  const evaluatePair = useCallback(
    (leftIdx: number, rightIdx: number) => {
      const leftSlot = board.leftSlots[leftIdx];
      const rightSlot = board.rightSlots[rightIdx];
      if (!leftSlot || !rightSlot) return;

      const isMatch = leftSlot.pairId === rightSlot.pairId;

      if (isMatch) {
        soundManager.playCorrect();
        const nextMs = remainingMsRef.current + CORRECT_BONUS_SECONDS * 1000;
        remainingMsRef.current = nextMs;
        setRemainingMs(nextMs);

        const prevDifficulty = getDifficultyForCorrectCount(correctCountRef.current);
        const nextCorrect = correctCountRef.current + 1;
        const nextDifficulty = getDifficultyForCorrectCount(nextCorrect);
        correctCountRef.current = nextCorrect;
        setCorrectCount(nextCorrect);
        setBonusSecondsEarned((prev) => prev + CORRECT_BONUS_SECONDS);
        setStreak((prev) => {
          const updated = prev + 1;
          setBestStreak((b) => Math.max(b, updated));
          return updated;
        });

        const leveledUp = nextDifficulty > prevDifficulty;
        setFeedbackBanner({
          id: Date.now(),
          type: 'correct',
          text: leveledUp
            ? `+${CORRECT_BONUS_SECONDS} san · Səviyyə ${nextDifficulty}: ${DIFFICULTY_LABELS[nextDifficulty]}!`
            : `+${CORRECT_BONUS_SECONDS} san · Doğru`,
        });

        setSlotFlash({ type: 'correct', leftIdx, rightIdx });
        setSelectedLeft(null);
        setSelectedRight(null);

        pendingReplaceRef.current = {
          leftIdx,
          rightIdx,
          targetDifficulty: nextDifficulty,
        };
        clearPendingTimeout();
        flashTimeoutRef.current = window.setTimeout(() => {
          commitPendingReplacement();
          setSlotFlash(null);
        }, 180);
      } else {
        soundManager.playWrong();
        const nextMs = Math.max(0, remainingMsRef.current - WRONG_PENALTY_SECONDS * 1000);
        remainingMsRef.current = nextMs;
        setRemainingMs(nextMs);

        setWrongCount((prev) => prev + 1);
        setPenaltySecondsLost((prev) => prev + WRONG_PENALTY_SECONDS);
        setStreak(0);

        const truePair = board.activePairsById[leftSlot.pairId];
        if (truePair) {
          setMistakes((prev) => [
            {
              id: `${leftSlot.pairId}-${Date.now()}`,
              prompt: truePair.prompt,
              correctAnswer: truePair.answer,
              chosenAnswer: rightSlot.text,
            },
            ...prev,
          ]);
        }

        setFeedbackBanner({
          id: Date.now(),
          type: 'wrong',
          text: `-${WRONG_PENALTY_SECONDS} san · Səhv`,
        });

        if (nextMs <= 0) {
          finishGame();
          return;
        }

        setSlotFlash({ type: 'wrong', leftIdx, rightIdx });
        setSelectedLeft(null);
        setSelectedRight(null);

        clearPendingTimeout();
        flashTimeoutRef.current = window.setTimeout(() => {
          setSlotFlash(null);
        }, 320);
      }
    },
    [
      board,
      clearPendingTimeout,
      commitPendingReplacement,
      finishGame,
    ]
  );

  const handleSelectLeft = useCallback(
    (idx: number) => {
      if (status !== 'PLAYING') return;

      // Finish any pending matched-pair replacement immediately so rapid clicks never stall
      if (pendingReplaceRef.current) {
        clearPendingTimeout();
        commitPendingReplacement();
        setSlotFlash(null);
      } else if (slotFlash?.type === 'wrong') {
        clearPendingTimeout();
        setSlotFlash(null);
      }

      if (selectedLeft === idx) {
        setSelectedLeft(null);
        return;
      }

      soundManager.playSelect();

      if (selectedRight !== null) {
        evaluatePair(idx, selectedRight);
      } else {
        setSelectedLeft(idx);
      }
    },
    [
      clearPendingTimeout,
      commitPendingReplacement,
      evaluatePair,
      selectedLeft,
      selectedRight,
      slotFlash,
      status,
    ]
  );

  const handleSelectRight = useCallback(
    (idx: number) => {
      if (status !== 'PLAYING') return;

      if (pendingReplaceRef.current) {
        clearPendingTimeout();
        commitPendingReplacement();
        setSlotFlash(null);
      } else if (slotFlash?.type === 'wrong') {
        clearPendingTimeout();
        setSlotFlash(null);
      }

      if (selectedRight === idx) {
        setSelectedRight(null);
        return;
      }

      soundManager.playSelect();

      if (selectedLeft !== null) {
        evaluatePair(selectedLeft, idx);
      } else {
        setSelectedRight(idx);
      }
    },
    [
      clearPendingTimeout,
      commitPendingReplacement,
      evaluatePair,
      selectedLeft,
      selectedRight,
      slotFlash,
      status,
    ]
  );

  // Keyboard shortcuts: 1-5 for left column, Escape to deselect
  useEffect(() => {
    if (status !== 'PLAYING') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLeft(null);
        setSelectedRight(null);
        return;
      }
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 5) {
        handleSelectLeft(num - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, handleSelectLeft]);

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progressPct = Math.min(100, Math.max(0, (remainingMs / (INITIAL_SECONDS * 1000)) * 100));
  const isUrgent = status === 'PLAYING' && remainingSeconds <= 15;

  const totalAttempts = correctCount + wrongCount;
  const accuracyPct = totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0;
  const poolSize = getPoolForCategory(category).length;
  const currentDifficulty = getDifficultyForCorrectCount(correctCount);
  const progressInLevel =
    currentDifficulty >= MAX_DIFFICULTY
      ? ANSWERS_PER_LEVEL
      : correctCount % ANSWERS_PER_LEVEL;

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F7F5] text-[#0F1F18]">
      {/* Top Bar Contract: Brand wordmark — Rule summary — Primary action */}
      <header className="w-full border-b border-[#DCE4DF] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 sm:gap-8">
          <button
            type="button"
            onClick={() => {
              clearPendingTimeout();
              setStatus('TITLE_MENU');
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-[#0F1F18] hover:text-[#059669] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
          >
            Biologiya Uyğunlaşdırma
          </button>

          <div className="hidden md:flex items-center gap-3 text-xs font-medium text-[#52635B] whitespace-nowrap">
            <span>60 saniyə başlanğıc</span>
            <span aria-hidden="true">·</span>
            <span>Doğru: +5 saniyə</span>
            <span aria-hidden="true">·</span>
            <span>Səhv: -7 saniyə</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundEnabled ? 'Səsi bağla' : 'Səsi aç'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#3D4F47] hover:text-[#0F1F18] border border-[#DCE4DF] rounded-lg bg-[#F8FAF9] hover:bg-[#EDF2EF] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-[#059669]" aria-hidden="true" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-[#6E7F77]" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{soundEnabled ? 'Səs açıq' : 'Səs bağlı'}</span>
            </button>

            {status === 'PLAYING' ? (
              <button
                type="button"
                onClick={() => startGame(category)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F1F18] hover:bg-[#1E352B] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Yenidən başla</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startGame(category)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
              >
                <span>Oyuna başla</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Stage */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center">
        {status === 'TITLE_MENU' && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            {/* Left Intro & Setup Column */}
            <div className="lg:col-span-7 flex flex-col justify-between bg-white border border-[#DCE4DF] rounded-xl p-6 sm:p-10">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#059669] mb-3">
                  Biologiya Sürət Viktorinası · {BIOLOGY_PAIRS.length} sual və termin
                </p>

                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#0F1F18] leading-tight [text-wrap:balance] mb-4">
                  Sol tərəfdən termini seç, sağ tərəfdən cavabı uyğunlaşdır
                </h1>

                <p className="text-base text-[#4A5C54] leading-relaxed max-w-xl mb-8">
                  Oyuna başladığınız an 60 saniyəlik geri sayım işə düşür. Hər doğru uyğunlaşdırma
                  cütü yeni sualla əvəzlənir və vaxtınıza əlavə saniyə gəlir.
                </p>

                {/* Topic Segmented Selector */}
                <div className="mb-8">
                  <p className="text-xs font-semibold text-[#52635B] mb-2.5">
                    Mövzu seçimi ({poolSize} cüt mövcuddur)
                  </p>
                  <div
                    role="group"
                    aria-label="Mövzu seçimi"
                    className="flex flex-wrap gap-2 p-1.5 bg-[#EDF2EF] rounded-lg border border-[#DCE4DF]"
                  >
                    {(Object.keys(CATEGORY_LABELS) as Array<'all' | BiologyCategory>).map(
                      (catKey) => {
                        const isActive = category === catKey;
                        return (
                          <button
                            key={catKey}
                            type="button"
                            onClick={() => setCategory(catKey)}
                            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669] ${
                              isActive
                                ? 'bg-white text-[#0F1F18] shadow-xs border border-[#DCE4DF]'
                                : 'text-[#4A5C54] hover:text-[#0F1F18]'
                            }`}
                          >
                            {CATEGORY_LABELS[catKey]}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-[#E6ECE8]">
                <button
                  type="button"
                  onClick={() => startGame(category)}
                  className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 text-base font-bold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
                >
                  <span>Oyuna başla — 60 san</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>

                {bestScore > 0 && (
                  <div className="text-sm text-[#4A5C54]">
                    <span>Şəxsi rekord: </span>
                    <span className="font-mono-num font-bold text-[#0F1F18]">
                      {bestScore} doğru
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Rules & Sample Board Preview */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-white border border-[#DCE4DF] rounded-xl p-6 sm:p-8">
              <div>
                <h2 className="text-lg font-bold text-[#0F1F18] mb-5">
                  Oyun qaydaları və vaxt balansı
                </h2>

                <div className="divide-y divide-[#E6ECE8]">
                  <div className="py-4 first:pt-0 flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#0F1F18]">Başlanğıc müddəti</p>
                      <p className="text-xs text-[#52635B] mt-0.5">
                        Başlayan an geri sayım aktivləşir
                      </p>
                    </div>
                    <span className="font-mono-num text-lg font-bold text-[#0F1F18] whitespace-nowrap">
                      60 san
                    </span>
                  </div>

                  <div className="py-4 flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#059669]">Doğru uyğunlaşdırma</p>
                      <p className="text-xs text-[#52635B] mt-0.5">
                        Vaxt artır və cüt yeni sualla əvəzlənir
                      </p>
                    </div>
                    <span className="font-mono-num text-lg font-bold text-[#059669] whitespace-nowrap">
                      +5 san
                    </span>
                  </div>

                  <div className="py-4 flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#DC2626]">Səhv uyğunlaşdırma</p>
                      <p className="text-xs text-[#52635B] mt-0.5">
                        Qalan müddətdən 7 saniyə çıxılır
                      </p>
                    </div>
                    <span className="font-mono-num text-lg font-bold text-[#DC2626] whitespace-nowrap">
                      -7 san
                    </span>
                  </div>

                  <div className="py-4 last:pb-0 flex items-baseline justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#0F1F18]">Artan çətinlik</p>
                      <p className="text-xs text-[#52635B] mt-0.5">
                        Hər 6 doğru cavabdan bir suallar çətinləşir
                      </p>
                    </div>
                    <span className="font-mono-num text-sm font-bold text-[#3D4F47] whitespace-nowrap">
                      4 səviyyə
                    </span>
                  </div>
                </div>
              </div>

              {/* Clean Static Illustration of Left -> Right Matching */}
              <div className="mt-6 pt-6 border-t border-[#E6ECE8]">
                <p className="text-xs font-semibold text-[#52635B] mb-3">
                  Nümunə uyğunlaşdırma
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border-2 border-[#059669] bg-[#ECFDF5] text-xs font-semibold text-[#064E3B]">
                    Mitoxondri
                  </div>
                  <div className="p-3 rounded-lg border-2 border-[#059669] bg-[#ECFDF5] text-xs font-semibold text-[#064E3B]">
                    Hüceyrənin enerji (ATF) mərkəzi
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {status === 'PLAYING' && (
          <section className="flex flex-col gap-5 sm:gap-6">
            {/* Top HUD Strip: Timer + Live Metrics (Zero-pill tabular typography) */}
            <div className="bg-white border border-[#DCE4DF] rounded-xl p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                {/* Countdown Display + Delta */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2.5">
                    <Clock
                      className={`w-6 h-6 shrink-0 ${
                        isUrgent ? 'text-[#DC2626]' : 'text-[#059669]'
                      }`}
                      aria-hidden="true"
                    />
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`font-mono-num text-3xl sm:text-4xl font-bold leading-none ${
                            isUrgent ? 'text-[#DC2626]' : 'text-[#0F1F18]'
                          }`}
                        >
                          {remainingSeconds}
                        </span>
                        <span className="text-sm font-semibold text-[#52635B]">saniyə</span>
                        {isUrgent && (
                          <span className="text-xs font-bold text-[#DC2626] ml-1">
                            Son saniyələr!
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Transient +5 san / -7 san feedback */}
                  <div className="min-w-[130px] h-7 flex items-center">
                    <AnimatePresence mode="wait">
                      {feedbackBanner && (
                        <motion.div
                          key={feedbackBanner.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.16 }}
                          className={`inline-flex items-center gap-1.5 text-sm font-bold font-mono-num ${
                            feedbackBanner.type === 'correct'
                              ? 'text-[#059669]'
                              : 'text-[#DC2626]'
                          }`}
                        >
                          {feedbackBanner.type === 'correct' ? (
                            <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <X className="w-4 h-4 shrink-0" aria-hidden="true" />
                          )}
                          <span>{feedbackBanner.text}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Unboxed Tabular Stats */}
                <div className="flex flex-wrap items-center gap-5 sm:gap-7 text-sm">
                  <div>
                    <p className="text-xs text-[#52635B]">Doğru</p>
                    <p className="font-mono-num text-xl font-bold text-[#059669]">
                      {correctCount}
                    </p>
                  </div>
                  <div className="h-7 w-px bg-[#E2E8E4]" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[#52635B]">Səhv</p>
                    <p className="font-mono-num text-xl font-bold text-[#DC2626]">
                      {wrongCount}
                    </p>
                  </div>
                  <div className="h-7 w-px bg-[#E2E8E4]" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[#52635B]">Seriya</p>
                    <p className="font-mono-num text-xl font-bold text-[#0F1F18]">{streak}</p>
                  </div>
                  <div className="h-7 w-px bg-[#E2E8E4]" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[#52635B]">
                      Çətinlik ·{' '}
                      <span className="font-mono-num">
                        {currentDifficulty < MAX_DIFFICULTY
                          ? `${progressInLevel}/${ANSWERS_PER_LEVEL}`
                          : 'Maks'}
                      </span>
                    </p>
                    <p className="text-base sm:text-lg font-bold text-[#0F1F18] whitespace-nowrap">
                      {currentDifficulty}/4 · {DIFFICULTY_LABELS[currentDifficulty]}
                    </p>
                  </div>
                </div>
              </div>

              {/* Clean Progress Bar */}
              <div
                className="w-full h-2.5 bg-[#E6ECE8] rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={remainingSeconds}
                aria-valuemin={0}
                aria-valuemax={INITIAL_SECONDS}
                aria-label="Qalan vaxt"
              >
                <div
                  className={`h-full transition-[width] duration-75 ease-linear rounded-full ${
                    isUrgent ? 'bg-[#DC2626]' : 'bg-[#059669]'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Active Selection Instruction Line */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs sm:text-sm text-[#4A5C54]">
              <span>
                {selectedLeft !== null
                  ? 'İndi sağ tərəfdən uyğun cavabı seçin.'
                  : selectedRight !== null
                  ? 'İndi sol tərəfdən uyğun termini və ya sualı seçin.'
                  : 'Soldan bir termin və ya sual seçin, sonra sağdan cavabını göstərin.'}
              </span>
              <span className="hidden sm:inline text-xs text-[#65776F]">
                Mövzu: {CATEGORY_LABELS[category]} · Klaviatura: 1–5
              </span>
            </div>

            {/* Two-Column Matching Board */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 items-start">
              {/* LEFT COLUMN: Biology Terms & Simple Questions */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-[#DCE4DF]">
                  <h2 className="text-sm font-bold text-[#0F1F18]">
                    Bioloji terminlər və suallar
                  </h2>
                  <span className="text-xs text-[#52635B]">Sol tərəf</span>
                </div>

                <div className="flex flex-col gap-3">
                  {board.leftSlots.map((slot, idx) => {
                    const isSelected = selectedLeft === idx;
                    const isCorrectFlash =
                      slotFlash?.type === 'correct' && slotFlash.leftIdx === idx;
                    const isWrongFlash =
                      slotFlash?.type === 'wrong' && slotFlash.leftIdx === idx;

                    let stateClasses =
                      'bg-white border-[#D4DFD9] hover:border-[#059669] hover:bg-[#FAFDFB] text-[#0F1F18]';
                    let stateLabel: string | null = null;

                    if (isCorrectFlash) {
                      stateClasses =
                        'bg-[#ECFDF5] border-[#059669] ring-2 ring-[#059669]/25 text-[#064E3B]';
                      stateLabel = '+5 san';
                    } else if (isWrongFlash) {
                      stateClasses =
                        'bg-[#FEF2F2] border-[#DC2626] ring-2 ring-[#DC2626]/20 text-[#7F1D1D] animate-card-shake';
                      stateLabel = '-7 san';
                    } else if (isSelected) {
                      stateClasses =
                        'bg-[#ECFDF5] border-[#059669] ring-2 ring-[#059669]/25 text-[#064E3B]';
                      stateLabel = 'Seçildi';
                    }

                    return (
                      <motion.button
                        key={`${idx}-${slot.pairId}-${slot.generation}`}
                        type="button"
                        onClick={() => handleSelectLeft(idx)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        className={`w-full min-h-[76px] px-4 py-3.5 rounded-xl border-2 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669] ${stateClasses}`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="font-mono-num text-xs font-bold text-[#65776F] mt-0.5 shrink-0 w-4">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[15px] sm:text-base font-semibold leading-snug">
                              {slot.text}
                            </p>
                          </div>
                        </div>

                        {stateLabel && (
                          <span
                            className={`font-mono-num text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1 ${
                              isWrongFlash ? 'text-[#DC2626]' : 'text-[#059669]'
                            }`}
                          >
                            {isCorrectFlash && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                            {isWrongFlash && <X className="w-3.5 h-3.5" aria-hidden="true" />}
                            {stateLabel}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT COLUMN: Answers */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-[#DCE4DF]">
                  <h2 className="text-sm font-bold text-[#0F1F18]">Cavablar</h2>
                  <span className="text-xs text-[#52635B]">Sağ tərəf</span>
                </div>

                <div className="flex flex-col gap-3">
                  {board.rightSlots.map((slot, idx) => {
                    const isSelected = selectedRight === idx;
                    const isCorrectFlash =
                      slotFlash?.type === 'correct' && slotFlash.rightIdx === idx;
                    const isWrongFlash =
                      slotFlash?.type === 'wrong' && slotFlash.rightIdx === idx;

                    let stateClasses =
                      'bg-white border-[#D4DFD9] hover:border-[#059669] hover:bg-[#FAFDFB] text-[#0F1F18]';
                    let stateLabel: string | null = null;

                    if (isCorrectFlash) {
                      stateClasses =
                        'bg-[#ECFDF5] border-[#059669] ring-2 ring-[#059669]/25 text-[#064E3B]';
                      stateLabel = '+5 san';
                    } else if (isWrongFlash) {
                      stateClasses =
                        'bg-[#FEF2F2] border-[#DC2626] ring-2 ring-[#DC2626]/20 text-[#7F1D1D] animate-card-shake';
                      stateLabel = '-7 san';
                    } else if (isSelected) {
                      stateClasses =
                        'bg-[#ECFDF5] border-[#059669] ring-2 ring-[#059669]/25 text-[#064E3B]';
                      stateLabel = 'Seçildi';
                    }

                    return (
                      <motion.button
                        key={`${idx}-${slot.pairId}-${slot.generation}`}
                        type="button"
                        onClick={() => handleSelectRight(idx)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        className={`w-full min-h-[76px] px-4 py-3.5 rounded-xl border-2 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669] ${stateClasses}`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="font-mono-num text-xs font-bold text-[#65776F] mt-0.5 shrink-0 w-4">
                            {RIGHT_LETTERS[idx]}
                          </span>
                          <p className="text-[15px] sm:text-base font-medium leading-snug">
                            {slot.text}
                          </p>
                        </div>

                        {stateLabel && (
                          <span
                            className={`font-mono-num text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1 ${
                              isWrongFlash ? 'text-[#DC2626]' : 'text-[#059669]'
                            }`}
                          >
                            {isCorrectFlash && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                            {isWrongFlash && <X className="w-3.5 h-3.5" aria-hidden="true" />}
                            {stateLabel}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {status === 'GAME_OVER' && (
          <section className="max-w-4xl mx-auto w-full flex flex-col gap-6">
            <div className="bg-white border border-[#DCE4DF] rounded-xl p-6 sm:p-10">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-[#E6ECE8]">
                <div>
                  <p className="text-xs font-semibold text-[#059669] mb-1">
                    Vaxt bitdi · {CATEGORY_LABELS[category]}
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-bold text-[#0F1F18]">
                    Nəticə cədvəli
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStatus('TITLE_MENU')}
                    className="px-4 py-2.5 text-sm font-semibold text-[#3D4F47] hover:text-[#0F1F18] border border-[#DCE4DF] rounded-lg bg-[#F8FAF9] hover:bg-[#EDF2EF] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
                  >
                    Mövzunu dəyiş
                  </button>
                  <button
                    type="button"
                    onClick={() => startGame(category)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-[#059669] hover:bg-[#047857] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669]"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    <span>Yenidən oyna</span>
                  </button>
                </div>
              </div>

              {/* 4-column unboxed tabular summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 py-6 border-b border-[#E6ECE8]">
                <div>
                  <p className="text-xs font-medium text-[#52635B] mb-1">Doğru cavablar</p>
                  <p className="font-mono-num text-3xl font-bold text-[#059669]">
                    {correctCount}
                  </p>
                  <p className="text-xs text-[#52635B] mt-1 font-mono-num">
                    +{bonusSecondsEarned} san qazanıldı
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#52635B] mb-1">Səhv cəhdlər</p>
                  <p className="font-mono-num text-3xl font-bold text-[#DC2626]">{wrongCount}</p>
                  <p className="text-xs text-[#52635B] mt-1 font-mono-num">
                    -{penaltySecondsLost} san silindi
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#52635B] mb-1">Dəqiqlik</p>
                  <p className="font-mono-num text-3xl font-bold text-[#0F1F18]">
                    {accuracyPct}%
                  </p>
                  <p className="text-xs text-[#52635B] mt-1 font-mono-num">
                    {totalAttempts} cəhd
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#52635B] mb-1">Ən uzun seriya</p>
                  <p className="font-mono-num text-3xl font-bold text-[#0F1F18]">{bestStreak}</p>
                  <p className="text-xs text-[#52635B] mt-1 font-mono-num">
                    Səviyyə {currentDifficulty} ({DIFFICULTY_LABELS[currentDifficulty]}) · Rekord:{' '}
                    {bestScore}
                  </p>
                </div>
              </div>

              {/* Mistakes Review List */}
              <div className="pt-6">
                {mistakes.length === 0 ? (
                  <p className="text-sm font-medium text-[#059669]">
                    {correctCount > 0
                      ? 'Əla nəticə! Bu turda heç bir səhv uyğunlaşdırma etmədiniz.'
                      : 'Bu turda heç bir cavab qeydə alınmadı. Yenidən cəhd edin!'}
                  </p>
                ) : (
                  <div>
                    <h2 className="text-sm font-bold text-[#0F1F18] mb-3">
                      Təkrarlamaq üçün səhv etdiyiniz suallar ({mistakes.length})
                    </h2>
                    <div className="divide-y divide-[#E6ECE8] border border-[#E6ECE8] rounded-lg">
                      {mistakes.map((m) => (
                        <div
                          key={m.id}
                          className="p-3.5 sm:px-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-sm"
                        >
                          <div className="font-semibold text-[#0F1F18]">{m.prompt}</div>
                          <div className="text-[#DC2626] flex items-center gap-1.5">
                            <X className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>Seçilən: {m.chosenAnswer}</span>
                          </div>
                          <div className="text-[#059669] font-medium flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>Doğru: {m.correctAnswer}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
