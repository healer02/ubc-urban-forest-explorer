import {
  DAILY_SECONDS, RATINGS, dayKey, dailySpecies, cardKey,
  mastery, dueCount, streak, reviewCandidates, schedule, answerMatches, quizChoices,
} from './learning.js';
import {newState, openStorage, snapshot, updateState, saveObservation, mergeBackup} from './storage.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const announcement = document.querySelector('#announcement');
const icons = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/>',
  observe: '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="3.5"/>',
  progress: '<path d="M4 20h16M7 16v-4m5 4V8m5 8V4"/>',
  pin: '<path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  leaf: '<path d="M20 4C10 4 5 8 5 14a5 5 0 0 0 5 5c6 0 10-5 10-15ZM4 20l9-9"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const escape = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const formatCount = value => Number(value).toLocaleString('en-CA');
const shortDate = new Intl.DateTimeFormat('en-CA', {month: 'short', day: 'numeric', year: 'numeric'});
const longDate = new Intl.DateTimeFormat('en-CA', {weekday: 'long', month: 'long', day: 'numeric'});
let db, deck, inventoryPromise, map, review, reviewBusy = false, previewUrls = [], backupPromise;
let speciesById = new Map();
let state = newState();
let observations = [];
let draft = newDraft();

function newDraft() {
  return {speciesId: '', photo: null, note: '', coords: null, gpsAt: 0, gps: '', gpsTask: null, processing: false, saving: false, error: ''};
}

function route() {
  const [page = 'today', pane, id] = location.hash.slice(1).split('/');
  if (page === 'species' && speciesById.has(pane)) return {page, id: pane};
  if (page === 'progress') return {page, pane: ['species', 'photos', 'map'].includes(pane) ? pane : 'species', id};
  if (['today', 'review', 'observe'].includes(page)) return {page};
  return {page: 'today'};
}

function announce(text) {
  announcement.textContent = text;
}

function imageUrl(blob) {
  const url = URL.createObjectURL(blob);
  previewUrls.push(url);
  return url;
}

function speciesPhoto(species) {
  const personal = observations.find(obs => obs.speciesId === species.id);
  return personal
    ? {url: imageUrl(personal.photo), view: 'Your photo', alt: `Your photo of ${species.common}`}
    : species.photo;
}

function credits(photo) {
  if (!photo?.sourceUrl) return '';
  return `<p class="credit"><a href="${escape(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.title)}</a>
    by ${escape(photo.credit)} · <a href="${escape(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.license)}</a> · resized for the app</p>`;
}

function photoMarkup(photo, fallback = 'Photo unavailable', alt = photo?.alt || '') {
  if (!photo) return `<div class="photo-placeholder">${icon('leaf')}<span>${escape(fallback)}</span></div>`;
  return `<img src="${escape(photo.url)}" alt="${escape(alt)}" decoding="async">`;
}

function verified(species) {
  const entry = state.verified[species.id];
  return entry?.revision === species.revision && entry.verified === true;
}

function badge(species) {
  return verified(species) ? '<span class="badge verified">Verified</span>' : '<span class="badge unchecked">Needs check</span>';
}

function features(species) {
  return `<ol class="features">${species.features.slice(0, 3).map(feature => `<li>${escape(feature)}</li>`).join('')}</ol>`;
}

function stat(value, label) {
  return `<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
}

function remaining() {
  return Math.max(0, DAILY_SECONDS - (state.time[dayKey()] ?? 0));
}

function today() {
  const species = dailySpecies(deck);
  const photo = speciesPhoto(species);
  const mastered = deck.filter(item => mastery(state, item.id) === 'Mastered').length;
  const due = dueCount(state);
  const reviewLine = remaining() === 0 ? 'Five minutes done today.' :
    due ? `${due} ${due === 1 ? 'card is' : 'cards are'} due.` : 'Photo ID and recall in five minutes or less.';
  return `
    <section class="intro" aria-labelledby="heading">
      <p class="date-line">${escape(longDate.format(new Date()))}</p>
      <h1 id="heading">Today</h1>
      <div class="stats" aria-label="Your learning progress">
        ${stat(`${mastered}/${deck.length}`, 'Mastered')}
        ${stat(due, 'Due')}
        ${stat(observations.length, 'Observations')}
        ${stat(`${streak(state)} d`, 'Streak')}
      </div>
      <section class="review-call" aria-label="Daily review">
        <div><h2>Daily review</h2><p>${escape(reviewLine)}</p></div>
        <a class="button primary" href="#review">Start review</a>
      </section>
    </section>
    <div class="today-grid">
      <article class="card spotlight">
        <div class="spotlight-body spotlight-intro">
          <p class="section-label">Species of the day</p>
          <h2>${escape(species.common)}</h2>
          <p class="botanical"><i>${escape(species.botanical)}</i></p>
          <div class="tag-row"><span class="species-type">${species.native ? 'Regional native' : 'Introduced'} · ${escape(species.group)}</span>${badge(species)}</div>
        </div>
        <div class="spotlight-media media">${photoMarkup(photo, '', photo ? `Photo of ${species.common}` : '')}</div>
        <div class="spotlight-body spotlight-footer">
          <a class="text-link" href="#species/${species.id}">Open field notes ${icon('chevron')}</a>
          ${credits(photo)}
        </div>
      </article>
      <article class="card discussion">
        <p class="section-label">Today’s controversy</p>
        <div class="discussion-mark">${icon('book')}</div>
        ${species.controversy ? `<h2>${escape(species.controversy)}</h2>` : '<h2>No topic recorded for this species</h2>'}
        <div class="tag-row"><span>${escape(species.common)}</span>${badge(species)}</div>
        <a class="text-link" href="#species/${species.id}">Read field notes and sources ${icon('chevron')}</a>
      </article>
    </div>`;
}

function chooseCard(avoid = '') {
  review.card = reviewCandidates(deck, state, Date.now(), avoid)[0] ?? null;
  review.revealed = false;
  review.answer = '';
  review.feedback = '';
  if (review.card) review.choices = quizChoices(deck, review.card.species);
  else endReview('queue');
}

function startClock() {
  if (review?.card && !review.reason && !document.hidden && review.started === null) {
    review.started = performance.now();
  }
}

function spent() {
  const elapsed = review.started === null ? 0 : (performance.now() - review.started) / 1000;
  return Math.min(DAILY_SECONDS, review.base + review.elapsed + elapsed);
}

function pauseClock() {
  if (review && review.started !== null) {
    review.elapsed += (performance.now() - review.started) / 1000;
    review.started = null;
  }
}

function saveTime() {
  if (!review) return Promise.resolve();
  const day = review.day;
  const seconds = Math.floor(spent());
  return updateState(db, data => {
    data.time[day] = Math.max(data.time[day] ?? 0, seconds);
    return data;
  }).then(next => { state = next; }).catch(() => announce('Review time could not be saved.'));
}

function endReview(reason) {
  pauseClock();
  review.reason = reason;
}

function beginReview() {
  const day = dayKey();
  review = {day, base: state.time[day] ?? 0, elapsed: 0, started: null, completed: 0, reason: '', card: null};
  if (remaining() <= 0) endReview('time');
  else chooseCard();
  startClock();
}

function clockText() {
  const seconds = Math.max(0, Math.ceil(DAILY_SECONDS - spent()));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderReview() {
  if (!review || review.day !== dayKey()) beginReview();
  if (review.reason) {
    const title = review.reason === 'time' ? 'Five minutes done' : review.reason === 'day' ? 'A new study day' :
      review.completed ? 'Review complete' : 'No cards ready';
    let line = review.completed ? `${review.completed} ${review.completed === 1 ? 'card' : 'cards'} rated this session.` : '';
    if (review.reason === 'queue') {
      const retry = Object.values(state.cards).some(card => card.lastRating === 'again' && card.dueAt > Date.now()
        && card.dueAt - Date.now() <= 45_000);
      line += retry ? ' Cards rated Again will be ready shortly.' : ' Check back when your next cards are due.';
    }
    return `<section class="card session-done">
      <div class="round-icon">${icon('check')}</div><h1>${title}</h1><p>${escape(line.trim())}</p>
      <a class="button primary" href="#today">Back to Today</a>
      ${review.reason === 'queue' || review.reason === 'day' ? '<button class="button secondary" data-action="resume">Check for cards</button>' : ''}
    </section>`;
  }
  const {species, mode} = review.card;
  const photo = mode === 'photo' ? speciesPhoto(species) : null;
  const photoView = photo ? `<span class="cue">${escape(photo.view)}</span>` : '';
  return `<section class="review-screen">
    <div class="screen-heading quiz-heading"><div><p class="section-label">Daily review</p><h1>${mode === 'photo' ? 'Name this tree' : 'Recall the ID features'}</h1></div>
      <span class="timer">${icon('clock')}<span id="clock">${clockText()}</span></span></div>
    <div class="card quiz-card">
      ${mode === 'photo'
        ? `<div class="media quiz-media">${photoMarkup(photo, 'Photo unavailable. Use the reveal to study the ID features.', 'Tree identification photo')}${photoView}</div>`
        : `<div class="recall-prompt"><p class="section-label">Name to features</p><h2>${escape(species.common)}</h2><p class="botanical"><i>${escape(species.botanical)}</i></p></div>`}
      <div class="quiz-body">
        ${review.revealed ? `
          <div id="quiz-answer" tabindex="-1">
            ${review.feedback ? `<p class="feedback">${escape(review.feedback)}</p>` : ''}
            <div class="tag-row answer-title"><h2>${escape(species.common)}</h2>${badge(species)}</div>
            <p class="botanical"><i>${escape(species.botanical)}</i></p>
            ${features(species)}${credits(photo)}
          </div>
          <h3 class="rate-title">How well did you recall it?</h3>
          <div class="ratings">${RATINGS.map(([id, label, hint]) => `<button class="button rating ${id}" data-action="rate" data-rating="${id}" title="${escape(hint)}">${label}</button>`).join('')}</div>`
          : mode === 'photo' && photo ? `
            <p class="field-label choice-label">Pick a name</p>
            <div class="choices">${review.choices.map(option => `<button class="button choice" data-action="choose" data-id="${option.id}">${escape(option.common)}</button>`).join('')}</div>
            <form id="quiz-form">
              <label class="field-label" for="quiz-input">Type the common or botanical name</label>
              <div class="input-row"><input id="quiz-input" name="answer" type="search" autocomplete="off" spellcheck="false" placeholder="Enter tree name"><button class="button primary" type="submit">Check</button></div>
            </form>
            <button class="text-link quiet" type="button" data-action="reveal">Show answer</button>` : `
            ${mode === 'recall' ? '<p>Think of three features you could point out on a walk.</p>' : ''}
            <button class="button primary" type="button" data-action="reveal">${mode === 'recall' ? 'Reveal features' : 'Reveal answer'}</button>`}
        <p id="review-error" class="form-message" role="alert" hidden></p>
      </div>
    </div>
    <a href="#today" class="button quiet end-link">End review</a>
  </section>`;
}

function reveal(answer = '') {
  if (review.revealed || review.reason) return;
  const {species, mode} = review.card;
  review.answer = answer;
  review.feedback = mode === 'photo' && answer
    ? answerMatches(species, answer) ? 'Correct' : `You answered “${answer}”. Compare it with the features below.`
    : '';
  review.revealed = true;
  render();
  document.querySelector('#quiz-answer')?.focus({preventScroll: true});
}

async function rate(rating) {
  if (reviewBusy || !review?.card || !review.revealed || review.reason || spent() >= DAILY_SECONDS) return;
  reviewBusy = true;
  document.querySelectorAll('.rating').forEach(button => { button.disabled = true; });
  const active = review;
  const now = Date.now();
  const {species, mode} = active.card;
  const key = cardKey(species.id, mode);
  const seconds = Math.floor(spent());
  try {
    state = await updateState(db, current => {
      current.cards[key] = schedule(current.cards[key], rating, now);
      current.days[active.day] = true;
      current.time[active.day] = Math.max(current.time[active.day] ?? 0, seconds);
      return current;
    });
    active.completed += 1;
    if (review === active && route().page === 'review') {
      chooseCard(species.id);
      render();
      focusMain();
    }
  } catch {
    const error = document.querySelector('#review-error');
    if (error) {
      error.hidden = false;
      error.textContent = 'The rating could not be saved. Try again.';
    }
    document.querySelectorAll('.rating').forEach(button => { button.disabled = false; });
  } finally {
    reviewBusy = false;
  }
}

function reviewTick() {
  if (route().page !== 'review' || !review || review.reason || reviewBusy || document.hidden) return;
  if (spent() >= DAILY_SECONDS || review.day !== dayKey()) {
    endReview(review.day === dayKey() ? 'time' : 'day');
    void saveTime();
    render();
    return;
  }
  const clock = document.querySelector('#clock');
  if (clock) clock.textContent = clockText();
}

function gpsText(active = draft) {
  if (active.coords) return `Location captured · ±${Math.round(active.coords.accuracy)} m accuracy`;
  return active.gps || 'Waiting for location…';
}

function updateGps() {
  const label = document.querySelector('#gps-status');
  if (label) label.textContent = gpsText();
}

function locate() {
  const active = draft;
  if (!navigator.geolocation) {
    active.gps = 'GPS is unavailable here. You can save without it.';
    updateGps();
    return;
  }
  if (active.gpsTask) return;
  active.gps = 'Getting your location…';
  updateGps();
  active.gpsTask = new Promise(resolve => {
    let settled = false;
    const finish = (coords, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (coords) {
        active.coords = coords;
        active.gpsAt = Date.now();
      }
      active.gps = message;
      if (draft === active) updateGps();
      resolve();
    };
    const deadline = setTimeout(() => finish(null, 'Couldn’t get GPS in time. You can save without it.'), 11_000);
    try {
      navigator.geolocation.getCurrentPosition(({coords}) => {
        finish({lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy}, '');
      }, error => {
        finish(null, error.code === 1 ? 'Location permission denied. You can save without GPS.'
          : 'Couldn’t get GPS. You can save without it.');
      }, {enableHighAccuracy: true, maximumAge: 20_000, timeout: 9000});
    } catch {
      finish(null, 'Couldn’t access GPS. You can save without it.');
    }
  }).finally(() => {
    active.gpsTask = null;
  });
}

function option(species, selected) {
  return `<option value="${species.id}" ${selected === species.id ? 'selected' : ''}>${escape(species.common)}</option>`;
}

function alphabetical() {
  return [...deck].sort((a, b) => a.common.localeCompare(b.common, 'en-CA'));
}

function observe() {
  return `<section class="screen-heading"><h1>Add observation</h1><p>Photograph a tree to bring your own images into review.</p></section>
    <form id="observe-form" class="card form-card">
      <div class="upload-wrap ${draft.photo ? 'has-image' : ''}">
        ${draft.photo ? `<div class="media observation-preview"><img src="${escape(imageUrl(draft.photo))}" alt="Your selected tree photo"></div>` : ''}
        <label class="upload-control">${icon('observe')}<strong>${draft.processing ? 'Preparing photo…' : draft.photo ? 'Retake photo' : 'Take a photo'}</strong>
          <input id="camera" class="sr-only" type="file" accept="image/*" capture="environment" ${draft.processing || draft.saving ? 'disabled' : ''} aria-label="Take a tree photo">
        </label>
      </div>
      <div class="form-fields">
        <label class="field-label" for="observation-species">Species</label>
        <select id="observation-species" required ${draft.saving ? 'disabled' : ''}>
          <option value="">Choose a species</option>${alphabetical().map(species => option(species, draft.speciesId)).join('')}
        </select>
        <label class="field-label" for="observation-note">Field note <span class="muted">(optional)</span></label>
        <textarea id="observation-note" rows="3" maxlength="320" placeholder="What did you notice?" ${draft.saving ? 'disabled' : ''}>${escape(draft.note)}</textarea>
        <div class="location-box">${icon('pin')}<span id="gps-status" role="status">${escape(gpsText())}</span>
          <button type="button" class="text-link" data-action="gps" ${draft.saving ? 'disabled' : ''}>Retry GPS</button></div>
        <p class="form-message" role="alert" ${draft.error ? '' : 'hidden'}>${escape(draft.error)}</p>
        <button class="button primary full" type="submit" ${draft.processing || draft.saving ? 'disabled' : ''}>${draft.saving ? 'Saving…' : 'Save observation'}</button>
      </div>
    </form>`;
}

async function preparePhoto(file) {
  const active = draft;
  active.processing = true;
  active.error = '';
  if (route().page === 'observe') render();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.83));
    canvas.width = canvas.height = 1;
    if (!photo) throw new Error('No encoded photo');
    active.photo = photo;
    const hasRecentLocation = active.coords && Date.now() - active.gpsAt <= 20_000;
    if (draft === active && !active.gpsTask && !hasRecentLocation) {
      active.coords = null;
      locate();
    }
  } catch {
    active.error = 'That photo could not be opened. Try taking it again with your camera.';
  } finally {
    URL.revokeObjectURL(url);
    active.processing = false;
    if (route().page === 'observe') render();
  }
}

async function submitObservation() {
  const active = draft;
  if (active.saving || active.processing) return;
  if (!active.photo || !speciesById.has(active.speciesId)) {
    active.error = !active.photo ? 'Take a tree photo first.' : 'Choose a species.';
    render();
    return;
  }
  active.saving = true;
  active.error = '';
  render();
  try {
    await active.gpsTask;
    const obs = {id: crypto.randomUUID(), speciesId: active.speciesId, photo: active.photo,
      note: active.note.trim(), coords: active.coords, createdAt: Date.now()};
    await saveObservation(db, obs);
    observations = [obs, ...observations];
    draft = newDraft();
    announce('Observation saved.');
    if (route().page === 'observe') location.hash = '#progress/photos';
  } catch {
    active.saving = false;
    active.error = 'The observation could not be saved. Check available device storage, then try again.';
    if (route().page === 'observe') render();
  }
}

function photoGallery(list) {
  if (!list.length) return `<div class="empty card"><div class="round-icon">${icon('observe')}</div>
    <h2>No observations yet</h2><p>Your field photos will appear here and in reviews.</p>
    <a class="button secondary" href="#observe">Add observation</a></div>`;
  return `<div class="gallery">${list.map(obs => {
    const species = speciesById.get(obs.speciesId);
    return `<article class="card gallery-item">
      <div class="media gallery-media"><img src="${escape(imageUrl(obs.photo))}" alt="Your photo of ${escape(species.common)}" loading="lazy" decoding="async"></div>
      <div class="gallery-body"><h3><a href="#species/${species.id}">${escape(species.common)}</a></h3>
      <p class="muted">${escape(shortDate.format(obs.createdAt))}${obs.coords ? ' · GPS recorded' : ''}</p>
      ${obs.note ? `<p class="obs-note">${escape(obs.note)}</p>` : ''}</div>
    </article>`;
  }).join('')}</div>`;
}

function speciesList() {
  return `<div class="card species-list">${alphabetical().map(species => `<a class="species-row" href="#species/${species.id}">
    <span><strong>${escape(species.common)}</strong><i>${escape(species.botanical)}</i></span>
    <span class="row-status"><span class="mastery ${mastery(state, species.id).toLowerCase()}">${mastery(state, species.id)}</span>${icon('chevron')}</span>
  </a>`).join('')}</div>`;
}

function progress(view) {
  const panes = [['species', 'Species'], ['photos', 'My photos'], ['map', 'Map']];
  const tabs = panes.map(([id, label]) =>
    `<a href="#progress/${id}" ${view.pane === id ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  return `<section class="screen-heading"><h1>Progress</h1>
      <p>${deck.filter(species => mastery(state, species.id) === 'Mastered').length} of ${deck.length} mastered · ${observations.length} ${observations.length === 1 ? 'observation' : 'observations'}</p></section>
    <nav class="segments" aria-label="Progress views">${tabs}</nav>
    ${view.pane === 'photos' ? photoGallery(observations) : view.pane === 'map' ? mapPane(view.id) : speciesList()}
    <section class="card backup-card"><h2>Back up your field notebook</h2>
      <p>Your observations, GPS, review history, and verification marks are stored on this device. Save a ZIP to Files to keep a copy.</p>
      <div class="backup-actions"><button class="button secondary" data-action="export">Export ZIP</button>
        <label class="button secondary file-button">Import ZIP<input class="sr-only" id="import-file" type="file" accept=".zip,application/zip" aria-label="Import ZIP"></label></div>
      <p class="form-message" id="backup-status" role="status" hidden></p>
    </section>`;
}

function profile(id) {
  const species = speciesById.get(id);
  const photo = speciesPhoto(species);
  const fields = [['Look-alikes', species.lookalikes], ['Design use', species.design],
    ['Ecology', species.ecology], ['Controversy', species.controversy], ['Tour talking point', species.tour]];
  return `<a class="text-link back-link" href="#progress/species">All species</a>
    <div class="screen-heading"><h1>${escape(species.common)}</h1><p class="botanical"><i>${escape(species.botanical)}</i></p>
    <div class="tag-row"><span>${species.native ? 'Native to coastal southwestern BC' : 'Introduced in coastal southwestern BC'} · ${escape(species.group)}</span>${badge(species)}</div></div>
    <div class="profile-layout">
      <div>
        <article class="card profile-photo">
          <div class="media">${photoMarkup(photo, 'No photo available', photo ? `Photo of ${species.common}` : '')}</div>
          ${photo ? `<div class="photo-caption"><span>${escape(photo.view)}</span>${credits(photo)}</div>` : ''}
        </article>
        <section class="card padded location-card"><h2>Campus locations</h2>
          <p>${formatCount(species.locationCount)} mapped records after excluding inventory status flags. Check tree presence and access before a tour.</p>
          <a class="button secondary" href="#progress/map/${species.id}">${icon('pin')} Show on map</a>
        </section>
      </div>
      <article class="card padded details">
        <h2>Three ID features</h2>${features(species)}
        ${fields.map(([label, value]) => value ? `<section><h3>${label}</h3><p>${escape(value)}</p></section>` : '').join('')}
        ${species.sources.length ? `<details class="sources"><summary>Sources to check</summary><ul>
          ${species.sources.map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)}</a></li>`).join('')}
        </ul></details>` : ''}
        <button class="button secondary" data-action="verify" data-id="${species.id}">${verified(species) ? 'Mark as needs check' : 'Mark as verified'}</button>
      </article>
    </div>`;
}

function mapPane(id) {
  const selected = speciesById.has(id) ? id : dailySpecies(deck).id;
  return `<section class="card map-card"><div class="map-controls">
      <label class="field-label" for="map-species">Campus inventory species</label>
      <select id="map-species"><option value="all">All starter taxa</option>${alphabetical().map(species => option(species, selected)).join('')}</select>
      <label class="check-row"><input type="checkbox" id="map-observations" checked> Show my observations</label>
    </div>
    <div class="map-host" id="map" aria-label="Campus tree locations"></div>
    <div class="map-caption"><p id="map-status" role="status">Loading campus points…</p>
      <p><span class="inventory-dot"></span> Inventory <span class="observation-dot"></span> My photos</p>
      <p>Inventory points may need a field check. <a href="https://github.com/UBCGeodata/ubc-geospatial-opendata/blob/master/ubcv/landscape/geojson/ubcv_campus_trees.geojson" target="_blank" rel="noopener noreferrer">UBC inventory</a>. The OpenStreetMap basemap uses an internet connection. <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Report a map issue</a></p>
    </div></section>`;
}

async function mapData() {
  if (!inventoryPromise) {
    inventoryPromise = fetch('./data/locations.json').then(response => {
      if (!response.ok) throw new Error('Campus locations are unavailable.');
      return response.json();
    }).catch(error => {
      inventoryPromise = null;
      throw error;
    });
  }
  return inventoryPromise;
}

async function initMap() {
  const host = document.querySelector('#map');
  const caption = document.querySelector('#map-status');
  const L = window.L;
  if (!host || !L) {
    if (caption) caption.textContent = 'The map could not be opened. Reload the app and try again.';
    return;
  }
  const browseMap = L.map(host, {preferCanvas: true, zoomControl: true, attributionControl: true}).setView([49.263, -123.249], 15);
  map = browseMap;
  const basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  basemap.addTo(browseMap);
  const markerLayer = L.layerGroup().addTo(browseMap);
  let campus;
  try {
    campus = await mapData();
  } catch {
    if (host.isConnected) caption.textContent = 'Campus points could not be loaded. Reopen this page to try again.';
    return;
  }
  if (!host.isConnected) return;
  const dropdown = document.querySelector('#map-species');
  const checkbox = document.querySelector('#map-observations');
  function showPoints() {
    markerLayer.clearLayers();
    const ids = dropdown.value === 'all' ? deck.map(species => species.id) : [dropdown.value];
    const bounds = L.latLngBounds([]);
    let listed = 0, personal = 0;
    for (const id of ids) {
      const species = speciesById.get(id);
      for (const [lat, lng, objectId, live] of campus[id] ?? []) {
        const point = [lat, lng];
        bounds.extend(point);
        listed += 1;
        L.circleMarker(point, {radius: ids.length > 1 ? 3.5 : 5, color: '#164d3e', weight: 1.5,
          fillColor: '#34745c', fillOpacity: 0.8}).bindPopup(
          `<strong>${escape(species.common)}</strong><br><i>${escape(species.botanical)}</i><br>Inventory #${objectId}<br>${live ? 'Recorded live' : 'Live status unrecorded'}`
        ).addTo(markerLayer);
      }
    }
    if (checkbox.checked) {
      for (const obs of observations) {
        if (!obs.coords) continue;
        const point = [obs.coords.lat, obs.coords.lng];
        const species = speciesById.get(obs.speciesId);
        personal += 1;
        if (!bounds.isValid()) bounds.extend(point);
        L.circleMarker(point, {radius: 7, color: '#603518', fillColor: '#cc7d3c', weight: 2, fillOpacity: 0.95})
          .bindPopup(`<strong>${escape(species.common)}</strong><br>Your observation · ${escape(shortDate.format(obs.createdAt))}${obs.note ? `<br>${escape(obs.note)}` : ''}`)
          .addTo(markerLayer);
      }
    }
    if (bounds.isValid()) browseMap.fitBounds(bounds, {maxZoom: 17, padding: [18, 18], animate: false});
    caption.textContent = `${formatCount(listed)} campus records · ${formatCount(personal)} ${personal === 1 ? 'observation' : 'observations'} with GPS`;
  }
  dropdown.addEventListener('change', showPoints);
  checkbox.addEventListener('change', showPoints);
  showPoints();
}

function focusMain() {
  window.scrollTo(0, 0);
  main.focus({preventScroll: true});
}

function render() {
  if (!deck) return;
  map?.remove();
  map = undefined;
  const staleUrls = previewUrls;
  previewUrls = [];
  const view = route();
  const activeTab = view.page === 'review' ? 'today' : view.page === 'species' ? 'progress' : view.page;
  const screens = {today, observe, review: renderReview, progress: () => progress(view), species: () => profile(view.id)};
  const headerDate = document.querySelector('#header-date');
  headerDate.hidden = view.page === 'today';
  headerDate.textContent = longDate.format(new Date());
  main.className = `shell page-${view.page}`;
  main.innerHTML = screens[view.page]();
  main.setAttribute('aria-busy', 'false');
  nav.innerHTML = [['today', 'Today'], ['observe', 'Observe'], ['progress', 'Progress']].map(([page, label]) =>
    `<a class="nav-link" href="#${page}" ${activeTab === page ? 'aria-current="page"' : ''}>${icon(page)}<span>${label}</span></a>`).join('');
  staleUrls.forEach(url => URL.revokeObjectURL(url));
  if (view.page === 'progress' && view.pane === 'map') void initMap();
}

function backupStatus(text) {
  const label = document.querySelector('#backup-status');
  if (label) {
    label.textContent = text;
    label.hidden = false;
  } else {
    announce(text);
  }
}

async function transferBackup(file) {
  const buttons = [...document.querySelectorAll('.backup-actions button,.backup-actions input')];
  if (buttons.some(button => button.disabled)) return;
  buttons.forEach(button => { button.disabled = true; });
  backupStatus(file ? 'Checking backup…' : 'Preparing backup…');
  try {
    backupPromise ??= import('./backup.js').catch(error => {
      backupPromise = undefined;
      throw error;
    });
    const transfer = await backupPromise;
    if (file) {
      const incoming = await transfer.readBackup(file, new Set(speciesById.keys()));
      const added = await mergeBackup(db, incoming);
      await refreshStorage();
      if (route().page === 'progress') render();
      backupStatus(`Backup restored. ${added} new ${added === 1 ? 'observation' : 'observations'} added.`);
    } else {
      const zip = await transfer.createBackup(await snapshot(db));
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ubc-trees-${dayKey()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      backupStatus('Backup ready. Look in Downloads or Files.');
    }
  } catch (error) {
    backupStatus(`${file ? 'Import failed' : 'Export failed'}. ${error.message || 'Try again.'}`);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function toggleVerification(button) {
  const species = speciesById.get(button.dataset.id);
  if (!species) return;
  button.disabled = true;
  const next = !verified(species);
  try {
    state = await updateState(db, data => {
      data.verified[species.id] = {revision: species.revision, verified: next, updatedAt: Date.now()};
      return data;
    });
    if (route().id === species.id && route().page === 'species') {
      render();
      document.querySelector('[data-action="verify"]')?.focus({preventScroll: true});
    }
    announce(next ? 'Marked verified.' : 'Marked needs check.');
  } catch {
    button.disabled = false;
    announce('Could not update the verification mark.');
  }
}

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  focusMain();
});

main.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const {action} = button.dataset;
  if (action === 'reveal') reveal();
  if (action === 'choose') reveal(speciesById.get(button.dataset.id).common);
  if (action === 'rate') void rate(button.dataset.rating);
  if (action === 'verify') void toggleVerification(button);
  if (action === 'gps') locate();
  if (action === 'export') void transferBackup();
  if (action === 'resume') { beginReview(); render(); focusMain(); }
});

main.addEventListener('submit', event => {
  if (event.target.id === 'quiz-form') {
    event.preventDefault();
    const input = document.querySelector('#quiz-input');
    if (input.value.trim()) reveal(input.value.trim().slice(0, 120));
    else input.focus();
  }
  if (event.target.id === 'observe-form') {
    event.preventDefault();
    void submitObservation();
  }
});

main.addEventListener('change', event => {
  const {id, value, files} = event.target;
  if (id === 'camera' && files?.[0]) void preparePhoto(files[0]);
  if (id === 'observation-species') draft.speciesId = value;
  if (id === 'import-file' && files?.[0]) {
    const file = files[0];
    event.target.value = '';
    void transferBackup(file);
  }
});
main.addEventListener('input', event => {
  if (event.target.id === 'observation-note') draft.note = event.target.value;
});
main.addEventListener('error', event => {
  if (event.target.tagName !== 'IMG') return;
  const image = event.target;
  const text = document.createElement('span');
  text.className = 'image-error';
  text.textContent = 'Photo unavailable';
  image.replaceWith(text);
}, true);

let lastRoute;
window.addEventListener('hashchange', async () => {
  if (!deck) return;
  if (lastRoute === 'review' && route().page !== 'review') {
    pauseClock();
    const leaving = review;
    await saveTime();
    if (review === leaving) review = null;
  }
  const view = route();
  lastRoute = view.page;
  if (view.page === 'observe' && !draft.gps && !draft.coords) locate();
  render();
  focusMain();
});

document.addEventListener('visibilitychange', () => {
  if (route().page === 'review' && review) {
    if (document.hidden) {
      pauseClock();
      void saveTime();
    } else {
      startClock();
      reviewTick();
    }
  } else if (!document.hidden && route().page === 'today') {
    render();
  }
});
window.addEventListener('pagehide', () => {
  if (review) {
    pauseClock();
    void saveTime();
  }
});

async function refreshStorage() {
  const saved = await snapshot(db);
  state = saved.state;
  observations = saved.observations.filter(obs => speciesById.has(obs.speciesId)).sort((a, b) => b.createdAt - a.createdAt);
}

async function load() {
  try {
    const [connection, response] = await Promise.all([openStorage(), fetch('./data/species.json')]);
    db = connection;
    if (!response.ok) throw new Error('The tree catalog could not be loaded.');
    deck = await response.json();
    if (!Array.isArray(deck) || !deck.length) throw new Error('The tree catalog is empty.');
    speciesById = new Map(deck.map(species => [species.id, species]));
    await refreshStorage();
    lastRoute = route().page;
    if (lastRoute === 'observe') locate();
    render();
    setInterval(reviewTick, 300);
    setInterval(() => {
      if (route().page === 'review' && review && !review.reason && !document.hidden) void saveTime();
    }, 8000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Offline installation failed:', error);
    });
  } catch (error) {
    main.setAttribute('aria-busy', 'false');
    main.innerHTML = `<section class="card padded"><h1>Couldn’t open the field guide</h1>
      <p>Open the app in Safari and reload. It needs access to local device storage.</p>
      <p class="muted">${escape(error.message || '')}</p></section>`;
  }
}

void load();
