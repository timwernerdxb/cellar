/* ============================================
   CELLAR — Wine & Whiskey Collection App
   ============================================ */

// ============ DATA LAYER ============

const STORAGE_KEY = 'vino_cellar';
const TASTINGS_KEY = 'vino_tastings';
const THEME_KEY = 'vino_theme';

const WHISKEY_TYPES = ['Scotch', 'Bourbon', 'Irish', 'Japanese', 'Rye', 'Single Malt', 'Blended', 'Tennessee'];
const WINE_TYPES = ['Red', 'White', 'Rosé', 'Sparkling', 'Dessert', 'Fortified'];
const TEQUILA_TYPES = ['Tequila', 'Mezcal'];
const SPIRIT_TYPES = ['Rum', 'Cognac', 'Brandy', 'Gin', 'Vodka', 'Other Spirit'];
const API_KEY_STORAGE = 'vino_openai_key';

function isWhiskey(type) { return WHISKEY_TYPES.includes(type); }
function isWine(type) { return WINE_TYPES.includes(type); }
function isTequila(type) { return TEQUILA_TYPES.includes(type); }
function isSpirit(type) { return SPIRIT_TYPES.includes(type) || WHISKEY_TYPES.includes(type) || TEQUILA_TYPES.includes(type); }
function isSpiritOrWhiskey(type) { return isWhiskey(type) || isTequila(type) || SPIRIT_TYPES.includes(type); }

// ============ AUTH STATE ============

let currentUser = null;
let syncTimer = null;
let authMode = 'login'; // 'login' or 'register'

async function checkAuthState() {
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
      body: JSON.stringify({ bottles: cellar, tastings }),
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cellar));
    localStorage.setItem(TASTINGS_KEY, JSON.stringify(tastings));
    localStorage.setItem('vino_last_sync', new Date().toISOString());
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

// ============ MARKET VALUE ESTIMATION ============

function estimateMarketValue(bottle) {
  // If CSV imported with a market value, use it
  if (bottle.marketValue && bottle.marketValue > 0) return bottle.marketValue;

  let base = bottle.price ? parseFloat(bottle.price) : (isSpiritOrWhiskey(bottle.type) ? 60 : 25);

  if (isWhiskey(bottle.type)) return estimateWhiskeyValue(bottle, base);
  if (isSpirit(bottle.type)) return estimateSpiritValue(bottle, base);
  return estimateWineValue(bottle, base);
}

function estimateWineValue(wine, base) {
  const regionMult = {
    'bordeaux': 2.2, 'burgundy': 2.8, 'champagne': 1.8, 'napa': 1.9,
    'barolo': 1.7, 'tuscany': 1.6, 'rioja': 1.3, 'rhone': 1.5, 'rhône': 1.5,
    'mosel': 1.5, 'piedmont': 1.6, 'sonoma': 1.4, 'willamette': 1.3,
    'mendoza': 1.0, 'loire': 1.2, 'douro': 1.3, 'priorat': 1.4,
  };
  const grapeMult = {
    'cabernet sauvignon': 1.4, 'pinot noir': 1.5, 'nebbiolo': 1.6,
    'sangiovese': 1.2, 'merlot': 1.1, 'syrah': 1.2, 'shiraz': 1.2,
    'chardonnay': 1.2, 'riesling': 1.3, 'sauvignon blanc': 1.0,
  };
  const premiumKw = ['chateau', 'château', 'domaine', 'opus', 'sassicaia', 'tignanello',
    'penfolds', 'petrus', 'lafite', 'latour', 'mouton', 'margaux', 'romanee',
    'leroy', 'krug', 'dom perignon', 'salon', 'cristal'];

  const region = (wine.region || '').toLowerCase();
  const grape = (wine.grape || '').toLowerCase();
  const producer = ((wine.producer || '') + ' ' + (wine.name || '')).toLowerCase();
  const vintage = parseInt(wine.vintage) || 2020;
  const age = new Date().getFullYear() - vintage;

  for (const [k, m] of Object.entries(regionMult)) { if (region.includes(k)) { base *= m; break; } }
  for (const [k, m] of Object.entries(grapeMult)) { if (grape.includes(k)) { base *= m; break; } }
  if (age > 0 && age <= 5) base *= 1 + age * 0.04;
  else if (age > 5 && age <= 15) base *= 1.2 + (age - 5) * 0.06;
  else if (age > 15 && age <= 30) base *= 1.8 + (age - 15) * 0.03;
  else if (age > 30) base *= 2.25 + Math.min((age - 30) * 0.015, 1.0);
  for (const kw of premiumKw) { if (producer.includes(kw)) { base *= 1.5; break; } }
  if (wine.type === 'Sparkling') base *= 1.15;

  const hash = (wine.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.9 + (hash % 20) / 100;
  return Math.round(base * 100) / 100;
}

function estimateWhiskeyValue(w, base) {
  const regionMult = {
    'islay': 1.8, 'speyside': 1.5, 'highland': 1.4, 'lowland': 1.2,
    'campbeltown': 1.5, 'kentucky': 1.3, 'tennessee': 1.2,
    'japan': 2.0, 'ireland': 1.1, 'taiwan': 1.6,
  };
  const premiumKw = ['macallan', 'yamazaki', 'hibiki', 'nikka', 'pappy', 'van winkle',
    'blanton', 'buffalo trace', 'lagavulin', 'ardbeg', 'laphroaig', 'glenfiddich',
    'glenlivet', 'balvenie', 'dalmore', 'springbank', 'redbreast', 'midleton',
    'maker\'s mark', 'woodford', 'whistlepig', 'kavalan', 'wild turkey'];

  const region = (w.region || '').toLowerCase();
  const nameProducer = ((w.producer || '') + ' ' + (w.name || '')).toLowerCase();
  const age = parseInt(w.age) || 0;

  for (const [k, m] of Object.entries(regionMult)) { if (region.includes(k)) { base *= m; break; } }

  // Age premium — whiskey appreciates steeply with age statements
  if (age >= 10 && age < 15) base *= 1.5;
  else if (age >= 15 && age < 18) base *= 2.2;
  else if (age >= 18 && age < 21) base *= 3.0;
  else if (age >= 21 && age < 25) base *= 4.5;
  else if (age >= 25 && age < 30) base *= 7.0;
  else if (age >= 30) base *= 10 + (age - 30) * 0.5;

  for (const kw of premiumKw) { if (nameProducer.includes(kw)) { base *= 1.6; break; } }
  if (w.type === 'Japanese') base *= 1.3;
  if (w.abv && parseFloat(w.abv) > 50) base *= 1.15; // Cask strength premium

  const hash = (w.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.9 + (hash % 20) / 100;
  return Math.round(base * 100) / 100;
}

function estimateSpiritValue(s, base) {
  const premiumKw = ['clase azul', 'don julio', 'patron', 'herradura', 'casamigos',
    'fortaleza', 'tears of llorona', 'last drop', 'diplomatico', 'zacapa',
    'flor de cana', 'appleton', 'havana club', 'hennessy', 'remy martin', 'louis xiii'];
  const nameProducer = ((s.producer || '') + ' ' + (s.name || '')).toLowerCase();
  for (const kw of premiumKw) { if (nameProducer.includes(kw)) { base *= 1.6; break; } }
  if (/limited|edition|reserva|extra anejo|ultra/i.test(s.name || '')) base *= 1.5;
  const age = parseInt(s.age) || 0;
  if (age >= 10) base *= 1 + age * 0.08;
  const hash = (s.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  base *= 0.9 + (hash % 20) / 100;
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
    const currency = get('Currency') || 'EUR';
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
let currentFilter = 'all';
let selectedTastingWineId = null;
let currentRating = 0;
let addCategory = 'wine';
let editingBottleId = null;

// Data starts empty — loaded from server after login

// Ensure category field and market values
cellar.forEach(w => {
  if (!w.category) w.category = isWhiskey(w.type) ? 'whiskey' : isTequila(w.type) ? 'tequila' : SPIRIT_TYPES.includes(w.type) ? 'spirit' : 'wine';
  if (!w.marketValue || w.marketValue <= 0) w.marketValue = estimateMarketValue(w);
});

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

  const showSpirit = cat === 'whiskey' || cat === 'spirit' || cat === 'tequila';
  document.querySelectorAll('.whiskey-field').forEach(el => el.style.display = showSpirit ? '' : 'none');
  document.querySelectorAll('.wine-field').forEach(el => el.style.display = showSpirit ? 'none' : '');

  // Update labels
  const labels = {
    wine: { producer: 'Producer / Winery', vintage: 'Vintage *', grape: 'Grape / Varietal', prodPH: 'e.g. Chateau Margaux', grapePH: 'e.g. Cabernet Sauvignon', regionPH: 'e.g. Bordeaux, France' },
    whiskey: { producer: 'Distillery / Producer', vintage: 'Bottling Year', grape: 'Grain / Mash Bill', prodPH: 'e.g. The Macallan', grapePH: 'e.g. Malted Barley', regionPH: 'e.g. Islay, Scotland' },
    tequila: { producer: 'Producer / Brand', vintage: 'Bottling Year', grape: 'Agave Type', prodPH: 'e.g. Clase Azul', grapePH: 'e.g. Blue Weber Agave', regionPH: 'e.g. Jalisco, Mexico' },
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
  if (view === 'settings') updateApiKeyStatus();
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
  const totalBottles = cellar.reduce((s, w) => s + (parseInt(w.quantity) || 0), 0);
  const ratedWines = cellar.filter(w => w.rating);
  const avgRating = ratedWines.length ? (ratedWines.reduce((s, w) => s + w.rating, 0) / ratedWines.length).toFixed(1) : '—';
  const now = new Date().getFullYear();
  const readyCount = cellar.filter(w => {
    if (isSpiritOrWhiskey(w.type)) return true;
    const from = parseInt(w.drinkFrom) || 0;
    const until = parseInt(w.drinkUntil) || 9999;
    return now >= from && now <= until;
  }).reduce((s, w) => s + (parseInt(w.quantity) || 0), 0);
  const totalValue = cellar.reduce((s, w) => s + (w.marketValue || 0) * (parseInt(w.quantity) || 1), 0);

  // Dynamic greeting
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const userName = (typeof currentUser !== 'undefined' && currentUser?.name) ? ', ' + currentUser.name.split(' ')[0] : '';
  const greetEl = document.getElementById('dashGreeting');
  if (greetEl) greetEl.textContent = timeGreeting + userName;

  animateValue('totalBottles', totalBottles);
  document.getElementById('avgRating').textContent = avgRating;
  animateValue('readyToDrink', readyCount);
  document.getElementById('totalValue').textContent = '€' + Math.round(totalValue).toLocaleString();

  // Top bottles by value
  const topValue = [...cellar].sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0)).slice(0, 6);
  const topList = document.getElementById('topValueList');
  if (topList) {
    topList.innerHTML = topValue.length === 0
      ? '<div class="empty-state"><p>Add bottles to see top value</p></div>'
      : topValue.map(w => {
        const currSym = (w.currency || 'EUR') === 'EUR' ? '€' : '$';
        return cardSmHTML(w, `${currSym}${Math.round(w.marketValue || 0).toLocaleString()}`);
      }).join('');
  }

  // Ready to drink — prioritize wines in their drink window, then spirits
  const winesReady = cellar.filter(w => {
    if (isSpiritOrWhiskey(w.type)) return false;
    const from = parseInt(w.drinkFrom) || 0;
    const until = parseInt(w.drinkUntil) || 9999;
    return now >= from && now <= until;
  });
  const spiritsReady = cellar.filter(w => isSpiritOrWhiskey(w.type));
  const readyWines = [...winesReady, ...spiritsReady].slice(0, 8);
  const readyList = document.getElementById('readyWinesList');
  readyList.innerHTML = readyWines.length === 0
    ? '<div class="empty-state"><p>No bottles ready right now</p></div>'
    : readyWines.map(w => cardSmHTML(w)).join('');

  // Recent
  const recent = [...cellar].sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || '')).slice(0, 8);
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

function renderTypeChart() {
  const ctx = document.getElementById('typeChart');
  if (typeChartInstance) typeChartInstance.destroy();
  const types = {};
  cellar.forEach(w => { types[w.type] = (types[w.type] || 0) + (parseInt(w.quantity) || 1); });
  // Sort by count descending
  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
  const colors = {
    // Wine
    Red: '#8B1A1A', White: '#C9A96E', 'Rosé': '#E8A0BF', Sparkling: '#7FB3D3',
    Dessert: '#D4A574', Fortified: '#6C3483',
    // Whiskey
    Scotch: '#B8860B', Bourbon: '#D2691E', Irish: '#228B22', Japanese: '#C41E3A',
    Rye: '#8B4513', 'Single Malt': '#DAA520', Blended: '#A0522D', Tennessee: '#CD853F',
    // Tequila
    Tequila: '#2E86AB', Mezcal: '#567D2E',
    // Spirits
    Rum: '#A0522D', Cognac: '#7B3F00',
    Brandy: '#9B6B43', Gin: '#4682B4', Vodka: '#8FA8C8', 'Other Spirit': '#808080',
  };
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  typeChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        data: sorted.map(s => s[1]),
        backgroundColor: sorted.map(s => colors[s[0]] || '#999'),
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
          labels: { padding: 12, usePointStyle: true, pointStyleWidth: 10, color: isDark ? '#A8A4A0' : '#6B6560', font: { family: 'DM Sans', size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed} bottle${ctx.parsed !== 1 ? 's' : ''}`
          }
        }
      }
    }
  });
}

function renderRegionChart() {
  const ctx = document.getElementById('regionChart');
  if (regionChartInstance) regionChartInstance.destroy();
  const regions = {};
  cellar.forEach(w => { const r = (w.region || 'Unknown').split(',')[0].trim(); regions[r] = (regions[r] || 0) + (parseInt(w.quantity) || 1); });
  const sorted = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Gradient palette for bars
  const barPalette = ['#8B1A1A', '#B8860B', '#2E86AB', '#6C3483', '#228B22', '#C41E3A', '#D2691E', '#4682B4', '#567D2E', '#9B6B43'];
  regionChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        data: sorted.map(s => s[1]),
        backgroundColor: sorted.map((_, i) => barPalette[i % barPalette.length] + (isDark ? 'CC' : 'BB')),
        borderRadius: 4,
        barThickness: 22,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.x} bottle${ctx.parsed.x !== 1 ? 's' : ''}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: isDark ? '#2A2A30' : '#E8E4DE' },
          ticks: { color: isDark ? '#9B9590' : '#6B6560', font: { family: 'DM Sans', size: 11 }, stepSize: 1 }
        },
        y: {
          grid: { display: false },
          ticks: { color: isDark ? '#A8A4A0' : '#6B6560', font: { family: 'DM Sans', size: 11 } }
        }
      }
    }
  });
}

let categoryChartInstance = null;
function renderCategoryChart() {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (categoryChartInstance) categoryChartInstance.destroy();
  const cats = { Wine: 0, Whiskey: 0, Spirit: 0 };
  cellar.forEach(w => {
    const qty = parseInt(w.quantity) || 1;
    if (isWhiskey(w.type)) cats.Whiskey += qty;
    else if (isSpirit(w.type)) cats.Spirit += qty;
    else cats.Wine += qty;
  });
  // Remove empty categories
  Object.keys(cats).forEach(k => { if (cats[k] === 0) delete cats[k]; });
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const catColors = { Wine: '#8B1A1A', Whiskey: '#B8860B', Spirit: '#2E86AB' };
  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(cats),
      datasets: [{
        data: Object.values(cats),
        backgroundColor: Object.keys(cats).map(k => catColors[k]),
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
          labels: { padding: 14, usePointStyle: true, pointStyleWidth: 10, color: isDark ? '#A8A4A0' : '#6B6560', font: { family: 'DM Sans', size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed} bottle${ctx.parsed !== 1 ? 's' : ''}`
          }
        }
      }
    }
  });
}

// ============ CELLAR ============

function renderCellar() {
  let wines = [...cellar];
  const search = (document.getElementById('cellarSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('cellarSort')?.value || 'added';

  if (currentFilter !== 'all') wines = wines.filter(w => w.type === currentFilter);
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
    default: wines.sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
  }

  const totalQty = wines.reduce((s, w) => s + (parseInt(w.quantity) || 1), 0);
  document.getElementById('cellarCount').textContent = totalQty + ' bottle' + (totalQty !== 1 ? 's' : '') + (totalQty !== wines.length ? ` (${wines.length} unique)` : '');
  const grid = document.getElementById('cellarGrid');

  if (wines.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 6v12a2 2 0 002 2h14a2 2 0 002-2V6M3 6l3-3h12l3 3M10 11h4"/></svg><h3>No bottles found</h3><p>Try adjusting your filters or add some bottles</p></div>`;
    return;
  }

  grid.innerHTML = wines.map(w => {
    const status = getDrinkStatus(w);
    const ratingStars = w.rating ? '★'.repeat(w.rating) + '☆'.repeat(5 - w.rating) : '';
    const currSym = (w.currency || 'EUR') === 'EUR' ? '€' : '$';
    const marketVal = w.marketValue ? currSym + w.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '';
    const typeClass = w.type.replace(/\s/g, '');
    const isSW = isSpiritOrWhiskey(w.type);
    const subtitle = isSW
      ? `${escHTML(w.producer || '')}${w.age ? ' · ' + w.age + ' Year' : ''}${w.designation ? ' · ' + escHTML(w.designation) : ''}`
      : `${escHTML(w.producer || '')} ${w.vintage ? '· ' + w.vintage : ''}`;
    const detailChips = isSW
      ? `<span class="wine-detail-chip">${escHTML(w.type)}</span>${w.abv ? `<span class="wine-detail-chip">${w.abv}% ABV</span>` : ''}${w.size && w.size !== '750ml' ? `<span class="wine-detail-chip">${w.size}</span>` : ''}${w.region ? `<span class="wine-detail-chip">${escHTML(w.region.split(',')[0])}</span>` : ''}`
      : `<span class="wine-detail-chip">${escHTML(w.type)}</span>${w.grape ? `<span class="wine-detail-chip">${escHTML(w.grape)}</span>` : ''}${w.region ? `<span class="wine-detail-chip">${escHTML(w.region.split(',')[0])}</span>` : ''}`;

    const imgSrc = w.imageUrl ? (w.imageUrl.startsWith('data:') || w.imageUrl.startsWith('/') ? w.imageUrl : `/api/images/proxy?url=${encodeURIComponent(w.imageUrl)}`) : '';

    return `
      <div class="wine-card" onclick="openWineModal('${w.id}')">
        ${imgSrc ? `<img class="wine-card-image" src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        ${w.quantity > 1 ? `<span class="wine-qty">${w.quantity} bottles</span>` : ''}
        <div class="wine-card-top">
          <div class="wine-color-bar type-${typeClass}"></div>
          <div>
            <div class="wine-card-title">${escHTML(w.name)}</div>
            <div class="wine-card-subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="wine-card-details">
          ${detailChips}
          <span class="wine-status status-${status.class}" style="font-size:0.72rem;padding:0.15rem 0.45rem">${status.label}</span>
        </div>
        <div class="wine-card-footer">
          <span class="wine-price">${marketVal ? marketVal + ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400">est. value</span>' : ''}</span>
          ${ratingStars ? `<span class="wine-rating-sm">${ratingStars}</span>` : '<span style="font-size:0.8rem;color:var(--text-muted)">Not rated</span>'}
        </div>
      </div>`;
  }).join('');
}

function setCellarFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderCellar();
}
function filterCellar() { renderCellar(); }

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
    category: isWhiskey(type) ? 'whiskey' : isTequila(type) ? 'tequila' : SPIRIT_TYPES.includes(type) ? 'spirit' : 'wine',
    age: isSW ? (parseInt(document.getElementById('whiskeyAge').value) || null) : null,
    abv: isSW ? (parseFloat(document.getElementById('whiskeyAbv').value) || null) : null,
    currency: 'EUR',
    size: '750ml',
    imageUrl: pendingBottleImage || null,
  };

  if (editingBottleId) {
    // Editing: preserve fields not in the form
    const existing = cellar.find(b => b.id === editingBottleId);
    if (existing) {
      bottle.addedDate = existing.addedDate;
      bottle.rating = existing.rating;
      bottle.ctId = existing.ctId;
      bottle.communityScore = existing.communityScore;
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
  const currSym = (w.currency || 'EUR') === 'EUR' ? '€' : '$';

  const modalImgSrc = w.imageUrl ? (w.imageUrl.startsWith('data:') || w.imageUrl.startsWith('/') ? w.imageUrl : `/api/images/proxy?url=${encodeURIComponent(w.imageUrl)}`) : '';

  const body = document.getElementById('modalBody');
  body.innerHTML = `
    ${modalImgSrc ? `<img class="modal-bottle-image" src="${modalImgSrc}" alt="${escHTML(w.name)}" onerror="this.style.display='none'">` : ''}
    <h2 class="modal-wine-title">${escHTML(w.name)}</h2>
    <p class="modal-wine-subtitle">${escHTML(w.producer || '')} ${w.vintage ? '· ' + w.vintage : ''} · ${escHTML(w.region || '')}${w.age ? ' · ' + w.age + ' Year' : ''}${w.designation ? ' · ' + escHTML(w.designation) : ''}</p>
    <div class="modal-detail-grid">
      <div class="modal-detail-item"><label>Type</label><div class="value"><span class="wine-type-dot type-${w.type.replace(/\s/g, '')}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px"></span>${w.type}</div></div>
      ${isSW ? `<div class="modal-detail-item"><label>ABV</label><div class="value">${w.abv ? w.abv + '%' : '—'}</div></div>` : `<div class="modal-detail-item"><label>Grape</label><div class="value">${escHTML(w.grape || '—')}</div></div>`}
      <div class="modal-detail-item"><label>Quantity</label><div class="value">${w.quantity || 1} bottle${(w.quantity || 1) > 1 ? 's' : ''}${w.pending ? ` <span style="font-size:0.75rem;color:var(--warning)">(${w.pending} pending)</span>` : ''}</div></div>
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
    ${wineTastings.length > 0 ? `<h4 style="margin-top:1.5rem;margin-bottom:0.75rem;font-family:'DM Sans',sans-serif;font-weight:600;font-size:0.95rem">Tasting History</h4>${wineTastings.map(t => `<div class="tasting-note-card"><div class="tasting-note-header"><span class="tasting-note-rating">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</span><span class="date">${formatDate(t.date)}</span></div>${t.tags.length ? `<div class="tasting-note-tags">${t.tags.map(tag => `<span class="tag active">${tag}</span>`).join('')}</div>` : ''}${t.notes ? `<div class="tasting-note-text">${escHTML(t.notes)}</div>` : ''}</div>`).join('')}` : ''}
    ${w.editHistory && w.editHistory.length > 0 ? `<h4 style="margin-top:1.5rem;margin-bottom:0.75rem;font-family:'DM Sans',sans-serif;font-weight:600;font-size:0.95rem">Edit History</h4>${w.editHistory.slice().reverse().map(entry => {
      const d = new Date(entry.date);
      const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `<div class="edit-history-entry" style="padding:0.6rem 0.75rem;margin-bottom:0.5rem;background:var(--bg);border-radius:var(--radius-xs);border:1px solid var(--border);font-size:0.82rem"><div style="color:var(--text-muted);margin-bottom:0.35rem">${dateStr}</div>${entry.changes.map(c => `<div style="line-height:1.5"><span style="font-weight:600;text-transform:capitalize">${c.field}</span>: <span style="color:var(--danger);text-decoration:line-through">${escHTML(c.from)}</span> → <span style="color:var(--success)">${escHTML(c.to)}</span></div>`).join('')}</div>`;
    }).join('')}` : ''}
    <div class="modal-actions">
      <button class="btn btn-primary btn-sm" onclick="editBottle('${w.id}')">Edit</button>
      <button class="btn btn-secondary btn-sm" onclick="drinkBottle('${w.id}')">Open a Bottle</button>
      <button class="btn btn-danger btn-sm" onclick="removeWine('${w.id}')">Remove</button>
    </div>`;

  document.getElementById('wineModal').classList.add('open');
}

function closeModal(event) { if (event.target === document.getElementById('wineModal')) closeWineModal(); }
function closeWineModal() { document.getElementById('wineModal').classList.remove('open'); }

function drinkBottle(id) {
  const w = cellar.find(b => b.id === id);
  if (!w) return;
  w.quantity = Math.max(0, (parseInt(w.quantity) || 1) - 1);
  if (w.quantity === 0) { cellar = cellar.filter(b => b.id !== id); closeWineModal(); showToast(`Last bottle of ${w.name} — enjoy!`); }
  else showToast(`Opened a ${w.name}. ${w.quantity} left.`);
  saveCellar(cellar); renderCellar(); renderDashboard();
}

function removeWine(id) {
  const w = cellar.find(b => b.id === id);
  cellar = cellar.filter(b => b.id !== id);
  saveCellar(cellar); closeWineModal();
  showToast(`${w ? w.name : 'Bottle'} removed`);
  renderCellar(); renderDashboard();
}

// ============ CAMERA & SCANNING FLOW ============

let cameraStream = null;
let scanMode = 'idle'; // idle | barcode | label | label-only
let barcodeInterval = null;
let barcodeData = null; // data from barcode lookup, to merge with label
let autoCapCountdown = null;

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
  stopBarcodeScan();
  clearAutoCapCountdown();
  const video = document.getElementById('cameraVideo');
  // Full cleanup of ZXing (reset is ok here since we're closing everything)
  if (window._zxingReader) {
    try { window._zxingReader.reset(); } catch(e) {}
    window._zxingReader = null;
  }
  // Stop all camera tracks
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
  barcodeData = null;
}

// === UNIFIED SCAN FLOW ===
// Step 1: Open camera, look for barcode
// Step 2: Barcode found → lookup → show result → prompt for label
// Step 3: Capture label → GPT-4o Vision → merge with barcode data → fill form

async function startScanFlow() {
  barcodeData = null;
  scanMode = 'barcode';

  const preview = document.getElementById('cameraPreview');
  preview.style.display = 'block';

  // Always open camera ourselves — we manage the stream, barcode libs just decode
  await openCamera();
  setScanStatus('Point at the barcode on the back of the bottle...');
  showToast('Scan the barcode first');
  startBarcodeScan();

  // Fallback: if no barcode detected within 12 seconds, skip to label capture
  window._barcodeScanTimeout = setTimeout(() => {
    if (scanMode === 'barcode') {
      console.log('[Scan] Barcode timeout — skipping to label capture');
      stopBarcodeScan();
      setScanStatus('No barcode found — capture the front label instead', true);
      showToast('No barcode found. Capture the label instead.');
      scanMode = 'label';
      startAutoCapCountdown(5);
    }
  }, 12000);
}

async function startLabelOnly() {
  barcodeData = null;
  scanMode = 'label-only';
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

function startBarcodeScan() {
  const video = document.getElementById('cameraVideo');
  console.log('[Scan] Starting barcode scan. BarcodeDetector:', 'BarcodeDetector' in window, 'ZXing:', typeof ZXing !== 'undefined');

  // Try native BarcodeDetector first (Chrome, Edge — NOT Safari)
  if ('BarcodeDetector' in window) {
    console.log('[Scan] Using native BarcodeDetector');
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128'] });
    let scanning = true;
    barcodeInterval = setInterval(async () => {
      if (!scanning) return;
      if (!cameraStream || scanMode !== 'barcode') {
        console.log('[Scan] BarcodeDetector stopping — stream:', !!cameraStream, 'mode:', scanMode);
        stopBarcodeScan();
        return;
      }
      // Wait for video to have actual frames
      if (!video.videoWidth || video.readyState < 2) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0 && scanning) {
          scanning = false; // prevent duplicate detections
          const code = barcodes[0].rawValue;
          console.log('[Scan] Native BarcodeDetector found:', code);
          // Stop the interval and timeout, but keep the camera stream alive
          if (barcodeInterval) { clearInterval(barcodeInterval); barcodeInterval = null; }
          if (window._barcodeScanTimeout) { clearTimeout(window._barcodeScanTimeout); window._barcodeScanTimeout = null; }
          setScanStatus(`Barcode found: ${code} — looking up...`, true);
          await lookupBarcodeForFlow(code);
        }
      } catch (e) {
        // detect() can throw if video isn't ready — that's fine, just retry
        if (e.name !== 'InvalidStateError') {
          console.warn('[Scan] BarcodeDetector.detect error:', e.message);
        }
      }
    }, 500);
    return;
  }

  // Fallback: ZXing library — works on Safari, Firefox, and all browsers
  if (typeof ZXing !== 'undefined' && ZXing.BrowserMultiFormatReader) {
    console.log('[Scan] Using ZXing BrowserMultiFormatReader (Safari/Firefox compatible)');
    startZxingVideoScan();
    return;
  }

  // No barcode scanning available — let user skip to label
  console.log('[Scan] No barcode API available');
  setScanStatus('Barcode scanning not available — tap Capture to photograph the label instead');
}

function startZxingVideoScan() {
  const video = document.getElementById('cameraVideo');

  // We already have our own camera stream open — feed it to ZXing for decoding
  if (!cameraStream || !video.srcObject) {
    console.error('[Scan] ZXing: no camera stream available');
    setScanStatus('Camera not ready — tap Capture to photograph the label instead');
    return;
  }

  const codeReader = new ZXing.BrowserMultiFormatReader();
  window._zxingReader = codeReader;

  console.log('[Scan] Starting ZXing decodeFromStream (using our camera stream)...');

  // decodeFromStream uses OUR stream — doesn't open its own camera
  codeReader.decodeFromStream(cameraStream, video, (result, err) => {
    if (result) {
      const code = typeof result.getText === 'function' ? result.getText() : result.text || String(result);
      console.log('[Scan] ZXing barcode found:', code);

      // Stop ZXing decoding but keep our camera stream alive
      if (window._zxingReader) {
        try { window._zxingReader.stopContinuousDecode(); } catch(e) {}
        window._zxingReader = null;
      }

      // Clear the barcode timeout since we found one
      if (window._barcodeScanTimeout) { clearTimeout(window._barcodeScanTimeout); window._barcodeScanTimeout = null; }

      setScanStatus(`Barcode found: ${code} — looking up...`, true);
      lookupBarcodeForFlow(code);
    }
    if (err && err.name !== 'NotFoundException') {
      console.warn('[Scan] ZXing error:', err.name, err.message);
    }
  });
  console.log('[Scan] ZXing decodeFromStream started');
}

function stopBarcodeScan() {
  // Clear barcode timeout
  if (window._barcodeScanTimeout) { clearTimeout(window._barcodeScanTimeout); window._barcodeScanTimeout = null; }
  // Clear native BarcodeDetector interval
  if (barcodeInterval) { clearInterval(barcodeInterval); barcodeInterval = null; }
  // Stop ZXing decoding (but NOT the camera stream — we own it)
  if (window._zxingReader) {
    try {
      if (typeof window._zxingReader.stopContinuousDecode === 'function') {
        window._zxingReader.stopContinuousDecode();
      }
      // Don't call reset() — it kills the video stream
      console.log('[Scan] ZXing decoding stopped');
    } catch (e) {
      console.warn('[Scan] ZXing stop error:', e.message);
    }
    window._zxingReader = null;
  }
}

function clearAutoCapCountdown() {
  if (autoCapCountdown) { clearInterval(autoCapCountdown); autoCapCountdown = null; }
}

// JSONP helper — works from file:// protocol where fetch() is blocked
function jsonpFetch(url, callbackParam = 'callback', timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const cbName = '_jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      const el = document.getElementById(cbName);
      if (el) el.remove();
    }
    window[cbName] = (data) => { cleanup(); resolve(data); };
    const sep = url.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    script.id = cbName;
    script.src = url + sep + callbackParam + '=' + cbName;
    script.onerror = () => { cleanup(); reject(new Error('JSONP script error')); };
    document.head.appendChild(script);
  });
}

async function lookupBarcodeForFlow(code) {
  console.log('[Scan] Barcode detected:', code, '- starting lookup...');
  console.log('[Scan] Protocol:', location.protocol, '(file:// = fetch may be blocked)');
  setScanStatus(`Barcode: ${code}. Looking up product...`);

  // Helper: try a fetch with timeout
  async function tryFetch(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // Try Open Food Facts — fetch first, then JSONP fallback for file:// protocol
  try {
    let data;
    const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    try {
      console.log('[Scan] Trying OFF via fetch...');
      const resp = await tryFetch(offUrl);
      data = await resp.json();
      console.log('[Scan] OFF fetch succeeded');
    } catch (fetchErr) {
      console.warn('[Scan] OFF fetch failed:', fetchErr.message, '- trying JSONP...');
      // JSONP fallback — Open Food Facts supports it
      data = await jsonpFetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
      console.log('[Scan] OFF JSONP succeeded');
    }
    console.log('[Scan] OFF response status:', data.status, 'has product:', !!data.product, 'name:', data.product?.product_name);
    if (data.status === 1 && data.product && data.product.product_name) {
      barcodeData = parseOpenFoodFactsProduct(data.product);
      console.log('[Scan] OFF match:', barcodeData.name, barcodeData.type, barcodeData.category);
      setScanStatus(`Found: ${barcodeData.name}. Now scan the front label.`, true);
      showToast(`Found: ${barcodeData.name}. Now scan the front label!`);
      scanMode = 'label';
      startAutoCapCountdown(5);
      return;
    }
    console.log('[Scan] OFF: product not found for barcode', code);
  } catch (err) {
    console.warn('[Scan] OFF all attempts failed:', err.message);
  }

  // Try UPC Item DB (fetch only — no JSONP support)
  try {
    console.log('[Scan] Trying UPC Item DB via fetch...');
    const resp2 = await tryFetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
    const data2 = await resp2.json();
    console.log('[Scan] UPC Item DB response:', data2.code, 'items:', data2.items?.length);
    if (data2.items && data2.items.length > 0 && data2.items[0].title) {
      const item = data2.items[0];
      barcodeData = {
        name: item.title, producer: item.brand || '', type: 'Red', category: 'wine',
        region: '', vintage: null, age: null, abv: null, grape: '', price: null,
        drinkFrom: null, drinkUntil: null,
      };
      const allText = ((item.title || '') + ' ' + (item.brand || '') + ' ' + (item.category || '') + ' ' + (item.description || '')).toLowerCase();
      if (/whisk[e]?y|scotch|bourbon|single malt/.test(allText)) {
        barcodeData.category = 'whiskey';
        barcodeData.type = allText.includes('bourbon') ? 'Bourbon' : allText.includes('scotch') ? 'Scotch' : 'Single Malt';
      } else if (/tequila|mezcal|agave/.test(allText)) {
        barcodeData.category = 'tequila'; barcodeData.type = allText.includes('mezcal') ? 'Mezcal' : 'Tequila';
      } else if (/\brum\b/.test(allText)) { barcodeData.category = 'spirit'; barcodeData.type = 'Rum'; }
      else if (/cognac|brandy/.test(allText)) { barcodeData.category = 'spirit'; barcodeData.type = allText.includes('cognac') ? 'Cognac' : 'Brandy'; }
      else if (/\bgin\b/.test(allText)) { barcodeData.category = 'spirit'; barcodeData.type = 'Gin'; }
      else if (/wine/.test(allText)) {
        if (/white/.test(allText)) barcodeData.type = 'White';
        else if (/ros[eé]/.test(allText)) barcodeData.type = 'Rosé';
        else if (/sparkling|champagne/.test(allText)) barcodeData.type = 'Sparkling';
      }
      setScanStatus(`Found: ${barcodeData.name}. Now scan the front label.`, true);
      showToast(`Found: ${barcodeData.name}. Now scan the front label!`);
      scanMode = 'label';
      startAutoCapCountdown(5);
      return;
    }
    console.log('[Scan] UPC Item DB: product not found for barcode', code);
  } catch (err2) {
    console.warn('[Scan] UPC Item DB fetch error:', err2.message);
  }

  // No match in barcode DBs — normal for spirits. Move straight to label scan.
  console.log('[Scan] No barcode match found — moving to label scan');
  setScanStatus('Now scan the front label — AI will identify the bottle', true);
  showToast('Scan the front label for AI recognition');
  scanMode = 'label';
  startAutoCapCountdown(5);
}

async function startAutoCapCountdown(seconds) {
  clearAutoCapCountdown();
  // Clear barcode scan timeout
  if (window._barcodeScanTimeout) { clearTimeout(window._barcodeScanTimeout); window._barcodeScanTimeout = null; }

  // Ensure camera is active before starting countdown
  const video = document.getElementById('cameraVideo');
  console.log('[AutoCap] Camera check — srcObject:', !!video.srcObject, 'stream:', !!cameraStream, 'width:', video.videoWidth);
  if (!video.srcObject || !cameraStream || !video.videoWidth) {
    console.log('[AutoCap] Camera not active — re-opening for label capture');
    await openCamera();
  }

  let remaining = seconds;
  setScanStatus(`Now flip to the front label. Auto-capture in <span class="scan-countdown">${remaining}s</span>`, true);
  autoCapCountdown = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearAutoCapCountdown();
      capturePhoto();
    } else {
      setScanStatus(`Now flip to the front label. Auto-capture in <span class="scan-countdown">${remaining}s</span>`, true);
    }
  }, 1000);
}

async function capturePhoto() {
  clearAutoCapCountdown();
  const wasBarcodeMode = scanMode === 'barcode';
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('captureCanvas');

  // Stop any active barcode scanning (keeps camera stream alive)
  stopBarcodeScan();

  // Check if video is actually showing frames
  console.log('[Capture] Video state — srcObject:', !!video.srcObject, 'width:', video.videoWidth, 'readyState:', video.readyState, 'cameraStream:', !!cameraStream);

  if (!video.srcObject || !video.videoWidth || video.readyState < 2) {
    console.log('[Capture] Video not ready — opening camera');
    await openCamera();
    // Wait for real frames
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

  // Capture the frame
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  console.log('[Capture] Frame captured:', w, 'x', h);
  closeCamera();

  if (wasBarcodeMode) {
    // User tapped Capture during barcode phase — skip barcode, go straight to label
    barcodeData = null;
  }

  processLabelImage(dataUrl);
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => processLabelImage(e.target.result);
  reader.readAsDataURL(file);
  event.target.value = '';
}

// Legacy aliases for any other references
function startCamera() { openCamera(); }
function stopCamera() { closeCamera(); }
function startBarcodeScanner() { startScanFlow(); }

// ---- Open Food Facts product parser ----

function parseOpenFoodFactsProduct(p) {
  const name = p.product_name || p.product_name_en || '';
  const brand = p.brands || '';
  const cats = (p.categories || '').toLowerCase();
  const labels = (p.labels || '').toLowerCase();
  const origins = p.origins || p.origin || '';
  const allText = (name + ' ' + brand + ' ' + cats + ' ' + labels + ' ' + (p.generic_name || '')).toLowerCase();

  // Detect type
  const isWhisk = /whisk[e]?y|bourbon|scotch|rye whiskey|single malt|blended malt/.test(allText);
  const isTequilaOrMezcal = /tequila|mezcal|agave/.test(allText);
  const isRum = /\brum\b|\bron\b/.test(allText);
  const isCognac = /cognac|brandy/.test(allText);
  const isGin = /\bgin\b/.test(allText);

  let type = 'Red';
  let category = 'wine';
  if (isWhisk) {
    if (allText.includes('bourbon')) type = 'Bourbon';
    else if (allText.includes('scotch') || allText.includes('single malt')) type = 'Scotch';
    else if (allText.includes('irish')) type = 'Irish';
    else if (allText.includes('japanese') || allText.includes('japan')) type = 'Japanese';
    else if (allText.includes('rye')) type = 'Rye';
    else if (allText.includes('tennessee')) type = 'Tennessee';
    else type = 'Blended';
    category = 'whiskey';
  } else if (isTequilaOrMezcal) {
    type = allText.includes('mezcal') ? 'Mezcal' : 'Tequila'; category = 'tequila';
  } else if (isRum) { type = 'Rum'; category = 'spirit'; }
  else if (isCognac) { type = allText.includes('cognac') ? 'Cognac' : 'Brandy'; category = 'spirit'; }
  else if (isGin) { type = 'Gin'; category = 'spirit'; }
  else {
    if (/white wine|vin blanc|bianco/.test(cats)) type = 'White';
    else if (/rosé|rose wine/.test(cats)) type = 'Rosé';
    else if (/sparkling|champagne|prosecco|cava/.test(cats)) type = 'Sparkling';
    else if (/dessert|sweet wine|sauternes|port/.test(cats)) type = 'Dessert';
  }

  const vintageMatch = (name + ' ' + (p.generic_name || '')).match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const vintage = vintageMatch ? parseInt(vintageMatch[1]) : null;

  // Age statement for whiskey
  const ageMatch = allText.match(/(\d{1,2})\s*(?:year|yr|ans|jahre)/);
  const age = ageMatch ? parseInt(ageMatch[1]) : null;

  // ABV
  const abv = p.nutriments?.alcohol_100g || null;

  // Region
  const regionMap = {
    'bordeaux': 'Bordeaux, France', 'burgundy': 'Burgundy, France', 'champagne': 'Champagne, France',
    'tuscany': 'Tuscany, Italy', 'toscana': 'Tuscany, Italy', 'rioja': 'Rioja, Spain',
    'napa': 'Napa Valley, USA', 'islay': 'Islay, Scotland', 'speyside': 'Speyside, Scotland',
    'highland': 'Highland, Scotland', 'kentucky': 'Kentucky, USA', 'tennessee': 'Tennessee, USA',
    'japan': 'Japan', 'ireland': 'Ireland', 'marlborough': 'Marlborough, New Zealand',
  };
  let region = origins;
  const rText = (origins + ' ' + cats + ' ' + labels).toLowerCase();
  for (const [k, v] of Object.entries(regionMap)) { if (rText.includes(k)) { region = v; break; } }

  const isSpirType = category !== 'wine';
  return {
    name: name || brand || 'Unknown', producer: brand || '', vintage, type,
    grape: isSpirType ? '' : '', region, price: null, age, abv,
    drinkFrom: !isSpirType && vintage ? vintage + 2 : null,
    drinkUntil: !isSpirType && vintage ? vintage + (type === 'Red' ? 15 : 5) : null,
    category,
  };
}

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
            { type: 'text', text: `Analyze this bottle label image and extract all information. Return ONLY valid JSON with these fields (use null for unknown):
{
  "name": "full product name",
  "producer": "producer/brand/distillery/winery",
  "vintage": year as number or null,
  "type": one of "Red","White","Rosé","Sparkling","Dessert","Fortified","Scotch","Bourbon","Irish","Japanese","Rye","Single Malt","Blended","Tennessee","Tequila","Mezcal","Rum","Cognac","Brandy","Gin","Other Spirit",
  "category": "wine" or "whiskey" or "tequila" or "spirit",
  "grape": "grape varietal" or null,
  "region": "region, country",
  "age": age statement as number or null,
  "abv": ABV percentage as number or null,
  "designation": "special designation/edition" or null,
  "size": "bottle size" or "750ml"
}` },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }],
        max_tokens: 500,
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

    // Add computed fields
    if (extracted.category !== 'wine' && extracted.vintage) {
      extracted.drinkFrom = null;
      extracted.drinkUntil = null;
    } else if (extracted.vintage) {
      extracted.drinkFrom = extracted.vintage + 2;
      extracted.drinkUntil = extracted.vintage + (extracted.type === 'Red' ? 15 : extracted.type === 'White' ? 5 : 10);
    }

    // Merge with barcode data if we have it
    if (barcodeData) {
      const merged = { ...barcodeData };
      // Vision data takes priority for most fields, barcode fills gaps
      for (const [key, val] of Object.entries(extracted)) {
        if (val !== null && val !== undefined && val !== '') merged[key] = val;
      }
      // But if vision didn't find name/producer, use barcode
      if (!extracted.name && barcodeData.name) merged.name = barcodeData.name;
      if (!extracted.producer && barcodeData.producer) merged.producer = barcodeData.producer;
      Object.assign(extracted, merged);
      barcodeData = null;
    }

    hideProcessing();
    showScanResults(extracted);
    populateFormFromScan(extracted);
    showToast(extracted.name ? `Recognized: ${extracted.name}` : 'Analysis complete — review fields.');
  } catch (err) {
    hideProcessing();
    // If vision failed but we have barcode data, use that
    if (barcodeData) {
      showScanResults(barcodeData);
      populateFormFromScan(barcodeData);
      showToast('Vision failed, using barcode data. ' + (err.message || ''));
      barcodeData = null;
    } else {
      showToast('Vision API error: ' + (err.message || 'Unknown error'));
    }
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
  const validCats = ['wine', 'whiskey', 'tequila', 'spirit'];
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
    const currency = get(row, 'Currency') || get(row, 'currency') || 'EUR';
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

    if (ctType === 'Spirits' || ctCategory === 'Distilled' || /whisk[e]?y|scotch|bourbon|single malt|tequila|mezcal|\brum\b|cognac|brandy|\bgin\b|vodka/i.test(allText)) {
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
      else if (/\brum\b|\bron\b/i.test(allText)) { type = 'Rum'; category = 'spirit'; }
      else if (/cognac/i.test(allText)) { type = 'Cognac'; category = 'spirit'; }
      else if (/brandy/i.test(allText)) { type = 'Brandy'; category = 'spirit'; }
      else if (/\bgin\b/i.test(allText)) { type = 'Gin'; category = 'spirit'; }
      else if (/vodka/i.test(allText)) { type = 'Vodka'; category = 'spirit'; }
      else { type = 'Other Spirit'; category = 'spirit'; }
    } else if (ctType === 'Red' || ctColor === 'Red') { type = 'Red'; }
    else if (ctType === 'White' || ctColor === 'White') { type = 'White'; }
    else if (/ros[eé]/i.test(ctType + ctColor)) { type = 'Rosé'; }
    else if (/sparkling|champagne/i.test(ctType + ctColor)) { type = 'Sparkling'; }
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
