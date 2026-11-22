import {
  BIOLOGY_PAIRS,
  BiologyCategory,
  BiologyPair,
  DifficultyLevel,
} from '../data/biologyPairs';

export const BOARD_SIZE = 5;
export const INITIAL_SECONDS = 60;
export const CORRECT_BONUS_SECONDS = 5;
export const WRONG_PENALTY_SECONDS = 7;
export const ANSWERS_PER_LEVEL = 6;
export const MAX_DIFFICULTY: DifficultyLevel = 4;

export interface SlotItem {
  pairId: string;
  text: string;
  kind: 'term' | 'question';
  difficulty: DifficultyLevel;
  generation: number;
}

export interface BoardState {
  leftSlots: SlotItem[];
  rightSlots: SlotItem[];
  usedPairIds: string[];
  activePairsById: Record<string, BiologyPair>;
}

export function getDifficultyForCorrectCount(correctCount: number): DifficultyLevel {
  const tier = Math.floor(correctCount / ANSWERS_PER_LEVEL) + 1;
  if (tier >= 4) return 4;
  if (tier <= 1) return 1;
  return tier as DifficultyLevel;
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function derangeSlots(left: SlotItem[], right: SlotItem[]): SlotItem[] {
  if (left.length <= 1) return right;
  let attempt = shuffleArray(right);
  for (let tries = 0; tries < 25; tries++) {
    const hasAligned = attempt.some((item, idx) => item.pairId === left[idx].pairId);
    if (!hasAligned) return attempt;
    attempt = shuffleArray(right);
  }
  return [...right.slice(1), right[0]];
}

export function getPoolForCategory(category: 'all' | BiologyCategory): BiologyPair[] {
  if (category === 'all') return BIOLOGY_PAIRS;
  return BIOLOGY_PAIRS.filter((p) => p.category === category);
}

export function createInitialBoard(category: 'all' | BiologyCategory): BoardState {
  const pool = getPoolForCategory(category);
  // Start with Level 1 (Asan) questions first
  const level1Pool = shuffleArray(pool.filter((p) => p.difficulty === 1));
  const fallbackPool = shuffleArray(pool.filter((p) => p.difficulty > 1));
  const initialPairs = [...level1Pool, ...fallbackPool].slice(0, BOARD_SIZE);

  const activePairsById: Record<string, BiologyPair> = {};
  initialPairs.forEach((p) => {
    activePairsById[p.id] = p;
  });

  const leftSlots: SlotItem[] = initialPairs.map((p) => ({
    pairId: p.id,
    text: p.prompt,
    kind: p.kind,
    difficulty: p.difficulty,
    generation: 1,
  }));

  const rawRight: SlotItem[] = initialPairs.map((p) => ({
    pairId: p.id,
    text: p.answer,
    kind: p.kind,
    difficulty: p.difficulty,
    generation: 1,
  }));

  const rightSlots = derangeSlots(leftSlots, rawRight);

  return {
    leftSlots,
    rightSlots,
    usedPairIds: initialPairs.map((p) => p.id),
    activePairsById,
  };
}

/**
 * Picks the next unseen biology pair prioritizing the target difficulty tier.
 * Gradually scales up as targetDifficulty rises (every 6 correct answers).
 */
function pickNextPairForDifficulty(
  category: 'all' | BiologyCategory,
  targetDifficulty: DifficultyLevel,
  activeIds: Set<string>,
  usedIds: Set<string>
): { pair: BiologyPair; resetUsed: boolean } {
  const pool = getPoolForCategory(category);
  const availableUnseen = pool.filter((p) => !activeIds.has(p.id) && !usedIds.has(p.id));

  // Search exact target difficulty first, then nearest difficulty tiers
  const difficultyOrder: DifficultyLevel[] = [1, 2, 3, 4].sort(
    (a, b) => Math.abs(a - targetDifficulty) - Math.abs(b - targetDifficulty)
  ) as DifficultyLevel[];

  for (const level of difficultyOrder) {
    const candidates = availableUnseen.filter((p) => p.difficulty === level);
    if (candidates.length > 0) {
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      return { pair: picked, resetUsed: false };
    }
  }

  // If all unseen pairs across all levels were used, recycle from pool excluding active board items
  const availableAny = pool.filter((p) => !activeIds.has(p.id));
  for (const level of difficultyOrder) {
    const candidates = availableAny.filter((p) => p.difficulty === level);
    if (candidates.length > 0) {
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      return { pair: picked, resetUsed: true };
    }
  }

  return { pair: pool[0], resetUsed: true };
}

/**
 * Replaces the matched left & right slot with a fresh question-answer pair
 * matching the current difficulty level.
 */
export function replaceMatchedPair(
  board: BoardState,
  leftIndex: number,
  rightIndex: number,
  category: 'all' | BiologyCategory,
  targetDifficulty: DifficultyLevel
): BoardState {
  const matchedPairId = board.leftSlots[leftIndex].pairId;
  const remainingActiveIds = new Set(
    board.leftSlots
      .filter((_, idx) => idx !== leftIndex)
      .map((slot) => slot.pairId)
  );
  const usedIdsSet = new Set(board.usedPairIds);

  const { pair: nextPair, resetUsed } = pickNextPairForDifficulty(
    category,
    targetDifficulty,
    remainingActiveIds,
    usedIdsSet
  );

  const nextUsedPairIds = resetUsed
    ? [...Array.from(remainingActiveIds), nextPair.id]
    : [...board.usedPairIds, nextPair.id];

  const nextActivePairs = { ...board.activePairsById };
  delete nextActivePairs[matchedPairId];
  nextActivePairs[nextPair.id] = nextPair;

  const nextLeftSlots = [...board.leftSlots];
  nextLeftSlots[leftIndex] = {
    pairId: nextPair.id,
    text: nextPair.prompt,
    kind: nextPair.kind,
    difficulty: nextPair.difficulty,
    generation: board.leftSlots[leftIndex].generation + 1,
  };

  const nextRightSlots = [...board.rightSlots];
  nextRightSlots[rightIndex] = {
    pairId: nextPair.id,
    text: nextPair.answer,
    kind: nextPair.kind,
    difficulty: nextPair.difficulty,
    generation: board.rightSlots[rightIndex].generation + 1,
  };

  // Prevent landing directly across on the same horizontal row
  if (leftIndex === rightIndex && nextRightSlots.length > 1) {
    const swapCandidates = nextRightSlots
      .map((_, idx) => idx)
      .filter((idx) => idx !== rightIndex);
    const swapIdx = swapCandidates[Math.floor(Math.random() * swapCandidates.length)];
    const temp = nextRightSlots[swapIdx];
    nextRightSlots[swapIdx] = nextRightSlots[rightIndex];
    nextRightSlots[rightIndex] = temp;
  }

  return {
    leftSlots: nextLeftSlots,
    rightSlots: nextRightSlots,
    usedPairIds: nextUsedPairIds,
    activePairsById: nextActivePairs,
  };
}
