const DATABASE = 'ubc-urban-forest-explorer';
const STATE_KEY = 'learning';

export const newState = () => ({cards: {}, verified: {}, days: {}, time: {}});
let connection;

export function openStorage() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('state');
        db.createObjectStore('observations', {keyPath: 'id'});
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
    });
  }
  return connection;
}

async function encodeObservation(observation) {
  // Some WebKit storage contexts cannot write Blob objects directly.
  return {...observation, photo: await observation.photo.arrayBuffer()};
}

function decodeObservation(observation) {
  if (observation.photo instanceof Blob) return observation;
  return {...observation, photo: new Blob([observation.photo], {type: 'image/jpeg'})};
}

export function snapshot(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['state', 'observations']);
    const state = tx.objectStore('state').get(STATE_KEY);
    const observations = tx.objectStore('observations').getAll();
    tx.oncomplete = () => resolve({
      state: state.result ?? newState(),
      observations: observations.result.map(decodeObservation),
    });
    tx.onabort = () => reject(tx.error);
  });
}

export function updateState(db, edit) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    const request = store.get(STATE_KEY);
    let next;
    request.onsuccess = () => {
      try {
        next = edit(request.result ?? newState());
        store.put(next, STATE_KEY);
      } catch (error) {
        reject(error);
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(tx.error ?? new Error('Storage update cancelled'));
  });
}

export async function saveObservation(db, observation) {
  const record = await encodeObservation(observation);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('observations', 'readwrite');
    tx.objectStore('observations').add(record);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

function mergeState(current, incoming) {
  for (const [key, card] of Object.entries(incoming.cards)) {
    if (!current.cards[key] || card.lastAt > current.cards[key].lastAt) current.cards[key] = card;
  }
  for (const [key, entry] of Object.entries(incoming.verified)) {
    if (!current.verified[key] || entry.updatedAt > current.verified[key].updatedAt) current.verified[key] = entry;
  }
  Object.assign(current.days, incoming.days);
  for (const [day, seconds] of Object.entries(incoming.time)) {
    current.time[day] = Math.max(current.time[day] ?? 0, seconds);
  }
  return current;
}

export async function mergeBackup(db, incoming) {
  const records = await Promise.all(incoming.observations.map(encodeObservation));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['state', 'observations'], 'readwrite');
    const stateStore = tx.objectStore('state');
    const obsStore = tx.objectStore('observations');
    let added = 0;
    const existing = stateStore.get(STATE_KEY);
    existing.onsuccess = () => stateStore.put(mergeState(existing.result ?? newState(), incoming.state), STATE_KEY);
    for (const obs of records) {
      const request = obsStore.getKey(obs.id);
      request.onsuccess = () => {
        if (request.result === undefined) {
          added += 1;
          obsStore.add(obs);
        }
      };
    }
    tx.oncomplete = () => resolve(added);
    tx.onabort = () => reject(tx.error ?? new Error('Import cancelled'));
  });
}
