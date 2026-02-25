/* ============================================
   CELLAR — Wine & Whiskey Collection App
   ============================================ */

// ============ DATA LAYER ============

const STORAGE_KEY = 'vino_cellar';
const TASTINGS_KEY = 'vino_tastings';
const FINDS_KEY = 'vino_finds';
const THEME_KEY = 'vino_theme';

const WHISKEY_TYPES = ['Scotch', 'Bourbon', 'Irish', 'Japanese', 'Rye', 'Single Malt', 'Blended', 'Tennessee'];
const WINE_TYPES = ['Red', 'White', 'Rosé', 'Sparkling', 'Champagne', 'Dessert', 'Fortified'];
const TEQUILA_TYPES = ['Tequila', 'Mezcal'];
const SAKE_TYPES = ['Junmai', 'Ginjo', 'Daiginjo', 'Nigori', 'Sparkling Sake', 'Sake'];
const SPIRIT_TYPES = ['Rum', 'Cognac', 'Brandy', 'Gin', 'Vodka', 'Other Spirit'];
const API_KEY_STORAGE = 'vino_openai_key';

function isWhiskey(type) { return WHISKEY_TYPES.includes(type); }
function isWine(type) { return WINE_TYPES.includes(type); }
function isTequila(type) { return TEQUILA_TYPES.includes(type); }
function isSake(type) { return SAKE_TYPES.includes(type); }
function isSpirit(type) { return SPIRIT_TYPES.includes(type) || WHISKEY_TYPES.includes(type) || TEQUILA_TYPES.includes(type) || SAKE_TYPES.includes(type); }
function isSpiritOrWhiskey(type) { return isWhiskey(type) || isTequila(type) || isSake(type) || SPIRIT_TYPES.includes(type); }

// ============ AUTH STATE ============

let currentUser = null;
let syncTimer = null;
let authMode = 'login'; // 'login' or 'register'

async function checkAuthState() {
  // Check if this is a shared cellar URL
  const sharePath = window.location.pathname.match(/^\/share\/([a-f0-9-]+)$/i);
  if (sharePath) {
    await loadSharedCellar(sharePath[1]);
    return;
  }
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'include' });
    if (resp.ok) {
      currentUser = await resp.json();
      await enterApp();
    } else {
      currentUser = null;
      showWelcome();
    }
  } catch {
    currentUser = null;
    showWelcome();
  }
}

function showWelcome() {
  document.body.classList.add('no-auth');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-welcome').classList.add('active');
}

async function enterApp() {
  document.body.classList.remove('no-auth');
  updateAuthUI();
  // Load data from server
  await syncFromServer();
  // Load API key from server if not in localStorage
  try {
    const resp = await fetch('/api/settings', { credentials: 'include' });
    if (resp.ok) {
      const settings = await resp.json();
      if (settings.openaiKey) {
        localStorage.setItem(API_KEY_STORAGE, settings.openaiKey);
      }
    }
  } catch {}
  switchView('dashboard');
}

function updateAuthUI() {
  const loginSection = document.getElementById('authLogin');
  const userSection = document.getElementById('authUser');
  if (!loginSection || !userSection) return;

  if (currentUser) {
    loginSection.style.display = 'none';
    userSection.style.display = 'flex';
    document.getElementById('authUserName').textContent = currentUser.name || currentUser.email;
  } else {
    loginSection.style.display = 'block';
    userSection.style.display = 'none';
  }
}

function toggleAuthMode(e) {
  e.preventDefault();
  const nameField = document.getElementById('authName');
  const submitBtn = document.getElementById('authSubmitBtn');
  const toggleText = document.getElementById('authToggleText');
  const toggleLink = document.getElementById('authToggleLink');
  const errorEl = document.getElementById('authError');
  errorEl.style.display = 'none';

  if (authMode === 'login') {
    authMode = 'register';
    nameField.style.display = 'block';
    submitBtn.textContent = 'Create account';
    toggleText.textContent = 'Have an account?';
    toggleLink.textContent = 'Sign in';
  } else {
    authMode = 'login';
    nameField.style.display = 'none';
    submitBtn.textContent = 'Sign in';
    toggleText.textContent = 'No account?';
    toggleLink.textContent = 'Sign up';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value.trim();
  const errorEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';

  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = authMode === 'login' ? { email, password } : { email, password, name };
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      errorEl.textContent = data.error || 'Something went wrong';
      errorEl.style.display = 'block';
      return;
    }
    currentUser = data;
    updateAuthUI();
    showToast(`Welcome${currentUser.name ? ', ' + currentUser.name : ''}!`);
    document.getElementById('authForm').reset();
    // Sync
    if (cellar.length > 0 && !localStorage.getItem('vino_synced')) {
      showSyncPrompt();
    } else {
      await syncFromServer();
    }
    renderDashboard();
  } catch (err) {
    errorEl.textContent = 'Connection error — try again';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  }
}

let welcomeMode = 'login';

function toggleWelcomeMode(e) {
  e.preventDefault();
  const nameField = document.getElementById('welcomeName');
  const submitBtn = document.getElementById('welcomeSubmitBtn');
  const toggleText = document.getElementById('welcomeToggleText');
  const toggleLink = document.getElementById('welcomeToggleLink');
  document.getElementById('welcomeError').style.display = 'none';

  if (welcomeMode === 'login') {
    welcomeMode = 'register';
    nameField.style.display = 'block';
    submitBtn.textContent = 'Create account';
    toggleText.textContent = 'Have an account?';
    toggleLink.textContent = 'Sign in';
  } else {
    welcomeMode = 'login';
    nameField.style.display = 'none';
    submitBtn.textContent = 'Sign in';
    toggleText.textContent = 'No account?';
    toggleLink.textContent = 'Sign up';
  }
}

async function handleWelcomeAuth(e) {
  e.preventDefault();
  const email = document.getElementById('welcomeEmail').value.trim();
  const password = document.getElementById('welcomePassword').value;
  const name = document.getElementById('welcomeName').value.trim();
  const errorEl = document.getElementById('welcomeError');
  const submitBtn = document.getElementById('welcomeSubmitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = welcomeMode === 'login' ? 'Signing in...' : 'Creating account...';

  try {
    const endpoint = welcomeMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = welcomeMode === 'login' ? { email, password } : { email, password, name };
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      errorEl.textContent = data.error || 'Something went wrong';
      errorEl.style.display = 'block';
      return;
    }
    currentUser = data;
    showToast(`Welcome${currentUser.name ? ', ' + currentUser.name : ''}!`);
    await enterApp();
  } catch (err) {
    errorEl.textContent = 'Connection error — try again';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = welcomeMode === 'login' ? 'Sign in' : 'Create account';
  }
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  currentUser = null;
  cellar = [];
  tastings = [];
  updateAuthUI();
  showWelcome();
  showToast('Signed out');
}

// ============ SYNC ============

function debouncedServerSync() {
  if (!currentUser) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToServer(), 1000);
}

async function syncToServer() {
  if (!currentUser) return;
  try {
    await fetch('/api/sync/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ bottles: cellar, tastings, finds: restaurantFinds }),
    });
    localStorage.setItem('vino_last_sync', new Date().toISOString());
  } catch (err) {
    console.warn('Sync to server failed:', err.message);
  }
}

async function syncFromServer() {
  if (!currentUser) return;
  try {
    const resp = await fetch('/api/sync/download', { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json();
    cellar = data.bottles || [];
    tastings = data.tastings || [];
    restaurantFinds = data.finds || [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cellar));
    localStorage.setItem(TASTINGS_KEY, JSON.stringify(tastings));
    localStorage.setItem(FINDS_KEY, JSON.stringify(restaurantFinds));
    localStorage.setItem('vino_last_sync', new Date().toISOString());
    // Run migrations on freshly downloaded data (fix values, currency, etc.)
    runMigrations();
    renderDashboard(); renderCellar();
  } catch (err) {
    console.warn('Sync from server failed:', err.message);
  }
}

function showSyncPrompt() {
  const count = cellar.length;
  const modal = document.getElementById('syncModal');
  if (modal) {
    document.getElementById('syncCount').textContent = count;
    modal.classList.add('open');
  }
}

async function confirmSync() {
  document.getElementById('syncModal')?.classList.remove('open');
  showToast('Uploading your collection...');
  await syncToServer();
  localStorage.setItem('vino_synced', '1');
  showToast(`${cellar.length} bottles synced to cloud`);
}

function skipSync() {
  document.getElementById('syncModal')?.classList.remove('open');
  localStorage.setItem('vino_synced', '1');
}

async function syncNow() {
  showToast('Syncing...');
  await syncToServer();
  showToast('Synced');
}

// ============ DATA LAYER ============

function loadCellar() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveCellar(wines) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wines));
  debouncedServerSync();
}
function loadTastings() {
  try { return JSON.parse(localStorage.getItem(TASTINGS_KEY)) || []; } catch { return []; }
}
function saveTastings(t) {
  localStorage.setItem(TASTINGS_KEY, JSON.stringify(t));
  debouncedServerSync();
}
function loadFinds() {
  try { return JSON.parse(localStorage.getItem(FINDS_KEY)) || []; } catch { return []; }
}
function saveFinds(f) {
  localStorage.setItem(FINDS_KEY, JSON.stringify(f));
  debouncedServerSync();
}

// ============ MARKET VALUE ESTIMATION ============

function estimateMarketValue(bottle) {
  // If CSV imported with a market value, use it
  if (bottle.marketValue && bottle.marketValue > 0) return bottle.marketValue;

  // If user entered a purchase price, use it as the base market value
  const userPrice = bottle.price ? parseFloat(bottle.price) : 0;
  if (userPrice > 0) return userPrice;

  // No price data at all — rough estimate from heuristics
  let base = isSpiritOrWhiskey(bottle.type) ? 45 : 20;

  if (isWhiskey(bottle.type)) return estimateWhiskeyValue(bottle, base);
  if (isSpirit(bottle.type)) return estimateSpiritValue(bottle, base);
  return estimateWineValue(bottle, base);
}

function estimateWineValue(wine, base) {
  const regionMult = {
    'bordeaux': 1.8, 'burgundy': 2.2, 'champagne': 1.5, 'napa': 1.6,
    'barolo': 1.5, 'tuscany': 1.4, 'rioja': 1.2, 'rhone': 1.3, 'rhône': 1.3,
    'mosel': 1.3, 'piedmont': 1.4, 'sonoma': 1.3, 'willamette': 1.2,
    'mendoza': 1.0, 'loire': 1.1, 'douro': 1.2, 'priorat': 1.3,
  };
  const grapeMult = {
    'cabernet sauvignon': 1.2, 'pinot noir': 1.3, 'nebbiolo': 1.4,
    'sangiovese': 1.1, 'merlot': 1.0, 'syrah': 1.1, 'shiraz': 1.1,
    'chardonnay': 1.1, 'riesling': 1.2, 'sauvignon blanc': 1.0,
  };
  const ultraPremiumKw = ['petrus', 'lafite', 'latour', 'mouton', 'margaux', 'romanee',
    'leroy', 'dom perignon', 'salon', 'cristal', 'opus', 'sassicaia'];
  const premiumKw = ['chateau', 'château', 'domaine', 'tignanello',
    'penfolds', 'krug'];

  const region = (wine.region || '').toLowerCase();
  const grape = (wine.grape || '').toLowerCase();
  const producer = ((wine.producer || '') + ' ' + (wine.name || '')).toLowerCase();
  const vintage = parseInt(wine.vintage) || 2020;
  const age = new Date().getFullYear() - vintage;

  for (const [k, m] of Object.entries(regionMult)) { if (region.includes(k)) { base *= m; break; } }
  for (const [k, m] of Object.entries(grapeMult)) { if (grape.includes(k)) { base *= m; break; } }
  if (age > 0 && age <= 5) base *= 1 + age * 0.03;
  else if (age > 5 && age <= 15) base *= 1.15 + (age - 5) * 0.04;
  else if (age > 15 && age <= 30) base *= 1.55 + (age - 15) * 0.02;
  else if (age > 30) base *= 1.85 + Math.min((age - 30) * 0.01, 0.5);
  let brandApplied = false;
  for (const kw of ultraPremiumKw) { if (producer.includes(kw)) { base *= 1.5; brandApplied = true; break; } }
  if (!brandApplied) { for (const kw of premiumKw) { if (producer.includes(kw)) { base *= 1.2; break; } } }
  if (wine.type === 'Sparkling' || wine.type === 'Champagne') base *= 1.1;

  const hash = (wine.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.95 + (hash % 10) / 100;
  return Math.round(base * 100) / 100;
}

function estimateWhiskeyValue(w, base) {
  const regionMult = {
    'islay': 1.4, 'speyside': 1.3, 'highland': 1.2, 'lowland': 1.1,
    'campbeltown': 1.3, 'kentucky': 1.1, 'tennessee': 1.0,
    'japan': 1.4, 'ireland': 1.0, 'taiwan': 1.3,
  };
  // Top-tier brands get a bigger bump; mid-tier brands get a smaller one
  const ultraPremiumKw = ['macallan', 'yamazaki', 'pappy', 'van winkle', 'dalmore', 'springbank', 'kavalan'];
  const premiumKw = ['hibiki', 'nikka', 'blanton', 'lagavulin', 'ardbeg', 'laphroaig',
    'glenfiddich', 'glenlivet', 'balvenie', 'redbreast', 'midleton',
    'buffalo trace', 'maker\'s mark', 'woodford', 'whistlepig', 'wild turkey'];

  const region = (w.region || '').toLowerCase();
  const nameProducer = ((w.producer || '') + ' ' + (w.name || '')).toLowerCase();
  const age = parseInt(w.age) || 0;

  for (const [k, m] of Object.entries(regionMult)) { if (region.includes(k)) { base *= m; break; } }

  // Age premium — moderate scaling
  if (age >= 10 && age < 15) base *= 1.3;
  else if (age >= 15 && age < 18) base *= 1.8;
  else if (age >= 18 && age < 21) base *= 2.5;
  else if (age >= 21 && age < 25) base *= 3.5;
  else if (age >= 25 && age < 30) base *= 5.0;
  else if (age >= 30) base *= 7 + (age - 30) * 0.3;

  let brandApplied = false;
  for (const kw of ultraPremiumKw) { if (nameProducer.includes(kw)) { base *= 1.5; brandApplied = true; break; } }
  if (!brandApplied) { for (const kw of premiumKw) { if (nameProducer.includes(kw)) { base *= 1.2; break; } } }
  if (w.abv && parseFloat(w.abv) > 50) base *= 1.1; // Cask strength premium

  const hash = (w.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.95 + (hash % 10) / 100;
  return Math.round(base * 100) / 100;
}

function estimateSpiritValue(s, base) {
  const ultraPremiumKw = ['clase azul', 'louis xiii', 'tears of llorona', 'last drop'];
  const premiumKw = ['don julio', 'patron', 'herradura', 'casamigos',
    'fortaleza', 'diplomatico', 'zacapa', 'flor de cana', 'appleton',
    'havana club', 'hennessy', 'remy martin'];
  const nameProducer = ((s.producer || '') + ' ' + (s.name || '')).toLowerCase();
  let brandApplied = false;
  for (const kw of ultraPremiumKw) { if (nameProducer.includes(kw)) { base *= 1.5; brandApplied = true; break; } }
  if (!brandApplied) { for (const kw of premiumKw) { if (nameProducer.includes(kw)) { base *= 1.2; break; } } }
  if (/limited|edition|reserva|extra anejo|ultra/i.test(s.name || '')) base *= 1.3;
  const age = parseInt(s.age) || 0;
  if (age >= 10) base *= 1 + age * 0.05;
  const hash = (s.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.95 + (hash % 10) / 100;
  return Math.round(base * 100) / 100;
}

// ============ SAMPLE DATA ============

function getSampleData() {
  return parseCellarTrackerCSV();
}

function getSampleTastings() {
  return [];
}

// ============ CSV IMPORT (CellarTracker format) ============

function parseCellarTrackerCSV() {
  const csv = CELLARTRACKER_CSV;
  const lines = parseCSVLines(csv);
  if (lines.length < 2) return [];
  const headers = lines[0];
  const bottles = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.length < headers.length) continue;
    const get = (col) => { const idx = headers.indexOf(col); return idx >= 0 ? (row[idx] || '').trim() : ''; };

    const ctType = get('Type');
    const ctColor = get('Color');
    const ctCategory = get('Category');
    const name = get('Wine');
    const producer = get('Producer');
    const varietal = get('Varietal') || get('MasterVarietal');
    const vintageRaw = parseInt(get('Vintage')) || null;
    const vintage = vintageRaw && vintageRaw > 1900 ? vintageRaw : null;
    const country = get('Country');
    const region = get('Region');
    const subRegion = get('SubRegion');
    const appellation = get('Appellation');
    const designation = get('Designation');
    const vineyard = get('Vineyard');
    const size = get('Size');
    const currency = get('Currency') || 'USD';
    const priceRaw = get('Price').replace(',', '.');
    const price = parseFloat(priceRaw) || null;
    const valueRaw = get('Value').replace(',', '.');
    const marketValue = parseFloat(valueRaw) || null;
    const quantity = parseInt(get('Quantity')) || 1;
    const pending = parseInt(get('Pending')) || 0;
    const beginConsume = parseInt(get('BeginConsume')) || null;
    const endConsume = parseInt(get('EndConsume')) || null;
    const pNotes = get('PNotes');
    const pScore = parseInt(get('PScore')) || null;
    const cNotes = get('CNotes');
    const cScore = parseFloat(get('CScore')) || null;

    // Build region string
    const regionParts = [subRegion !== 'Unknown' ? subRegion : '', region !== 'Unknown' ? region : '', country].filter(Boolean);
    const regionStr = regionParts.join(', ');

    // Determine type
    let type = 'Other Spirit';
    let category = 'spirit';
    const allText = (name + ' ' + designation + ' ' + varietal + ' ' + ctCategory + ' ' + producer + ' ' + vineyard + ' ' + region + ' ' + country + ' ' + subRegion + ' ' + appellation).toLowerCase();

    // Known whisky distilleries that CellarTracker categorizes as generic "Spirits"
    const KNOWN_WHISKY_PRODUCERS = ['macallan', 'benromach', 'glenfiddich', 'glenlivet', 'balvenie',
      'ardbeg', 'lagavulin', 'laphroaig', 'dalmore', 'springbank', 'oban', 'talisker',
      'bowmore', 'bruichladdich', 'highland park', 'aberlour', 'bunnahabhain', 'caol ila',
      'craigellachie', 'edradour', 'glen grant', 'glendronach', 'glenmorangie', 'knockando',
      'mortlach', 'royal salute', 'strathisla', 'tamnavulin', 'tomatin', 'nikka', 'yamazaki',
      'hakushu', 'hibiki', 'kavalan', 'redbreast', 'jameson', 'midleton', 'bushmills',
      'maker\'s mark', 'woodford', 'wild turkey', 'buffalo trace', 'pappy', 'blanton',
      'whistlepig', 'bulleit', 'four roses', 'knob creek', 'jack daniel'];
    const isKnownWhisky = KNOWN_WHISKY_PRODUCERS.some(p => allText.includes(p));
    const scotlandBased = /scotland|speyside|highland|islay|lowland|campbeltown|craigellachie/.test(allText);
    const maltVarietal = varietal.toLowerCase() === 'malt' || varietal.toLowerCase() === 'grain';

    if (ctType === 'Spirits' || ctCategory === 'Distilled') {
      if (/whisk[e]?y|scotch|single malt|bourbon/i.test(allText) || isKnownWhisky || (scotlandBased && maltVarietal)) {
        if (/bourbon/i.test(allText)) type = 'Bourbon';
        else if (/scotch|single malt/i.test(allText) || (scotlandBased && maltVarietal) || isKnownWhisky && scotlandBased) type = 'Scotch';
        else if (/irish/i.test(allText)) type = 'Irish';
        else if (/japan/i.test(allText)) type = 'Japanese';
        else if (/rye whisk/i.test(allText)) type = 'Rye';
        else if (/tennessee/i.test(allText)) type = 'Tennessee';
        else type = 'Single Malt';
        category = 'whiskey';
      } else if (/tequila|agave/i.test(allText)) { type = 'Tequila'; category = 'tequila'; }
      else if (/mezcal/i.test(allText)) { type = 'Mezcal'; category = 'tequila'; }
      else if (/rum|ron\b/i.test(allText)) { type = 'Rum'; category = 'spirit'; }
      else if (/cognac/i.test(allText)) { type = 'Cognac'; category = 'spirit'; }
      else if (/brandy/i.test(allText)) { type = 'Brandy'; category = 'spirit'; }
      else if (/gin/i.test(allText)) { type = 'Gin'; category = 'spirit'; }
      else { type = 'Other Spirit'; category = 'spirit'; }
    } else if (ctType === 'Red' || ctColor === 'Red') { type = 'Red'; category = 'wine'; }
    else if (ctType === 'White' || ctColor === 'White') { type = 'White'; category = 'wine'; }
    else if (/ros[eé]/i.test(ctType + ctColor)) { type = 'Rosé'; category = 'wine'; }
    else if (/sparkling|champagne/i.test(ctType + ctColor)) { type = 'Sparkling'; category = 'wine'; }
    else if (/dessert|sweet/i.test(ctType + ctCategory)) { type = 'Dessert'; category = 'wine'; }
    else if (/fortified|port|sherry/i.test(ctType + ctCategory)) { type = 'Fortified'; category = 'wine'; }
    else { type = 'Red'; category = 'wine'; }

    // Extract age from name/designation
    const ageMatch = (name + ' ' + designation).match(/(\d{1,2})\s*(?:year|yr|ans|jahre)/i);
    const age = ageMatch ? parseInt(ageMatch[1]) : null;

    // Extract ABV from vineyard field or name (CT stores it oddly)
    const abvMatch = ((get('Vineyard') || '') + ' ' + name + ' ' + designation).match(/(\d{2,3}(?:[.,]\d{1,2})?)\s*%/);
    const abv = abvMatch ? parseFloat(abvMatch[1].replace(',', '.')) : null;

    // Skip duplicates by iWine ID
    const ctId = get('iWine');
    if (ctId && bottles.some(b => b.ctId === ctId)) continue;

    bottles.push({
      id: get('iWine') || Date.now().toString() + i,
      name,
      producer,
      vintage,
      type,
      grape: category === 'wine' ? varietal : '',
      varietal,
      masterVarietal: get('MasterVarietal'),
      region: regionStr,
      country,
      subRegion: subRegion !== 'Unknown' ? subRegion : '',
      appellation: appellation !== 'Unknown' ? appellation : '',
      designation,
      vineyard: vineyard !== 'Unknown' ? vineyard : '',
      size,
      currency,
      quantity,
      pending,
      price,
      marketValue,
      location: '',
      drinkFrom: beginConsume && beginConsume < 9999 ? beginConsume : null,
      drinkUntil: endConsume && endConsume < 9999 ? endConsume : null,
      notes: pNotes || '',
      communityNotes: cNotes || '',
      personalScore: pScore,
      communityScore: cScore,
      addedDate: new Date().toISOString().split('T')[0],
      rating: pScore ? Math.min(5, Math.round(pScore / 20)) : null,
      category,
      age,
      abv,
      ctId: get('iWine'),
    });
  }
  return bottles;
}

function parseCSVLines(csv) {
  const lines = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { current.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') i++;
        current.push(field); field = '';
        if (current.some(f => f.trim())) lines.push(current);
        current = [];
      } else field += c;
    }
  }
  current.push(field);
  if (current.some(f => f.trim())) lines.push(current);
  return lines;
}

const CELLARTRACKER_CSV = `"iWine","Type","Color","Category","Size","Currency","Value","Price","TotalQuantity","Quantity","Pending","Vintage","Wine","Locale","Producer","Varietal","MasterVarietal","Designation","Vineyard","Country","Region","SubRegion","Appellation","BeginConsume","EndConsume","LikeVotes","LikePercent","LikeIt","PNotes","PScore","CNotes","CScore","WA","WAWeb","IWC","IWCWeb","WS","WSWeb","WE","WEWeb","BR","BRWeb","GV","GVWeb","LF","LFWeb","JG","JGWeb","LD","LDWeb","CW","CWWeb","SJ","SJWeb","GA","GAWeb","WWR","WWRWeb","TT","TTWeb","FP","FPWeb"
"5673183","Spirits","Other","Distilled","750ml","EUR","21001,2291","21000","1","1","0","1972","Benromach 50 Year Old - 2024 release","United Kingdom, Scotland, Speyside","Benromach","Malt","Grain","50 Year Old - 2024 release","Unknown","United Kingdom","Scotland","Speyside","Speyside","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644966","Spirits","Other","Distilled","750ml","EUR","1051,0615","1051","1","1","0","2022","Clase Azul 25th Anniversary Limited Edition Tequila","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","25th Anniversary Limited Edition Tequila","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5309163","Spirits","Other","Distilled","750ml","EUR","1350,079","1350","1","1","0","2023","Clase Azul Dia de Muertos Limited Edition AROMAS","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Dia de Muertos Limited Edition AROMAS","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"4850948","Spirits","Other","Distilled","750ml","EUR","1432,4713","1350","1","1","0","2022","Clase Azul Dia de Muertos Limited Edition Colores","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Dia de Muertos Limited Edition Colores","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","1","1","True","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644905","Spirits","Other","Distilled","750ml","EUR","1450,0849","1450","1","1","0","2024","Clase Azul Dia de Muertos Limited Edition Musica","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Dia de Muertos Limited Edition Musica","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671857","Spirits","Other","Distilled","750ml","EUR","1780,1042","1780","1","1","0","2025","Clase Azul Dia de Muertos Limited Edition Recuerdos","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Dia de Muertos Limited Edition Recuerdos","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671811","Spirits","Other","Distilled","750ml","EUR","6000,3512","6000","2","2","0","2026","Clase Azul Edicion Limitada - Encuentros Amador Montes","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Edicion Limitada - Encuentros Amador Montes","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644919","Spirits","Other","Distilled","750ml","EUR","6000,3512","6000","1","1","0","2025","Clase Azul Edicion Limitada Lienzos Mexicanos - FABULA IDOL","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Edicion Limitada Lienzos Mexicanos - FABULA IDOL","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644935","Spirits","Other","Distilled","750ml","EUR","6000,3512","6000","1","1","0","2025","Clase Azul Edicion Limitada Lienzos Mexicanos - Poesia Floral","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Edicion Limitada Lienzos Mexicanos - Poesia Floral","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644931","Spirits","Other","Distilled","750ml","EUR","6000,3512","6000","1","1","0","2025","Clase Azul Edicion Limitada Lienzos Mexicanos - Sonata Noctur","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Edicion Limitada Lienzos Mexicanos - Sonata Noctur","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3731785","Spirits","Other","Distilled","750ml","EUR","269,8461","250","1","1","0","1001","Clase Azul Gold","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Gold","Unknown","Mexico","Jalisco","Tequila","Unknown","2022","2042","1","1","","","","1","92","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671844","Spirits","Other","Distilled","750ml","EUR","6650,3892","6650","1","0","1","2025","Clase Azul Limited Edition - Master Artisans - Coro Silvestre","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Master Artisans - Coro Silvestre","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671842","Spirits","Other","Distilled","750ml","EUR","6000,3512","6000","1","0","1","2025","Clase Azul Limited Edition - Master Artisans - Jardin Tonalte","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Master Artisans - Jardin Tonalte","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671847","Spirits","Other","Distilled","750ml","EUR","7614,4457","7614","1","0","1","2025","Clase Azul Limited Edition - Master Artisans - Paraiso Noctur","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Master Artisans - Paraiso Noctur","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5645777","Spirits","Other","Distilled","1.0L","EUR","1300,0761","1300","1","1","0","2025","Clase Azul Limited Edition - Pink","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Pink","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5645771","Spirits","Other","Distilled","1.0L","EUR","780,0457","780","1","1","0","2024","Clase Azul Limited Edition - Pink","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Pink","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5645769","Spirits","Other","Distilled","1.0L","EUR","613,0359","613","1","1","0","2023","Clase Azul Limited Edition - Pink","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Pink","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5645768","Spirits","Other","Distilled","1.0L","EUR","1500,0878","1500","1","1","0","2022","Clase Azul Limited Edition - Pink","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition - Pink","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644953","Spirits","Other","Distilled","750ml","EUR","1240,0726","1240","1","1","0","2024","Clase Azul Limited edition - The Loft Brooklyn Collection I","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited edition - The Loft Brooklyn Collection I","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644954","Spirits","Other","Distilled","750ml","EUR","1815,1063","1815","1","1","0","2025","Clase Azul Limited edition - The Loft Brooklyn Collection II","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited edition - The Loft Brooklyn Collection II","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5645790","Spirits","Other","Distilled","1.0L","EUR","7730,4525","7730","1","1","0","1001","Clase Azul Limited Edition Jalisco 200","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition Jalisco 200","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5644977","Spirits","Other","Distilled","750ml","EUR","4363,2554","4363","3","3","0","2025","Clase Azul Limited Edition X Eduardo Sarabia","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Limited Edition X Eduardo Sarabia","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"4082124","Spirits","Other","Distilled","750ml","EUR","329,7173","437","1","1","0","1001","Clase Azul Mezcal Durango","Mexico, Oaxaca","Clase Azul","Agave","Agave","Mezcal Durango","Unknown","Mexico","Oaxaca","Unknown","Unknown","2033","2083","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"1424949","Spirits","Other","Distilled","750ml","EUR","140,137","170","1","1","0","1001","Clase Azul Reposado Tequila","Mexico, Jalisco, Tequila","Clase Azul","Agave","Agave","Reposado Tequila","Unknown","Mexico","Jalisco","Tequila","Unknown","2024","2043","7","1","","","","10","92","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"1734505","Spirits","Other","Distilled","1.0L","EUR","1500,0878","1500","1","1","0","1001","Clase Azul Ultra Reserva Tequila Extra Anejo","Mexico, Jalisco, Tequila","Clase Azul Ultra","Agave","Agave","Reserva Tequila Extra Anejo","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671818","Spirits","Other","Distilled","750ml","EUR","3470,2031","3470","1","1","0","1001","Flor de Cana Flor de Cana 35 Years Limited Edition Aged Rum","Nicaragua","Flor de Cana","Molasses","Molasses","Flor de Cana 35 Years Limited Edition Aged Rum","Unknown","Nicaragua","Nicaragua","Unknown","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5328202","Red","Red","Dry","750ml","EUR","116,6735","156","1","1","0","2019","Joao Portugal Ramos Vinho Regional Alentejano Estremus","Portugal, Alentejano, Vinho Regional Alentejano","Joao Portugal Ramos","Red Blend","Red Blend","Estremus","Unknown","Portugal","Alentejano","Unknown","Vinho Regional Alentejano","9999","2029","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5671826","Spirits","Other","Distilled","750ml","EUR","1870,1094","1870","1","1","0","1001","The Last Drop Distillers Release 40 - EXTRA ANEJO TEQUILA","Mexico, Jalisco, Tequila","The Last Drop Distillers","Agave","Agave","Release 40 - EXTRA ANEJO TEQUILA","Unknown","Mexico","Jalisco","Tequila","Unknown","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3886954","Spirits","Other","Distilled","750ml","EUR","295,14","233","1","1","0","1001","The Macallan 12 Year Old Double Cask Year of the Rat Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","12 Year Old Double Cask Year of the Rat","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3140763","Spirits","Other","Distilled","750ml","EUR","147,1279","126","1","1","0","1001","The Macallan Aera Single Malt Scotch Whisky, 40%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Aera","Single Malt Scotch Whisky, 40%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","1","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"4749050","Spirits","Other","Distilled","750ml","EUR","138,7406","120","4","4","0","2023","The Macallan Classic Cut 2023 Limited Edition Single Malt Scotch Whisky, 50.3%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Classic Cut 2023 Limited Edition","Single Malt Scotch Whisky, 50.3%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5488249","Spirits","Other","Distilled","750ml","EUR","131,7113","150","1","1","0","2024","The Macallan Classic Cut 2024 Limited Edition Single Malt Scotch Whisky, 52.4%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Classic Cut 2024 Limited Edition","Single Malt Scotch Whisky, 52.4%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3278470","Spirits","Other","Distilled","750ml","EUR","248,9764","260","1","1","0","1001","The Macallan Concept Number 1 Single Malt Scotch Whisky, 40%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Concept Number 1","Single Malt Scotch Whisky, 40%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3592113","Spirits","Other","Distilled","750ml","EUR","247,9812","260","1","1","0","2019","The Macallan Concept Number 2 Single Malt Scotch Whisky, 40%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Concept Number 2","Single Malt Scotch Whisky, 40%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"4122567","Spirits","Other","Distilled","750ml","EUR","236,5747","260","1","1","0","1001","The Macallan Concept Number 3 Single Malt Scotch Whisky, 40%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Concept Number 3","Single Malt Scotch Whisky, 40%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5391001","Spirits","Other","Distilled","750ml","EUR","186,1193","172","1","1","0","1001","The Macallan Harmony Collection - Guardian Oak Single Malt Scotch Whisky, 44,2%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Harmony Collection - Guardian Oak","Single Malt Scotch Whisky, 44,2%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","1","94","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5479190","Spirits","Other","Distilled","750ml","EUR","147,3005","0","1","1","0","2025","The Macallan Harmony Collection - Jing Phoenix Honey Orchid Tea Single Malt Scotch Whisky, 43.9%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Harmony Collection - Jing Phoenix Honey Orchid Tea","Single Malt Scotch Whisky, 43.9%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3850312","Spirits","Other","Distilled","750ml","EUR","268,9265","266","1","1","0","2019","The Macallan Rare Cask 2019 Release Batch No. 2 Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Rare Cask 2019 Release Batch No. 2","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","1","1","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5452366","Spirits","Other","Distilled","750ml","EUR","325,019","325","1","1","0","2024","The Macallan Rare Cask 2024 Release Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Rare Cask 2024 Release","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5673193","Spirits","Other","Distilled","750ml","EUR","730,0427","730","2","2","0","1991","The Macallan rarest reserve macallan aged 33 years","United Kingdom, Scotland, Speyside","The Macallan","Malt","Grain","rarest reserve macallan aged 33 years","Unknown","United Kingdom","Scotland","Speyside","Speyside","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3539815","Spirits","Other","Distilled","750ml","EUR","1025,06","1025","1","1","0","1001","The Macallan The Archival Series Folio 5 Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","The Archival Series Folio 5","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","2030","2050","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"3918198","Spirits","Other","Distilled","750ml","EUR","741,7728","995","1","1","0","1001","The Macallan The Archival Series Folio 6 Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","The Archival Series Folio 6","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"4651212","Spirits","Other","Distilled","750ml","EUR","560,0039","964","1","1","0","1001","The Macallan The Archival Series Folio 7 Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","The Archival Series Folio 7","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5568308","Spirits","Other","Distilled","750ml","EUR","443,026","443","1","1","0","1001","The Macallan The Archival Series Folio 8 Single Malt Scotch Whisky, 43%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","The Archival Series Folio 8","Single Malt Scotch Whisky, 43%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5153251","Spirits","Other","Distilled","750ml","EUR","1528,7752","1350","1","1","0","1001","The Macallan Time:Space Mastery (200th Anniversary) Single Malt Scotch Whisky, 43.6%","United Kingdom, Scotland, Craigellachie, Easter Elchies","The Macallan","Malt","Grain","Time:Space Mastery (200th Anniversary)","Single Malt Scotch Whisky, 43.6%","United Kingdom","Scotland","Craigellachie","Easter Elchies","9999","9999","1","1","","","","1","97","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"5328202","Red","Red","Dry","750ml","EUR","116,6735","156","1","1","0","2019","Joao Portugal Ramos Vinho Regional Alentejano Estremus","Portugal, Alentejano, Vinho Regional Alentejano","Joao Portugal Ramos","Red Blend","Red Blend","Estremus","Unknown","Portugal","Alentejano","Unknown","Vinho Regional Alentejano","9999","2029","0","","","","","0","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""`;


// ============ INIT ============

let cellar = loadCellar();
let tastings = loadTastings();
let restaurantFinds = loadFinds();
let activeFilters = new Set();
let showFavoritesOnly = false;
let cellarStatusFilter = 'active'; // 'active' | 'consumed' | 'all'
let selectedTastingWineId = null;
let currentRating = 0;
let addCategory = 'wine';
let editingBottleId = null;

// Data starts empty — loaded from server after login

// Data migration — runs after every data load (initial + server sync)
function runMigrations() {
  let dirty = false;
  cellar.forEach(w => {
    if (!w.category) { w.category = isWhiskey(w.type) ? 'whiskey' : isTequila(w.type) ? 'tequila' : isSake(w.type) ? 'sake' : SPIRIT_TYPES.includes(w.type) ? 'spirit' : 'wine'; dirty = true; }
    if (!w.status) { w.status = 'active'; dirty = true; }
    if (!w.consumptionHistory) { w.consumptionHistory = []; dirty = true; }
    // Re-estimate market values for non-CSV bottles (no ctId = added via scan/manual)
    if (!w.ctId) {
      const oldMv = w.marketValue;
      w.marketValue = 0; // Clear so estimateMarketValue doesn't short-circuit
      w.marketValue = estimateMarketValue(w);
      if (w.marketValue !== oldMv) dirty = true;
    } else if (!w.marketValue || w.marketValue <= 0) {
      w.marketValue = estimateMarketValue(w);
      dirty = true;
    }
    // Migrate currency to USD
    if (w.currency === 'EUR') { w.currency = 'USD'; dirty = true; }
    // Set storage location to Dubai if not set
    if (!w.location) { w.location = 'Dubai'; dirty = true; }
  });
  if (dirty && cellar.length > 0) saveCellar(cellar);
}
runMigrations();

// ---- Batch Critic Score Estimation ----
async function runBatchScoring() {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) { showToast('Add your OpenAI API key in Settings first.'); return; }

  const unscoredBottles = cellar.filter(b => !b.communityScore && b.status !== 'consumed' && b.name);
  const unscoredFinds = restaurantFinds.filter(f => !f.communityScore && f.name);
  const allUnscored = [...unscoredBottles, ...unscoredFinds];
  if (allUnscored.length === 0) { showToast('All items already have scores!'); return; }

  const btn = document.getElementById('batchScoreBtn');
  const statusEl = document.getElementById('batchScoreStatus');
  if (btn) btn.disabled = true;

  let scored = 0;
  const total = allUnscored.length;
  if (statusEl) statusEl.textContent = `Scoring 0/${total}...`;

  // Process ALL items (bottles + finds) in batches of 10
  const batchSize = 10;
  for (let i = 0; i < allUnscored.length; i += batchSize) {
    const batch = allUnscored.slice(i, i + batchSize);
    const prompt = batch.map((b, idx) => {
      const parts = [b.name, b.producer, b.type, b.region, b.vintage ? `${b.vintage}` : null, b.grape].filter(Boolean);
      return `${idx + 1}. ${parts.join(' | ')}`;
    }).join('\n');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `For each wine/spirit below, estimate a critic score out of 100 based on known reviews (Wine Spectator, CellarTracker, Vivino, etc.) or your best estimate based on the producer's reputation and quality tier. Return ONLY a JSON array of numbers (scores), one per item, in the same order. If you cannot estimate, use null.\n\n${prompt}`
          }],
          max_tokens: 300,
          temperature: 0.1,
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || `API error ${response.status}`;
        if (statusEl) statusEl.textContent = `Error: ${errMsg}`;
        if (btn) btn.disabled = false;
        showToast('Scoring error: ' + errMsg);
        return;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        batch.forEach((b, idx) => {
          const score = scores[idx];
          if (score && typeof score === 'number' && score >= 1 && score <= 100) {
            b.communityScore = Math.round(score);
            scored++;
          }
        });
      }
    } catch (err) {
      console.error('Batch scoring error:', err);
    }

    if (statusEl) statusEl.textContent = `Scoring ${Math.min(i + batchSize, total)}/${total}...`;
    if (i + batchSize < allUnscored.length) await new Promise(r => setTimeout(r, 500));
  }

  saveCellar(cellar);
  saveFinds(restaurantFinds);
  renderCellar();
  renderDashboard();
  renderFinds();
  if (statusEl) statusEl.textContent = `Done! Scored ${scored}/${total}.`;
  if (btn) btn.disabled = false;
  showToast(`Estimated scores for ${scored} items`);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
}
initTheme();

document.addEventListener('DOMContentLoaded', () => {
  setupStarRating();
  document.getElementById('tastingDate').value = new Date().toISOString().split('T')[0];

  // Check auth — will show welcome page or load app
  checkAuthState();
});

// ============ ADD CATEGORY TOGGLE ============

function setAddCategory(cat, btn) {
  addCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const showSpirit = cat === 'whiskey' || cat === 'spirit' || cat === 'tequila' || cat === 'sake';
  document.querySelectorAll('.whiskey-field').forEach(el => el.style.display = showSpirit ? '' : 'none');
  document.querySelectorAll('.wine-field').forEach(el => el.style.display = showSpirit ? 'none' : '');

  // Update labels
  const labels = {
    wine: { producer: 'Producer / Winery', vintage: 'Vintage *', grape: 'Grape / Varietal', prodPH: 'e.g. Chateau Margaux', grapePH: 'e.g. Cabernet Sauvignon', regionPH: 'e.g. Bordeaux, France' },
    whiskey: { producer: 'Distillery / Producer', vintage: 'Bottling Year', grape: 'Grain / Mash Bill', prodPH: 'e.g. The Macallan', grapePH: 'e.g. Malted Barley', regionPH: 'e.g. Islay, Scotland' },
    tequila: { producer: 'Producer / Brand', vintage: 'Bottling Year', grape: 'Agave Type', prodPH: 'e.g. Clase Azul', grapePH: 'e.g. Blue Weber Agave', regionPH: 'e.g. Jalisco, Mexico' },
    sake: { producer: 'Brewery / Producer', vintage: 'Bottling Year', grape: 'Rice Type', prodPH: 'e.g. Dassai', grapePH: 'e.g. Yamada Nishiki', regionPH: 'e.g. Niigata, Japan' },
    spirit: { producer: 'Producer / Brand', vintage: 'Bottling Year', grape: 'Base Ingredient', prodPH: 'e.g. Diplomatico', grapePH: 'e.g. Sugarcane', regionPH: 'e.g. Venezuela' },
  };
  const l = labels[cat] || labels.wine;
  document.getElementById('labelProducer').textContent = l.producer;
  document.getElementById('labelVintage').textContent = l.vintage;
  document.getElementById('labelGrape').textContent = l.grape;
  document.getElementById('wineProducer').placeholder = l.prodPH;
  document.getElementById('wineGrape').placeholder = l.grapePH;
  document.getElementById('wineRegion').placeholder = l.regionPH;

  // Vintage/Year is required only for wine, optional for whiskey, tequila & spirits
  const vintageInput = document.getElementById('wineVintage');
  vintageInput.required = (cat === 'wine');

  // Auto-set first option of relevant optgroup
  const sel = document.getElementById('wineType');
  if (cat === 'whiskey') sel.value = 'Scotch';
  else if (cat === 'tequila') sel.value = 'Tequila';
  else if (cat === 'sake') sel.value = 'Junmai';
  else if (cat === 'spirit') sel.value = 'Rum';
  else sel.value = 'Red';
}

// ============ VIEW SWITCHING ============

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  const navItem = document.querySelector(`[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');
  if (view === 'dashboard') renderDashboard();
  if (view === 'cellar') renderCellar();
  if (view === 'tasting') { renderTastingWines(); renderPastTastings(); }
  if (view === 'timeline') renderTimeline();
  if (view === 'finds') renderFinds();
  if (view === 'settings') { updateApiKeyStatus(); loadShareStatus(); }
  if (view !== 'add' && editingBottleId) { editingBottleId = null; updateAddViewTitle(false); }
  document.getElementById('sidebar').classList.remove('open');
}

function toggleMobileNav() { document.getElementById('sidebar').classList.toggle('open'); }

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem(THEME_KEY, 'light'); }
  else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem(THEME_KEY, 'dark'); }
  renderDashboard();
}

// ============ DASHBOARD ============

let typeChartInstance = null;
let regionChartInstance = null;

function renderDashboard() {
  const activeCellar = cellar.filter(w => w.status !== 'consumed');
  const totalBottles = activeCellar.reduce((s, w) => s + (parseInt(w.quantity) || 0), 0);
  const ratedWines = cellar.filter(w => w.rating);
  const avgRating = ratedWines.length ? (ratedWines.reduce((s, w) => s + w.rating, 0) / ratedWines.length).toFixed(1) : '—';
  const now = new Date().getFullYear();
  const readyCount = activeCellar.filter(w => {
    if (isSpiritOrWhiskey(w.type)) return true;
    const from = parseInt(w.drinkFrom) || 0;
    const until = parseInt(w.drinkUntil) || 9999;
    return now >= from && now <= until;
  }).reduce((s, w) => s + (parseInt(w.quantity) || 0), 0);
  const totalValue = activeCellar.reduce((s, w) => s + (w.marketValue || 0) * (parseInt(w.quantity) || 1), 0);
  const totalValueAll = cellar.reduce((s, w) => s + (w.marketValue || 0) * Math.max(parseInt(w.quantity) || 1, 1), 0);
  const consumedCount = cellar.reduce((s, w) => s + ((w.consumptionHistory || []).length), 0);

  // Dynamic greeting
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const userName = (typeof currentUser !== 'undefined' && currentUser?.name) ? ', ' + currentUser.name.split(' ')[0] : '';
  const greetEl = document.getElementById('dashGreeting');
  if (greetEl) greetEl.textContent = timeGreeting + userName;

  animateValue('totalBottles', totalBottles);
  document.getElementById('avgRating').textContent = avgRating;
  animateValue('readyToDrink', readyCount);
  const valueEl = document.getElementById('totalValue');
  valueEl.innerHTML = '$' + Math.round(totalValue).toLocaleString() + (totalValueAll > totalValue ? ` <span class="value-total-incl">($${Math.round(totalValueAll).toLocaleString()})</span>` : '');
  const consumedEl = document.getElementById('consumedCount');
  if (consumedEl) consumedEl.textContent = consumedCount;

  // Top bottles by value (active only)
  const topValue = [...activeCellar].sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0)).slice(0, 6);
  const topList = document.getElementById('topValueList');
  if (topList) {
    topList.innerHTML = topValue.length === 0
      ? '<div class="empty-state"><p>Add bottles to see top value</p></div>'
      : topValue.map(w => {
        const currSym = '$';
        return cardSmHTML(w, `${currSym}${Math.round(w.marketValue || 0).toLocaleString()}`);
      }).join('');
  }

  // Ready to drink — prioritize wines in their drink window, then spirits (active only)
  const winesReady = activeCellar.filter(w => {
    if (isSpiritOrWhiskey(w.type)) return false;
    const from = parseInt(w.drinkFrom) || 0;
    const until = parseInt(w.drinkUntil) || 9999;
    return now >= from && now <= until;
  });
  const spiritsReady = activeCellar.filter(w => isSpiritOrWhiskey(w.type));
  const readyWines = [...winesReady, ...spiritsReady].slice(0, 8);
  const readyList = document.getElementById('readyWinesList');
  readyList.innerHTML = readyWines.length === 0
    ? '<div class="empty-state"><p>No bottles ready right now</p></div>'
    : readyWines.map(w => cardSmHTML(w)).join('');

  // Recently opened
  const allConsumptions = cellar.flatMap(w => (w.consumptionHistory || []).map(c => ({ ...c, bottle: w })));
  allConsumptions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentOpenedList = document.getElementById('recentOpenedList');
  if (recentOpenedList) {
    recentOpenedList.innerHTML = allConsumptions.length === 0
      ? '<div class="empty-state"><p>No bottles opened yet</p></div>'
      : allConsumptions.slice(0, 8).map(c => cardSmHTML(c.bottle, formatDate(c.date))).join('');
  }

  // Recent additions (active only)
  const recent = [...activeCellar].sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || '')).slice(0, 8);
  document.getElementById('recentWinesList').innerHTML = recent.map(w => cardSmHTML(w)).join('');

  renderTypeChart();
  renderRegionChart();
  renderCategoryChart();
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  let cur = 0;
  const step = Math.max(1, Math.floor(target / 30));
  const timer = setInterval(() => {
    cur += step;
    if (cur >= target) { cur = target; clearInterval(timer); }
    el.textContent = cur;
  }, 20);
}

function cardSmHTML(w, extraLabel) {
  const status = getDrinkStatus(w);
  const typeClass = w.type.replace(/\s/g, '');
  return `
    <div class="wine-card-sm" onclick="openWineModal('${w.id}')">
      <div class="wine-name">
        <span class="wine-type-dot type-${typeClass}"></span>
        ${escHTML(w.name)}
      </div>
      <div class="wine-meta">${w.vintage || 'NV'} · ${escHTML(w.producer || w.region || w.grape || '')}${w.age ? ' · ' + w.age + 'yr' : ''}</div>
      ${extraLabel ? `<span class="wine-value-tag">${extraLabel}</span>` : `<span class="wine-status status-${status.class}">${status.label}</span>`}
    </div>`;
}

function getDrinkStatus(w) {
  if (isSpiritOrWhiskey(w.type)) return { class: 'ready', label: 'Anytime' };
  const now = new Date().getFullYear();
  const from = parseInt(w.drinkFrom) || 0;
  const until = parseInt(w.drinkUntil) || 9999;
  const peak = from + Math.round((until - from) * 0.4);
  if (now < from) return { class: 'early', label: 'Too Early' };
  if (now > until) return { class: 'past', label: 'Past Peak' };
  if (now >= peak - 1 && now <= peak + 2) return { class: 'peak', label: 'At Peak' };
  return { class: 'ready', label: 'Ready' };
}

function isMobileView() { return window.innerWidth <= 1024; }

// Re-render charts on orientation/resize change (debounced)
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (document.getElementById('view-dashboard')?.classList.contains('active')) {
      renderTypeChart(); renderRegionChart(); renderCategoryChart();
    }
  }, 300);
});

const TYPE_COLORS = {
  Red: '#8B1A1A', White: '#C9A96E', 'Rosé': '#E8A0BF', Sparkling: '#7FB3D3',
  Champagne: '#D4AF37', Dessert: '#D4A574', Fortified: '#6C3483',
  Scotch: '#B8860B', Bourbon: '#D2691E', Irish: '#228B22', Japanese: '#C41E3A',
  Rye: '#8B4513', 'Single Malt': '#DAA520', Blended: '#A0522D', Tennessee: '#CD853F',
  Tequila: '#2E86AB', Mezcal: '#567D2E',
  Junmai: '#C45B28', Ginjo: '#E07B39', Daiginjo: '#D4A574', Nigori: '#F5DEB3', 'Sparkling Sake': '#7FB3D3', Sake: '#C9A96E',
  Rum: '#A0522D', Cognac: '#7B3F00',
  Brandy: '#9B6B43', Gin: '#4682B4', Vodka: '#8FA8C8', 'Other Spirit': '#808080',
};
const CAT_COLORS = { Wine: '#8B1A1A', Whiskey: '#B8860B', Tequila: '#2E86AB', Sake: '#C45B28', Spirit: '#6C3483' };
const BAR_PALETTE = ['#8B1A1A', '#B8860B', '#2E86AB', '#6C3483', '#228B22', '#C41E3A', '#D2691E', '#4682B4', '#567D2E', '#9B6B43'];

// ---- Mobile-native chart renderers (pure HTML/CSS, no Chart.js) ----

function renderMobileBarList(sorted, total, colorMap, container) {
  container.innerHTML = sorted.map(([label, count]) => {
    const pct = total > 0 ? (count / total * 100) : 0;
    const color = colorMap[label] || colorMap[Object.keys(colorMap)[sorted.indexOf([label, count]) % Object.keys(colorMap).length]] || '#999';
    const bg = typeof colorMap === 'object' ? (colorMap[label] || '#999') : '#999';
    return `
      <div class="m-bar-row">
        <div class="m-bar-label">${escHTML(label)}</div>
        <div class="m-bar-track">
          <div class="m-bar-fill" style="width:${Math.max(pct, 2)}%;background:${bg}"></div>
        </div>
        <div class="m-bar-value">${count}</div>
      </div>`;
  }).join('');
}

function renderMobileSegmentBar(entries, total, colorMap, container) {
  if (entries.length === 0) { container.innerHTML = '<div class="empty-state"><p>No data</p></div>'; return; }
  const segmentsHTML = entries.map(([label, count]) => {
    const pct = total > 0 ? (count / total * 100) : 0;
    const color = colorMap[label] || '#999';
    return `<div class="m-seg-piece" style="width:${Math.max(pct, 3)}%;background:${color}" title="${label}: ${count}"></div>`;
  }).join('');
  const legendHTML = entries.map(([label, count]) => {
    const color = colorMap[label] || '#999';
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `<div class="m-seg-legend-item"><span class="m-seg-dot" style="background:${color}"></span><span class="m-seg-name">${escHTML(label)}</span><span class="m-seg-count">${count} (${pct}%)</span></div>`;
  }).join('');
  container.innerHTML = `
    <div class="m-seg-bar">${segmentsHTML}</div>
    <div class="m-seg-legend">${legendHTML}</div>`;
}

function renderTypeChart() {
  const mobile = isMobileView();
  const types = {};
  cellar.filter(w => w.status !== 'consumed').forEach(w => { types[w.type] = (types[w.type] || 0) + (parseInt(w.quantity) || 1); });
  let sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, e) => s + e[1], 0);

  const ctx = document.getElementById('typeChart');
  const card = ctx.closest('.chart-card');
  // Always create mobile container
  let mobileEl = card.querySelector('.m-chart-mobile');
  if (!mobileEl) { mobileEl = document.createElement('div'); mobileEl.className = 'm-chart-mobile'; card.appendChild(mobileEl); }

  // Always populate mobile chart (CSS controls visibility)
  let mobileSorted = [...sorted];
  if (mobileSorted.length > 8) {
    const top = mobileSorted.slice(0, 7);
    const rest = mobileSorted.slice(7);
    const otherTotal = rest.reduce((s, e) => s + e[1], 0);
    if (otherTotal > 0) top.push(['Other', otherTotal]);
    mobileSorted = top;
  }
  renderMobileSegmentBar(mobileSorted, total, TYPE_COLORS, mobileEl);

  if (mobile) return; // CSS hides chart-wrap, shows m-chart-mobile

  // Desktop: use Chart.js
  const chartWrap = ctx.closest('.chart-wrap');
  if (chartWrap) { chartWrap.style.removeProperty('height'); chartWrap.style.removeProperty('min-height'); }

  if (typeChartInstance) typeChartInstance.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  typeChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        data: sorted.map(s => s[1]),
        backgroundColor: sorted.map(s => TYPE_COLORS[s[0]] || '#999'),
        borderWidth: 2,
        borderColor: isDark ? '#1A1A1E' : '#FFFFFF',
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 12, usePointStyle: true, pointStyleWidth: 10,
            color: isDark ? '#A8A4A0' : '#6B6560',
            font: { family: 'DM Sans', size: 11 }
          }
        },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} bottle${ctx.parsed !== 1 ? 's' : ''}` } }
      }
    }
  });
}

function renderRegionChart() {
  const mobile = isMobileView();
  const regions = {};
  cellar.filter(w => w.status !== 'consumed').forEach(w => { const r = (w.region || 'Unknown').split(',')[0].trim(); regions[r] = (regions[r] || 0) + (parseInt(w.quantity) || 1); });
  const maxRegions = mobile ? 8 : 10;
  const sorted = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, maxRegions);
  const total = sorted.reduce((s, e) => s + e[1], 0);

  const ctx = document.getElementById('regionChart');
  const card = ctx.closest('.chart-card');
  // Always create and populate mobile container
  let mobileEl = card.querySelector('.m-chart-mobile');
  if (!mobileEl) { mobileEl = document.createElement('div'); mobileEl.className = 'm-chart-mobile'; card.appendChild(mobileEl); }
  const regionColors = {};
  sorted.forEach(([label], i) => { regionColors[label] = BAR_PALETTE[i % BAR_PALETTE.length]; });
  renderMobileBarList(sorted, total, regionColors, mobileEl);

  if (mobile) return; // CSS hides chart-wrap, shows m-chart-mobile

  // Desktop: Chart.js
  const chartWrap = ctx.closest('.chart-wrap');
  if (chartWrap) { chartWrap.style.removeProperty('height'); chartWrap.style.removeProperty('min-height'); }

  if (regionChartInstance) regionChartInstance.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const barH = 32;
  const h = Math.max(160, sorted.length * barH + 60);
  if (chartWrap) { chartWrap.style.setProperty('height', h + 'px', 'important'); chartWrap.style.setProperty('min-height', h + 'px', 'important'); }

  regionChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        data: sorted.map(s => s[1]),
        backgroundColor: sorted.map((_, i) => BAR_PALETTE[i % BAR_PALETTE.length] + (isDark ? 'CC' : 'BB')),
        borderRadius: 4, barThickness: 22,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} bottle${ctx.parsed.x !== 1 ? 's' : ''}` } } },
      scales: {
        x: { grid: { color: isDark ? '#2A2A30' : '#E8E4DE' }, ticks: { color: isDark ? '#9B9590' : '#6B6560', font: { family: 'DM Sans', size: 11 }, stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: isDark ? '#A8A4A0' : '#6B6560', font: { family: 'DM Sans', size: 11 } } }
      }
    }
  });
}

let categoryChartInstance = null;
function renderCategoryChart() {
  const mobile = isMobileView();
  const cats = { Wine: 0, Whiskey: 0, Tequila: 0, Sake: 0, Spirit: 0 };
  cellar.filter(w => w.status !== 'consumed').forEach(w => {
    const qty = parseInt(w.quantity) || 1;
    if (isWhiskey(w.type)) cats.Whiskey += qty;
    else if (isTequila(w.type)) cats.Tequila += qty;
    else if (isSake(w.type)) cats.Sake += qty;
    else if (SPIRIT_TYPES.includes(w.type)) cats.Spirit += qty;
    else cats.Wine += qty;
  });
  Object.keys(cats).forEach(k => { if (cats[k] === 0) delete cats[k]; });
  const catKeys = Object.keys(cats);
  const catEntries = catKeys.map(k => [k, cats[k]]);
  const total = catEntries.reduce((s, e) => s + e[1], 0);

  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  const card = ctx.closest('.chart-card');
  // Always create and populate mobile container
  let mobileEl = card.querySelector('.m-chart-mobile');
  if (!mobileEl) { mobileEl = document.createElement('div'); mobileEl.className = 'm-chart-mobile'; card.appendChild(mobileEl); }
  renderMobileSegmentBar(catEntries, total, CAT_COLORS, mobileEl);

  if (mobile) return; // CSS hides chart-wrap, shows m-chart-mobile

  // Desktop: Chart.js
  const chartWrap = ctx.closest('.chart-wrap');
  if (chartWrap) { chartWrap.style.removeProperty('height'); chartWrap.style.removeProperty('min-height'); }

  if (categoryChartInstance) categoryChartInstance.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: catKeys,
      datasets: [{
        data: Object.values(cats),
        backgroundColor: catKeys.map(k => CAT_COLORS[k]),
        borderWidth: 2,
        borderColor: isDark ? '#1A1A1E' : '#FFFFFF',
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 14, usePointStyle: true, pointStyleWidth: 10,
            color: isDark ? '#A8A4A0' : '#6B6560',
            font: { family: 'DM Sans', size: 12 }
          }
        },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} bottle${ctx.parsed !== 1 ? 's' : ''}` } }
      }
    }
  });
}

// ============ CELLAR ============

function renderCellar() {
  let wines = [...cellar];
  const search = (document.getElementById('cellarSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('cellarSort')?.value || 'added';

  // Filter by status (active / consumed / all)
  if (cellarStatusFilter === 'active') wines = wines.filter(w => w.status !== 'consumed');
  else if (cellarStatusFilter === 'consumed') wines = wines.filter(w => w.status === 'consumed');

  if (activeFilters.size > 0) wines = wines.filter(w => activeFilters.has(w.type));
  if (showFavoritesOnly) wines = wines.filter(w => w.isFavorite);
  if (search) {
    wines = wines.filter(w =>
      (w.name || '').toLowerCase().includes(search) || (w.producer || '').toLowerCase().includes(search) ||
      (w.grape || '').toLowerCase().includes(search) || (w.region || '').toLowerCase().includes(search) ||
      ('' + w.vintage).includes(search) || (w.type || '').toLowerCase().includes(search)
    );
  }

  switch (sort) {
    case 'name': wines.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'vintage': wines.sort((a, b) => (b.vintage || 0) - (a.vintage || 0)); break;
    case 'rating': wines.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    case 'value': wines.sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0)); break;
    default:
      if (cellarStatusFilter === 'consumed') {
        wines.sort((a, b) => (b.consumedDate || '').localeCompare(a.consumedDate || ''));
      } else {
        wines.sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
      }
  }

  const totalQty = wines.reduce((s, w) => s + Math.max(parseInt(w.quantity) || 0, w.status === 'consumed' ? 1 : 1), 0);
  const label = cellarStatusFilter === 'consumed' ? 'consumed' : 'bottle';
  document.getElementById('cellarCount').textContent = wines.length + ' ' + label + (wines.length !== 1 ? 's' : '');
  const grid = document.getElementById('cellarGrid');

  if (wines.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 6v12a2 2 0 002 2h14a2 2 0 002-2V6M3 6l3-3h12l3 3M10 11h4"/></svg><h3>No bottles found</h3><p>Try adjusting your filters or add some bottles</p></div>`;
    return;
  }

  grid.innerHTML = wines.map(w => {
    const status = getDrinkStatus(w);
    const ratingStars = w.rating ? '★'.repeat(w.rating) + '☆'.repeat(5 - w.rating) : '';
    const currSym = '$';
    const marketVal = w.marketValue ? currSym + w.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '';
    const typeClass = w.type.replace(/\s/g, '');
    const isSW = isSpiritOrWhiskey(w.type);
    const subtitle = isSW
      ? `${escHTML(w.producer || '')}${w.age ? ' · ' + w.age + ' Year' : ''}${w.designation ? ' · ' + escHTML(w.designation) : ''}`
      : `${escHTML(w.producer || '')} ${w.vintage ? '· ' + w.vintage : ''}`;
    const detailChips = isSW
      ? `<span class="wine-detail-chip">${escHTML(w.type)}</span>${w.abv ? `<span class="wine-detail-chip">${w.abv}% ABV</span>` : ''}${w.size && w.size !== '750ml' ? `<span class="wine-detail-chip">${w.size}</span>` : ''}${w.region ? `<span class="wine-detail-chip">${escHTML(w.region.split(',')[0])}</span>` : ''}`
      : `<span class="wine-detail-chip">${escHTML(w.type)}</span>${w.grape ? `<span class="wine-detail-chip">${escHTML(w.grape)}</span>` : ''}${w.region ? `<span class="wine-detail-chip">${escHTML(w.region.split(',')[0])}</span>` : ''}`;

    const isConsumed = w.status === 'consumed';

    // Critic score badge (top left): show community/critic score if available
    const ratingBadge = w.communityScore ? `<span class="card-badge-rating">${Math.round(w.communityScore)}<span class="card-badge-rating-max">/100</span></span>` : '';
    // Location badge
    const locBadge = w.location ? `<span class="card-badge-location"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${escHTML(w.location)}</span>` : '';

    return `
      <div class="wine-card${isConsumed ? ' consumed' : ''}" onclick="openWineModal('${w.id}')">
        ${ratingBadge}
        <button class="favorite-star${w.isFavorite ? ' active' : ''}" onclick="toggleFavorite('${w.id}', event)" title="${w.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">${w.isFavorite ? '&#9733;' : '&#9734;'}</button>
        ${locBadge}
        ${isConsumed ? `<span class="wine-qty consumed-badge">Consumed</span>` : w.quantity > 1 ? `<span class="wine-qty">${w.quantity} bottles</span>` : ''}
        <div class="wine-card-top">
          <div class="wine-color-bar type-${typeClass}"></div>
          <div>
            <div class="wine-card-title">${escHTML(w.name)}</div>
            <div class="wine-card-subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="wine-card-details">
          ${detailChips}
          ${isConsumed
            ? `<span class="wine-status status-consumed" style="font-size:0.72rem;padding:0.15rem 0.45rem">Opened ${formatDate(w.consumedDate)}</span>`
            : `<span class="wine-status status-${status.class}" style="font-size:0.72rem;padding:0.15rem 0.45rem">${status.label}</span>`}
        </div>
        <div class="wine-card-footer">
          <span class="wine-price">${marketVal ? marketVal + ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400">est. value</span>' : ''}</span>
          ${ratingStars ? `<span class="wine-rating-sm">${ratingStars}</span>` : '<span style="font-size:0.8rem;color:var(--text-muted)">Not rated</span>'}
        </div>
      </div>`;
  }).join('');
}

const CATEGORY_TYPES = {
  wine: ['Red','White','Rosé','Sparkling','Champagne','Dessert','Fortified'],
  whiskey: ['Scotch','Bourbon','Irish','Japanese','Rye','Single Malt','Blended','Tennessee'],
  tequila: ['Tequila','Mezcal'],
  sake: ['Junmai','Ginjo','Daiginjo','Nigori','Sparkling Sake','Sake'],
  spirit: ['Rum','Cognac','Brandy','Gin','Vodka','Other Spirit'],
};

function toggleTypeFilter(type) {
  if (activeFilters.has(type)) activeFilters.delete(type);
  else activeFilters.add(type);
  updateFilterCheckboxes();
  updateFilterButtonText();
  renderCellar();
}

function toggleCategoryFilter(category) {
  const types = CATEGORY_TYPES[category] || [];
  const allSelected = types.every(t => activeFilters.has(t));
  if (allSelected) {
    // Deselect all types in this category
    types.forEach(t => activeFilters.delete(t));
  } else {
    // Select all types in this category
    types.forEach(t => activeFilters.add(t));
  }
  updateFilterCheckboxes();
  updateFilterButtonText();
  renderCellar();
}

function clearTypeFilters() {
  activeFilters.clear();
  updateFilterCheckboxes();
  updateFilterButtonText();
  renderCellar();
}

function updateFilterCheckboxes() {
  document.querySelectorAll('#filterPanel .filter-check-item input').forEach(cb => {
    const label = cb.parentElement.textContent.trim();
    // Match checkbox to type by finding the onchange attribute
    const match = cb.getAttribute('onchange')?.match(/toggleTypeFilter\('(.+?)'\)/);
    if (match) cb.checked = activeFilters.has(match[1]);
  });
}

function updateFilterButtonText() {
  const btn = document.getElementById('filterBtnText');
  if (activeFilters.size === 0) { btn.textContent = 'All Types'; return; }

  // Check if entire categories are selected — show category name instead of individual types
  const catNames = {wine:'Wine',whiskey:'Whiskey',tequila:'Tequila',sake:'Sake',spirit:'Spirits'};
  const selectedCats = [];
  const remaining = new Set(activeFilters);
  for (const [cat, types] of Object.entries(CATEGORY_TYPES)) {
    if (types.every(t => remaining.has(t))) {
      selectedCats.push(catNames[cat]);
      types.forEach(t => remaining.delete(t));
    }
  }
  const parts = [...selectedCats, ...remaining];
  if (parts.length <= 2) btn.textContent = parts.join(', ');
  else btn.textContent = parts.length + ' filters selected';
}

function toggleFilterDropdown() {
  const panel = document.getElementById('filterPanel');
  panel.classList.toggle('open');
}

// Close filter dropdown on click outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('filterDropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    document.getElementById('filterPanel')?.classList.remove('open');
  }
});
function setCellarStatusFilter(status, btn) {
  cellarStatusFilter = status;
  document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCellar();
}
function filterCellar() { renderCellar(); }

function toggleFavorite(id, event) {
  event.stopPropagation();
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  w.isFavorite = !w.isFavorite;
  saveCellar(cellar);
  renderCellar();
}

function toggleFavoriteFromModal(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  w.isFavorite = !w.isFavorite;
  saveCellar(cellar);
  renderCellar();
  openWineModal(id);
}

function toggleFavoritesFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  document.getElementById('filterFavBtn')?.classList.toggle('active', showFavoritesOnly);
  renderCellar();
}

// ============ ADD BOTTLE ============

function addBottle(event) {
  event.preventDefault();
  const type = document.getElementById('wineType').value;
  const isSW = isSpiritOrWhiskey(type);

  const bottle = {
    id: editingBottleId || Date.now().toString(),
    name: document.getElementById('wineName').value.trim(),
    producer: document.getElementById('wineProducer').value.trim(),
    vintage: parseInt(document.getElementById('wineVintage').value) || null,
    type,
    grape: document.getElementById('wineGrape').value.trim(),
    varietal: document.getElementById('wineGrape').value.trim(),
    region: document.getElementById('wineRegion').value.trim(),
    quantity: parseInt(document.getElementById('wineQuantity').value) || 1,
    price: parseFloat(document.getElementById('winePrice').value) || null,
    location: document.getElementById('wineLocation').value.trim(),
    drinkFrom: isSW ? null : (parseInt(document.getElementById('wineDrinkFrom').value) || null),
    drinkUntil: isSW ? null : (parseInt(document.getElementById('wineDrinkUntil').value) || null),
    notes: document.getElementById('wineNotes').value.trim(),
    addedDate: new Date().toISOString().split('T')[0],
    rating: null,
    communityScore: pendingScanRating || null,
    category: isWhiskey(type) ? 'whiskey' : isTequila(type) ? 'tequila' : isSake(type) ? 'sake' : SPIRIT_TYPES.includes(type) ? 'spirit' : 'wine',
    age: isSW ? (parseInt(document.getElementById('whiskeyAge').value) || null) : null,
    abv: isSW ? (parseFloat(document.getElementById('whiskeyAbv').value) || null) : null,
    currency: 'USD',
    size: '750ml',
    imageUrl: pendingBottleImage || null,
    status: 'active',
    consumptionHistory: [],
  };

  if (editingBottleId) {
    // Editing: preserve fields not in the form
    const existing = cellar.find(b => b.id === editingBottleId);
    if (existing) {
      bottle.addedDate = existing.addedDate;
      bottle.rating = existing.rating;
      bottle.status = existing.status || 'active';
      bottle.consumptionHistory = existing.consumptionHistory || [];
      bottle.consumedDate = existing.consumedDate;
      bottle.ctId = existing.ctId;
      bottle.communityScore = bottle.communityScore || existing.communityScore;
      bottle.communityNotes = existing.communityNotes;
      bottle.personalScore = existing.personalScore;
      bottle.masterVarietal = existing.masterVarietal;
      bottle.designation = bottle.designation || existing.designation;
      bottle.appellation = bottle.appellation || existing.appellation;
      bottle.vineyard = existing.vineyard;
      bottle.pending = existing.pending;
      bottle.country = existing.country;
      bottle.subRegion = existing.subRegion;
      if (!bottle.imageUrl) bottle.imageUrl = existing.imageUrl;
      // Preserve CSV market value if it existed — only re-estimate if price changed
      if (existing.marketValue && existing.marketValue > 0) {
        const priceChanged = (bottle.price || null) !== (existing.price || null);
        bottle.marketValue = priceChanged ? estimateMarketValue(bottle) : existing.marketValue;
      } else {
        bottle.marketValue = estimateMarketValue(bottle);
      }

      // Build edit history entry — track what changed
      const changes = [];
      const trackFields = ['name','producer','type','vintage','region','grape','price','quantity','notes','age','abv','distillery'];
      for (const f of trackFields) {
        const oldVal = (existing[f] ?? '').toString();
        const newVal = (bottle[f] ?? '').toString();
        if (oldVal !== newVal) changes.push({ field: f, from: oldVal || '(empty)', to: newVal || '(empty)' });
      }
      if (changes.length > 0) {
        bottle.editHistory = [...(existing.editHistory || []), { date: new Date().toISOString(), changes }];
      } else {
        bottle.editHistory = existing.editHistory || [];
      }
    }
    cellar = cellar.map(b => b.id === editingBottleId ? bottle : b);
    showToast(`${bottle.name} updated`);
    editingBottleId = null;
    updateAddViewTitle(false);
  } else {
    bottle.marketValue = estimateMarketValue(bottle);
    cellar.push(bottle);
    showToast(`${bottle.name} added to your collection`);
  }

  saveCellar(cellar);
  document.getElementById('addWineForm').reset();
  document.getElementById('wineQuantity').value = 1;
  pendingBottleImage = null;
  pendingScanRating = null;
  removeBottleImage();
  switchView('cellar');
}

function editBottle(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  closeWineModal();
  editingBottleId = id;

  // Switch to add view
  switchView('add');

  // Set category
  const cat = w.category || (isWhiskey(w.type) ? 'whiskey' : isTequila(w.type) ? 'tequila' : SPIRIT_TYPES.includes(w.type) ? 'spirit' : 'wine');
  const catBtn = document.querySelector(`[data-cat="${cat}"]`);
  if (catBtn) setAddCategory(cat, catBtn);

  // Populate form fields
  document.getElementById('wineName').value = w.name || '';
  document.getElementById('wineProducer').value = w.producer || '';
  document.getElementById('wineVintage').value = w.vintage || '';
  document.getElementById('wineType').value = w.type || 'Red';
  document.getElementById('wineGrape').value = w.grape || w.varietal || '';
  document.getElementById('wineRegion').value = w.region || '';
  document.getElementById('wineQuantity').value = w.quantity || 1;
  document.getElementById('winePrice').value = w.price || '';
  document.getElementById('wineLocation').value = w.location || '';
  document.getElementById('wineDrinkFrom').value = w.drinkFrom || '';
  document.getElementById('wineDrinkUntil').value = w.drinkUntil || '';
  document.getElementById('wineNotes').value = w.notes || '';
  if (w.age) document.getElementById('whiskeyAge').value = w.age;
  if (w.abv) document.getElementById('whiskeyAbv').value = w.abv;

  // Show existing bottle image
  if (w.imageUrl) {
    const displayUrl = w.imageUrl.startsWith('data:') || w.imageUrl.startsWith('/') ? w.imageUrl : `/api/images/proxy?url=${encodeURIComponent(w.imageUrl)}`;
    setBottleImagePreview(displayUrl, w.imageUrl);
  } else {
    removeBottleImage();
  }

  updateAddViewTitle(true);
  document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateAddViewTitle(editing) {
  const header = document.querySelector('#view-add .view-header h1');
  const subtitle = document.querySelector('#view-add .view-header .subtitle');
  const submitBtn = document.querySelector('#addWineForm .btn-primary');
  if (editing) {
    header.textContent = 'Edit Bottle';
    subtitle.textContent = 'Update the details below';
    submitBtn.textContent = 'Save Changes';
  } else {
    header.textContent = 'Add Bottle';
    subtitle.textContent = 'Scan a label, take a photo, or enter details manually';
    submitBtn.textContent = 'Add to Collection';
  }
}

// ============ TASTING NOTES ============

function renderTastingWines() {
  const search = (document.getElementById('tastingSearch')?.value || '').toLowerCase();
  let wines = [...cellar];
  if (search) wines = wines.filter(w => (w.name || '').toLowerCase().includes(search) || (w.producer || '').toLowerCase().includes(search));
  const list = document.getElementById('tastingWineList');
  if (wines.length === 0) { list.innerHTML = '<div class="empty-state"><p>No bottles in your collection yet</p></div>'; return; }
  list.innerHTML = wines.map(w => {
    const typeClass = w.type.replace(/\s/g, '');
    return `<div class="tasting-wine-item" onclick="selectTastingWine('${w.id}')"><span class="wine-type-dot type-${typeClass}"></span><div><div class="name">${escHTML(w.name)}</div><div class="meta">${w.vintage || 'NV'} · ${escHTML(w.producer || w.type)}</div></div></div>`;
  }).join('');
}
function filterTastingWines() { renderTastingWines(); }

function selectTastingWine(id) {
  selectedTastingWineId = id;
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  document.getElementById('tastingFormCard').style.display = 'block';
  document.getElementById('tastingWineHeader').innerHTML = `<h3>${escHTML(w.name)}</h3><p>${w.vintage || 'NV'} · ${escHTML(w.producer || '')} · ${escHTML(w.region || '')}</p>`;
  currentRating = 0;
  updateStarDisplay();
  document.querySelectorAll('.tag').forEach(t => t.classList.remove('active'));
  document.getElementById('tastingNotes').value = '';
  document.getElementById('tastingDate').value = new Date().toISOString().split('T')[0];
}

function cancelTasting() { document.getElementById('tastingFormCard').style.display = 'none'; selectedTastingWineId = null; }

function setupStarRating() {
  document.querySelectorAll('#starRating .star').forEach(star => {
    star.addEventListener('click', () => { currentRating = parseInt(star.dataset.value); updateStarDisplay(); });
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.value);
      document.querySelectorAll('#starRating .star').forEach(s => s.classList.toggle('active', parseInt(s.dataset.value) <= val));
    });
  });
  document.getElementById('starRating').addEventListener('mouseleave', updateStarDisplay);
}

function updateStarDisplay() {
  document.querySelectorAll('#starRating .star').forEach(s => s.classList.toggle('active', parseInt(s.dataset.value) <= currentRating));
  document.getElementById('ratingDisplay').textContent = currentRating + ' / 5';
}
function toggleTag(btn) { btn.classList.toggle('active'); }

function saveTasting(event) {
  event.preventDefault();
  if (!selectedTastingWineId || !currentRating) { showToast('Please select a rating'); return; }
  const tags = Array.from(document.querySelectorAll('#flavorTags .tag.active')).map(t => t.dataset.tag);
  tastings.unshift({ id: 'tasting_' + Date.now(), wineId: selectedTastingWineId, rating: currentRating, tags, notes: document.getElementById('tastingNotes').value.trim(), date: document.getElementById('tastingDate').value });
  saveTastings(tastings);
  const wineTastings = tastings.filter(t => t.wineId === selectedTastingWineId);
  const avg = Math.round(wineTastings.reduce((s, t) => s + t.rating, 0) / wineTastings.length);
  const w = cellar.find(b => b.id === selectedTastingWineId);
  if (w) { w.rating = avg; saveCellar(cellar); }
  cancelTasting();
  renderPastTastings();
  showToast('Tasting note saved');
}

function renderPastTastings() {
  const list = document.getElementById('pastTastingsList');
  if (tastings.length === 0) { list.innerHTML = '<div class="empty-state"><p>No tasting notes yet.</p></div>'; return; }
  list.innerHTML = tastings.slice(0, 20).map(t => {
    const w = cellar.find(b => b.id === t.wineId);
    if (!w) return '';
    return `<div class="tasting-note-card"><div class="tasting-note-header"><span class="name">${escHTML(w.name)} ${w.vintage || 'NV'}</span><span class="date">${formatDate(t.date)}</span></div><div class="tasting-note-rating">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div>${t.tags.length ? `<div class="tasting-note-tags">${t.tags.map(tag => `<span class="tag active">${tag}</span>`).join('')}</div>` : ''}${t.notes ? `<div class="tasting-note-text">${escHTML(t.notes)}</div>` : ''}</div>`;
  }).join('');
}

// ============ DRINK TIMELINE ============

function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  const now = new Date().getFullYear();
  let wines = cellar.filter(w => w.drinkFrom || w.drinkUntil || isSpiritOrWhiskey(w.type));

  wines.sort((a, b) => {
    const aS = getDrinkStatus(a), bS = getDrinkStatus(b);
    const order = { peak: 0, ready: 1, early: 2, past: 3 };
    if (order[aS.class] !== order[bS.class]) return order[aS.class] - order[bS.class];
    return (a.drinkFrom || 0) - (b.drinkFrom || 0);
  });

  if (wines.length === 0) {
    container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg><h3>No drink windows set</h3><p>Add drink-from/until dates or whiskey bottles</p></div>';
    return;
  }

  const allFrom = wines.map(w => parseInt(w.drinkFrom) || now).filter(Boolean);
  const allUntil = wines.map(w => parseInt(w.drinkUntil) || now + 20).filter(Boolean);
  const minYear = Math.min(...allFrom, now) - 2;
  const maxYear = Math.max(...allUntil, now) + 2;
  const range = maxYear - minYear;

  container.innerHTML = wines.map(w => {
    const status = getDrinkStatus(w);
    const isSW = isSpiritOrWhiskey(w.type);

    if (isSW) {
      return `<div class="timeline-item" onclick="openWineModal('${w.id}')">
        <div class="timeline-status-indicator ready"></div>
        <div class="timeline-info"><div class="name">${escHTML(w.name)}</div><div class="meta">${escHTML(w.type)}${w.age ? ' · ' + w.age + ' Year' : ''}</div></div>
        <div class="timeline-window"><div class="years" style="color:var(--gold)">Anytime</div><div class="label">No drink window</div></div>
      </div>`;
    }

    const from = parseInt(w.drinkFrom) || now;
    const until = parseInt(w.drinkUntil) || now + 10;
    const barLeft = ((from - minYear) / range) * 100;
    const barWidth = ((until - from) / range) * 100;
    const nowPos = ((now - minYear) / range) * 100;
    const barColor = status.class === 'peak' ? 'var(--wine-red)' : status.class === 'ready' ? 'var(--success)' : status.class === 'past' ? 'var(--text-muted)' : 'var(--border)';

    return `<div class="timeline-item" onclick="openWineModal('${w.id}')">
      <div class="timeline-status-indicator ${status.class}"></div>
      <div class="timeline-info"><div class="name">${escHTML(w.name)}</div><div class="meta">${w.vintage || 'NV'} · ${escHTML(w.type)}</div></div>
      <div class="timeline-bar-container"><div class="timeline-bar-bg"><div class="timeline-bar-fill" style="left:${barLeft}%;width:${barWidth}%;background:${barColor}"></div><div class="timeline-bar-now" style="left:${nowPos}%"></div></div></div>
      <div class="timeline-window"><div class="years">${from} – ${until}</div><div class="label">${status.label}</div></div>
    </div>`;
  }).join('');
}

// ============ DETAIL MODAL ============

function openWineModal(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  const status = getDrinkStatus(w);
  const wineTastings = tastings.filter(t => t.wineId === id);
  const marketVal = w.marketValue || estimateMarketValue(w);
  const purchasePrice = w.price ? parseFloat(w.price) : null;
  const appreciation = purchasePrice ? (((marketVal - purchasePrice) / purchasePrice) * 100).toFixed(0) : null;
  const isSW = isSpiritOrWhiskey(w.type);
  const currSym = '$';

  const modalImgSrc = w.imageUrl ? (w.imageUrl.startsWith('data:') || w.imageUrl.startsWith('/') ? w.imageUrl : `/api/images/proxy?url=${encodeURIComponent(w.imageUrl)}`) : '';

  const body = document.getElementById('modalBody');
  body.innerHTML = `
    ${modalImgSrc ? `<img class="modal-bottle-image" src="${modalImgSrc}" alt="${escHTML(w.name)}" onerror="this.style.display='none'">` : ''}
    <h2 class="modal-wine-title"><button class="modal-fav-star${w.isFavorite ? ' active' : ''}" onclick="toggleFavoriteFromModal('${w.id}')">${w.isFavorite ? '&#9733;' : '&#9734;'}</button>${escHTML(w.name)}</h2>
    <p class="modal-wine-subtitle">${escHTML(w.producer || '')} ${w.vintage ? '· ' + w.vintage : ''} · ${escHTML(w.region || '')}${w.age ? ' · ' + w.age + ' Year' : ''}${w.designation ? ' · ' + escHTML(w.designation) : ''}</p>
    <div class="modal-detail-grid">
      <div class="modal-detail-item"><label>Type</label><div class="value"><span class="wine-type-dot type-${w.type.replace(/\s/g, '')}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px"></span>${w.type}</div></div>
      ${isSW ? `<div class="modal-detail-item"><label>ABV</label><div class="value">${w.abv ? w.abv + '%' : '—'}</div></div>` : `<div class="modal-detail-item"><label>Grape</label><div class="value">${escHTML(w.grape || '—')}</div></div>`}
      <div class="modal-detail-item"><label>Quantity</label><div class="value">${w.status === 'consumed' ? '<span style="color:var(--text-muted)">Consumed</span>' : `${w.quantity || 1} bottle${(w.quantity || 1) > 1 ? 's' : ''}`}${w.pending ? ` <span style="font-size:0.75rem;color:var(--warning)">(${w.pending} pending)</span>` : ''}${w.consumedDate ? ` <span style="font-size:0.75rem;color:var(--text-muted)">· Last opened ${formatDate(w.consumedDate)}</span>` : ''}</div></div>
      <div class="modal-detail-item"><label>${w.size ? 'Size' : 'Location'}</label><div class="value">${escHTML(w.size || w.location || '—')}</div></div>
      ${isSW
        ? `<div class="modal-detail-item"><label>Age Statement</label><div class="value">${w.age ? w.age + ' Years' : 'NAS'}</div></div>`
        : `<div class="modal-detail-item"><label>Drink Window</label><div class="value">${w.drinkFrom && w.drinkUntil ? w.drinkFrom + ' – ' + w.drinkUntil : '—'} ${w.drinkFrom || w.drinkUntil ? `<span class="wine-status status-${status.class}" style="margin-left:6px;font-size:0.7rem;padding:0.1rem 0.4rem">${status.label}</span>` : ''}</div></div>`
      }
      <div class="modal-detail-item"><label>Rating</label><div class="value" style="color:var(--gold)">${w.rating ? '★'.repeat(w.rating) + '☆'.repeat(5 - w.rating) : '<span style="color:var(--text-muted)">Not rated</span>'}</div></div>
      <div class="modal-detail-item"><label>Purchase Price</label><div class="value">${purchasePrice ? currSym + purchasePrice.toFixed(0) : '—'}</div></div>
      <div class="modal-detail-item"><label>Est. Market Value</label><div class="value" style="color:var(--success);font-weight:600">${currSym}${marketVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}${appreciation !== null ? ` <span style="font-size:0.75rem;margin-left:4px;color:${parseFloat(appreciation) >= 0 ? 'var(--success)' : 'var(--danger)'}">${parseFloat(appreciation) >= 0 ? '+' : ''}${appreciation}%</span>` : ''}</div></div>
      ${w.appellation && w.appellation !== 'Unknown' ? `<div class="modal-detail-item"><label>Appellation</label><div class="value">${escHTML(w.appellation)}</div></div>` : ''}
      ${w.communityScore ? `<div class="modal-detail-item"><label>Community Score</label><div class="value">${w.communityScore}/100</div></div>` : ''}
    </div>
    ${w.notes ? `<div class="modal-notes">${escHTML(w.notes)}</div>` : ''}
    ${w.consumptionHistory && w.consumptionHistory.length > 0 ? `<h4 style="margin-top:1.5rem;margin-bottom:0.75rem;font-family:'DM Sans',sans-serif;font-weight:600;font-size:0.95rem">Consumption History</h4>${w.consumptionHistory.slice().reverse().map(c => `<div class="consumption-entry"><span class="consumption-date">${formatDate(c.date)}</span>${c.notes ? `<span class="consumption-notes">${escHTML(c.notes)}</span>` : ''}</div>`).join('')}` : ''}
    ${wineTastings.length > 0 ? `<h4 style="margin-top:1.5rem;margin-bottom:0.75rem;font-family:'DM Sans',sans-serif;font-weight:600;font-size:0.95rem">Tasting History</h4>${wineTastings.map(t => `<div class="tasting-note-card"><div class="tasting-note-header"><span class="tasting-note-rating">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</span><span class="date">${formatDate(t.date)}</span></div>${t.tags.length ? `<div class="tasting-note-tags">${t.tags.map(tag => `<span class="tag active">${tag}</span>`).join('')}</div>` : ''}${t.notes ? `<div class="tasting-note-text">${escHTML(t.notes)}</div>` : ''}</div>`).join('')}` : ''}
    ${w.editHistory && w.editHistory.length > 0 ? `<h4 style="margin-top:1.5rem;margin-bottom:0.75rem;font-family:'DM Sans',sans-serif;font-weight:600;font-size:0.95rem">Edit History</h4>${w.editHistory.slice().reverse().map(entry => {
      const d = new Date(entry.date);
      const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `<div class="edit-history-entry" style="padding:0.6rem 0.75rem;margin-bottom:0.5rem;background:var(--bg);border-radius:var(--radius-xs);border:1px solid var(--border);font-size:0.82rem"><div style="color:var(--text-muted);margin-bottom:0.35rem">${dateStr}</div>${entry.changes.map(c => `<div style="line-height:1.5"><span style="font-weight:600;text-transform:capitalize">${c.field}</span>: <span style="color:var(--danger);text-decoration:line-through">${escHTML(c.from)}</span> → <span style="color:var(--success)">${escHTML(c.to)}</span></div>`).join('')}</div>`;
    }).join('')}` : ''}
    <div class="modal-actions">
      <button class="btn btn-primary btn-sm" onclick="editBottle('${w.id}')">Edit</button>
      ${w.status === 'consumed'
        ? `<button class="btn btn-secondary btn-sm" onclick="restockBottle('${w.id}')">Restock</button>`
        : `<button class="btn btn-secondary btn-sm" onclick="drinkBottle('${w.id}')">Open a Bottle</button>`}
      <button class="btn btn-danger btn-sm" onclick="removeWine('${w.id}')">Remove</button>
    </div>`;

  document.getElementById('wineModal').classList.add('open');
}

function closeModal(event) { if (event.target === document.getElementById('wineModal')) closeWineModal(); }
function closeWineModal() { document.getElementById('wineModal').classList.remove('open'); }

function drinkBottle(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;

  const today = new Date().toISOString().split('T')[0];

  // Track consumption
  if (!w.consumptionHistory) w.consumptionHistory = [];
  w.consumptionHistory.push({ date: today, notes: '' });

  // Decrement quantity
  w.quantity = Math.max(0, (parseInt(w.quantity) || 1) - 1);

  if (w.quantity === 0) {
    // Mark as consumed instead of deleting
    w.status = 'consumed';
    w.consumedDate = today;
    closeWineModal();
    showToast(`Last bottle of ${w.name} — cheers! 🥂`);
  } else {
    showToast(`Opened a ${w.name}. ${w.quantity} left.`);
    // Refresh modal to show updated quantity & history
    openWineModal(id);
  }
  saveCellar(cellar); renderCellar(); renderDashboard();
}

function restockBottle(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  w.status = 'active';
  w.quantity = 1;
  w.consumedDate = null;
  saveCellar(cellar);
  showToast(`${w.name} restocked!`);
  openWineModal(id);
  renderCellar(); renderDashboard();
}

function removeWine(id) {
  if (!confirm('Remove this bottle from your collection?')) return;
  const w = cellar.find(b => b.id === id);
  cellar = cellar.filter(b => b.id !== id);
  saveCellar(cellar);
  closeWineModal();
  showToast(`${w ? w.name : 'Bottle'} removed`);
  // Re-render after modal close animation
  setTimeout(() => { renderCellar(); renderDashboard(); }, 50);
}

// ============ CAMERA & SCANNING FLOW ============

let cameraStream = null;
let scanMode = 'idle'; // idle | label

async function openCamera() {
  try {
    const preview = document.getElementById('cameraPreview');
    const video = document.getElementById('cameraVideo');
    preview.style.display = 'block';

    // Safari-compatible camera constraints — try ideal first, fall back to basic
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (e1) {
      console.warn('[Camera] Ideal constraints failed, trying basic:', e1.message);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }
        });
      } catch (e2) {
        console.warn('[Camera] Environment facing failed, trying any camera:', e2.message);
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
    }
    cameraStream = stream;
    video.srcObject = stream;

    // Safari requires explicit play() call and needs to wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(resolve); // resolve even if play fails (muted should help)
      };
      setTimeout(resolve, 3000); // safety timeout
    });

    // Scroll camera preview into view on mobile
    setTimeout(() => {
      preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  } catch (err) {
    console.error('[Camera] Failed to open:', err);
    showToast('Camera not available. Try uploading an image.');
    closeCamera();
  }
}

function closeCamera() {
  const video = document.getElementById('cameraVideo');
  if (cameraStream) {
    try { cameraStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    cameraStream = null;
  }
  if (video && video.srcObject) {
    try { video.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
    video.srcObject = null;
  }
  document.getElementById('cameraPreview').style.display = 'none';
  const statusBar = document.getElementById('scanStatusBar');
  if (statusBar) statusBar.style.display = 'none';
  scanMode = 'idle';
}

function cancelScanFlow() {
  closeCamera();
}

async function startLabelOnly() {
  scanMode = 'label';
  await openCamera();
  setScanStatus('Point at the front label and tap Capture');
}

function setScanStatus(text, isSuccess) {
  const bar = document.getElementById('scanStatusBar');
  const textEl = document.getElementById('scanStatusText');
  bar.style.display = 'block';
  bar.className = 'scan-status-bar' + (isSuccess ? ' success' : '');
  textEl.innerHTML = text;
}


async function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('captureCanvas');

  if (!video.srcObject || !video.videoWidth || video.readyState < 2) {
    console.log('[Capture] Video not ready — opening camera');
    await openCamera();
    await new Promise(resolve => {
      let checks = 0;
      const check = setInterval(() => {
        checks++;
        if ((video.videoWidth > 0 && video.readyState >= 2) || checks > 20) {
          clearInterval(check);
          resolve();
        }
      }, 150);
    });
  }

  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  closeCamera();
  // Resize before sending to API to reduce token cost
  resizeImageForVision(dataUrl, 1024).then(resized => processLabelImage(resized));
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    // Resize image before sending to API to reduce token cost / avoid quota errors
    resizeImageForVision(e.target.result, 1024).then(resized => processLabelImage(resized));
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// Resize image to max dimension to save API tokens (GPT-4o vision)
function resizeImageForVision(dataUrl, maxDim = 1024) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return; }
      const scale = Math.min(maxDim / w, maxDim / h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original
    img.src = dataUrl;
  });
}

// Legacy aliases
function startCamera() { openCamera(); }
function stopCamera() { closeCamera(); }

// ---- Label Recognition via GPT-4o Vision ----

async function processLabelImage(dataUrl) {
  showProcessing();
  document.getElementById('scannedImage').src = dataUrl;

  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) {
    hideProcessing();
    showToast('Add your OpenAI API key in Settings first.');
    return;
  }

  try {
    const el = document.querySelector('.scan-processing p');
    if (el) el.textContent = 'Sending to AI for analysis...';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Analyze this bottle label image. Extract all visible information AND use your knowledge of this specific product to fill in details not shown on the label. Return ONLY valid JSON:
{
  "name": "full product name",
  "producer": "producer/brand/distillery/winery/brewery",
  "vintage": year as number or null,
  "type": one of "Red","White","Rosé","Sparkling","Champagne","Dessert","Fortified","Scotch","Bourbon","Irish","Japanese","Rye","Single Malt","Blended","Tennessee","Tequila","Mezcal","Junmai","Ginjo","Daiginjo","Nigori","Sparkling Sake","Sake","Rum","Cognac","Brandy","Gin","Vodka","Other Spirit",
  "category": "wine" or "whiskey" or "tequila" or "sake" or "spirit",
  "grape": "grape varietal, or rice type for sake (e.g. Yamada Nishiki), or grain/base ingredient for spirits" or null,
  "region": "region, country",
  "age": age statement as number or null,
  "abv": ABV percentage as number or null,
  "designation": "special designation/edition" or null,
  "size": "bottle size" or "750ml",
  "price": estimated retail price in USD as number or null,
  "criticScore": estimated critic/community score out of 100 (based on known reviews, reputation — e.g. Wine Spectator, CellarTracker, Vivino) as number or null,
  "drinkFrom": earliest recommended drinking year or null,
  "drinkUntil": latest recommended drinking year or null,
  "notes": "brief tasting profile/description (2-3 sentences from your knowledge)" or null
}
Use your knowledge to estimate price, critic score, drinking window, grape/rice variety, tasting notes, and any other fields not visible on the label.` },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }
          ]
        }],
        max_tokens: 700,
        temperature: 0.1,
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const extracted = JSON.parse(jsonMatch[0]);

    // Fill in drink window if GPT-4o didn't provide one (wines only)
    if (extracted.category === 'wine' && extracted.vintage && !extracted.drinkFrom) {
      extracted.drinkFrom = extracted.vintage + 2;
      extracted.drinkUntil = extracted.vintage + (extracted.type === 'Red' ? 15 : extracted.type === 'White' ? 5 : 10);
    }
    if (extracted.category !== 'wine') {
      extracted.drinkFrom = null;
      extracted.drinkUntil = null;
    }

    hideProcessing();
    showScanResults(extracted);
    populateFormFromScan(extracted);

    // Auto-set label photo as bottle image if no image chosen yet
    if (!pendingBottleImage && dataUrl) {
      // Resize label photo for bottle image (max 400px wide)
      const img = new Image();
      img.onload = () => {
        const maxW = 400;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL('image/jpeg', 0.8);
        setBottleImagePreview(resized, resized);
      };
      img.src = dataUrl;
    }

    showToast(extracted.name ? `Recognized: ${extracted.name}` : 'Analysis complete — review fields.');
  } catch (err) {
    hideProcessing();
    showToast('Vision API error: ' + (err.message || 'Unknown error'));
    console.error('Vision API error:', err);
  }
}

function showProcessing() {
  document.getElementById('scanProcessing').style.display = 'flex';
  const p = document.querySelector('.scan-processing p');
  if (p) p.textContent = 'Analyzing label...';
  document.getElementById('scanPreview').style.display = 'none';
}
function hideProcessing() { document.getElementById('scanProcessing').style.display = 'none'; }

function showScanResults(extracted) {
  const preview = document.getElementById('scanPreview');
  const result = document.getElementById('scanResult');
  preview.style.display = 'flex';
  const fields = [];
  if (extracted.name) fields.push('Name');
  if (extracted.producer) fields.push('Producer');
  if (extracted.vintage) fields.push('Vintage');
  if (extracted.type) fields.push('Type');
  if (extracted.grape) fields.push('Grape');
  if (extracted.region) fields.push('Region');
  if (extracted.age) fields.push('Age');
  if (extracted.abv) fields.push('ABV');
  result.innerHTML = `<h4>Label Recognized</h4><p><strong>${escHTML(extracted.name || 'Unknown')}</strong> — ${extracted.vintage || 'NV'}</p><div class="extracted-fields">${fields.map(f => `<span class="extracted-field">${f} detected</span>`).join('')}</div><p style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted)">Fields auto-filled below. Review before saving.</p>`;
}

function populateFormFromScan(data) {
  // Auto-switch category
  const cat = data.category || 'wine';
  const validCats = ['wine', 'whiskey', 'tequila', 'sake', 'spirit'];
  const effectiveCat = validCats.includes(cat) ? cat : 'wine';
  const btn = document.querySelector(`[data-cat="${effectiveCat}"]`);
  if (btn) setAddCategory(effectiveCat, btn);

  if (data.name) document.getElementById('wineName').value = data.name;
  if (data.producer) document.getElementById('wineProducer').value = data.producer;
  if (data.vintage) document.getElementById('wineVintage').value = data.vintage;
  if (data.type) document.getElementById('wineType').value = data.type;
  if (data.grape) document.getElementById('wineGrape').value = data.grape;
  if (data.region) document.getElementById('wineRegion').value = data.region;
  if (data.price) document.getElementById('winePrice').value = data.price;
  if (data.drinkFrom) document.getElementById('wineDrinkFrom').value = data.drinkFrom;
  if (data.drinkUntil) document.getElementById('wineDrinkUntil').value = data.drinkUntil;
  if (data.age) document.getElementById('whiskeyAge').value = data.age;
  if (data.abv) document.getElementById('whiskeyAbv').value = data.abv;
  if (data.notes) document.getElementById('wineNotes').value = data.notes;
  // Store AI-estimated critic score (out of 100)
  pendingScanRating = data.criticScore ? Math.min(100, Math.max(1, Math.round(data.criticScore))) : null;

  document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ UTILITIES ============

function escHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============ RESTAURANT FINDS ============

let findsLocationFilter = ''; // '' = all, or 'City, CC' string
let findsCategoryFilter = ''; // '' = all, or 'wine'/'whiskey'/'tequila'/'sake'/'spirit'

function getFindsLocationLabel(f) {
  // Build display: "City, CC" format
  if (f.locationCity && f.locationCountry) return `${f.locationCity}, ${f.locationCountry}`;
  if (f.locationCity) return f.locationCity;
  if (f.locationCountry) return f.locationCountry;
  // Fallback: try to extract from old locationName
  if (f.locationName) return f.locationName;
  return '';
}

function renderFindsLocationFilter() {
  const container = document.getElementById('findsLocationFilter');
  if (!container) return;
  // Collect unique locations
  const locs = new Set();
  restaurantFinds.forEach(f => {
    const loc = getFindsLocationLabel(f);
    if (loc) locs.add(loc);
  });
  if (locs.size === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  const sorted = [...locs].sort();
  container.innerHTML = `<button class="finds-loc-btn${!findsLocationFilter ? ' active' : ''}" onclick="setFindsLocationFilter('')">All</button>` +
    sorted.map(loc => `<button class="finds-loc-btn${findsLocationFilter === loc ? ' active' : ''}" onclick="setFindsLocationFilter('${escHTML(loc)}')">${escHTML(loc)}</button>`).join('');
}

function setFindsLocationFilter(loc) {
  findsLocationFilter = loc;
  renderFinds();
}

function setFindsCategoryFilter(cat) {
  findsCategoryFilter = cat;
  renderFinds();
}

function getFindCategory(f) {
  const t = f.type || '';
  if (isWhiskey(t)) return 'whiskey';
  if (isTequila(t)) return 'tequila';
  if (isSake(t)) return 'sake';
  if (SPIRIT_TYPES.includes(t)) return 'spirit';
  return 'wine';
}

function renderFindsCategoryFilter() {
  const container = document.getElementById('findsCategoryFilter');
  if (!container) return;
  const cats = {};
  restaurantFinds.forEach(f => {
    const c = getFindCategory(f);
    cats[c] = (cats[c] || 0) + 1;
  });
  const catOrder = ['wine','whiskey','tequila','sake','spirit'];
  const catLabels = {wine:'Wine',whiskey:'Whiskey',tequila:'Tequila',sake:'Sake',spirit:'Spirit'};
  const activeCats = catOrder.filter(c => cats[c]);
  if (activeCats.length <= 1) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = `<button class="finds-loc-btn${!findsCategoryFilter?' active':''}" onclick="setFindsCategoryFilter('')">All</button>` +
    activeCats.map(c => `<button class="finds-loc-btn${findsCategoryFilter===c?' active':''}" onclick="setFindsCategoryFilter('${c}')">${catLabels[c]} (${cats[c]})</button>`).join('');
}

function renderFinds() {
  const search = (document.getElementById('findsSearch')?.value || '').toLowerCase();
  let finds = [...restaurantFinds];
  if (search) {
    finds = finds.filter(f =>
      (f.name || '').toLowerCase().includes(search) ||
      (f.producer || '').toLowerCase().includes(search) ||
      (f.region || '').toLowerCase().includes(search) ||
      (f.locationName || '').toLowerCase().includes(search) ||
      (f.locationCity || '').toLowerCase().includes(search) ||
      (f.locationCountry || '').toLowerCase().includes(search) ||
      (f.type || '').toLowerCase().includes(search)
    );
  }
  // Filter by category
  if (findsCategoryFilter) {
    finds = finds.filter(f => getFindCategory(f) === findsCategoryFilter);
  }
  // Filter by location
  if (findsLocationFilter) {
    finds = finds.filter(f => getFindsLocationLabel(f) === findsLocationFilter);
  }
  finds.sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
  const countEl = document.getElementById('findsCount');
  if (countEl) countEl.textContent = finds.length + ' find' + (finds.length !== 1 ? 's' : '');

  // Render filter pills
  renderFindsCategoryFilter();
  renderFindsLocationFilter();

  const grid = document.getElementById('findsGrid');
  if (!grid) return;

  if (finds.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem 1rem">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:1rem;opacity:0.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <h3 style="margin-bottom:0.25rem">No finds yet</h3>
      <p style="color:var(--text-muted);font-size:0.85rem">Scan a label at a restaurant to remember it</p>
    </div>`;
    return;
  }

  grid.innerHTML = finds.map(f => {
    const locLabel = getFindsLocationLabel(f);
    const scoreChip = f.communityScore ? `<span class="wine-detail-chip find-rating-chip">${Math.round(f.communityScore)}/100</span>` : '';
    return `
      <div class="find-card find-card-compact" onclick="openFindModal('${f.id}')">
        <div class="find-card-body">
          <div class="find-card-title">${escHTML(f.name || 'Unknown')}</div>
          <div class="find-card-subtitle">${escHTML(f.producer || '')}</div>
          <div class="find-card-details">
            <span class="wine-detail-chip">${escHTML(f.type || 'Wine')}</span>
            ${f.vintage ? `<span class="wine-detail-chip">${f.vintage}</span>` : ''}
            ${scoreChip}
          </div>
          <div class="find-card-footer">
            ${locLabel ? `<span class="find-location"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escHTML(locLabel)}</span>` : ''}
            <span class="find-date">${formatDate(f.addedDate)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openFindModal(id) {
  const f = restaurantFinds.find(x => x.id === id);
  if (!f) return;
  const imgSrc = f.imageUrl ? (f.imageUrl.startsWith('data:') || f.imageUrl.startsWith('/') ? f.imageUrl : `/api/images/proxy?url=${encodeURIComponent(f.imageUrl)}`) : '';
  let mapLink = '';
  if (f.latitude && f.longitude) {
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    const mapUrl = isApple
      ? `https://maps.apple.com/?ll=${f.latitude},${f.longitude}&q=${encodeURIComponent(f.locationName || 'Restaurant Find')}`
      : `https://www.google.com/maps?q=${f.latitude},${f.longitude}`;
    mapLink = `<a href="${mapUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="margin-top:0.5rem;display:inline-flex;align-items:center;gap:0.25rem;font-size:0.72rem;padding:0.25rem 0.6rem;float:right">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Maps</a>`;
  }
  const body = document.getElementById('modalBody');
  body.innerHTML = `
    ${imgSrc ? `<img class="modal-bottle-image" src="${imgSrc}" alt="${escHTML(f.name)}" onerror="this.style.display='none'">` : ''}
    <h2 class="modal-wine-title">${escHTML(f.name || 'Unknown')}</h2>
    <p class="modal-wine-subtitle">${escHTML(f.producer || '')} ${f.vintage ? '· ' + f.vintage : ''} ${f.region ? '· ' + escHTML(f.region) : ''}</p>
    <div class="modal-detail-grid">
      <div class="modal-detail-item"><label>Type</label><div class="value">${escHTML(f.type || '—')}</div></div>
      <div class="modal-detail-item"><label>Category</label><div class="value">${escHTML((f.category || '—').charAt(0).toUpperCase() + (f.category || '—').slice(1))}</div></div>
      ${f.grape ? `<div class="modal-detail-item"><label>Grape / Varietal</label><div class="value">${escHTML(f.grape)}</div></div>` : ''}
      ${f.region ? `<div class="modal-detail-item"><label>Region</label><div class="value">${escHTML(f.region)}</div></div>` : ''}
      ${f.locationName || f.locationCity ? `<div class="modal-detail-item"><label>Found At</label><div class="value">${escHTML(f.locationName || '')}${f.locationCity ? ` <span style="color:var(--text-muted);font-size:0.82rem">${escHTML(f.locationCity)}${f.locationCountry ? ', ' + escHTML(f.locationCountry) : ''}</span>` : ''}${mapLink}</div></div>` : ''}
      <div class="modal-detail-item"><label>Date Found</label><div class="value">${formatDate(f.addedDate)}</div></div>
    </div>
    ${f.notes ? `<div style="margin-top:1rem;padding:0.75rem;background:var(--bg-hover);border-radius:var(--radius-xs);font-size:0.85rem;line-height:1.5;color:var(--text-secondary)">${escHTML(f.notes)}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-primary btn-sm" onclick="addFindToCellar('${f.id}')">Add to Collection</button>
      <button class="btn btn-danger btn-sm" onclick="removeFind('${f.id}')">Remove</button>
    </div>`;
  document.getElementById('wineModal').classList.add('open');
}

function removeFind(id) {
  if (!confirm('Remove this find?')) return;
  restaurantFinds = restaurantFinds.filter(f => f.id !== id);
  saveFinds(restaurantFinds);
  closeWineModal();
  renderFinds();
  showToast('Find removed');
}

function addFindToCellar(id) {
  const f = restaurantFinds.find(x => x.id === id);
  if (!f) return;
  closeWineModal();
  switchView('add');
  const cat = f.category || 'wine';
  const validCats = ['wine', 'whiskey', 'tequila', 'sake', 'spirit'];
  const effectiveCat = validCats.includes(cat) ? cat : 'wine';
  const btn = document.querySelector(`[data-cat="${effectiveCat}"]`);
  if (btn) setAddCategory(effectiveCat, btn);
  if (f.name) document.getElementById('wineName').value = f.name;
  if (f.producer) document.getElementById('wineProducer').value = f.producer;
  if (f.vintage) document.getElementById('wineVintage').value = f.vintage;
  if (f.type) document.getElementById('wineType').value = f.type;
  if (f.grape) document.getElementById('wineGrape').value = f.grape;
  if (f.region) document.getElementById('wineRegion').value = f.region;
  if (f.notes) document.getElementById('wineNotes').value = f.notes;
  if (f.imageUrl) {
    const displayUrl = f.imageUrl.startsWith('data:') || f.imageUrl.startsWith('/') ? f.imageUrl : `/api/images/proxy?url=${encodeURIComponent(f.imageUrl)}`;
    setBottleImagePreview(displayUrl, f.imageUrl);
  }
  showToast('Pre-filled from your find — adjust and save');
}

// ---- Find scan flow ----

let findScanStream = null;

async function startFindScan() {
  try {
    const preview = document.getElementById('findCameraPreview');
    const video = document.getElementById('findCameraVideo');
    preview.style.display = 'block';
    const constraints = { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } };
    try {
      findScanStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      findScanStream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    video.srcObject = findScanStream;
    await video.play();
  } catch (err) {
    showToast('Camera access denied');
    cancelFindScan();
  }
}

function cancelFindScan() {
  if (findScanStream) { findScanStream.getTracks().forEach(t => t.stop()); findScanStream = null; }
  const preview = document.getElementById('findCameraPreview');
  if (preview) preview.style.display = 'none';
  const proc = document.getElementById('findProcessing');
  if (proc) proc.style.display = 'none';
}

async function captureFindPhoto() {
  const video = document.getElementById('findCameraVideo');
  const canvas = document.getElementById('findCaptureCanvas');
  if (!video.srcObject || !video.videoWidth || video.readyState < 2) { showToast('Camera not ready'); return; }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  cancelFindScan();
  const resized = await resizeImageForVision(dataUrl, 1024);
  await processFindImage(resized);
}

function handleFindImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const resized = await resizeImageForVision(e.target.result, 1024);
    await processFindImage(resized);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function processFindImage(dataUrl) {
  document.getElementById('findProcessing').style.display = 'flex';
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) { document.getElementById('findProcessing').style.display = 'none'; showToast('Add your OpenAI API key in Settings first'); return; }

  // Capture GPS
  let gpsPosition = null;
  try {
    gpsPosition = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  } catch { /* GPS unavailable */ }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Analyze this bottle label. Extract info AND use your knowledge to fill gaps. Return ONLY valid JSON:
{"name":"full name","producer":"producer/winery","vintage":year or null,"type":"Red/White/Rosé/Sparkling/Champagne/Dessert/Fortified/Scotch/Bourbon/Irish/Japanese/Rye/Single Malt/Blended/Tennessee/Tequila/Mezcal/Junmai/Ginjo/Daiginjo/Nigori/Sparkling Sake/Sake/Rum/Cognac/Brandy/Gin/Vodka/Other Spirit","category":"wine/whiskey/tequila/sake/spirit","grape":"varietal or null","region":"region, country","notes":"brief tasting profile (2-3 sentences)" or null,"communityScore": 0-100 critic/community consensus score based on your knowledge (Vivino, Wine-Searcher, etc) or null if unknown}` },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }
        ]}],
        max_tokens: 500,
        temperature: 0.1,
      })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API error ${response.status}`);
    }
    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const data = JSON.parse(jsonMatch[0]);

    // Reverse geocode — capture venue, city, and country code
    let locationName = '';
    let locationCity = '';
    let locationCountry = '';
    if (gpsPosition) {
      try {
        const geoResp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${gpsPosition.latitude}&lon=${gpsPosition.longitude}&format=json&zoom=18&accept-language=en`);
        if (geoResp.ok) {
          const g = await geoResp.json();
          const venueName = g.address?.restaurant || g.address?.bar || g.address?.cafe || g.address?.pub || '';
          locationCity = g.address?.city || g.address?.town || g.address?.state || g.address?.county || g.address?.village || '';
          locationCountry = (g.address?.country_code || '').toUpperCase();
          locationName = venueName || [locationCity, locationCountry].filter(Boolean).join(', ');
        }
      } catch {}
    }

    const find = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
      name: data.name || 'Unknown',
      producer: data.producer || '',
      type: data.type || 'Red',
      category: data.category || 'wine',
      grape: data.grape || '',
      region: data.region || '',
      vintage: data.vintage || null,
      notes: data.notes || '',
      communityScore: data.communityScore || null,
      imageUrl: dataUrl,
      addedDate: new Date().toISOString().split('T')[0],
      latitude: gpsPosition?.latitude || null,
      longitude: gpsPosition?.longitude || null,
      locationName,
      locationCity,
      locationCountry,
    };
    restaurantFinds.push(find);
    saveFinds(restaurantFinds);
    renderFinds();
    showToast(`Added "${find.name}" to finds`);
  } catch (err) {
    console.error('Find scan error:', err);
    showToast('Find scan error: ' + (err.message || 'try again'));
  } finally {
    document.getElementById('findProcessing').style.display = 'none';
  }
}

// ============ SHAREABLE CELLAR ============

async function loadSharedCellar(token) {
  // Hide ALL app UI for shared view — show only the shared section
  document.body.classList.add('no-auth', 'shared-view');
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.style.display = 'none';
  const navToggle = document.querySelector('.mobile-nav-toggle');
  if (navToggle) navToggle.style.display = 'none';

  // Force-hide ALL views including welcome
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });

  // Use the static shared view section from HTML
  const sharedView = document.getElementById('view-shared');
  if (!sharedView) {
    document.body.innerHTML = '<div style="padding:4rem;text-align:center"><h3>Error</h3><p>Shared view container not found.</p></div>';
    return;
  }
  sharedView.classList.add('active');
  sharedView.style.display = 'block';
  sharedView.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem;gap:1rem">
    <div class="scan-spinner"></div>
    <p style="color:var(--text-secondary)">Loading shared collection...</p>
  </div>`;

  try {
    const resp = await fetch('/api/share/' + token);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('Share API error:', resp.status, errText);
      sharedView.innerHTML = `<div style="padding:4rem;text-align:center">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 1rem;display:block;color:var(--text-muted)"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <h3>Link not found</h3>
        <p style="color:var(--text-muted)">This share link may have been revoked or is invalid.</p>
      </div>`;
      return;
    }
    const data = await resp.json();
    console.log('Share data loaded:', data.bottles?.length, 'bottles');
    renderSharedView(data, sharedView);
  } catch (err) {
    console.error('Share load error:', err);
    sharedView.innerHTML = `<div style="padding:4rem;text-align:center"><h3>Failed to load</h3><p style="color:var(--text-muted)">Error: ${escHTML(err.message || 'Unknown error')}. Try refreshing.</p></div>`;
  }
}

function renderSharedView(data, container) {
  const { bottles, owner, showValues } = data;
  console.log('renderSharedView: total bottles from API:', bottles.length, 'statuses:', bottles.map(b => b.status || 'none'));
  const activeBottles = bottles.filter(b => b.status !== 'consumed');
  console.log('renderSharedView: active bottles:', activeBottles.length);
  const total = activeBottles.reduce((s, b) => s + (b.quantity || 1), 0);

  // Group by type for stats
  const typeCounts = {};
  activeBottles.forEach(b => { typeCounts[b.type] = (typeCounts[b.type] || 0) + (b.quantity || 1); });
  const typeChips = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
    `<span class="wine-detail-chip">${escHTML(t)} (${c})</span>`
  ).join('');

  let valueHtml = '';
  if (showValues) {
    const totalValue = activeBottles.reduce((s, b) => s + (b.marketValue || 0) * (b.quantity || 1), 0);
    valueHtml = `<span style="color:var(--success);font-weight:600;margin-left:1rem">Est. Value: $${Math.round(totalValue).toLocaleString()}</span>`;
  }

  const cardsHtml = activeBottles.sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || '')).map(b => {
    const typeClass = 'type-' + (b.type || '').replace(/\s/g, '');
    const rating = b.rating ? '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating) : '';
    const scoreBadge = b.communityScore ? `<span class="card-badge-rating">${Math.round(b.communityScore)}<span class="card-badge-rating-max">/100</span></span>` : '';
    return `
      <div class="wine-card" style="cursor:default">
        ${scoreBadge}
        <div class="wine-card-top">
          <div class="wine-color-bar ${typeClass}"></div>
          <div>
            <div class="wine-card-title">${escHTML(b.name || 'Unknown')}</div>
            <div class="wine-card-subtitle">${escHTML(b.producer || '')} ${b.vintage ? '· ' + b.vintage : ''}</div>
          </div>
        </div>
        <div class="wine-card-details">
          <span class="wine-detail-chip">${escHTML(b.type || '—')}</span>
          ${b.region ? `<span class="wine-detail-chip">${escHTML(b.region)}</span>` : ''}
          ${b.grape ? `<span class="wine-detail-chip">${escHTML(b.grape)}</span>` : ''}
        </div>
        <div class="wine-card-footer">
          ${showValues && b.marketValue ? `<span class="wine-price">$${Math.round(b.marketValue).toLocaleString()}</span>` : '<span></span>'}
          ${rating ? `<span class="wine-rating-sm">${rating}</span>` : ''}
        </div>
        ${(b.quantity || 1) > 1 ? `<span class="wine-qty">×${b.quantity}</span>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <header class="view-header">
      <div>
        <h1>${escHTML(owner.name)}'s Collection</h1>
        <p class="subtitle">${total} bottle${total !== 1 ? 's' : ''} ${valueHtml}</p>
      </div>
    </header>
    <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1.5rem">${typeChips}</div>
    <div class="wine-grid">${cardsHtml}</div>
    ${activeBottles.length === 0 ? `<div class="empty-state"><h3>Empty collection</h3><p>No bottles in this collection yet.</p></div>` : ''}`;
}

// Share management functions (for settings)
async function loadShareStatus() {
  try {
    const resp = await fetch('/api/share/status', { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json();
    const section = document.getElementById('shareSection');
    if (!section) return;
    const linkInput = document.getElementById('shareLinkInput');
    const genBtn = document.getElementById('shareGenBtn');
    const copyBtn = document.getElementById('shareCopyBtn');
    const revokeBtn = document.getElementById('shareRevokeBtn');
    const toggleEl = document.getElementById('shareShowValues');
    if (data.token) {
      linkInput.value = window.location.origin + data.url;
      linkInput.style.display = 'block';
      genBtn.style.display = 'none';
      copyBtn.style.display = 'inline-flex';
      revokeBtn.style.display = 'inline-flex';
      toggleEl.checked = data.showValues;
    } else {
      linkInput.style.display = 'none';
      genBtn.style.display = 'inline-flex';
      copyBtn.style.display = 'none';
      revokeBtn.style.display = 'none';
    }
  } catch {}
}

async function generateShareLink() {
  try {
    const resp = await fetch('/api/share/generate', { method: 'POST', credentials: 'include' });
    if (!resp.ok) throw new Error();
    showToast('Share link created');
    await loadShareStatus();
  } catch { showToast('Failed to create share link'); }
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => showToast('Link copied to clipboard')).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('Link copied');
  });
}

async function revokeShareLink() {
  if (!confirm('Revoke share link? Anyone with the link will no longer be able to view your collection.')) return;
  try {
    const resp = await fetch('/api/share/revoke', { method: 'DELETE', credentials: 'include' });
    if (!resp.ok) throw new Error();
    showToast('Share link revoked');
    await loadShareStatus();
  } catch { showToast('Failed to revoke'); }
}

async function toggleShareValues() {
  const checked = document.getElementById('shareShowValues')?.checked || false;
  try {
    await fetch('/api/share/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ showValues: checked }),
    });
    showToast(checked ? 'Values visible in shared view' : 'Values hidden from shared view');
  } catch { showToast('Failed to update'); }
}

// ============ SETTINGS ============

async function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  if (!key) { showToast('Please enter an API key'); return; }
  localStorage.setItem(API_KEY_STORAGE, key);
  // Also save to server if logged in
  if (currentUser) {
    try {
      await fetch('/api/settings/openai-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key }),
      });
    } catch {}
  }
  showToast('API key saved');
  updateApiKeyStatus();
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  const btn = input.nextElementSibling;
  if (input.type === 'password') { input.type = 'text'; btn.textContent = 'Hide'; }
  else { input.type = 'password'; btn.textContent = 'Show'; }
}

function updateApiKeyStatus() {
  const status = document.getElementById('apiKeyStatus');
  if (!status) return;
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (key) {
    status.textContent = 'Key saved (***' + key.slice(-4) + ')';
    status.className = 'api-key-status saved';
    document.getElementById('apiKeyInput').value = key;
  } else {
    status.textContent = 'No key configured';
    status.className = 'api-key-status missing';
  }
}

function exportData() {
  const data = { cellar, tastings, exportDate: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cellar-export-' + new Date().toISOString().split('T')[0] + '.json';
  a.click(); URL.revokeObjectURL(url);
  showToast('Collection exported');
}

function clearAllData() {
  if (!confirm('This will delete all bottles and tasting notes. Are you sure?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TASTINGS_KEY);
  cellar = []; tastings = [];
  renderDashboard(); renderCellar(); renderTastingWines(); renderPastTastings(); renderTimeline();
  showToast('All data cleared');
}

// ============ BOTTLE IMAGE ============

let pendingBottleImage = null; // { url, dataUrl } — set before saving
let pendingScanRating = null; // AI-estimated rating from scan (1-5)

function searchBottleImage() {
  const name = document.getElementById('wineName').value.trim();
  const producer = document.getElementById('wineProducer').value.trim();
  const type = document.getElementById('wineType').value;
  const query = [name, producer, type].filter(Boolean).join(' ');

  if (!query || query.length < 3) {
    showToast('Enter a bottle name first');
    return;
  }

  const resultsEl = document.getElementById('imageSearchResults');
  const gridEl = document.getElementById('imageSearchGrid');
  const loadingEl = document.getElementById('imageSearchLoading');

  resultsEl.style.display = 'block';
  loadingEl.style.display = 'flex';
  gridEl.innerHTML = '';

  fetch(`/api/images/search?q=${encodeURIComponent(query)}`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      loadingEl.style.display = 'none';
      const images = data.images || [];
      if (images.length === 0) {
        gridEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:0.85rem">No images found. Try uploading a photo instead.</p>';
        return;
      }
      gridEl.innerHTML = images.map((img, i) => {
        const src = `/api/images/proxy?url=${encodeURIComponent(img.thumbnail || img.url)}`;
        return `<div class="image-search-item" onclick="selectSearchImage(${i})">
          <img src="${src}" alt="Result ${i + 1}" loading="lazy" onerror="this.parentElement.style.display='none'">
        </div>`;
      }).join('');
      // Store URLs for selection
      window._imageSearchResults = images;
    })
    .catch(err => {
      loadingEl.style.display = 'none';
      gridEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--danger);font-size:0.85rem">Search failed. Try uploading a photo instead.</p>';
    });
}

function selectSearchImage(index) {
  const images = window._imageSearchResults || [];
  if (!images[index]) return;

  const img = images[index];
  const proxyUrl = `/api/images/proxy?url=${encodeURIComponent(img.url)}`;

  // Show preview
  setBottleImagePreview(proxyUrl, img.url);
  closeImageSearch();
  showToast('Image selected');
}

function closeImageSearch() {
  document.getElementById('imageSearchResults').style.display = 'none';
}

function setBottleImagePreview(displayUrl, storeUrl) {
  const preview = document.getElementById('bottleImagePreview');
  const imgEl = document.getElementById('bottleImageImg');
  const dataInput = document.getElementById('bottleImageData');

  imgEl.src = displayUrl;
  dataInput.value = storeUrl || displayUrl;
  preview.style.display = 'block';
  pendingBottleImage = storeUrl || displayUrl;
}

function removeBottleImage() {
  document.getElementById('bottleImagePreview').style.display = 'none';
  document.getElementById('bottleImageImg').src = '';
  document.getElementById('bottleImageData').value = '';
  pendingBottleImage = null;
}

function handleBottleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Resize image to save storage (max 400px wide)
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setBottleImagePreview(dataUrl, dataUrl);
      showToast('Photo added');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function promptImageUrl() {
  const url = prompt('Paste image URL:');
  if (url && url.startsWith('http')) {
    const proxyUrl = `/api/images/proxy?url=${encodeURIComponent(url)}`;
    setBottleImagePreview(proxyUrl, url);
    showToast('Image URL set');
  }
}

// ============ CSV FILE UPLOAD ============

function handleCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('csvImportStatus');
  statusEl.style.display = 'block';
  statusEl.className = 'csv-import-status';
  statusEl.textContent = 'Reading file...';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const csvText = e.target.result;
      const lines = parseCSVLines(csvText);
      if (lines.length < 2) {
        statusEl.className = 'csv-import-status error';
        statusEl.textContent = 'CSV file appears empty or has no data rows.';
        return;
      }

      const headers = lines[0].map(h => h.trim());
      const bottles = parseCSVToBottles(headers, lines);

      if (bottles.length === 0) {
        statusEl.className = 'csv-import-status error';
        statusEl.textContent = 'No bottles could be parsed from the CSV. Check the format.';
        return;
      }

      // Merge with existing collection (skip duplicates by name+vintage)
      let added = 0;
      let skipped = 0;
      for (const bottle of bottles) {
        const exists = cellar.some(b =>
          b.name === bottle.name && b.vintage === bottle.vintage && b.producer === bottle.producer
        );
        if (exists) {
          skipped++;
        } else {
          cellar.push(bottle);
          added++;
        }
      }

      saveCellar(cellar);
      renderCellar();
      renderDashboard();

      statusEl.className = 'csv-import-status success';
      statusEl.textContent = `Imported ${added} bottles${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}. Total collection: ${cellar.length}`;
      showToast(`${added} bottles imported from CSV`);
    } catch (err) {
      statusEl.className = 'csv-import-status error';
      statusEl.textContent = 'Error parsing CSV: ' + err.message;
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function parseCSVToBottles(headers, lines) {
  const bottles = [];
  const get = (row, col) => {
    // Try exact match first
    let idx = headers.indexOf(col);
    // Try case-insensitive
    if (idx < 0) idx = headers.findIndex(h => h.toLowerCase() === col.toLowerCase());
    return idx >= 0 && idx < row.length ? (row[idx] || '').trim() : '';
  };

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.length < 2) continue;

    // Support both CellarTracker and generic CSV formats
    const name = get(row, 'Wine') || get(row, 'Name') || get(row, 'wine') || get(row, 'name');
    if (!name) continue;

    const producer = get(row, 'Producer') || get(row, 'Winery') || get(row, 'Brand') || get(row, 'producer');
    const vintageRaw = parseInt(get(row, 'Vintage') || get(row, 'Year') || get(row, 'vintage')) || null;
    const vintage = vintageRaw && vintageRaw > 1900 && vintageRaw < 2100 ? vintageRaw : null;
    const ctType = get(row, 'Type') || get(row, 'type');
    const ctColor = get(row, 'Color') || get(row, 'color');
    const ctCategory = get(row, 'Category') || get(row, 'category');
    const varietal = get(row, 'Varietal') || get(row, 'Grape') || get(row, 'MasterVarietal') || get(row, 'grape');
    const country = get(row, 'Country') || get(row, 'country');
    const region = get(row, 'Region') || get(row, 'region');
    const subRegion = get(row, 'SubRegion') || get(row, 'Sub-Region');
    const appellation = get(row, 'Appellation') || get(row, 'appellation');
    const designation = get(row, 'Designation') || get(row, 'designation');
    const size = get(row, 'Size') || get(row, 'size') || '750ml';
    const currency = get(row, 'Currency') || get(row, 'currency') || 'USD';
    const priceRaw = (get(row, 'Price') || get(row, 'price') || '').replace(',', '.');
    const price = parseFloat(priceRaw) || null;
    const valueRaw = (get(row, 'Value') || get(row, 'value') || '').replace(',', '.');
    const marketValue = parseFloat(valueRaw) || null;
    const quantity = parseInt(get(row, 'Quantity') || get(row, 'quantity') || get(row, 'Qty')) || 1;
    const beginConsume = parseInt(get(row, 'BeginConsume') || get(row, 'DrinkFrom')) || null;
    const endConsume = parseInt(get(row, 'EndConsume') || get(row, 'DrinkUntil')) || null;
    const notes = get(row, 'PNotes') || get(row, 'Notes') || get(row, 'notes');
    const pScore = parseInt(get(row, 'PScore') || get(row, 'Rating') || get(row, 'rating')) || null;
    const cScore = parseFloat(get(row, 'CScore') || get(row, 'CommunityScore')) || null;

    // Build region string
    const regionParts = [
      subRegion && subRegion !== 'Unknown' ? subRegion : '',
      region && region !== 'Unknown' ? region : '',
      country
    ].filter(Boolean);
    const regionStr = regionParts.join(', ');

    // Determine type
    const allText = [name, designation, varietal, ctCategory, producer, region, country, subRegion, appellation].join(' ').toLowerCase();
    let type = 'Red';
    let category = 'wine';

    if (ctType === 'Spirits' || ctCategory === 'Distilled' || /whisk[e]?y|scotch|bourbon|single malt|tequila|mezcal|sake|junmai|ginjo|daiginjo|nigori|\brum\b|cognac|brandy|\bgin\b|vodka/i.test(allText)) {
      if (/whisk[e]?y|scotch|single malt|bourbon/i.test(allText)) {
        if (/bourbon/i.test(allText)) type = 'Bourbon';
        else if (/scotch|single malt/i.test(allText) || /scotland|speyside|highland|islay/i.test(allText)) type = 'Scotch';
        else if (/irish/i.test(allText)) type = 'Irish';
        else if (/japan/i.test(allText)) type = 'Japanese';
        else if (/rye whisk/i.test(allText)) type = 'Rye';
        else if (/tennessee/i.test(allText)) type = 'Tennessee';
        else type = 'Single Malt';
        category = 'whiskey';
      } else if (/tequila|agave/i.test(allText)) { type = 'Tequila'; category = 'tequila'; }
      else if (/mezcal/i.test(allText)) { type = 'Mezcal'; category = 'tequila'; }
      else if (/daiginjo/i.test(allText)) { type = 'Daiginjo'; category = 'sake'; }
      else if (/ginjo/i.test(allText)) { type = 'Ginjo'; category = 'sake'; }
      else if (/nigori/i.test(allText)) { type = 'Nigori'; category = 'sake'; }
      else if (/junmai/i.test(allText)) { type = 'Junmai'; category = 'sake'; }
      else if (/\bsake\b/i.test(allText)) { type = 'Sake'; category = 'sake'; }
      else if (/\brum\b|\bron\b/i.test(allText)) { type = 'Rum'; category = 'spirit'; }
      else if (/cognac/i.test(allText)) { type = 'Cognac'; category = 'spirit'; }
      else if (/brandy/i.test(allText)) { type = 'Brandy'; category = 'spirit'; }
      else if (/\bgin\b/i.test(allText)) { type = 'Gin'; category = 'spirit'; }
      else if (/vodka/i.test(allText)) { type = 'Vodka'; category = 'spirit'; }
      else { type = 'Other Spirit'; category = 'spirit'; }
    } else if (ctType === 'Red' || ctColor === 'Red') { type = 'Red'; }
    else if (ctType === 'White' || ctColor === 'White') { type = 'White'; }
    else if (/ros[eé]/i.test(ctType + ctColor)) { type = 'Rosé'; }
    else if (/champagne/i.test(allText)) { type = 'Champagne'; }
    else if (/sparkling/i.test(ctType + ctColor)) { type = 'Sparkling'; }
    else if (/dessert|sweet/i.test(ctType + ctCategory)) { type = 'Dessert'; }
    else if (/fortified|port|sherry/i.test(ctType + ctCategory)) { type = 'Fortified'; }

    // Extract age
    const ageMatch = (name + ' ' + designation).match(/(\d{1,2})\s*(?:year|yr|ans|jahre)/i);
    const age = ageMatch ? parseInt(ageMatch[1]) : null;

    // Extract ABV
    const abvMatch = (name + ' ' + designation).match(/(\d{2,3}(?:[.,]\d{1,2})?)\s*%/);
    const abv = abvMatch ? parseFloat(abvMatch[1].replace(',', '.')) : null;

    const bottle = {
      id: get(row, 'iWine') || (Date.now() + i).toString(),
      name,
      producer,
      vintage,
      type,
      grape: category === 'wine' ? varietal : '',
      varietal,
      region: regionStr,
      country,
      subRegion: subRegion !== 'Unknown' ? subRegion : '',
      appellation: appellation !== 'Unknown' ? appellation : '',
      designation,
      size,
      currency,
      quantity,
      price,
      marketValue: marketValue || null,
      location: '',
      drinkFrom: beginConsume && beginConsume < 9999 ? beginConsume : null,
      drinkUntil: endConsume && endConsume < 9999 ? endConsume : null,
      notes: notes || '',
      communityScore: cScore,
      personalScore: pScore,
      addedDate: new Date().toISOString().split('T')[0],
      rating: pScore ? Math.min(5, Math.round(pScore / 20)) : null,
      category,
      age,
      abv,
      ctId: get(row, 'iWine') || null,
    };

    // Estimate market value if not provided
    if (!bottle.marketValue) bottle.marketValue = estimateMarketValue(bottle);

    bottles.push(bottle);
  }

  return bottles;
}

// Settings auto-loaded on view switch via switchView()
