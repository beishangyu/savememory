import type { Card, SessionOrder } from '../db/schema'

/**
 * Round-robin flatten: takes one item from each group in turn.
 *
 * This is what turns "one topic at a time" into "mixed topics".
 */
function roundRobin<T>(groups: T[][]): T[] {
  const result: T[] = []
  let round = 0
  let added = true

  while (added) {
    added = false
    for (const group of groups) {
      if (round < group.length) {
        result.push(group[round])
        added = true
      }
    }
    round += 1
  }

  return result
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const list = map.get(id)
    if (list) list.push(item)
    else map.set(id, [item])
  }
  return [...map.values()]
}

/**
 * Build the order cards are presented in during a session.
 *
 * `due` is the plain FSRS order (most overdue first).
 *
 * `interleave` mixes topics: cards are grouped by their material, then by
 * their concept, and drawn round-robin so consecutive cards come from
 * different subjects. Blocking practice on one concept is known to feel
 * easier while actually producing worse long-term retention — this is the
 * cheap version of that fix.
 */
export function buildSessionQueue(cards: Card[], order: SessionOrder): Card[] {
  const sorted = [...cards].sort((a, b) => a.dueAt - b.dueAt)
  if (order === 'due') return sorted

  // Outer level: one card per material (topic).
  const bySource = groupBy(sorted, (card) => card.sourceId)

  // Inner level: within a material, still mix the concepts.
  const perSource = bySource.map((sourceCards) =>
    roundRobin(groupBy(sourceCards, (card) => card.conceptId)),
  )

  return roundRobin(perSource)
}

/** How many distinct topics are represented in a queue. */
export function countTopics(cards: Card[]): number {
  return new Set(cards.map((card) => card.sourceId)).size
}
