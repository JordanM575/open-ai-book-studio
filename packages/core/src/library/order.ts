import type { Chapter } from "../schema";

/** One chapter file a move rewrites, and the order number it is given. */
export interface OrderWrite {
  chapter: Chapter;
  order: number;
}

/**
 * The writes that move the chapter at `from` to `to`, in the order to make them (QA D10).
 *
 * `chapters` is the book in reading order. The chapter that ends up at each place takes the order
 * number that place had, so only the chapters between the two places are rewritten, whatever gaps a
 * deleted chapter left elsewhere: a move from 120th to 118th rewrites three files. A number that is
 * not above the one before it, such as two chapters left on one number by a move a crash cut short,
 * is raised by one, and the raise runs on only until a gap takes it up.
 *
 * Each write takes a number no other chapter holds when one is free. A move needs one write that
 * cannot, because the numbers it shares out go round in a cycle; the moving chapter makes that one,
 * first. Stopped after any write, the book then has a single pair of chapters on one number, the
 * moving chapter and its new neighbour, so every other chapter keeps its place and the next move
 * gives the pair numbers of their own.
 */
export function planMove(chapters: readonly Chapter[], from: number, to: number): OrderWrite[] {
  const moving = chapters[from];
  if (!moving || from === to || to < 0 || to >= chapters.length) return [];
  const sequence = [...chapters];
  sequence.splice(from, 1);
  sequence.splice(to, 0, moving);

  const numbers = chapters.map((chapter) => chapter.order);
  for (let index = 1; index < numbers.length; index += 1) {
    const previous = numbers[index - 1] ?? 0;
    if ((numbers[index] ?? 0) <= previous) numbers[index] = previous + 1;
  }
  const pending = sequence
    .map((chapter, index) => ({ chapter, order: numbers[index] ?? chapter.order }))
    .filter(({ chapter, order }) => chapter.order !== order);

  const holders = new Map<number, number>();
  for (const chapter of chapters) holders.set(chapter.order, (holders.get(chapter.order) ?? 0) + 1);
  const schedule: OrderWrite[] = [];
  while (pending.length > 0) {
    let next = pending.findIndex(({ order }) => !holders.get(order));
    if (next === -1) next = Math.max(0, pending.findIndex(({ chapter }) => chapter.id === moving.id));
    const [write] = pending.splice(next, 1);
    if (!write) break;
    holders.set(write.chapter.order, (holders.get(write.chapter.order) ?? 1) - 1);
    holders.set(write.order, (holders.get(write.order) ?? 0) + 1);
    schedule.push(write);
  }
  return schedule;
}
