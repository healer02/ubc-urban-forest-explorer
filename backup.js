import {zipSync, unzipSync, strToU8, strFromU8} from './vendor/fflate.js';
import {newState} from './storage.js';
import {DAILY_SECONDS} from './learning.js';

const FORMAT = 'ubc-urban-forest-explorer';
const VERSION = 1;
const MAX_ARCHIVE = 200 * 1024 * 1024;
const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_JSON = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function createBackup({state, observations}) {
  const files = {};
  const entries = [];
  let bytes = 0;
  for (const observation of observations) {
    const {photo, ...entry} = observation;
    bytes += photo.size;
    if (bytes >= MAX_ARCHIVE - MAX_JSON) throw new Error('This backup exceeds the 200 MB limit.');
    const file = `photos/${entry.id}.jpg`;
    files[file] = [new Uint8Array(await photo.arrayBuffer()), {level: 0}];
    entries.push({...entry, file});
  }
  const json = strToU8(JSON.stringify({
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), state, observations: entries,
  }));
  if (json.byteLength > MAX_JSON) throw new Error('This backup has too many records.');
  files['backup.json'] = [json, {level: 3}];
  return new Blob([zipSync(files)], {type: 'application/zip'});
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validNumber(value, min, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function readState(input, ids) {
  if (!isObject(input) || !['cards', 'verified', 'days', 'time'].every(key => isObject(input[key]))) {
    throw new Error('The learning history is incomplete.');
  }
  const out = newState();
  for (const [key, card] of Object.entries(input.cards)) {
    const [id, mode, extra] = key.split(':');
    if (!ids.has(id) || extra || !['photo', 'recall'].includes(mode)) continue;
    if (!isObject(card) || !validNumber(card.interval, 0, 365) || !validNumber(card.ease, 1.3, 3)
      || !validNumber(card.successes, 0) || !validNumber(card.dueAt, 0)
      || !validNumber(card.lastAt, 0) || !DAY.test(card.firstDay)
      || !['again', 'hard', 'good', 'easy'].includes(card.lastRating)) throw new Error('The backup contains an invalid review.');
    out.cards[key] = card;
  }
  for (const [id, entry] of Object.entries(input.verified)) {
    if (!ids.has(id)) continue;
    if (!isObject(entry) || typeof entry.verified !== 'boolean'
      || !/^[a-f0-9]{12}$/.test(entry.revision) || !validNumber(entry.updatedAt, 0)) {
      throw new Error('The backup contains an invalid verification.');
    }
    out.verified[id] = entry;
  }
  for (const [day, value] of Object.entries(input.days)) {
    if (DAY.test(day) && value === true) out.days[day] = true;
  }
  for (const [day, seconds] of Object.entries(input.time)) {
    if (DAY.test(day) && validNumber(seconds, 0, DAILY_SECONDS)) out.time[day] = seconds;
  }
  return out;
}

function readCoords(coords) {
  if (coords === null) return null;
  if (!isObject(coords) || !validNumber(coords.lat, -90, 90) || !validNumber(coords.lng, -180, 180)
    || !validNumber(coords.accuracy, 0)) throw new Error('The backup contains invalid GPS data.');
  return {lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy};
}

export async function readBackup(file, ids) {
  if (file.size > MAX_ARCHIVE) throw new Error('This backup exceeds the 200 MB limit.');
  let expanded = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {filter(entry) {
    if (entry.name === 'backup.json') {
      if (entry.originalSize > MAX_JSON) throw new Error('The backup JSON is too large.');
    } else if (/^photos\/[a-f0-9-]{36}\.jpg$/.test(entry.name)) {
      if (entry.originalSize > MAX_PHOTO) throw new Error('A backup photo is too large.');
    } else {
      return false;
    }
    expanded += entry.originalSize;
    if (expanded > MAX_ARCHIVE) throw new Error('This backup exceeds the 200 MB limit.');
    return true;
  }});
  if (!files['backup.json']) throw new Error('This ZIP is missing backup.json.');
  const data = JSON.parse(strFromU8(files['backup.json']));
  if (data.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.observations)) {
    throw new Error('Choose a ZIP exported by Urban Forest Explorer.');
  }
  const seen = new Set();
  const observations = data.observations.map(entry => {
    if (!isObject(entry) || !UUID.test(entry.id) || seen.has(entry.id)
      || !ids.has(entry.speciesId) || !validNumber(entry.createdAt, 0, 8.64e15)
      || typeof entry.note !== 'string' || entry.note.length > 320 || entry.file !== `photos/${entry.id}.jpg`) {
      throw new Error('The backup contains an invalid observation.');
    }
    seen.add(entry.id);
    const image = files[entry.file];
    if (!image || image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
      throw new Error('An observation photo is missing or damaged.');
    }
    return {id: entry.id, speciesId: entry.speciesId, createdAt: entry.createdAt,
      note: entry.note, coords: readCoords(entry.coords), photo: new Blob([image], {type: 'image/jpeg'})};
  });
  return {state: readState(data.state, ids), observations};
}
