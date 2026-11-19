export const DAILY_SECONDS = 300;
export const NEW_TAXA_PER_DAY = 3;
export const DAY_MS = 86_400_000;
export const RATINGS = [
  ['again', 'Again', 'I couldn’t recall it'],
  ['hard', 'Hard', 'I needed a clue'],
  ['good', 'Good', 'I recalled it'],
  ['easy', 'Easy', 'I knew it right away'],
];

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarIndex(day) {
  return Date.parse(day + 'T00:00:00Z') / DAY_MS;
}

export function dailySpecies(deck, date = new Date()) {
  const start = calendarIndex('2026-11-19');
  const index = calendarIndex(dayKey(date)) - start;
  return deck[((index % deck.length) + deck.length) % deck.length];
}

export function cardKey(speciesId, mode) {
  return `${speciesId}:${mode}`;
}

export function mastery(state, id) {
  const cards = ['photo', 'recall'].map(mode => state.cards[cardKey(id, mode)]);
  if (cards.every(card => card?.interval >= 14 && card.successes >= 3)) return 'Mastered';
  if (cards.some(Boolean)) return 'Learning';
  return 'New';
}

export function dueCount(state, now = Date.now()) {
  return Object.values(state.cards).filter(card => card.dueAt <= now).length;
}

export function streak(state, date = new Date()) {
  const days = new Set(Object.keys(state.days));
  const cursor = new Date(date);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let total = 0;
  while (days.has(dayKey(cursor))) {
    total += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return total;
}

export function reviewCandidates(deck, state, now = Date.now(), avoid = '') {
  const today = dayKey(new Date(now));
  const started = deck.filter(s => state.cards[cardKey(s.id, 'photo')]?.firstDay === today).length;
  const due = [];
  const newPhotos = [];
  const newRecalls = [];
  for (const species of deck) {
    const photo = state.cards[cardKey(species.id, 'photo')];
    const recall = state.cards[cardKey(species.id, 'recall')];
    if (photo?.dueAt <= now) due.push({species, mode: 'photo', dueAt: photo.dueAt});
    if (recall?.dueAt <= now) due.push({species, mode: 'recall', dueAt: recall.dueAt});
    if (!photo) newPhotos.push({species, mode: 'photo'});
    if (photo && !recall) newRecalls.push({species, mode: 'recall'});
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  const candidates = [...due, ...newRecalls, ...newPhotos.slice(0, Math.max(0, NEW_TAXA_PER_DAY - started))];
  const differentSpecies = candidates.filter(card => card.species.id !== avoid);
  return differentSpecies.length ? differentSpecies : candidates;
}

export function schedule(previous, rating, now = Date.now()) {
  if (!RATINGS.some(([id]) => id === rating)) throw new Error('Unknown rating');
  const before = previous ?? {interval: 0, ease: 2.3, successes: 0, firstDay: dayKey(new Date(now))};
  let interval;
  let dueAt;
  let ease = before.ease;
  let successes = before.successes;
  switch (rating) {
    case 'again':
      interval = 0;
      ease = Math.max(1.3, ease - 0.2);
      successes = 0;
      dueAt = now + 45_000;
      break;
    case 'hard':
      interval = Math.max(1, Math.round(before.interval * 1.2));
      ease = Math.max(1.3, ease - 0.15);
      break;
    case 'good':
      interval = Math.max(2, Math.ceil(before.interval * ease));
      successes += 1;
      break;
    case 'easy':
      ease = Math.min(3, ease + 0.15);
      interval = Math.max(4, Math.ceil(before.interval * ease * 1.3));
      successes += 1;
      break;
  }
  interval = Math.min(365, interval);
  return {interval, ease, successes, dueAt: dueAt ?? now + interval * DAY_MS,
    lastAt: now, lastRating: rating, firstDay: before.firstDay};
}

export function normalizedAnswer(text) {
  return String(text).normalize('NFKD').toLocaleLowerCase('en-CA')
    .replace(/\p{M}/gu, '').replace(/(?:\s+[×x]\s+|\s*×\s*)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function answerMatches(species, answer) {
  const value = normalizedAnswer(answer);
  return [species.common, species.botanical, ...(species.aliases ?? [])]
    .some(name => normalizedAnswer(name) === value);
}

export function quizChoices(deck, correct) {
  const shuffled = array => {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const others = deck.filter(species => species.id !== correct.id);
  const near = shuffled(others.filter(species => species.botanical.split(' ')[0] === correct.botanical.split(' ')[0]));
  const similar = shuffled(others.filter(species => species.group === correct.group && !near.includes(species)));
  const wider = shuffled(others.filter(species => species.group !== correct.group));
  return shuffled([correct, ...[...near, ...similar, ...wider].slice(0, 3)]);
}
