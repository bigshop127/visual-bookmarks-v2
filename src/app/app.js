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
  if (role === 'CREATOR') localStorage.setItem(AUTH.CREATOR.key, payload);
  else sessionStorage.setItem(AUTH.WORM.key, payload);
}

function loadSession() {
  const cStr = localStorage.getItem(AUTH.CREATOR.key);
  if (cStr) {
    const cData = JSON.parse(cStr);
    if (Date.now() - cData.ts < AUTH.SESSION_DURATION * 6 * 24) return 'CREATOR';
  }
  const wStr = sessionStorage.getItem(AUTH.WORM.key);
  if (wStr) {
    const wData = JSON.parse(wStr);
    if (Date.now() - wData.ts < AUTH.SESSION_DURATION) return 'WORM';
  }
  return null;
}

function keepSessionAlive() {
  setInterval(() => { if (state.role) saveSession(state.role); }, 60000);
}

function showLoginScreen() {
  return new Promise((resolve) => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="login-overlay" id="loginOverlay">
        <div class="login-box">
          <h2>身分驗證</h2>
          <label class="role-option">
            <input type="radio" name="role" value="CREATOR" checked> ${AUTH.CREATOR.label}
          </label>
          <label class="role-option" style="margin-bottom: 16px;">
            <input type="radio" name="role" value="WORM"> ${AUTH.WORM.label}
          </label>
          <div class="login-pw-wrap">
            <input type="password" id="loginPw" placeholder="請輸入訪問密碼..." autocomplete="new-password">
            <div class="login-error" id="loginError"></div>
          </div>
          <button class="login-btn" id="loginBtn">進入網站</button>
        </div>
      </div>
    `);
    const overlay = document.getElementById('loginOverlay');
    const btn = document.getElementById('loginBtn');
    const input = document.getElementById('loginPw');
    const err = document.getElementById('loginError');

    const doLogin = async () => {
      const pw = input.value.trim();
      if (!pw) return err.textContent = '請輸入密碼';
      const role = document.querySelector('input[name="role"]:checked').value;
      const targetHash = AUTH[role].hash;
      const inputHash = await sha256(pw);
      
      if (inputHash === targetHash) {
        overlay.remove();
        saveSession(role);
        resolve(role);
      } else {
        err.textContent = '密碼錯誤，請重新輸入';
        input.value = '';
      }
    };
    btn.addEventListener('click', doLogin);
    input.addEventListener('keypress', e => e.key === 'Enter' && doLogin());
  });
}

// ─── 全域狀態與工具 ─────────────────────────────────────────
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
  if (quoted) return quoted[1].trim();
  return raw.replace(/^PHOTOS\s*[-–]\s*Search Results For\s*/i, '').replace(/\s*[-–]\s*禁漫天堂\s*$/i, '').replace(/^Search Results For\s*/i, '').trim() || raw;
}

window.showToast = (msg) => {
  const existing = document.querySelector('.vb-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'vb-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
};

window.trackView = (id) => {
  state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 20);
  localStorage.setItem('recentViews', JSON.stringify(state.recent));
};

window.toggleFav = (e, id) => {
  e.preventDefault(); e.stopPropagation();
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter(x => x !== id);
    e.target.classList.remove('fav-active');
    showToast('已移出我的最愛');
  } else {
    state.favorites.push(id);
    e.target.classList.add('fav-active');
    showToast('已加入我的最愛');
  }
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
};

window.openColPicker = (e, id) => {
  e.preventDefault(); e.stopPropagation();
  showToast('收藏夾功能建置中');
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

// ─── 卡片渲染 (獨立跳轉按鈕版) ────────────────────────────────
function createCard(item) {
  const isFav = state.favorites.includes(item.id) ? 'fav-active' : '';
  const isScreenshot = item.coverImage.includes('/screenshots/');
  const displayTitle = cleanTitle(item.title);

  return `
    <div class="card" data-id="${item.id}" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <button class="btn-fav ${isFav}" onclick="toggleFav(event, '${item.id}')">❤</button>
      <button class="btn-collect" onclick="openColPicker(event, '${item.id}')">＋</button>
      
      <div class="card-cover-wrap">
        <img class="card-cover${isScreenshot ? ' screenshot-cover' : ''}"
             src="${item.coverImage}" loading="lazy" ${isScreenshot ? 'data-crop="380"' : ''} />
        <div class="card-overlay"></div>
      </div>
      
      <div class="card-body">
        <h3 class="title">${displayTitle}</h3>
        <div class="meta">${item.domain}</div>
      </div>
      
      <a class="btn-goto" href="${item.finalUrl}" target="_blank" onclick="trackView('${item.id}')">前往 ➔</a>
    </div>
  `;
}

function applyCropOffsets() {
  document.querySelectorAll('img.screenshot-cover[data-crop]').forEach(img => {
    const apply = () => img.style.marginTop = `-${parseInt(img.dataset.crop) * (img.offsetWidth / 1280)}px`;
    if (img.complete && img.naturalWidth) apply(); else img.addEventListener('load', apply, { once: true });
  });
}

function render(items) {
  const root = document.querySelector('#grid');
  root.innerHTML = items.slice(0, 20).map(createCard).join('');
  setTimeout(applyCropOffsets, 50);
  if (items.length > 20) {
    setTimeout(() => { 
      root.insertAdjacentHTML('beforeend', items.slice(20).map(createCard).join('')); 
      applyCropOffsets(); 
    }, 80);
  }
}

// ─── 手機端長按預覽邏輯 (防呆) ──────────────────────────────
function bindTouchPreview() {
  let timer = null;
  let activeCard = null;

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (activeCard) {
      activeCard.classList.remove('preview-active');
      activeCard = null;
    }
  }

  document.getElementById('grid').addEventListener('touchstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    // 點擊按鈕區塊不觸發預覽
    if (e.target.closest('button') || e.target.closest('.btn-goto')) return;

    clear();
    timer = setTimeout(() => {
      activeCard = card;
      card.classList.add('preview-active');
    }, 300); // 0.3 秒判定為長按
  }, { passive: true });

  // 手指移動或離開螢幕時立即終止預覽
  document.addEventListener('touchmove', clear, { passive: true });
  document.addEventListener('touchend', clear);
  document.addEventListener('touchcancel', clear);
}

// ─── 手機抽屜選單邏輯 ───────────────────────────────────────
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

  // 往下滑動主區塊時自動收合選單
  document.querySelector('main').addEventListener('touchstart', () => wrapper.classList.remove('open'), { passive: true });
}

// ─── 初始化與事件綁定 ───────────────────────────────────────
function initSidebar(items) {
  const folders = new Set();
  items.forEach(i => { if (i.folderPath) folders.add(i.folderPath.split(' / ')[0]); });
  
  const list = document.getElementById('folderList');
  if (list) {
    Array.from(folders).sort().forEach(f => {
      if (f) list.insertAdjacentHTML('beforeend', `<li data-folder="${f}">${f}</li>`);
    });
    
    list.addEventListener('click', e => {
      if (e.target.tagName === 'LI') {
        list.querySelectorAll('li').forEach(li => li.classList.remove('active'));
        e.target.classList.add('active');
        const folder = e.target.dataset.folder;
        state.filtered = folder === 'all' ? state.items : state.items.filter(i => i.folderPath && i.folderPath.startsWith(folder));
        render(state.filtered);
      }
    });
  }

  const actionList = document.getElementById('actionList');
  if (actionList) {
    actionList.addEventListener('click', e => {
      const action = e.target.dataset.action;
      if (!action) return;
      actionList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
      e.target.classList.add('active');
      
      if (action === 'recent') {
        render(state.items.filter(i => state.recent.includes(i.id)).sort((a,b) => state.recent.indexOf(a.id) - state.recent.indexOf(b.id)));
      } else if (action === 'favorite') {
        render(state.items.filter(i => state.favorites.includes(i.id)));
      } else if (action === 'random') {
        const shuffled = [...state.items].sort(() => 0.5 - Math.random());
        render(shuffled.slice(0, 5));
      }
    });
  }
}

function wireSpeedSlider() {
  const slider = document.querySelector('#previewSpeed');
  if (!slider) return;
  slider.value = state.previewSpeed;
  slider.addEventListener('input', e => {
    state.previewSpeed = Number(e.target.value);
    localStorage.setItem('previewSpeed', state.previewSpeed);
    document.querySelectorAll('.card').forEach(card => card.style.setProperty('--preview-duration', `${state.previewSpeed}s`));
  });
}

function wireSearch(items) {
  const fuse = new Fuse(items, { keys: ['title', 'domain'], threshold: 0.35 });
  document.querySelector('#searchInput').addEventListener('input', e => {
    const val = e.target.value.trim();
    render(val ? fuse.search(val).map(r => r.item) : state.filtered);
  });
}

// ─── 入口 ────────────────────────────────────────────────────
async function main() {
  state.role = loadSession();
  if (!state.role) state.role = await showLoginScreen();
  keepSessionAlive();

  const roleTag = document.createElement('div');
  roleTag.className = 'role-tag';
  roleTag.textContent = isCreator() ? '👑 造物主' : '🐛 小淫蟲';
  document.querySelector('.toolbar').prepend(roleTag);

  state.items = await loadAllItems();
  state.filtered = state.items;
  
  initSidebar(state.items);
  render(state.items);
  
  bindTouchPreview();
  initDrawer();
  wireSearch(state.items);
  wireSpeedSlider();
}

main();
