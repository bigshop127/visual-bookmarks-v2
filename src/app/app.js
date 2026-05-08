import Fuse from './assets/fuse.mjs';

// ─── 身分驗證 ───────────────────────────────────────────────
const AUTH = {
  CREATOR: { hash: '7858b5c12a547409fd80f4920ca09f59a2ebe87d64e6f55e1237311499eed094', label: '至高無上的造物主本人', key: 'vb_creator_session', remember: true },
  WORM: { hash: 'f747870ae666c39b589f577856a0f7198b3b81269cb0326de86d8046f2cf72db', label: '我是一隻小淫蟲', key: 'vb_worm_session', remember: false },
  SESSION_DURATION: 10 * 60 * 1000,
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function saveSession(role) {
  const payload = JSON.stringify({ role, ts: Date.now() });
  localStorage.setItem(role === 'CREATOR' ? AUTH.CREATOR.key : AUTH.WORM.key, payload);
}

function loadSession() {
  try {
    const cRaw = localStorage.getItem(AUTH.CREATOR.key);
    if (cRaw) {
      const { role, ts } = JSON.parse(cRaw);
      if (Date.now() - ts < AUTH.SESSION_DURATION * 100) return role;
    }
    const wRaw = localStorage.getItem(AUTH.WORM.key);
    if (wRaw) {
      const { role, ts } = JSON.parse(wRaw);
      if (Date.now() - ts < AUTH.SESSION_DURATION * 100) return role;
    }
  } catch {}
  return null;
}

function clearSession() {
  localStorage.removeItem(AUTH.CREATOR.key);
  localStorage.removeItem(AUTH.WORM.key);
}

function keepSessionAlive() {
  setInterval(() => { const r = loadSession(); if (r) saveSession(r); }, 60 * 1000);
}

function showLoginScreen() {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.id = 'loginBackdrop';
    backdrop.innerHTML = `
      <div class="login-box">
        <div class="login-title">⚡ 請選擇您的身分</div>
        <div class="login-roles">
          <label class="role-option"><input type="radio" name="role" value="CREATOR" /><span>👑 至高無上的造物主本人</span></label>
          <label class="role-option"><input type="radio" name="role" value="WORM" checked /><span>🐛 我是一隻小淫蟲</span></label>
        </div>
        <div class="login-pw-wrap"><input id="loginPw" type="password" placeholder="請輸入密碼..." autocomplete="off" /></div>
        <div id="loginError" class="login-error"></div>
        <button id="loginBtn" class="login-btn">進入</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    const pwInput = backdrop.querySelector('#loginPw');
    const errEl = backdrop.querySelector('#loginError');
    const btn = backdrop.querySelector('#loginBtn');
    async function attempt() {
      const role = backdrop.querySelector('input[name="role"]:checked')?.value;
      const hashed = await sha256(pwInput.value);
      if (hashed === (role === 'CREATOR' ? AUTH.CREATOR.hash : AUTH.WORM.hash)) {
        saveSession(role); backdrop.remove(); resolve(role);
      } else {
        errEl.textContent = '密碼錯誤'; pwInput.value = ''; pwInput.focus();
      }
    }
    btn.addEventListener('click', attempt);
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  });
}

// ─── 狀態與工具 ─────────────────────────────────────────────
const state = {
  items: [], filtered: [], role: null,
  previewSpeed: Number(localStorage.getItem('previewSpeed') || 22),
  recent: JSON.parse(localStorage.getItem('recentViews') || '[]'),
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
  collections: JSON.parse(localStorage.getItem('collections') || '[]'),
};

function isCreator() { return state.role === 'CREATOR'; }
function saveCollections() { localStorage.setItem('collections', JSON.stringify(state.collections)); }

function cleanTitle(raw) {
  if (!raw) return raw;
  const quoted = raw.match(/['"「」『』](.+?)['"「」『』]/);
  return quoted ? quoted[1].trim() : raw.replace(/PHOTOS\s*[-–]\s*Search Results For\s*/i, '').replace(/\s*[-–]\s*禁漫天堂\s*$/i, '').trim();
}

window.showToast = (msg) => {
  const t = document.createElement('div'); t.className = 'vb-toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
};

window.trackView = (id) => {
  state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 20);
  localStorage.setItem('recentViews', JSON.stringify(state.recent));
};

window.toggleFav = (e, id) => {
  e.preventDefault(); e.stopPropagation();
  const idx = state.favorites.indexOf(id);
  if (idx > -1) { state.favorites.splice(idx, 1); e.target.classList.remove('fav-active'); showToast('已移出我的最愛'); }
  else { state.favorites.push(id); e.target.classList.add('fav-active'); showToast('已加入我的最愛'); }
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
};

window.openColPicker = (e, id) => { e.preventDefault(); e.stopPropagation(); showToast('收藏夾功能建置中'); };

// ─── [核心功能] 專屬 App 喚醒與跳轉邏輯 (強化版) ─────────────────
window.handleJump = (e, url) => {
  e.preventDefault();
  e.stopPropagation();

  // 放寬正則表達式，同時支援 /album/123 與 /photo/123 格式
  const jmRegex = /(?:album|photo)\/(\d+)/;
  const match = url.match(jmRegex);
  
  if (match) {
    const albumId = match[1];
    const appUri = `jmcomic://album/${albumId}`;
    
    showToast('嘗試喚醒 App...');
    
    // 透過動態建立 a 標籤來觸發，提高 PWA 下的成功率
    const a = document.createElement('a');
    a.href = appUri;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // 延遲 2 秒後檢查。如果 App 成功喚醒，PWA 會退到背景 (document.hidden = true)
    // 只有在 PWA 依然留在畫面上時，才判定喚醒失敗並改開網頁
    setTimeout(() => {
      if (!document.hidden) {
        window.open(url, '_blank');
      }
    }, 2000);
  } else {
    // 一般連結直接開啟
    window.open(url, '_blank');
  }
};

async function loadAllItems() {
  const manifest = await (await fetch('./data/build-manifest.json')).json();
  const results = [];
  for (let i = 1; i <= manifest.shardCount; i++) {
    const res = await fetch(`./data/shards/items-${i}.json`);
    if (res.ok) results.push(...await res.json());
  }
  return results;
}

// ─── 卡片渲染 (整合 App 跳轉) ──────────────────────────────────
function createCard(item) {
  const isFav = state.favorites.includes(item.id) ? 'fav-active' : '';
  const isScreenshot = item.coverImage.includes('/screenshots/');
  const displayTitle = cleanTitle(item.title);

  return `
    <div class="card" data-id="${item.id}" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <button class="btn-fav ${isFav}" onclick="toggleFav(event, '${item.id}')">❤</button>
      <button class="btn-collect" onclick="openColPicker(event, '${item.id}')">＋</button>
      <div class="card-cover-wrap">
        <img class="card-cover${isScreenshot ? ' screenshot-cover' : ''}" src="${item.coverImage}" loading="lazy" ${isScreenshot ? 'data-crop="380"' : ''} />
        <div class="card-overlay"></div>
      </div>
      <div class="card-body">
        <h3 class="title">${displayTitle}</h3>
        <div class="meta">${item.domain}</div>
      </div>
      <a class="btn-goto" href="${item.finalUrl}" onclick="trackView('${item.id}'); handleJump(event, '${item.finalUrl}')">前往 ➔</a>
    </div>
  `;
}

function applyCropOffsets() {
  document.querySelectorAll('img.screenshot-cover[data-crop]').forEach(img => {
    const apply = () => img.style.marginTop = `-${parseInt(img.dataset.crop) * (img.offsetWidth / 1280)}px`;
    if (img.complete) apply(); else img.addEventListener('load', apply, { once: true });
  });
}

function render(items) {
  const root = document.querySelector('#grid');
  root.innerHTML = items.slice(0, 20).map(createCard).join('');
  setTimeout(applyCropOffsets, 50);
  if (items.length > 20) {
    setTimeout(() => { root.insertAdjacentHTML('beforeend', items.slice(20).map(createCard).join('')); applyCropOffsets(); }, 80);
  }
}

// ─── 點擊放大與收合邏輯 ─────────────────────────────────────
function bindClickPreview() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.btn-goto') || e.target.closest('.drawer-handle') || e.target.closest('.toolbar')) return;
    const card = e.target.closest('.card');
    const activeCards = document.querySelectorAll('.card.preview-active');
    if (card) {
      const isActive = card.classList.contains('preview-active');
      activeCards.forEach(c => c.classList.remove('preview-active'));
      if (!isActive) card.classList.add('preview-active');
    } else {
      activeCards.forEach(c => c.classList.remove('preview-active'));
    }
  });
}

// ─── 初始化選單與搜尋 ───────────────────────────────────────
function initDrawer() {
  const wrapper = document.getElementById('drawerWrapper');
  const handle = document.getElementById('drawerHandle');
  if (!wrapper || !handle) return;
  handle.addEventListener('click', () => wrapper.classList.toggle('open'));
  let startY = 0;
  handle.addEventListener('touchstart', e => startY = e.touches[0].clientY, { passive: true });
  handle.addEventListener('touchend', e => {
    const endY = e.changedTouches[0].clientY;
    if (endY - startY > 20) wrapper.classList.add('open');
    else if (startY - endY > 20) wrapper.classList.remove('open');
  });
  const m = document.querySelector('main');
  if(m) m.addEventListener('touchstart', () => wrapper.classList.remove('open'), { passive: true });
}

function initSidebar(items) {
  const folders = new Set();
  items.forEach(i => {
    if (i.folderPath) {
      const f = Array.isArray(i.folderPath) ? i.folderPath[0] : String(i.folderPath).split(' / ')[0];
      if (f) folders.add(f);
    }
  });
  const list = document.getElementById('folderList');
  if (list) {
    list.innerHTML = '<li class="active" data-folder="all">全部</li>';
    Array.from(folders).sort().forEach(f => list.insertAdjacentHTML('beforeend', `<li data-folder="${f}">${f}</li>`));
    list.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (li) {
        list.querySelectorAll('li').forEach(el => el.classList.remove('active')); li.classList.add('active');
        const f = li.dataset.folder;
        state.filtered = f === 'all' ? state.items : state.items.filter(i => (Array.isArray(i.folderPath) ? i.folderPath[0] : String(i.folderPath).split(' / ')[0]) === f);
        render(state.filtered);
      }
    });
  }
  const actionList = document.getElementById('actionList');
  if (actionList) {
    actionList.addEventListener('click', e => {
      const li = e.target.closest('li'); if (!li) return;
      const act = li.dataset.action; if (!act) return;
      actionList.querySelectorAll('li').forEach(el => el.classList.remove('active')); li.classList.add('active');
      if (act === 'recent') render(state.items.filter(i => state.recent.includes(i.id)).sort((a,b) => state.recent.indexOf(a.id) - state.recent.indexOf(b.id)));
      else if (act === 'favorite') render(state.items.filter(i => state.favorites.includes(i.id)));
      else if (act === 'random') render([...state.items].sort(() => 0.5 - Math.random()).slice(0, 5));
    });
  }
}

function wireSpeedSlider() {
  const s = document.querySelector('#previewSpeed'); if (!s) return;
  s.value = state.previewSpeed;
  s.addEventListener('input', e => {
    state.previewSpeed = Number(e.target.value);
    localStorage.setItem('previewSpeed', state.previewSpeed);
    document.querySelectorAll('.card').forEach(c => c.style.setProperty('--preview-duration', `${state.previewSpeed}s`));
  });
}

function wireSearch(items) {
  const input = document.querySelector('#searchInput'); if(!input) return;
  const fuse = new Fuse(items, { keys: ['title', 'domain'], threshold: 0.35 });
  input.addEventListener('input', e => {
    const val = e.target.value.trim();
    render(val ? fuse.search(val).map(r => r.item) : state.filtered);
  });
}

async function main() {
  state.role = loadSession();
  if (!state.role) state.role = await showLoginScreen();
  keepSessionAlive();
  const tb = document.querySelector('.toolbar');
  if(tb) {
    const tag = document.createElement('div'); tag.className = 'role-tag';
    tag.textContent = isCreator() ? '👑 造物主' : '🐛 小淫蟲';
    tb.prepend(tag);
  }
  state.items = await loadAllItems();
  state.filtered = state.items;
  initSidebar(state.items); render(state.items);
  bindClickPreview(); initDrawer(); wireSearch(state.items); wireSpeedSlider();
}

main();
