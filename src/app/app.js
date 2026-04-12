import Fuse from './assets/fuse.mjs';

// ─── 身分驗證 ───────────────────────────────────────────────
const AUTH = {
  CREATOR: {
    hash: '7858b5c12a547409fd80f4920ca09f59a2ebe87d64e6f55e1237311499eed094',
    label: '至高無上的造物主本人',
    key: 'vb_creator_session',
    remember: true,   // 記住登入狀態
  },
  WORM: {
    hash: 'f747870ae666c39b589f577856a0f7198b3b81269cb0326de86d8046f2cf72db',
    label: '我是一隻小淫蟲',
    key: 'vb_worm_session',
    remember: false,  // 關閉瀏覽器就登出（sessionStorage）
  },
  SESSION_DURATION: 10 * 60 * 1000, // 10 分鐘
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function saveSession(role) {
  const payload = JSON.stringify({ role, ts: Date.now() });
  if (role === 'CREATOR') {
    localStorage.setItem(AUTH.CREATOR.key, payload);
  } else {
    sessionStorage.setItem(AUTH.WORM.key, payload);
  }
}

function loadSession() {
  // 造物主：localStorage
  try {
    const raw = localStorage.getItem(AUTH.CREATOR.key);
    if (raw) {
      const { role, ts } = JSON.parse(raw);
      if (Date.now() - ts < AUTH.SESSION_DURATION) return role;
      localStorage.removeItem(AUTH.CREATOR.key);
    }
  } catch {}
  // 小淫蟲：sessionStorage
  try {
    const raw = sessionStorage.getItem(AUTH.WORM.key);
    if (raw) {
      const { role, ts } = JSON.parse(raw);
      if (Date.now() - ts < AUTH.SESSION_DURATION) return role;
      sessionStorage.removeItem(AUTH.WORM.key);
    }
  } catch {}
  return null;
}

function clearSession() {
  localStorage.removeItem(AUTH.CREATOR.key);
  sessionStorage.removeItem(AUTH.WORM.key);
}

// 每分鐘刷新 session timestamp，只要還在操作就不過期
function keepSessionAlive() {
  setInterval(() => {
    const role = loadSession();
    if (role) saveSession(role);
  }, 60 * 1000);
}

// ─── 登入 UI ────────────────────────────────────────────────
function showLoginScreen() {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.id = 'loginBackdrop';
    backdrop.innerHTML = `
      <div class="login-box">
        <div class="login-title">⚡ 請選擇您的身分</div>
        <div class="login-roles">
          <label class="role-option">
            <input type="radio" name="role" value="CREATOR" />
            <span>👑 至高無上的造物主本人</span>
          </label>
          <label class="role-option">
            <input type="radio" name="role" value="WORM" checked />
            <span>🐛 我是一隻小淫蟲</span>
          </label>
        </div>
        <div class="login-pw-wrap">
          <input id="loginPw" type="password" placeholder="請輸入密碼..." autocomplete="off" />
        </div>
        <div id="loginError" class="login-error"></div>
        <button id="loginBtn" class="login-btn">進入</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const pwInput = backdrop.querySelector('#loginPw');
    const errEl   = backdrop.querySelector('#loginError');
    const btn     = backdrop.querySelector('#loginBtn');

    async function attempt() {
      const role = backdrop.querySelector('input[name="role"]:checked')?.value;
      const pw   = pwInput.value;
      if (!pw) { errEl.textContent = '請輸入密碼'; return; }

      const hashed   = await sha256(pw);
      const expected = role === 'CREATOR' ? AUTH.CREATOR.hash : AUTH.WORM.hash;

      if (hashed === expected) {
        saveSession(role);
        backdrop.remove();
        resolve(role);
      } else {
        errEl.textContent = '密碼錯誤，請再試一次';
        pwInput.value = '';
        pwInput.focus();
      }
    }

    btn.addEventListener('click', attempt);
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  });
}

// ─── 主狀態 ─────────────────────────────────────────────────
const state = {
  items: [], filtered: [],
  role: null, // 'CREATOR' | 'WORM'
  previewSpeed: Number(localStorage.getItem('previewSpeed') || 22),
  recent: JSON.parse(localStorage.getItem('recentViews') || '[]'),
  favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
};

function isCreator() { return state.role === 'CREATOR'; }

window.trackView = (id) => {
  state.recent = [id, ...state.recent.filter(x => x !== id)].slice(0, 20);
  localStorage.setItem('recentViews', JSON.stringify(state.recent));
};

window.toggleFav = (e, id) => {
  e.preventDefault();
  if (!isCreator()) {
    showToast('此功能僅限造物主使用');
    return;
  }
  if (state.favorites.includes(id)) state.favorites = state.favorites.filter(x => x !== id);
  else state.favorites.push(id);
  localStorage.setItem('favorites', JSON.stringify(state.favorites));
  e.target.classList.toggle('active');
};

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'vb-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ─── 資料載入 ───────────────────────────────────────────────
async function loadAllItems() {
  const manifest = await (await fetch('./data/build-manifest.json')).json();
  const results = [];
  for (let i = 1; i <= manifest.shardCount; i++) {
    const res = await fetch(`./data/shards/items-${i}.json`);
    if (res.ok) results.push(...await res.json());
  }
  return results;
}

// ─── 卡片渲染 ───────────────────────────────────────────────
function createCard(item) {
  const isFav = state.favorites.includes(item.id) ? 'active' : '';
  const isScreenshot = item.coverImage.includes('/screenshots/');

  return `
    <a class="card" href="${item.finalUrl}" target="_blank" onclick="trackView('${item.id}')" style="--preview-duration:${state.previewSpeed}s; --preview-shift:-22%;">
      <button class="btn-fav ${isFav}" onclick="toggleFav(event, '${item.id}')">❤</button>
      <div class="card-cover-wrap">
        <img class="card-cover${isScreenshot ? ' screenshot-cover' : ''}"
             src="${item.coverImage}"
             loading="lazy"
             ${isScreenshot ? 'data-crop="380"' : ''} />
        <div class="card-overlay"></div>
      </div>
      <div class="card-body">
        <h3 class="title">${item.title}</h3>
        <div class="meta">${item.domain}</div>
      </div>
    </a>
  `;
}

// 動態計算裁切偏移（按實際渲染寬度等比換算380px）
function applyCropOffsets() {
  document.querySelectorAll('img.screenshot-cover[data-crop]').forEach(img => {
    const cropPx = parseInt(img.dataset.crop);
    const originalWidth = 1280;
    const apply = () => {
      const w = img.offsetWidth;
      if (!w) return;
      img.style.marginTop = `-${cropPx * (w / originalWidth)}px`;
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
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

// ─── 側欄 ────────────────────────────────────────────────────
function initSidebar(items) {
  const folders = [...new Set(items.map(i => i.folderPath[0]).filter(Boolean))];
  const folderHtml = `<li class="active" data-folder="all">全部</li>` +
    folders.map(f => `<li data-folder="${f}">${f}</li>`).join('');
  document.querySelector('#folderList').innerHTML = folderHtml;

  document.querySelector('#folderList').addEventListener('click', e => {
    if (e.target.tagName !== 'LI') return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');
    const folder = e.target.dataset.folder;
    state.filtered = folder === 'all' ? items : items.filter(i => i.folderPath[0] === folder);
    render(state.filtered);
  });

  document.querySelector('#actionList').addEventListener('click', e => {
    if (e.target.tagName !== 'LI') return;
    document.querySelectorAll('#folderList li, #actionList li').forEach(el => el.classList.remove('active'));
    e.target.classList.add('active');

    const action = e.target.dataset.action;
    if (action === 'recent') {
      const recentItems = state.recent.map(id => items.find(i => i.id === id)).filter(Boolean);
      render(recentItems);
    } else if (action === 'favorite') {
      if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
      const favItems = state.favorites.map(id => items.find(i => i.id === id)).filter(Boolean);
      render(favItems);
    } else if (action === 'random') {
      const randomItems = [...items].sort(() => 0.5 - Math.random()).slice(0, 5);
      render(randomItems);
    }
  });

  // 新增收藏夾按鈕
  document.querySelector('#btnAddCollection').addEventListener('click', () => {
    if (!isCreator()) { showToast('此功能僅限造物主使用'); return; }
    // 原有收藏夾邏輯在此保留，可繼續擴充
  });

  // 造物主專屬：顯示登出按鈕
  if (isCreator()) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = '登出';
    logoutBtn.addEventListener('click', () => {
      clearSession();
      location.reload();
    });
    document.querySelector('.sidebar').appendChild(logoutBtn);
  }

  // 角色標示
  const roleTag = document.createElement('div');
  roleTag.className = 'role-tag';
  roleTag.textContent = isCreator() ? '👑 造物主' : '🐛 小淫蟲';
  document.querySelector('.toolbar').prepend(roleTag);
}

// ─── 搜尋 ────────────────────────────────────────────────────
function wireSearch(items) {
  const fuse = new Fuse(items, { keys: ['title', 'domain'], threshold: 0.35 });
  document.querySelector('#searchInput').addEventListener('input', e => {
    const val = e.target.value.trim();
    render(val ? fuse.search(val).map(r => r.item) : items);
  });
}

// ─── 入口 ────────────────────────────────────────────────────
async function main() {
  // 檢查現有 session
  state.role = loadSession();

  // 沒有有效 session 就顯示登入畫面
  if (!state.role) {
    state.role = await showLoginScreen();
  }

  keepSessionAlive();

  state.items = await loadAllItems();
  state.filtered = state.items;
  initSidebar(state.items);
  render(state.items);
  wireSearch(state.items);
}

main();