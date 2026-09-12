/**
 * CIEL StudyOS - Logique Métier & Application JS (app.js)
 *
 * Ce fichier regroupe l'ensemble de la logique applicative :
 * - Variables d'état globales
 * - Helpers UI (Toast, Confirm, Avatars, Sync indicator)
 * - Initialisation & Authentification utilisateur
 * - Gestion du profil utilisateur & synchronisation du coffre (vault)
 * - Gestion des cours (création, rendu, suppression, filtrage par matière)
 * - Partage de cours entre élèves & boîte de réception
 * - Révision par Flashcards & gestion des Todos
 * - Navigation par onglets & affichage Lightbox
 */

/* ==========================================================
   1. VARIABLES D'ÉTAT GLOBALES
   ========================================================== */
let currentSession = { username: null, aesKey: null, saltHex: null };
let userVault = { courses: [], flashcards: [], todos: [], folders: [], settings: { compactMode: false, confetti: true }, profile: { avatar: '', bio: '' }, lastUpdated: null };
let allSharedCourses = [];
let pendingFiles = [];
let autoSaveTimer = null;
let authMode = 'login';
let currentSubView = 'mine';
let activeFilter = 'all';
let activeFolderId = 'all';
let selectedFolderColor = '#38bdf8';
const FOLDER_COLORS = ['#38bdf8', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#6366f1', '#14b8a6'];
let courseToShare = null;
let courseToMoveId = null;
let editingCourseId = null;
let fcCursor = 0;
let fcFlipped = false;

/* ==========================================================
   2. HELPERS UI & AVATARS
   ========================================================== */
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return (text || '').replace(/[&<>"']/g, m => map[m]);
}

function getUserColor(username) {
  const colors = ['#0284c7', '#6366f1', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6'];
  let hash = 0;
  const str = username || 'u';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function renderAvatarHTML(username, avatarUrl, size = 28) {
  const u = (username || 'U').trim();
  if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.startsWith('data:image/')) {
    const safeUrl = avatarUrl.replace(/"/g, '&quot;');
    return `<img src="${safeUrl}" class="avatar-img" style="width:${size}px; height:${size}px;" alt="${escapeHtml(u)}" />`;
  }
  const initial = u.charAt(0).toUpperCase();
  const color = getUserColor(u);
  const fontSize = Math.max(11, Math.round(size * 0.44));
  return `<div class="avatar-circle" style="width:${size}px; height:${size}px; background:${color}; font-size:${fontSize}px;">${initial}</div>`;
}

function showToast(message, type = 'info') {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon} toast-icon"></i>
    <span>${escapeHtml(message)}</span>
    <div class="toast-progress"></div>
  `;

  toast.onclick = () => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  };

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 260);
  }, 3000);
}

function customConfirm(title, message, confirmText = 'Confirmer', cancelText = 'Annuler') {
  return new Promise((resolve) => {
    const modal = document.getElementById('customConfirmModal');
    if (!modal) {
      if (typeof confirm === 'function') {
        resolve(confirm(message));
      } else {
        resolve(true);
      }
      return;
    }
    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMsg');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    if (okBtn) okBtn.innerText = confirmText;
    if (cancelBtn) cancelBtn.innerText = cancelText;

    modal.classList.add('active');
    trapFocusInModal(modal);

    const cleanUp = () => {
      releaseFocusTrap(modal);
      modal.classList.remove('active');
      if (okBtn) okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
    };

    if (okBtn) okBtn.onclick = () => { cleanUp(); resolve(true); };
    if (cancelBtn) cancelBtn.onclick = () => { cleanUp(); resolve(false); };
  });
}

let lastFocusedElement = null;
function trapFocusInModal(modalEl) {
  if (!modalEl) return;
  lastFocusedElement = document.activeElement;
  document.body.classList.add('modal-open');

  const focusables = modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (focusables.length > 0) {
    focusables[0].focus();
  }

  modalEl._handleTabTrap = (e) => {
    if (e.key !== 'Tab') return;
    const current = modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  modalEl.addEventListener('keydown', modalEl._handleTabTrap);
}

function releaseFocusTrap(modalEl) {
  if (modalEl && modalEl._handleTabTrap) {
    modalEl.removeEventListener('keydown', modalEl._handleTabTrap);
    delete modalEl._handleTabTrap;
  }
  const anyOpenModal = document.querySelector('.modal-backdrop.active, .lightbox-modal.active');
  if (!anyOpenModal) {
    document.body.classList.remove('modal-open');
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    try { lastFocusedElement.focus(); } catch (e) {}
  }
}

function setSync(state, msg) {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  dot.className = 'sync-dot';
  if (state) dot.classList.add(state);
}

/* ==========================================================
   4. INITIALISATION & AUTHENTIFICATION
   ========================================================== */
function initApp() {
  const savedUser = localStorage.getItem('ciel_session_user');
  if (savedUser) {
    restoreSession(savedUser).catch(err => {
      console.warn("Session expirée ou non restaurée:", err);
      const authOverlay = document.getElementById('authOverlay');
      if (authOverlay) authOverlay.style.display = 'flex';
    });
  } else {
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';
  }
}

if (typeof window !== 'undefined') {
  window.onload = initApp;
}

function switchAuthMode(mode) {
  authMode = mode;
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authAlert = document.getElementById('authAlert');

  if (tabBtnLogin) tabBtnLogin.classList.toggle('active', mode === 'login');
  if (tabBtnRegister) tabBtnRegister.classList.toggle('active', mode === 'register');
  if (authSubmitBtn) {
    authSubmitBtn.innerHTML = mode === 'login'
      ? '<i class="fa-solid fa-arrow-right-to-bracket"></i> Ouvrir mon espace'
      : '<i class="fa-solid fa-user-plus"></i> Créer mon espace personnel';
  }
  if (authAlert) authAlert.style.display = 'none';
}

async function handleAuthSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const alertEl = document.getElementById('authAlert');
  if (alertEl) alertEl.style.display = 'none';

  const userField = document.getElementById('authUsername');
  const passField = document.getElementById('authPassword');
  const rawUser = userField ? userField.value.trim() : '';
  const username = rawUser.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const password = passField ? passField.value : '';

  if (!username || !password) {
    if (alertEl) {
      alertEl.innerText = "Veuillez renseigner un identifiant et un mot de passe.";
      alertEl.style.display = 'block';
    }
    return;
  }

  const submitBtn = document.getElementById('authSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Chiffrement & Connexion...';
  }

  try {
    const registryFile = await ghGetFile('data/users_index.json');
    const registry = registryFile ? registryFile.data : { users: {} };

    if (authMode === 'register') {
      if (registry.users && registry.users[username]) {
        throw new Error("Cet identifiant existe déjà. Veuillez vous connecter.");
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltHex = bufToHex(salt);
      const verifier = await computePasswordVerifier(password, salt);
      const aesKey = await deriveKeyFromPassword(password, salt);

      if (!registry.users) registry.users = {};
      registry.users[username] = {
        salt: saltHex,
        verifier: verifier,
        avatar: '',
        bio: 'Élève Bac Pro CIEL',
        createdAt: new Date().toISOString()
      };

      await ghPutFile('data/users_index.json', registry, `Inscription sécurisée de @${username}`);

      currentSession = { username, aesKey, saltHex };
      userVault = {
        courses: [],
        flashcards: [],
        todos: [],
        profile: { avatar: '', bio: 'Élève Bac Pro CIEL' },
        lastUpdated: new Date().toISOString()
      };

      const encryptedVault = await encryptData(userVault, aesKey);
      await ghPutFile(`data/vaults/${username}.json`, encryptedVault, `Creation coffre chiffré @${username}`);
      openUserSession(username);
      showToast(`Bienvenue sur votre espace, ${username} !`, 'success');
    } else {
      if (!registry.users || !registry.users[username]) {
        throw new Error("Nom d'utilisateur inexistant. Créez un compte d'abord.");
      }

      const userRecord = registry.users[username];
      let aesKey = null;
      let saltHex = null;

      if (userRecord.verifier && userRecord.salt) {
        saltHex = userRecord.salt;
        const saltBuf = hexToBuf(saltHex);
        const computedVerifier = await computePasswordVerifier(password, saltBuf);
        if (computedVerifier !== userRecord.verifier) {
          throw new Error("Mot de passe incorrect.");
        }
        aesKey = await deriveKeyFromPassword(password, saltBuf);
      } else if (userRecord.passHash) {
        const passHash = await hashPassword(password);
        if (userRecord.passHash !== passHash) {
          throw new Error("Mot de passe incorrect.");
        }
        const fallbackSalt = hexToBuf('0123456789abcdef0123456789abcdef');
        aesKey = await deriveKeyFromPassword(password, fallbackSalt);
      } else {
        throw new Error("Compte corrompu ou non reconnu.");
      }

      currentSession = { username, aesKey, saltHex };
      await loadUserVault();
      await fetchSharedCourses();
      openUserSession(username);
      showToast(`Bon retour, ${username} !`, 'success');
    }
  } catch (err) {
    if (alertEl) {
      alertEl.innerText = err.message;
      alertEl.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = authMode === 'login'
        ? '<i class="fa-solid fa-arrow-right-to-bracket"></i> Ouvrir mon espace'
        : '<i class="fa-solid fa-user-plus"></i> Créer mon espace';
    }
  }
}

function openUserSession(username) {
  localStorage.setItem('ciel_session_user', username);
  trackUserLoginSession(username);
  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) userLabel.innerText = username;
  updateHeaderProfileUI();
  applyUserSettings();
  const authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'none';

  renderFoldersBar();
  renderCourses();
  renderFlashcards();
  renderTodos();
  updateReceivedBadge();
  setSync('synced', 'Connecté');
}

async function restoreSession(username) {
  currentSession = { username, aesKey: null, saltHex: null };
  trackUserLoginSession(username);
  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) userLabel.innerText = username;

  // 1. Restaurer depuis le cache local immédiat
  const localData = localStorage.getItem(`ciel_vault_${username}`);
  if (localData) {
    try {
      userVault = JSON.parse(localData);
      updateHeaderProfileUI();
      applyUserSettings();
      renderFoldersBar();
      renderCourses();
      renderFlashcards();
      renderTodos();
    } catch (e) {
      console.warn("Cache local invalide:", e);
    }
  }

  const authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'none';
  await loadUserVault();
  await fetchSharedCourses();
  updateHeaderProfileUI();
  applyUserSettings();
  renderFoldersBar();
  renderCourses();
  renderFlashcards();
  renderTodos();
  updateReceivedBadge();
}

function logout() {
  localStorage.removeItem('ciel_session_user');
  currentSession = { username: null, aesKey: null, saltHex: null };
  userVault = { courses: [], flashcards: [], todos: [], profile: { avatar: '', bio: '' }, lastUpdated: null };
  const authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'flex';
  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) userLabel.innerText = "Invité";
  const avatarContainer = document.getElementById('headerAvatarContainer');
  if (avatarContainer) avatarContainer.innerHTML = renderAvatarHTML('Invité', '', 28);
  setSync('', 'Déconnecté');
  showToast("Vous avez été déconnecté.", "info");
}

/* ==========================================================
   5. GESTION DU PROFIL UTILISATEUR & VAULT
   ========================================================== */
function updateHeaderProfileUI() {
  const avatarSrc = (userVault.profile && userVault.profile.avatar) ? userVault.profile.avatar : '';
  const container = document.getElementById('headerAvatarContainer');
  if (container) container.innerHTML = renderAvatarHTML(currentSession.username, avatarSrc, 28);
}

function openProfileModal() {
  if (!currentSession.username) return;
  const usernameDisplay = document.getElementById('profileUsernameDisplay');
  if (usernameDisplay) usernameDisplay.value = currentSession.username;
  const avatarSrc = (userVault.profile && userVault.profile.avatar) ? userVault.profile.avatar : '';
  const avatarContainer = document.getElementById('profileModalAvatarContainer');
  if (avatarContainer) avatarContainer.innerHTML = renderAvatarHTML(currentSession.username, avatarSrc, 80);
  const bioInput = document.getElementById('profileBioInput');
  if (bioInput) bioInput.value = (userVault.profile && userVault.profile.bio) ? userVault.profile.bio : '';
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function handleAvatarChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 120, 120);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      const avatarContainer = document.getElementById('profileModalAvatarContainer');
      if (avatarContainer) avatarContainer.innerHTML = renderAvatarHTML(currentSession.username, compressedDataUrl, 80);
      if (!userVault.profile) userVault.profile = {};
      userVault.profile.avatar = compressedDataUrl;
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function saveUserProfile() {
  if (!userVault.profile) userVault.profile = {};
  const bioInput = document.getElementById('profileBioInput');
  if (bioInput) userVault.profile.bio = bioInput.value.trim();

  updateHeaderProfileUI();
  closeProfileModal();
  triggerAutoSave();

  // Mettre à jour le registre public des élèves
  try {
    const regFile = await ghGetFile('data/users_index.json');
    if (regFile && regFile.data && regFile.data.users && regFile.data.users[currentSession.username]) {
      regFile.data.users[currentSession.username].avatar = userVault.profile.avatar || '';
      regFile.data.users[currentSession.username].bio = userVault.profile.bio || '';
      await ghPutFile('data/users_index.json', regFile.data, `Profil maj @${currentSession.username}`);
    }
    showToast("Profil enregistré et synchronisé !", "success");
  } catch (err) {
    showToast("Profil sauvegardé localement.", "info");
  }
}

async function loadUserVault() {
  if (!currentSession.username || (typeof ghConfig !== 'undefined' && !ghConfig.token)) return;
  setSync('saving', 'Chargement...');

  try {
    let file = await ghGetFile(`data/vaults/${currentSession.username}.json`);
    if (!file) {
      file = await ghGetFile(`data/users/${currentSession.username}.json`);
    }

    if (file && file.data) {
      if (file.data.iv && file.data.ciphertext) {
        if (currentSession.aesKey) {
          userVault = await decryptData(file.data, currentSession.aesKey);
        } else {
          console.warn("Clé AES non disponible en session, chargement différé.");
          return;
        }
      } else {
        userVault = file.data;
      }

      if (!userVault.courses) userVault.courses = [];
      if (!userVault.flashcards) userVault.flashcards = [];
      if (!userVault.todos) userVault.todos = [];
      if (!userVault.folders) userVault.folders = [];
      if (!userVault.settings) userVault.settings = { compactMode: false, confetti: true };
      if (!userVault.profile) userVault.profile = { avatar: '', bio: '' };

      localStorage.setItem(`ciel_vault_${currentSession.username}`, JSON.stringify(userVault));
      setSync('synced', 'À jour');
    } else {
      userVault = { courses: [], flashcards: [], todos: [], folders: [], settings: { compactMode: false, confetti: true }, profile: { avatar: '', bio: '' }, lastUpdated: new Date().toISOString() };
      setSync('synced', 'Nouveau');
    }
  } catch (err) {
    console.error("Erreur de chargement du coffre:", err);
    setSync('error', 'Erreur sync');
  }
}

function triggerAutoSave() {
  if (!currentSession.username) return;
  setSync('saving', 'Sauvegarde...');

  // 1. Sauvegarde locale immédiate
  userVault.lastUpdated = new Date().toISOString();
  localStorage.setItem(`ciel_vault_${currentSession.username}`, JSON.stringify(userVault));

  // 2. Envoi automatique vers GitHub avec debounce modéré (2.5s)
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      if (typeof ghConfig !== 'undefined' && ghConfig.token) {
        let payload = userVault;
        if (currentSession.aesKey) {
          payload = await encryptData(userVault, currentSession.aesKey);
        }
        await ghPutFile(`data/vaults/${currentSession.username}.json`, payload, `Auto-save coffre @${currentSession.username}`);
        const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        setSync('synced', `Synchronisé (${timeStr})`);
      } else {
        setSync('', 'Local');
      }
    } catch (e) {
      console.error("Erreur auto-save:", e);
      setSync('error', 'Erreur synchro');
    }
  }, 2500);
}

async function syncUserVault(silent = false) {
  await loadUserVault();
  await fetchSharedCourses();
  updateHeaderProfileUI();
  renderCourses();
  renderFlashcards();
  renderTodos();
  updateReceivedBadge();
  if (!silent) showToast("Données synchronisées avec GitHub !", "success");
}

/* ==========================================================
   6. GESTION DES COURS & PARTAGES
   ========================================================== */
async function fetchSharedCourses() {
  if (typeof ghConfig !== 'undefined' && !ghConfig.token) return;
  try {
    const file = await ghGetFile('data/shares.json');
    allSharedCourses = (file && file.data && file.data.shares) ? file.data.shares : [];
  } catch (e) {
    allSharedCourses = [];
  }
}

function switchCourseSubView(mode) {
  currentSubView = mode;
  const btnMine = document.getElementById('btnViewMine');
  const btnReceived = document.getElementById('btnViewReceived');
  if (btnMine) btnMine.classList.toggle('active', mode === 'mine');
  if (btnReceived) btnReceived.classList.toggle('active', mode === 'received');

  const foldersBar = document.getElementById('foldersBarContainer');
  if (foldersBar) {
    foldersBar.style.display = mode === 'mine' ? 'block' : 'none';
  }

  renderCourses();
}

function updateReceivedBadge() {
  if (!currentSession.username) return;
  const received = allSharedCourses.filter(s => s.toUser === currentSession.username);
  const badge = document.getElementById('receivedCountBadge');
  if (badge) badge.innerText = received.length;
}

let shareMode = 'users';

function switchShareMode(mode) {
  shareMode = mode;
  const btnUsers = document.getElementById('btnTabShareUsers');
  const btnQR = document.getElementById('btnTabShareQR');
  const secUsers = document.getElementById('shareModeUsersSection');
  const secQR = document.getElementById('shareModeQRSection');

  if (mode === 'users') {
    btnUsers?.classList.add('active');
    btnQR?.classList.remove('active');
    if (secUsers) secUsers.style.display = 'block';
    if (secQR) secQR.style.display = 'none';
  } else {
    btnQR?.classList.add('active');
    btnUsers?.classList.remove('active');
    if (secUsers) secUsers.style.display = 'none';
    if (secQR) secQR.style.display = 'block';
    if (courseToShare) renderCourseQRCode(courseToShare);
  }
}

function renderCourseQRCode(course) {
  const container = document.getElementById('shareQRCodeContainer');
  if (!container || typeof QRCode === 'undefined') return;
  container.innerHTML = '';
  const shareData = `${window.location.origin}${window.location.pathname}#course-${course.id}`;
  new QRCode(container, {
    text: shareData,
    width: 170,
    height: 170,
    colorDark: "#080c14",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

function copyShareCourseLink() {
  if (!courseToShare) return;
  const link = `${window.location.origin}${window.location.pathname}#course-${courseToShare.id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      showToast("Lien direct copié dans le presse-papier ! 📋", "success");
    }).catch(() => {
      prompt("Copiez ce lien de partage :", link);
    });
  } else {
    prompt("Copiez ce lien de partage :", link);
  }
}

function toggleSelectAllRecipients() {
  const checkboxes = document.querySelectorAll('.share-recipient-cb');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  showToast(!allChecked ? "Toute la classe sélectionnée !" : "Sélection réinitialisée", "info");
}

async function openShareModal(courseId) {
  const course = userVault.courses.find(c => c.id === courseId);
  if (!course) return;
  courseToShare = course;

  switchShareMode('users');

  const titleEl = document.getElementById('shareCourseTitle');
  if (titleEl) titleEl.innerText = course.title;
  const listEl = document.getElementById('recipientsList');
  if (listEl) listEl.innerHTML = '<div style="padding:1.25rem; text-align:center; color:var(--text-sub);"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des camarades...</div>';
  const modal = document.getElementById('shareModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }

  try {
    const regFile = await ghGetFile('data/users_index.json');
    const registry = regFile ? regFile.data : { users: {} };
    const myName = (currentSession.username || '').toLowerCase().trim();

    // EXCLUSION STRICTE : Ne jamais s'afficher soi-même
    const otherUsers = Object.keys(registry.users || {}).filter(u => u.toLowerCase().trim() !== myName);

    if (otherUsers.length === 0) {
      if (listEl) listEl.innerHTML = `<p style="font-size:0.85rem; color:var(--text-sub); padding:1.25rem; text-align:center;">Aucun autre élève inscrit pour le moment.</p>`;
      return;
    }

    if (listEl) {
      listEl.innerHTML = '';
      otherUsers.forEach(u => {
        const uData = registry.users[u] || {};
        const avatarHTML = renderAvatarHTML(u, uData.avatar, 34);
        const bioText = uData.bio ? escapeHtml(uData.bio) : 'Élève CIEL';

        const row = document.createElement('div');
        row.className = 'recipient-row';
        row.innerHTML = `
          <input type="checkbox" value="${escapeHtml(u)}" class="share-recipient-cb" id="cb_${escapeHtml(u)}" aria-label="Sélectionner @${escapeHtml(u)}" style="width:18px; height:18px; cursor:pointer;" />
          <label for="cb_${escapeHtml(u)}" style="display:flex; align-items:center; gap:0.65rem; flex:1; cursor:pointer; margin-bottom:0;">
            ${avatarHTML}
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; color:#fff; font-size:0.9rem;">@${escapeHtml(u)}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${bioText}</div>
            </div>
          </label>
        `;
        listEl.appendChild(row);
      });
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<p style="color:var(--accent-rose); padding:1rem; text-align:center;">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
  courseToShare = null;
}

async function confirmSendShare() {
  if (!courseToShare) return;
  const selected = Array.from(document.querySelectorAll('.share-recipient-cb:checked')).map(cb => cb.value);

  if (selected.length === 0) {
    showToast("Veuillez cocher au moins un élève destinataire.", "error");
    return;
  }

  const btn = document.getElementById('btnConfirmShare');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Envoi en cours...';
  }

  try {
    await fetchSharedCourses();

    const senderAvatar = (userVault.profile && userVault.profile.avatar) ? userVault.profile.avatar : '';
    const senderBio = (userVault.profile && userVault.profile.bio) ? userVault.profile.bio : '';

    selected.forEach(recipient => {
      allSharedCourses.push({
        id: 'share_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        fromUser: currentSession.username,
        senderAvatar: senderAvatar,
        senderBio: senderBio,
        toUser: recipient,
        sentAt: new Date().toISOString(),
        course: {
          subject: courseToShare.subject,
          title: courseToShare.title,
          content: courseToShare.content,
          attachments: courseToShare.attachments || []
        }
      });
    });

    await ghPutFile('data/shares.json', { shares: allSharedCourses }, `Partage de @${currentSession.username}`);
    showToast(`Cours partagé avec succès à : ${selected.join(', ')} !`, "success");
    closeShareModal();
  } catch (e) {
    console.error(e);
    showToast("Erreur lors du partage : " + e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Envoyer le cours aux élèves choisis';
    }
  }
}

function importSharedCourse(shareId) {
  const share = allSharedCourses.find(s => s.id === shareId);
  if (!share) return;

  const importTitle = `[Reçu de @${share.fromUser}] ${share.course.title}`;
  const alreadyExists = userVault.courses.some(c => c.title === importTitle);
  if (alreadyExists) {
    showToast("Ce cours est déjà présent dans votre classeur personnel.", "info");
    switchCourseSubView('mine');
    return;
  }

  userVault.courses.unshift({
    id: Date.now(),
    subject: share.course.subject,
    title: importTitle,
    content: share.course.content,
    attachments: share.course.attachments || [],
    date: new Date().toISOString()
  });

  triggerAutoSave();
  showToast("Ce cours a été importé dans votre classeur personnel !", "success");
  switchCourseSubView('mine');
}

async function deleteSharedCourse(shareId) {
  const ok = await customConfirm("Supprimer le partage", "Voulez-vous retirer ce cours partagé de votre boîte de réception ?");
  if (!ok) return;

  allSharedCourses = allSharedCourses.filter(s => s.id !== shareId);
  try {
    await ghPutFile('data/shares.json', { shares: allSharedCourses }, `Suppression partage`);
  } catch (e) {}
  updateReceivedBadge();
  renderCourses();
  showToast("Partage supprimé de la boîte de réception.", "info");
}

function setFilter(catKey) {
  activeFilter = catKey;
  document.querySelectorAll('.cat-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-cat') === catKey);
  });
  renderCourses();
}

function checkSubjectMatch(courseSubject, catKey) {
  if (catKey === 'all') return true;
  const sub = (courseSubject || '').toLowerCase();

  switch (catKey) {
    case 'maths': return sub.includes('math');
    case 'physique': return sub.includes('physique') || sub.includes('chimie');
    case 'reseaux': return sub.includes('réseaux') || sub.includes('reseaux');
    case 'secu': return sub.includes('cyber') || sub.includes('sécurité') || sub.includes('securite');
    case 'elec': return sub.includes('électronique') || sub.includes('electronique') || sub.includes('iot');
    case 'projet': return sub.includes('projet');
    case 'francais': return sub.includes('français') || sub.includes('francais');
    case 'hist-geo': return sub.includes('histoire') || sub.includes('géo') || sub.includes('geo') || sub.includes('emc');
    case 'pse': return sub.includes('pse') || sub.includes('santé') || sub.includes('environnement');
    case 'eco': return sub.includes('économie') || sub.includes('economie') || sub.includes('gestion');
    case 'anglais': return sub.includes('anglais');
    case 'allemand': return sub.includes('allemand');
    case 'arts': return sub.includes('arts') || sub.includes('artistique');
    case 'eps': return sub.includes('eps') || sub.includes('sport');
    default: return sub.includes(catKey.toLowerCase());
  }
}

function getSubjectThemeInfo(subject) {
  const sub = (subject || '').toLowerCase();

  if (sub.includes('réseaux') || sub.includes('reseaux')) {
    return { key: 'reseaux', icon: 'fa-solid fa-network-wired' };
  }
  if (sub.includes('cyber') || sub.includes('sécurité') || sub.includes('securite')) {
    return { key: 'secu', icon: 'fa-solid fa-shield-halved' };
  }
  if (sub.includes('électronique') || sub.includes('electronique') || sub.includes('iot')) {
    return { key: 'elec', icon: 'fa-solid fa-bolt' };
  }
  if (sub.includes('projet')) {
    return { key: 'projet', icon: 'fa-solid fa-diagram-project' };
  }
  if (sub.includes('math')) {
    return { key: 'maths', icon: 'fa-solid fa-square-root-variable' };
  }
  if (sub.includes('physique') || sub.includes('chimie')) {
    return { key: 'physique', icon: 'fa-solid fa-atom' };
  }
  if (sub.includes('français') || sub.includes('francais')) {
    return { key: 'francais', icon: 'fa-solid fa-feather' };
  }
  if (sub.includes('histoire') || sub.includes('géo') || sub.includes('geo') || sub.includes('emc')) {
    return { key: 'hist-geo', icon: 'fa-solid fa-earth-europe' };
  }
  if (sub.includes('pse') || sub.includes('santé') || sub.includes('environnement')) {
    return { key: 'pse', icon: 'fa-solid fa-heart-pulse' };
  }
  if (sub.includes('économie') || sub.includes('economie') || sub.includes('gestion')) {
    return { key: 'eco', icon: 'fa-solid fa-chart-pie' };
  }
  if (sub.includes('anglais') || sub.includes('allemand')) {
    return { key: 'langues', icon: 'fa-solid fa-language' };
  }
  if (sub.includes('arts') || sub.includes('artistique')) {
    return { key: 'arts', icon: 'fa-solid fa-palette' };
  }
  if (sub.includes('eps') || sub.includes('sport')) {
    return { key: 'eps', icon: 'fa-solid fa-person-running' };
  }
  return { key: 'default', icon: 'fa-solid fa-book-bookmark' };
}

let activeTagFilter = null;

function filterByTag(tag) {
  activeTagFilter = tag;
  const pill = document.getElementById('bcActiveTag');
  const text = document.getElementById('bcTagText');
  if (pill && text) {
    text.innerText = '#' + tag;
    pill.style.display = 'inline-flex';
  }
  renderCourses();
}

function clearTagFilter() {
  activeTagFilter = null;
  const pill = document.getElementById('bcActiveTag');
  if (pill) pill.style.display = 'none';
  renderCourses();
}

function toggleCourseFavorite(id) {
  const c = userVault.courses.find(x => x.id === id);
  if (!c) return;
  c.isFavorite = !c.isFavorite;
  showToast(c.isFavorite ? "Ajouté aux favoris ⭐" : "Retiré des favoris", "info");
  renderCourses();
  triggerAutoSave();
}

function renderCourses() {
  if (typeof document === 'undefined') return;
  const feed = document.getElementById('coursesFeed');
  const counter = document.getElementById('coursesCounter');
  if (!feed) return;
  const searchInput = document.getElementById('courseSearch');
  const search = (searchInput?.value || '').toLowerCase();
  const sortMode = document.getElementById('courseSortSelect')?.value || 'date-desc';

  feed.innerHTML = '';

  if (currentSubView === 'mine') {
    let items = userVault.courses.filter(c => {
      const matchCat = checkSubjectMatch(c.subject, activeFilter);
      const matchSearch = !search || c.title.toLowerCase().includes(search) || (c.content || '').toLowerCase().includes(search);
      const matchTag = !activeTagFilter || (c.tags && c.tags.includes(activeTagFilter));

      // Filtrage par dossier de rangement
      let matchFolder = true;
      if (activeFolderId === 'unassigned') {
        matchFolder = !c.folderId;
      } else if (activeFolderId && activeFolderId !== 'all') {
        matchFolder = c.folderId === activeFolderId;
      }

      return matchCat && matchSearch && matchTag && matchFolder;
    });

    // Tri dynamique
    if (sortMode === 'date-desc') {
      items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    } else if (sortMode === 'date-asc') {
      items.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    } else if (sortMode === 'title-asc') {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortMode === 'fav-first') {
      items.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || (new Date(b.date || 0) - new Date(a.date || 0)));
    }

    if (counter) counter.innerText = `${items.length} cours personnel${items.length > 1 ? 's' : ''}`;

    if (items.length === 0) {
      feed.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; color: var(--text-sub);">
          <i class="fa-solid fa-folder-open" style="font-size: 3rem; margin-bottom: 0.85rem; opacity: 0.35;"></i>
          <p style="font-size: 1rem; font-weight: 600; color: var(--text-muted);">Aucun cours dans cette sélection.</p>
          <p style="font-size: 0.82rem; margin-top: 0.35rem;">Ajoutez un cours avec le bouton <strong>+ Nouveau cours</strong>.</p>
        </div>`;
      return;
    }

    items.forEach(c => {
      const card = document.createElement('div');
      const theme = getSubjectThemeInfo(c.subject);
      card.className = `course-card theme-${theme.key}`;

      let attachmentsHTML = buildAttachmentsHTML(c.attachments);
      const parsedContent = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(c.content || '') : (c.content || '');
      const sanitizedBody = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsedContent) : parsedContent;

      let tagsHTML = '';
      if (c.tags && c.tags.length > 0) {
        tagsHTML = `<div class="card-tags-row">${c.tags.map(t => `<span class="card-tag-pill" onclick="filterByTag('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`).join('')}</div>`;
      }

      let folderHTML = '';
      if (c.folderId && userVault.folders) {
        const fol = userVault.folders.find(f => f.id === c.folderId);
        if (fol) {
          folderHTML = `<div><span class="course-folder-tag" style="border-color: ${fol.color}50; color: ${fol.color}; cursor: pointer;" onclick="setFolderFilter('${fol.id}')" title="Filtrer par le dossier ${escapeHtml(fol.name)}"><i class="fa-solid fa-folder"></i> ${escapeHtml(fol.name)}</span></div>`;
        }
      }

      card.innerHTML = `
        <div class="course-card-top">
          <span class="badge-sub"><i class="${theme.icon}"></i> ${escapeHtml(c.subject)}</span>
          <div class="card-actions">
            <button class="btn-card-action btn-action-fav ${c.isFavorite ? 'active' : ''}" onclick="toggleCourseFavorite(${c.id})" title="${c.isFavorite ? 'Retirer des favoris' : 'Marquer comme favori'}">
              <i class="fa-${c.isFavorite ? 'solid' : 'regular'} fa-star"></i>
            </button>
            <button class="btn-card-action btn-action-focus" onclick="openFocusModal(${c.id}, false)" title="Lecture Zen / Plein écran">
              <i class="fa-solid fa-expand"></i>
            </button>
            <button class="btn-card-action btn-action-pdf" onclick="exportCourseToPDF(${c.id})" title="Imprimer ou Exporter en PDF">
              <i class="fa-solid fa-file-pdf"></i>
            </button>
            <button class="btn-card-action btn-action-move" onclick="openMoveCourseModal(${c.id})" title="Ranger dans un dossier">
              <i class="fa-solid fa-folder-tree"></i>
            </button>
            <button class="btn-card-action btn-action-share" onclick="openShareModal(${c.id})" title="Partager avec un camarade">
              <i class="fa-solid fa-share-nodes"></i>
            </button>
            <button class="btn-card-action btn-action-ai-fc" onclick="generateFlashcardsForCourse(${c.id})" title="Générer des flashcards avec l'IA pour ce cours">
              <i class="fa-solid fa-wand-magic-sparkles" style="color: #c084fc;"></i>
            </button>
            <button class="btn-card-action btn-action-edit" onclick="openEditCourseModal(${c.id})" title="Modifier ce cours">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn-card-action btn-action-delete" onclick="deleteCourseById(${c.id})" title="Supprimer">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <h4 class="course-title">${escapeHtml(c.title)}</h4>
        ${folderHTML}
        ${tagsHTML}
        <div class="course-body">${sanitizedBody}</div>
        ${attachmentsHTML}
        <div class="course-card-footer">
          <span><i class="fa-regular fa-clock"></i> ${new Date(c.date).toLocaleDateString('fr-FR')} • ${new Date(c.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      `;
      feed.appendChild(card);
    });

  } else {
    let received = allSharedCourses.filter(s => {
      const matchCat = checkSubjectMatch(s.course.subject, activeFilter);
      const matchSearch = !search || s.course.title.toLowerCase().includes(search) || (s.course.content || '').toLowerCase().includes(search);
      const matchTag = !activeTagFilter || (s.course.tags && s.course.tags.includes(activeTagFilter));
      return s.toUser === currentSession.username && matchCat && matchSearch && matchTag;
    });

    if (counter) counter.innerText = `${received.length} cours partagé${received.length > 1 ? 's' : ''}`;

    if (received.length === 0) {
      feed.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; color: var(--text-sub);">
          <i class="fa-solid fa-inbox" style="font-size: 3rem; margin-bottom: 0.85rem; opacity: 0.35;"></i>
          <p style="font-size: 1rem; font-weight: 600; color: var(--text-muted);">Aucun cours reçu dans cette sélection.</p>
        </div>`;
      return;
    }

    received.forEach(s => {
      const card = document.createElement('div');
      const theme = getSubjectThemeInfo(s.course.subject);
      card.className = `course-card theme-${theme.key}`;

      let attachmentsHTML = buildAttachmentsHTML(s.course.attachments);
      const avatarHTML = renderAvatarHTML(s.fromUser, s.senderAvatar, 36);
      const senderBioHTML = s.senderBio ? `<span class="course-author-bio">${escapeHtml(s.senderBio)}</span>` : '';
      const parsedContent = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(s.course.content || '') : (s.course.content || '');
      const sanitizedBody = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsedContent) : parsedContent;

      let tagsHTML = '';
      if (s.course.tags && s.course.tags.length > 0) {
        tagsHTML = `<div class="card-tags-row">${s.course.tags.map(t => `<span class="card-tag-pill" onclick="filterByTag('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`).join('')}</div>`;
      }

      card.innerHTML = `
        <div class="course-card-top">
          <div class="course-card-sender">
            ${avatarHTML}
            <div class="course-card-sender-info">
              <div class="course-card-author-row">
                <span class="course-author-tag">@${escapeHtml(s.fromUser)}</span>
                <span class="badge-sub"><i class="${theme.icon}"></i> ${escapeHtml(s.course.subject)}</span>
              </div>
              ${senderBioHTML}
            </div>
          </div>
          <div class="card-actions">
            <button class="btn-card-action btn-action-focus" onclick="openFocusModal('${s.id}', true)" title="Lecture Zen / Plein écran">
              <i class="fa-solid fa-expand"></i>
            </button>
            <button class="btn-card-action btn-action-pdf" onclick="openFocusModal('${s.id}', true); setTimeout(()=>window.print(), 350);" title="Imprimer ou Exporter en PDF">
              <i class="fa-solid fa-file-pdf"></i>
            </button>
            <button class="btn-card-action btn-action-edit" onclick="importSharedCourse('${s.id}')" title="Importer dans mon classeur">
              <i class="fa-solid fa-file-import"></i>
            </button>
            <button class="btn-card-action btn-action-delete" onclick="deleteSharedCourse('${s.id}')" title="Supprimer">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <h4 class="course-title">${escapeHtml(s.course.title)}</h4>
        ${tagsHTML}
        <div class="course-body">${sanitizedBody}</div>
        ${attachmentsHTML}
        <div class="course-card-footer">
          <span><i class="fa-regular fa-paper-plane"></i> Reçu le ${new Date(s.sentAt).toLocaleDateString('fr-FR')}</span>
        </div>
      `;
      feed.appendChild(card);
    });
  }

  // Coloration syntaxique Prism sur tout le flux
  if (typeof Prism !== 'undefined' && feed) {
    Prism.highlightAllUnder(feed);
  }
}

function getFileIconClass(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (['doc', 'docx'].includes(ext)) return 'fa-solid fa-file-word';
  if (['pdf'].includes(ext)) return 'fa-solid fa-file-pdf';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-solid fa-file-excel';
  if (['ppt', 'pptx'].includes(ext)) return 'fa-solid fa-file-powerpoint';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fa-solid fa-file-zipper';
  if (['txt', 'md', 'json', 'py', 'c', 'cpp', 'js', 'html', 'css'].includes(ext)) return 'fa-solid fa-file-code';
  return 'fa-solid fa-file-arrow-down';
}

function buildAttachmentsHTML(attachments) {
  if (!attachments || attachments.length === 0) return '';
  let html = '<div class="attachments-shelf">';
  attachments.forEach(att => {
    const url = att.downloadUrl || att.path;
    const safeUrl = encodeURI(url).replace(/'/g, "%27");
    if (att.isImage) {
      html += `
        <div class="img-thumb-container" onclick="openLightbox('${safeUrl}')" title="Agrandir le schéma">
          <img src="${safeUrl}" alt="${escapeHtml(att.name)}" loading="lazy" />
        </div>`;
    } else {
      const iconClass = getFileIconClass(att.name);
      html += `
        <a href="${safeUrl}" target="_blank" download="${escapeHtml(att.name)}" class="file-badge-download" title="${escapeHtml(att.name)}">
          <i class="${iconClass}"></i>
          <span>${escapeHtml(att.name)}</span>
        </a>`;
    }
  });
  html += '</div>';
  return html;
}

// Fonctions Markdown Toolbar, Split-View & Draft Auto-Save
function insertMd(before, after, defaultText) {
  const textarea = document.getElementById('mContent');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.substring(start, end) || defaultText;
  const replacement = before + selected + after;
  textarea.value = val.substring(0, start) + replacement + val.substring(end);
  const newPos = start + before.length + selected.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  handleMarkdownInput();
}

function insertCodeBlock(lang = 'bash') {
  const textarea = document.getElementById('mContent');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.substring(start, end) || '// Tapez votre commande ou code ici';
  const block = `\n\`\`\`${lang}\n${selected}\n\`\`\`\n`;
  textarea.value = val.substring(0, start) + block + val.substring(end);
  textarea.focus();
  handleMarkdownInput();
}

function insertTableTemplate() {
  const tpl = `\n| Paramètre / Équipement | Valeur / Configuration | Description |\n|---|---|---|\n| IP / Masque | 192.168.1.1/24 | Passerelle par défaut |\n| VLAN | 10 | Réseau administration |\n`;
  insertMd('', '', tpl);
}

function editorUndo() {
  const textarea = document.getElementById('mContent');
  if (textarea) {
    textarea.focus();
    document.execCommand('undo');
    handleMarkdownInput();
  }
}

function editorRedo() {
  const textarea = document.getElementById('mContent');
  if (textarea) {
    textarea.focus();
    document.execCommand('redo');
    handleMarkdownInput();
  }
}

function setEditorMode(mode) {
  const container = document.getElementById('mdEditorContainer');
  const btnSplit = document.getElementById('btnModeSplit');
  const btnEdit = document.getElementById('btnModeEdit');
  const btnPreview = document.getElementById('btnModePreview');
  if (!container) return;

  container.classList.remove('split-active', 'edit-active', 'preview-active');
  [btnSplit, btnEdit, btnPreview].forEach(b => b?.classList.remove('active'));

  if (mode === 'split') {
    container.classList.add('split-active');
    btnSplit?.classList.add('active');
  } else if (mode === 'edit') {
    container.classList.add('edit-active');
    btnEdit?.classList.add('active');
  } else if (mode === 'preview') {
    container.classList.add('preview-active');
    btnPreview?.classList.add('active');
  }
}

let draftSaveTimeout = null;
function triggerDraftSave() {
  const title = document.getElementById('mTitle')?.value || '';
  const subject = document.getElementById('mSubject')?.value || '';
  const tags = document.getElementById('mTags')?.value || '';
  const content = document.getElementById('mContent')?.value || '';
  const status = document.getElementById('mDraftStatus');

  if (status) status.innerHTML = '<i class="fa-solid fa-pen"></i> En cours...';

  clearTimeout(draftSaveTimeout);
  draftSaveTimeout = setTimeout(() => {
    if (!editingCourseId && (title || content)) {
      try {
        localStorage.setItem('ciel_draft_course', JSON.stringify({ title, subject, tags, content, timestamp: Date.now() }));
        if (status) status.innerHTML = '<i class="fa-solid fa-check"></i> Brouillon sauvegardé';
      } catch (e) {}
    }
  }, 800);
}

function restoreDraftIfExists() {
  const raw = localStorage.getItem('ciel_draft_course');
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    const mTitle = document.getElementById('mTitle');
    const mSubject = document.getElementById('mSubject');
    const mTags = document.getElementById('mTags');
    const mContent = document.getElementById('mContent');
    const status = document.getElementById('mDraftStatus');

    if (mTitle && draft.title && !mTitle.value) mTitle.value = draft.title;
    if (mSubject && draft.subject && !mSubject.value) mSubject.value = draft.subject;
    if (mTags && draft.tags && !mTags.value) mTags.value = draft.tags;
    if (mContent && draft.content && !mContent.value) mContent.value = draft.content;
    if (status) status.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Brouillon restauré';
  } catch (e) {}
}

function clearDraft() {
  localStorage.removeItem('ciel_draft_course');
  const status = document.getElementById('mDraftStatus');
  if (status) status.innerHTML = '<i class="fa-solid fa-cloud"></i> Prêt';
}

function handleMarkdownInput() {
  triggerDraftSave();
  const content = document.getElementById('mContent')?.value || '';
  const preview = document.getElementById('mContentPreview');
  const wordEl = document.getElementById('mWordCount');
  const charEl = document.getElementById('mCharCount');
  const readEl = document.getElementById('mReadTime');

  const words = content.trim() ? (content.trim().match(/\S+/g) || []).length : 0;
  const chars = content.length;
  const readTime = Math.max(1, Math.ceil(words / 200));

  if (wordEl) wordEl.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${words} mot${words > 1 ? 's' : ''}`;
  if (charEl) charEl.innerText = `${chars} car.`;
  if (readEl) readEl.innerHTML = `<i class="fa-regular fa-clock"></i> ~${readTime} min de lecture`;

  if (preview) {
    const parsed = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(content) : content;
    preview.innerHTML = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsed) : parsed;
    if (typeof Prism !== 'undefined') {
      Prism.highlightAllUnder(preview);
    }
  }
}

// Focus Mode & PDF
function openFocusModal(id, isShared = false) {
  let course;
  if (!isShared) {
    course = userVault.courses.find(c => c.id === Number(id));
  } else {
    const shared = allSharedCourses.find(s => s.id === String(id));
    course = shared ? shared.course : null;
  }
  if (!course) return;

  const theme = getSubjectThemeInfo(course.subject);
  const metaEl = document.getElementById('focusModalMeta');
  const titleEl = document.getElementById('focusModalTitle');
  const bodyEl = document.getElementById('focusModalBody');
  const attEl = document.getElementById('focusModalAttachments');

  if (metaEl) {
    metaEl.innerHTML = `<span class="badge-sub"><i class="${theme.icon}"></i> ${escapeHtml(course.subject)}</span>`;
  }
  if (titleEl) titleEl.innerText = course.title;
  if (bodyEl) {
    const parsed = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(course.content || '') : (course.content || '');
    bodyEl.innerHTML = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsed) : parsed;
    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bodyEl);
  }
  if (attEl) {
    attEl.innerHTML = buildAttachmentsHTML(course.attachments);
  }

  const modal = document.getElementById('focusModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }
}

function closeFocusModal() {
  const modal = document.getElementById('focusModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function printFocusCourse() {
  window.print();
}

function exportCourseToPDF(id) {
  openFocusModal(id, false);
  setTimeout(() => {
    window.print();
  }, 400);
}

// Compression d'image côté client
async function compressImageIfNeeded(file) {
  if (!file.type || !file.type.startsWith('image/')) return file;
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1280;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (blob && blob.size < file.size) {
            const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function openCourseModal() {
  editingCourseId = null;
  pendingFiles = [];
  renderPendingModalFiles();
  updateFolderSelectOptions();

  const mTitle = document.getElementById('mTitle');
  const mTags = document.getElementById('mTags');
  const mContent = document.getElementById('mContent');
  const mFolder = document.getElementById('mFolder');
  const mSubmitBtn = document.getElementById('mSubmitBtn');

  if (mTitle) mTitle.value = '';
  if (mTags) mTags.value = '';
  if (mContent) mContent.value = '';
  if (mFolder) {
    mFolder.value = (activeFolderId && activeFolderId !== 'all' && activeFolderId !== 'unassigned') ? activeFolderId : '';
  }
  if (mSubmitBtn) mSubmitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sauvegarder dans mon classeur';
  
  restoreDraftIfExists();
  handleMarkdownInput();

  const modal = document.getElementById('courseModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }
}

function openEditCourseModal(id) {
  const course = userVault.courses.find(c => c.id === id);
  if (!course) return;

  editingCourseId = id;
  pendingFiles = [];
  renderPendingModalFiles();
  updateFolderSelectOptions();

  const mSubject = document.getElementById('mSubject');
  const mFolder = document.getElementById('mFolder');
  const mTitle = document.getElementById('mTitle');
  const mTags = document.getElementById('mTags');
  const mContent = document.getElementById('mContent');
  const mSubmitBtn = document.getElementById('mSubmitBtn');

  if (mSubject) mSubject.value = course.subject;
  if (mFolder) mFolder.value = course.folderId || '';
  if (mTitle) mTitle.value = course.title;
  if (mTags) mTags.value = (course.tags || []).join(', ');
  if (mContent) mContent.value = course.content || '';
  if (mSubmitBtn) mSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Mettre à jour le cours';

  handleMarkdownInput();

  const modal = document.getElementById('courseModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }
}

function closeCourseModal() {
  editingCourseId = null;
  const modal = document.getElementById('courseModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function handleModalFiles(e) {
  Array.from(e.target.files).forEach(f => pendingFiles.push(f));
  renderPendingModalFiles();
  e.target.value = '';
}

function removePendingFile(idx) {
  pendingFiles.splice(idx, 1);
  renderPendingModalFiles();
}

function renderPendingModalFiles() {
  const box = document.getElementById('mAttachedList');
  if (!box) return;
  box.innerHTML = '';
  pendingFiles.forEach((f, idx) => {
    const isImg = f.type && f.type.startsWith('image/');
    const chip = document.createElement('span');
    chip.style = 'background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 99px; padding: 0.3rem 0.7rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.4rem;';
    chip.innerHTML = `
      <i class="${isImg ? 'fa-solid fa-image' : 'fa-solid fa-file'}" style="color: var(--primary);" aria-hidden="true"></i>
      <span>${escapeHtml(f.name)}</span>
      <i class="fa-solid fa-xmark" style="color: var(--accent-rose); cursor: pointer;" onclick="removePendingFile(${idx})" title="Retirer" role="button" tabindex="0"></i>
    `;
    box.appendChild(chip);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = e => reject(e);
    reader.readAsDataURL(file);
  });
}

async function uploadToUserUploadsFolder(file) {
  if (typeof ghConfig === 'undefined' || !ghConfig.token) {
    // Mode local sans GitHub : converti en DataURL
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        path: reader.result,
        downloadUrl: reader.result,
        isImage: file.type && file.type.startsWith('image/'),
        size: file.size
      });
      reader.readAsDataURL(file);
    });
  }

  const b64 = await fileToBase64(file);
  const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}_${clean}`;
  const path = `uploads/${currentSession.username}/${filename}`;
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${ghConfig.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify({
      message: `Upload ${currentSession.username}: ${filename}`,
      content: b64,
      branch: ghConfig.branch
    })
  });

  if (!res.ok) throw new Error("Erreur téléversement GitHub");
  const data = await res.json();
  return {
    name: file.name,
    path: path,
    downloadUrl: data.content.download_url,
    isImage: file.type && file.type.startsWith('image/'),
    size: file.size
  };
}

async function submitCourse() {
  const subjectEl = document.getElementById('mSubject');
  const folderEl = document.getElementById('mFolder');
  const titleEl = document.getElementById('mTitle');
  const tagsEl = document.getElementById('mTags');
  const contentEl = document.getElementById('mContent');
  const btn = document.getElementById('mSubmitBtn');

  const subject = subjectEl ? subjectEl.value : '';
  const folderId = folderEl ? folderEl.value || null : null;
  const title = titleEl ? titleEl.value.trim() : '';
  const tagsRaw = tagsEl ? tagsEl.value : '';
  const tags = tagsRaw.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
  const content = contentEl ? contentEl.value.trim() : '';

  if (!title) {
    showToast("Veuillez renseigner un titre pour votre cours.", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement...';
  }

  try {
    const uploadedList = [];
    for (const file of pendingFiles) {
      const res = await uploadToUserUploadsFolder(file);
      uploadedList.push(res);
    }

    if (editingCourseId) {
      const target = userVault.courses.find(c => c.id === editingCourseId);
      if (target) {
        target.subject = subject;
        target.folderId = folderId;
        target.title = title;
        target.tags = tags;
        target.content = content;
        if (uploadedList.length > 0) {
          target.attachments = (target.attachments || []).concat(uploadedList);
        }
      }
      editingCourseId = null;
      showToast("Cours mis à jour avec succès !", "success");
    } else {
      userVault.courses.unshift({
        id: Date.now(),
        subject,
        folderId,
        title,
        tags,
        content,
        attachments: uploadedList,
        date: new Date().toISOString()
      });
      showToast("Cours enregistré dans votre classeur !", "success");
    }

    if (titleEl) titleEl.value = '';
    if (tagsEl) tagsEl.value = '';
    if (contentEl) contentEl.value = '';
    pendingFiles = [];
    clearDraft();

    closeCourseModal();
    renderFoldersBar();
    renderCourses();
    triggerAutoSave();
  } catch (err) {
    showToast("Erreur lors de l'enregistrement : " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sauvegarder dans mon classeur';
    }
  }
}

async function deleteCourseById(courseId) {
  const ok = await customConfirm("Supprimer ce cours", "Êtes-vous sûr de vouloir supprimer définitivement ce cours de votre classeur ?");
  if (!ok) return;

  userVault.courses = userVault.courses.filter(c => c.id !== courseId);
  renderCourses();
  triggerAutoSave();
  showToast("Cours supprimé.", "info");
}

/* ==========================================================
   7. FLASHCARDS & TODOS
   ========================================================== */
function renderFlashcards() {
  const cardEl = document.getElementById('fcInteractiveCard');
  const frontBox = document.getElementById('fcDisplayFront');
  const backBox = document.getElementById('fcDisplayBack');
  const counter = document.getElementById('fcNumberLabel');
  const badge = document.getElementById('fcBadgeLabel');
  const badgeFront = document.getElementById('fcBadgeLabelFront');
  const badgeBack = document.getElementById('fcBadgeLabelBack');
  const prevBtn = document.getElementById('fcPrevBtn');
  const delBtn = document.getElementById('fcDeleteBtn');
  const nextBtn = document.getElementById('fcNextBtn');

  if (!cardEl || !frontBox || !backBox) return;

  if (userVault.flashcards.length === 0) {
    frontBox.innerHTML = "Aucune flashcard enregistrée.";
    backBox.innerHTML = "Ajoutez une carte ci-dessus !";
    if (counter) counter.innerText = "0 / 0";
    if (badge) badge.innerHTML = '<i class="fa-solid fa-layer-group"></i> Discipline';
    if (badgeFront) badgeFront.innerText = "Vide";
    if (badgeBack) badgeBack.innerText = "Vide";
    if (prevBtn) prevBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    cardEl.classList.remove('is-flipped');
    return;
  }

  if (prevBtn) prevBtn.disabled = false;
  if (delBtn) delBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;

  if (fcCursor >= userVault.flashcards.length) fcCursor = 0;
  if (fcCursor < 0) fcCursor = userVault.flashcards.length - 1;

  const item = userVault.flashcards[fcCursor];
  if (counter) counter.innerText = `${fcCursor + 1} / ${userVault.flashcards.length}`;
  const subject = item.s || "Général";
  if (badge) badge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${escapeHtml(subject)}`;
  if (badgeFront) badgeFront.innerText = subject;
  if (badgeBack) badgeBack.innerText = subject;

  frontBox.innerText = item.q;
  backBox.innerText = item.a;

  if (fcFlipped) {
    cardEl.classList.add('is-flipped');
  } else {
    cardEl.classList.remove('is-flipped');
  }
}

function toggleFlashcardFlip() {
  if (userVault.flashcards.length === 0) return;
  fcFlipped = !fcFlipped;
  const cardEl = document.getElementById('fcInteractiveCard');
  if (cardEl) cardEl.classList.toggle('is-flipped', fcFlipped);
}

function nextFlashcard() {
  if (userVault.flashcards.length === 0) return;
  fcFlipped = false;
  fcCursor = (fcCursor + 1) % userVault.flashcards.length;
  renderFlashcards();
  if (fcCursor === 0 && typeof confetti === 'function' && userVault.flashcards.length > 1) {
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    showToast("Tour complet de révision terminé ! 🎯", "success");
  }
}

function prevFlashcard() {
  if (userVault.flashcards.length === 0) return;
  fcFlipped = false;
  fcCursor = (fcCursor - 1 + userVault.flashcards.length) % userVault.flashcards.length;
  renderFlashcards();
}

function addFlashcard() {
  const subEl = document.getElementById('fcSub');
  const qEl = document.getElementById('fcQ');
  const aEl = document.getElementById('fcA');

  const s = (subEl ? subEl.value.trim() : '') || 'CIEL';
  const q = qEl ? qEl.value.trim() : '';
  const a = aEl ? aEl.value.trim() : '';

  if (!q || !a) {
    showToast("Veuillez saisir une question et sa réponse.", "error");
    return;
  }
  userVault.flashcards.push({ s, q, a });
  if (qEl) qEl.value = '';
  if (aEl) aEl.value = '';
  renderFlashcards();
  triggerAutoSave();
  showToast("Flashcard ajoutée !", "success");
}

async function deleteCurrentFlashcard() {
  if (userVault.flashcards.length === 0) return;
  const ok = await customConfirm("Supprimer la flashcard", "Voulez-vous supprimer cette carte mémoire ?");
  if (!ok) return;

  userVault.flashcards.splice(fcCursor, 1);
  fcFlipped = false;
  renderFlashcards();
  triggerAutoSave();
  showToast("Flashcard supprimée.", "info");
}

function renderTodos() {
  const feed = document.getElementById('todosFeed');
  if (!feed) return;

  if (userVault.todos.length === 0) {
    feed.innerHTML = `<p style="text-align: center; color: var(--text-sub); padding: 1.5rem 0;"><i class="fa-solid fa-clipboard-check" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>Aucun objectif en attente.</p>`;
    return;
  }

  const total = userVault.todos.length;
  const doneCount = userVault.todos.filter(t => t.done).length;
  const percent = Math.round((doneCount / total) * 100);

  let html = `
    <div class="todo-progress-card">
      <div class="todo-progress-header">
        <span><i class="fa-solid fa-chart-line" style="color: var(--primary);"></i> Progression des révisions</span>
        <span>${doneCount} / ${total} complété${doneCount > 1 ? 's' : ''} (${percent}%)</span>
      </div>
      <div class="todo-progress-bar-bg">
        <div class="todo-progress-bar-fill" style="width: ${percent}%;"></div>
      </div>
    </div>
  `;

  userVault.todos.forEach((t, i) => {
    html += `
      <div class="todo-row ${t.done ? 'is-done' : ''}">
        <div style="display:flex; align-items:center; gap:0.85rem; cursor:pointer; flex:1;" onclick="toggleTodo(${i})">
          <div class="todo-check-btn">
            <i class="fa-solid fa-check"></i>
          </div>
          <span class="todo-text">${escapeHtml(t.text)}</span>
        </div>
        <button class="btn btn-danger" style="padding: 0.25rem 0.55rem; min-height: 32px;" onclick="deleteTodo(${i})" title="Supprimer">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
  });

  feed.innerHTML = html;
}

function toggleTodo(i) {
  if (userVault.todos && userVault.todos[i]) {
    userVault.todos[i].done = !userVault.todos[i].done;
    renderTodos();
    triggerAutoSave();
  }
}

function createTodo() {
  const input = document.getElementById('todoInputText');
  const val = input ? input.value.trim() : '';
  if (!val) return;
  userVault.todos.push({ text: val, done: false });
  if (input) input.value = '';
  renderTodos();
  triggerAutoSave();
}

async function deleteTodo(i) {
  const ok = await customConfirm("Supprimer l'objectif", "Voulez-vous supprimer cet objectif ?");
  if (!ok) return;
  userVault.todos.splice(i, 1);
  renderTodos();
  triggerAutoSave();
  showToast("Objectif supprimé.", "info");
}
const deleteTodoItem = deleteTodo;

/* ==========================================================
   8. NAVIGATION & LIGHTBOX
   ========================================================== */
function showTab(tabId) {
  document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));

  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  document.querySelectorAll(`[onclick="showTab('${tabId}')"]`).forEach(b => b.classList.add('active'));
  if (typeof window !== 'undefined' && window.scrollTo) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function openLightbox(src) {
  const img = document.getElementById('lightboxImg');
  const modal = document.getElementById('lightboxModal');
  if (img) img.src = src;
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);
  }
}

function closeLightbox() {
  const img = document.getElementById('lightboxImg');
  const modal = document.getElementById('lightboxModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
  if (img) img.src = '';
}

/* ==========================================================
   8.1 RACCOURCIS CLAVIER & RECHERCHE ERGONOMIQUE
   ========================================================== */
function toggleSearchClear(val) {
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.style.display = val && val.trim().length > 0 ? 'block' : 'none';
}

function clearCourseSearch() {
  const searchInput = document.getElementById('courseSearch');
  if (searchInput) {
    searchInput.value = '';
    toggleSearchClear('');
    renderCourses();
    searchInput.focus();
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================
   8.2 PARAMÈTRES, DERNIÈRE CONNEXION & EXPÉRIENCE ÉLÈVE
   ========================================================== */
function trackUserLoginSession(username) {
  if (!username || typeof localStorage === 'undefined') return;
  const currKey = `ciel_curr_login_${username}`;
  const prevKey = `ciel_prev_login_${username}`;

  const lastRecorded = localStorage.getItem(currKey);
  if (lastRecorded) {
    localStorage.setItem(prevKey, lastRecorded);
  }
  localStorage.setItem(currKey, new Date().toISOString());
}

function getFormattedLastLogin(username) {
  if (!username) return "Session active";
  if (typeof localStorage === 'undefined') return "Première connexion enregistrée aujourd'hui";
  const prevKey = `ciel_prev_login_${username}`;
  const prevIso = localStorage.getItem(prevKey);
  if (!prevIso) {
    return "Première connexion enregistrée aujourd'hui";
  }
  try {
    const d = new Date(prevIso);
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch(e) {
    return prevIso;
  }
}

function applyUserSettings() {
  const isCompact = userVault.settings?.compactMode || (typeof localStorage !== 'undefined' && localStorage.getItem('ciel_setting_compact') === 'true');
  const feed = document.getElementById('coursesFeed');
  if (feed) {
    if (isCompact) feed.classList.add('compact-mode');
    else feed.classList.remove('compact-mode');
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const username = currentSession.username || 'Invité';
  const uLabel = document.getElementById('settingsUsernameLabel');
  if (uLabel) uLabel.innerText = `@${username}`;

  const loginLabel = document.getElementById('settingsLastLoginLabel');
  if (loginLabel) {
    loginLabel.innerText = getFormattedLastLogin(username);
  }

  // Synchronisation des cases à cocher
  const compactToggle = document.getElementById('settingCompactMode');
  if (compactToggle) {
    compactToggle.checked = !!(userVault.settings?.compactMode || localStorage.getItem('ciel_setting_compact') === 'true');
  }

  const confettiToggle = document.getElementById('settingConfetti');
  if (confettiToggle) {
    confettiToggle.checked = userVault.settings?.confetti !== false && localStorage.getItem('ciel_setting_confetti') !== 'false';
  }

  // Synchronisation des options IA Gemini
  renderGeminiModelOptions();
  const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : 'gemini-2.5-flash';
  const modelSelect = document.getElementById('settingGeminiModel');
  if (modelSelect) {
    modelSelect.value = currentModel;
    updateModelEndpointDesc(currentModel);
  }
  if (typeof updateAIQuotaUI === 'function') {
    updateAIQuotaUI();
  }

  modal.classList.add('active');
  trapFocusInModal(modal);
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function toggleSettingCompactMode(checked) {
  if (!userVault.settings) userVault.settings = {};
  userVault.settings.compactMode = !!checked;
  localStorage.setItem('ciel_setting_compact', checked ? 'true' : 'false');
  applyUserSettings();
  triggerAutoSave();
  showToast(checked ? "Mode compact activé" : "Mode normal activé", "info");
}

function toggleSettingConfetti(checked) {
  if (!userVault.settings) userVault.settings = {};
  userVault.settings.confetti = !!checked;
  localStorage.setItem('ciel_setting_confetti', checked ? 'true' : 'false');
  triggerAutoSave();
  showToast(checked ? "Animations festives activées 🎉" : "Animations festives désactivées", "info");
}

function exportVaultBackupJSON() {
  if (!userVault) return;
  const username = currentSession.username || 'esteban';
  const dateStr = new Date().toISOString().slice(0, 10);
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(userVault, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `ciel_studyos_coffre_${username}_${dateStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("Sauvegarde exportée avec succès !", "success");
}

async function forceVaultSync() {
  await syncUserVault();
  showToast("Coffre synchronisé avec GitHub !", "success");
}

/* ==========================================================
   8.3 SYSTÈME DE DOSSIERS & RANGEMENT INTUITIF
   ========================================================== */
function renderFoldersBar() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('foldersChipsList');
  if (!container) return;
  if (!userVault.folders) userVault.folders = [];

  const totalCourses = (userVault.courses || []).length;
  const unassignedCount = (userVault.courses || []).filter(c => !c.folderId).length;

  let html = '';

  // 1. Bouton 'Tous les cours'
  const isAllActive = activeFolderId === 'all';
  html += `
    <button type="button" class="folder-chip ${isAllActive ? 'active' : ''}" onclick="setFolderFilter('all')" role="tab" aria-selected="${isAllActive}">
      <i class="fa-solid fa-folder-open folder-chip-icon"></i>
      <span class="folder-chip-name">Tous les cours</span>
      <span class="folder-chip-count">${totalCourses}</span>
    </button>
  `;

  // 2. Dossiers personnalisés
  userVault.folders.forEach(f => {
    const count = (userVault.courses || []).filter(c => c.folderId === f.id).length;
    const isActive = activeFolderId === f.id;
    const color = f.color || 'var(--primary)';
    html += `
      <div class="folder-chip ${isActive ? 'active' : ''}" style="--f-color: ${color}; --f-glow: ${color}40;" onclick="setFolderFilter('${f.id}')" role="tab" aria-selected="${isActive}">
        <i class="fa-solid fa-folder folder-chip-icon" style="color: ${color};"></i>
        <span class="folder-chip-name">${escapeHtml(f.name)}</span>
        <span class="folder-chip-count">${count}</span>
        <button type="button" class="folder-chip-menu-btn" onclick="event.stopPropagation(); openEditFolderModal('${f.id}')" title="Gérer ce dossier" aria-label="Gérer le dossier ${escapeHtml(f.name)}">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </div>
    `;
  });

  // 3. Bouton 'Non classés'
  if (unassignedCount > 0 && userVault.folders.length > 0) {
    const isUnassignedActive = activeFolderId === 'unassigned';
    html += `
      <button type="button" class="folder-chip ${isUnassignedActive ? 'active' : ''}" onclick="setFolderFilter('unassigned')" role="tab" aria-selected="${isUnassignedActive}">
        <i class="fa-regular fa-folder folder-chip-icon"></i>
        <span class="folder-chip-name">Non classés</span>
        <span class="folder-chip-count">${unassignedCount}</span>
      </button>
    `;
  }

  container.innerHTML = html;
  updateFolderSelectOptions();
}

function setFolderFilter(fId) {
  activeFolderId = fId;
  renderFoldersBar();
  renderCourses();
}

function updateFolderSelectOptions() {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('mFolder');
  if (!select) return;
  if (!userVault.folders) userVault.folders = [];

  const currentVal = select.value;
  select.innerHTML = '<option value="">📁 Aucun dossier (Non classé)</option>';
  userVault.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `📁 ${f.name}`;
    select.appendChild(opt);
  });
  if (currentVal) select.value = currentVal;
}

function openCreateFolderModal(fromCourseModal = false) {
  const modal = document.getElementById('folderModal');
  if (!modal) return;

  const title = document.getElementById('folderModalTitle');
  const idInput = document.getElementById('fFolderId');
  const nameInput = document.getElementById('fFolderName');
  if (title) title.innerHTML = '<i class="fa-solid fa-folder-plus" style="color: var(--primary);"></i> Nouveau dossier';
  if (idInput) idInput.value = '';
  if (nameInput) nameInput.value = '';

  selectedFolderColor = FOLDER_COLORS[0];
  renderColorPalette();

  modal.classList.add('active');
  trapFocusInModal(modal);
  if (nameInput) setTimeout(() => nameInput.focus(), 150);
}

function openEditFolderModal(folderId) {
  const folder = userVault.folders.find(f => f.id === folderId);
  if (!folder) return;

  customConfirm(`Dossier "${folder.name}" : voulez-vous le SUPPRIMER ?\n\n(Vos cours seront conservés intacts dans votre classeur en tant que non-classés)`, () => {
    deleteFolder(folderId);
  });
}

function deleteFolder(folderId) {
  if (!userVault.folders) return;
  userVault.folders = userVault.folders.filter(f => f.id !== folderId);
  (userVault.courses || []).forEach(c => {
    if (c.folderId === folderId) c.folderId = null;
  });
  if (activeFolderId === folderId) activeFolderId = 'all';
  renderFoldersBar();
  renderCourses();
  triggerAutoSave();
  showToast("Dossier supprimé (vos cours sont conservés).", "info");
}

function closeFolderModal() {
  const modal = document.getElementById('folderModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function renderColorPalette() {
  const palette = document.getElementById('folderColorPalette');
  if (!palette) return;
  palette.innerHTML = FOLDER_COLORS.map(color => `
    <button type="button" class="color-circle ${color === selectedFolderColor ? 'selected' : ''}" style="background: ${color};" onclick="selectFolderColor('${color}')" aria-label="Choisir la couleur ${color}">
      ${color === selectedFolderColor ? '<i class="fa-solid fa-check" style="color:#fff;"></i>' : ''}
    </button>
  `).join('');
}

function selectFolderColor(color) {
  selectedFolderColor = color;
  renderColorPalette();
}

function handleFolderSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('fFolderName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) return;

  if (!userVault.folders) userVault.folders = [];

  const newFolder = {
    id: 'f_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    name: name,
    color: selectedFolderColor,
    createdAt: new Date().toISOString()
  };

  userVault.folders.push(newFolder);
  closeFolderModal();
  renderFoldersBar();

  // Si le formulaire de cours est ouvert, pré-sélectionner le nouveau dossier
  const mFolder = document.getElementById('mFolder');
  if (mFolder) {
    mFolder.value = newFolder.id;
  }

  triggerAutoSave();
  showToast(`Dossier "${name}" créé avec succès !`, "success");
}

function openMoveCourseModal(courseId) {
  courseToMoveId = courseId;
  const course = (userVault.courses || []).find(c => c.id === courseId);
  if (!course) return;

  const modal = document.getElementById('moveCourseModal');
  const sub = document.getElementById('moveCourseModalSubtitle');
  const list = document.getElementById('moveFolderOptionsList');
  if (!modal || !list) return;

  if (sub) sub.innerText = `Déplacer "${course.title}" dans :`;

  let html = `
    <button type="button" class="move-folder-btn ${!course.folderId ? 'current' : ''}" onclick="assignCourseToFolder(null)">
      <span><i class="fa-regular fa-folder"></i> Aucun dossier (Non classé)</span>
      ${!course.folderId ? '<i class="fa-solid fa-check" style="color:var(--accent-green);"></i>' : ''}
    </button>
  `;

  if (!userVault.folders) userVault.folders = [];
  userVault.folders.forEach(f => {
    const isCurrent = course.folderId === f.id;
    html += `
      <button type="button" class="move-folder-btn ${isCurrent ? 'current' : ''}" onclick="assignCourseToFolder('${f.id}')">
        <span><i class="fa-solid fa-folder" style="color:${f.color};"></i> ${escapeHtml(f.name)}</span>
        ${isCurrent ? '<i class="fa-solid fa-check" style="color:var(--accent-green);"></i>' : ''}
      </button>
    `;
  });

  list.innerHTML = html;
  modal.classList.add('active');
  trapFocusInModal(modal);
}

function closeMoveCourseModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('moveCourseModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function assignCourseToFolder(folderId) {
  if (!courseToMoveId) return;
  const course = (userVault.courses || []).find(c => c.id === courseToMoveId);
  if (course) {
    course.folderId = folderId;
    triggerAutoSave();
    renderFoldersBar();
    renderCourses();
    const fName = folderId ? (userVault.folders.find(f => f.id === folderId)?.name || 'Dossier') : 'Non classé';
    showToast(`Cours rangé dans "${fName}"`, "success");
  }
  closeMoveCourseModal();
}

/* ==========================================================
   8.4 MODULE ASSISTANT IA (STUDYBOT CIEL)
   ========================================================== */
let aiChatHistoryState = [];
let isAIGenerating = false;

function openAIAssistantModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('aiAssistantModal');
  if (!modal) return;

  // Mise à jour du sélecteur de modèle direct dans l'en-tête
  renderQuickModelSelect();

  // Mise à jour des jauges de quotas
  updateAIQuotaUI();

  // Rendu des messages existants (ou message de bienvenue)
  renderAIChatMessages();

  modal.classList.add('active');
  trapFocusInModal(modal);

  setTimeout(() => {
    const input = document.getElementById('aiChatInput');
    if (input) input.focus();
    scrollAIChatToBottom();
  }, 100);
}

function renderQuickModelSelect() {
  const select = document.getElementById('aiQuickModelSelect');
  if (!select || typeof GEMINI_MODELS === 'undefined') return;

  const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : 'gemini-2.5-flash';

  const tierGroups = [
    { id: 'tier_25', label: '⚡ Famille Gemini 2.5' },
    { id: 'tier_30', label: '🧠 Famille Gemini 3.0 à 3.5' },
    { id: 'tier_36', label: '✨ Famille Gemini 3.6 & 3.7' }
  ];

  select.innerHTML = tierGroups.map(group => {
    const models = GEMINI_MODELS.filter(m => m.tier === group.id);
    if (models.length === 0) return '';
    const options = models.map(m => `
      <option value="${m.id}" ${m.id === currentModel ? 'selected' : ''}>${m.name} [${m.tag}]</option>
    `).join('');
    return `<optgroup label="${group.label}">${options}</optgroup>`;
  }).join('');
}

function toggleAIQuotaPanel() {
  const panel = document.getElementById('aiQuotaPanel');
  const btn = document.getElementById('btnToggleAIQuota');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (btn) {
    if (isOpen) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  updateAIQuotaUI();
}

function updateAIQuotaUI() {
  if (typeof getAIQuotaInfo !== 'function') return;
  const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : 'gemini-2.5-flash';
  const info = getAIQuotaInfo(currentModel);
  if (!info) return;

  const fmt = (typeof formatTokens === 'function') ? formatTokens : (n) => typeof n === 'number' ? n.toLocaleString('fr-FR') : '0';

  const applyToBar = (pctElId, barElId, resetElId, pct, usedTokens, limitTokens, resetText, iconClass) => {
    const pctEl = document.getElementById(pctElId);
    if (pctEl) {
      pctEl.innerText = `${pct}% (${fmt(usedTokens)} / ${fmt(limitTokens)} tokens)`;
      if (pct >= 90) pctEl.style.color = '#f87171';
      else if (pct >= 75) pctEl.style.color = '#fb923c';
      else pctEl.style.color = '#94a3b8';
    }
    const barEl = document.getElementById(barElId);
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.className = 'ai-quota-fill';
      if (pct >= 90) barEl.classList.add('danger');
      else if (pct >= 75) barEl.classList.add('warning');
    }
    const resetEl = document.getElementById(resetElId);
    if (resetEl) {
      resetEl.innerHTML = `<i class="${iconClass}"></i> ${escapeHtml(resetText)}`;
    }
  };

  // 1. Volet de quotas dans StudyBot
  applyToBar('aiQuota5hPct', 'aiQuota5hBar', 'aiQuota5hReset', info.pct5h, info.usedTokens5h, info.limitTokens5h, info.reset5hText, 'fa-regular fa-clock');
  applyToBar('aiQuota7dPct', 'aiQuota7dBar', 'aiQuota7dReset', info.pct7d, info.usedTokens7d, info.limitTokens7d, info.reset7dText, 'fa-regular fa-calendar-check');

  // 2. Section quotas dans les Paramètres
  applyToBar('settingQuota5hPct', 'settingQuota5hBar', 'settingQuota5hReset', info.pct5h, info.usedTokens5h, info.limitTokens5h, info.reset5hText, 'fa-regular fa-clock');
  applyToBar('settingQuota7dPct', 'settingQuota7dBar', 'settingQuota7dReset', info.pct7d, info.usedTokens7d, info.limitTokens7d, info.reset7dText, 'fa-regular fa-calendar-check');

  // 3. Bouton pillule dans l'en-tête StudyBot
  const miniText = document.getElementById('aiHeaderQuotaMiniText');
  if (miniText) {
    miniText.innerText = `Tokens (${fmt(info.usedTokens5h)}/${fmt(info.limitTokens5h)})`;
  }
}

function handleQuickModelChange(newModelId) {
  if (typeof setSelectedGeminiModel === 'function') {
    setSelectedGeminiModel(newModelId);

    // Synchroniser avec les paramètres si la modale des paramètres est ouverte
    const settingSelect = document.getElementById('settingGeminiModel');
    if (settingSelect) settingSelect.value = newModelId;
    if (typeof updateModelEndpointDesc === 'function') updateModelEndpointDesc(newModelId);

    updateAIQuotaUI();
    showToast(`Modèle sélectionné : ${newModelId}`, "info");
  }
}

function closeAIAssistantModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('aiAssistantModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function scrollAIChatToBottom() {
  const body = document.getElementById('aiChatBody');
  if (body) {
    body.scrollTop = body.scrollHeight;
  }
}

function renderAIChatMessages() {
  const container = document.getElementById('aiChatHistory');
  if (!container) return;

  if (aiChatHistoryState.length === 0) {
    const username = currentSession.username || 'Élève';
    container.innerHTML = `
      <div class="ai-message ai-msg-bot">
        <div class="ai-msg-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div class="ai-msg-bubble">
          <p><strong>Bonjour ${escapeHtml(username)} ! 👋</strong></p>
          <p>Je suis <strong>StudyBot CIEL</strong>, ton assistant propulsé par Google Gemini. Je suis spécialisé dans le programme du <strong>Bac Pro CIEL</strong> (Cybersécurité, Informatique et Réseaux, Électronique) ainsi que les matières générales.</p>
          <p>Tu peux me poser une question de cours, me demander d'expliquer un protocole (VLAN, STP, OSPF, DNS, TCP/IP), de résoudre un calcul (Loi d'Ohm, Masque /28, Puissance), ou d'analyser un code Arduino/C/Python.</p>
          <p style="font-size: 0.84rem; color: var(--text-muted); margin-top: 0.5rem;"><em>💡 Clique sur l'une des suggestions ci-dessous ou écris directement ta question.</em></p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = aiChatHistoryState.map((msg, index) => {
    const isUser = msg.role === 'user';
    let formattedText = '';
    if (isUser) {
      formattedText = escapeHtml(msg.text).replace(/\n/g, '<br>');
    } else {
      const parsed = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(msg.text) : escapeHtml(msg.text);
      formattedText = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsed) : parsed;
    }

    const actionBtnHTML = (!isUser) ? `
      <div class="ai-msg-actions">
        <button type="button" class="ai-action-btn ai-action-btn-retry" onclick="retryAIMessage(${index}, 'normal')" title="Régénérer cette réponse">
          <i class="fa-solid fa-rotate-right"></i> Réessayer
        </button>
        <button type="button" class="ai-action-btn ai-action-btn-variant" onclick="retryAIMessage(${index}, 'shorter')" title="Régénérer en version plus courte et concise">
          <i class="fa-solid fa-compress"></i> Plus court
        </button>
        <button type="button" class="ai-action-btn ai-action-btn-variant" onclick="retryAIMessage(${index}, 'longer')" title="Régénérer en version plus détaillée avec exemples">
          <i class="fa-solid fa-expand"></i> Plus long
        </button>
        <button type="button" class="ai-action-btn ai-action-btn-model" onclick="promptSwitchModelForMessage(${index})" title="Régénérer avec un autre modèle Gemini">
          <i class="fa-solid fa-robot"></i> Autre modèle
        </button>
        <button type="button" class="ai-action-btn" onclick="createCourseFromAIMessage(${index})" title="Créer une fiche de cours à partir de cette réponse">
          <i class="fa-solid fa-file-circle-plus"></i> Créer fiche
        </button>
        <button type="button" class="ai-action-btn" onclick="copyAIMessageText(${index})" title="Copier la réponse">
          <i class="fa-solid fa-copy"></i> Copier
        </button>
      </div>` : '';

    return `
      <div class="ai-message ${isUser ? 'ai-msg-user' : 'ai-msg-bot'}">
        <div class="ai-msg-avatar">
          <i class="fa-solid ${isUser ? 'fa-user' : 'fa-wand-magic-sparkles'}"></i>
        </div>
        <div class="ai-msg-bubble">
          ${formattedText}
          ${actionBtnHTML}
        </div>
      </div>
    `;
  }).join('');

  if (typeof Prism !== 'undefined') {
    Prism.highlightAllUnder(container);
  }
}

async function retryAIMessage(botIndex, mode = 'normal', specificModel = null) {
  if (isAIGenerating) return;

  const userIndex = botIndex - 1;
  if (userIndex < 0 || aiChatHistoryState[userIndex]?.role !== 'user') {
    showToast("Impossible de retrouver la question d'origine.", "error");
    return;
  }

  const originalUserText = aiChatHistoryState[userIndex].text;

  // Tronquer pour repartir avant la réponse du bot
  aiChatHistoryState = aiChatHistoryState.slice(0, userIndex);

  let newPromptText = originalUserText;
  if (mode === 'shorter') {
    newPromptText = `${originalUserText}\n\n[Consigne pour l'IA : Réponds de manière très synthétique, concise et percutante, sous forme de mémo d'examen pour le Bac Pro CIEL.]`;
    showToast("Régénération en version plus courte...", "info");
  } else if (mode === 'longer') {
    newPromptText = `${originalUserText}\n\n[Consigne pour l'IA : Réponds de manière très détaillée, exhaustive et approfondie, avec des exemples techniques complets, des commandes et des explications étape par étape pour le Bac Pro CIEL.]`;
    showToast("Régénération en version détaillée...", "info");
  } else if (mode === 'normal') {
    showToast("Régénération de la réponse...", "info");
  }

  if (specificModel && typeof setSelectedGeminiModel === 'function') {
    setSelectedGeminiModel(specificModel);
    const qSelect = document.getElementById('aiQuickModelSelect');
    if (qSelect) qSelect.value = specificModel;
    const sSelect = document.getElementById('settingGeminiModel');
    if (sSelect) sSelect.value = specificModel;
    showToast(`Régénération avec ${specificModel}...`, "info");
  }

  await sendAIAssistantMessage(newPromptText);
}

function promptSwitchModelForMessage(botIndex) {
  const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : 'gemini-2.5-flash';
  const otherModels = (typeof GEMINI_MODELS !== 'undefined') ? GEMINI_MODELS.filter(m => m.id !== currentModel) : [];

  if (otherModels.length === 0) {
    retryAIMessage(botIndex, 'normal');
    return;
  }

  const listOptions = otherModels.map((m, i) => `${i + 1}. ${m.name} (${m.id})`).join('\n');
  const chosenIndexStr = prompt(`Choisissez le numéro du modèle pour régénérer la réponse :\n\n${listOptions}`, "1");
  if (!chosenIndexStr) return;

  const idx = parseInt(chosenIndexStr.trim(), 10) - 1;
  if (idx >= 0 && idx < otherModels.length) {
    const chosenModelId = otherModels[idx].id;
    retryAIMessage(botIndex, 'normal', chosenModelId);
  } else {
    showToast("Numéro de modèle non valide.", "error");
  }
}

async function handleAIChatSubmit(event) {
  if (event) event.preventDefault();
  if (isAIGenerating) return;

  const input = document.getElementById('aiChatInput');
  if (!input) return;
  const prompt = input.value.trim();
  if (!prompt) return;

  input.value = '';
  await sendAIAssistantMessage(prompt);
}

function handleAIChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAIChatSubmit(e);
  }
}

function loadAIQuestionSuggestion(text) {
  const input = document.getElementById('aiChatInput');
  if (input) {
    input.value = text;
    sendAIAssistantMessage(text);
  }
}

async function sendAIAssistantMessage(userText) {
  if (!userText || isAIGenerating) return;

  isAIGenerating = true;
  aiChatHistoryState.push({ role: 'user', text: userText, timestamp: Date.now() });
  renderAIChatMessages();

  // Indicateur de frappe
  const container = document.getElementById('aiChatHistory');
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'ai-message ai-msg-bot';
  typingIndicator.id = 'aiTypingIndicator';
  typingIndicator.innerHTML = `
    <div class="ai-msg-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
    <div class="ai-msg-bubble">
      <div class="ai-typing-indicator">
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
        <div class="ai-typing-dot"></div>
      </div>
    </div>
  `;
  container.appendChild(typingIndicator);
  scrollAIChatToBottom();

  const sendBtn = document.getElementById('btnAISend');
  if (sendBtn) sendBtn.disabled = true;

  try {
    if (typeof callGeminiAPI !== 'function') {
      throw new Error("Module IA (js/ai.js) non disponible.");
    }

    const reply = await callGeminiAPI(aiChatHistoryState);
    const ind = document.getElementById('aiTypingIndicator');
    if (ind) ind.remove();

    aiChatHistoryState.push({ role: 'model', text: reply, timestamp: Date.now() });
    renderAIChatMessages();
    scrollAIChatToBottom();
    if (typeof updateAIQuotaUI === 'function') updateAIQuotaUI();
  } catch (err) {
    const ind = document.getElementById('aiTypingIndicator');
    if (ind) ind.remove();
    console.error("Erreur StudyBot IA:", err);
    showToast(err.message || "Erreur lors de la communication avec Gemini", "error");

    if (typeof updateAIQuotaUI === 'function') updateAIQuotaUI();

    const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : '';
    const quota = (typeof getAIQuotaInfo === 'function') ? getAIQuotaInfo(currentModel) : null;
    let quotaTip = '';
    if (quota && quota.isBlocked) {
      quotaTip = `\n\n💡 **Astuce révision :** Les quotas sont séparés par famille de modèles. Si cette famille est épuisée, sélectionnez un modèle de la **Famille Gemini 2.5** (*Gemini 2.5 Flash*) via le menu du haut pour continuer vos révisions.`;
      const panel = document.getElementById('aiQuotaPanel');
      if (panel && !panel.classList.contains('open') && typeof toggleAIQuotaPanel === 'function') {
        toggleAIQuotaPanel();
      }
    }

    aiChatHistoryState.push({
      role: 'model',
      text: `⚠️ **Notification :**\n\n${err.message}${quotaTip}`,
      timestamp: Date.now()
    });
    renderAIChatMessages();
    scrollAIChatToBottom();
  } finally {
    isAIGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function clearAIChatHistory() {
  if (aiChatHistoryState.length === 0) return;
  customConfirm("Réinitialiser la conversation ?", "Voulez-vous effacer tout l'historique de discussion avec StudyBot CIEL ?", () => {
    aiChatHistoryState = [];
    renderAIChatMessages();
    showToast("Historique de conversation effacé", "info");
  });
}

function copyAIMessageText(index) {
  const msg = aiChatHistoryState[index];
  if (!msg) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg.text).then(() => {
      showToast("Réponse copiée dans le presse-papiers !", "success");
    }).catch(() => {
      showToast("Impossible de copier la réponse", "error");
    });
  }
}

function createCourseFromAIMessage(index) {
  const msg = aiChatHistoryState[index];
  if (!msg) return;

  let topicTitle = "Note de cours générée par IA";
  if (index > 0 && aiChatHistoryState[index - 1]?.role === 'user') {
    topicTitle = aiChatHistoryState[index - 1].text.slice(0, 45);
    if (aiChatHistoryState[index - 1].text.length > 45) topicTitle += '...';
  }

  closeAIAssistantModal();
  openCourseModal();

  setTimeout(() => {
    const titleInput = document.getElementById('cTitle');
    const contentInput = document.getElementById('cContent');
    const tagsInput = document.getElementById('cTags');

    if (titleInput) titleInput.value = topicTitle;
    if (contentInput) {
      contentInput.value = msg.text;
      if (typeof updateMdPreview === 'function') updateMdPreview();
    }
    if (tagsInput) tagsInput.value = 'IA, BacProCIEL, StudyBot';

    showToast("Réponse insérée dans une nouvelle fiche de cours !", "success");
  }, 200);
}

/* ==========================================================
   8.5 GÉNÉRATEUR DE COURS IA & ENHANCE MARKDOWN
   ========================================================== */
function openAICoursePrompt() {
  const modal = document.getElementById('aiCoursePromptModal');
  if (!modal) return;
  modal.classList.add('active');
  trapFocusInModal(modal);

  setTimeout(() => {
    const input = document.getElementById('aiCourseTopicInput');
    if (input) input.focus();
  }, 100);
}

function closeAICoursePromptModal() {
  const modal = document.getElementById('aiCoursePromptModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

async function handleAICoursePromptSubmit(event) {
  if (event) event.preventDefault();

  const topicInput = document.getElementById('aiCourseTopicInput');
  const subjectSelect = document.getElementById('aiCourseSubjectSelect');
  const formatSelect = document.getElementById('aiCourseFormatSelect');
  const submitBtn = document.getElementById('btnSubmitAICoursePrompt');

  const topic = topicInput?.value.trim();
  const subject = subjectSelect?.value || 'Informatique & Réseaux';
  const format = formatSelect?.value || 'complet';

  if (!topic) {
    showToast("Veuillez renseigner un sujet de cours.", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Rédaction par l'IA...`;
  }

  showToast("Génération du cours complet par Gemini en cours...", "info");

  try {
    if (typeof generateCourseWithAI !== 'function') {
      throw new Error("Module de génération de cours non chargé.");
    }

    const generatedMarkdown = await generateCourseWithAI(topic, subject, { format });

    // Injecter dans le formulaire de cours actuel
    const titleInput = document.getElementById('cTitle');
    const subSelect = document.getElementById('cSubject');
    const contentInput = document.getElementById('cContent');
    const tagsInput = document.getElementById('cTags');

    if (titleInput && (!titleInput.value || titleInput.value.trim() === '')) {
      titleInput.value = topic;
    }
    if (subSelect) {
      subSelect.value = subject;
    }
    if (contentInput) {
      contentInput.value = generatedMarkdown;
      if (typeof updateMdPreview === 'function') updateMdPreview();
    }
    if (tagsInput && !tagsInput.value) {
      tagsInput.value = `${subject.split(' ')[0]}, Synthèse, BacPro`;
    }

    closeAICoursePromptModal();
    showToast("Fiche de cours rédigée avec succès par l'IA !", "success");
  } catch (err) {
    console.error("Erreur génération cours IA:", err);
    showToast(err.message || "Erreur lors de la génération du cours", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Générer le cours`;
    }
  }
}

async function enhanceCurrentContentWithAI() {
  const contentInput = document.getElementById('cContent');
  if (!contentInput) return;

  const currentText = contentInput.value.trim();
  if (!currentText) {
    showToast("Le contenu du cours est vide. Utilisez 'Rédiger IA' pour créer un cours complet.", "info");
    return;
  }

  const subject = document.getElementById('cSubject')?.value || 'Bac Pro CIEL';
  showToast("Restructuration et amélioration Markdown par l'IA...", "info");

  try {
    if (typeof callGeminiAPI !== 'function') {
      throw new Error("Module IA non chargé.");
    }

    const enhancePrompt = [
      {
        role: 'user',
        text: `Tu es un expert pédagogique du Bac Pro CIEL. Voici des notes ou un cours brut sur la discipline "${subject}".
Améliore et structure ce contenu en Markdown impeccable :
- Corrige l'orthographe et la grammaire française
- Structure clairement avec des titres H2/H3 (#, ##, ###), listes à puces, mots-clés en gras
- Formate les commandes, adresses IP ou code dans des blocs de code appropriés
- Ajoute un encadré récapitulatif "À retenir pour l'examen" à la fin
- Conserve absolument l'ensemble des informations d'origine sans en inventer de contradictoires.

Voici le contenu brut :
${currentText}`
      }
    ];

    const enhanced = await callGeminiAPI(enhancePrompt);
    contentInput.value = enhanced;
    if (typeof updateMdPreview === 'function') updateMdPreview();
    showToast("Notes structurées et enrichies en Markdown !", "success");
  } catch (err) {
    console.error("Erreur restructuration IA:", err);
    showToast(err.message || "Erreur lors de l'amélioration du contenu", "error");
  }
}

/* ==========================================================
   8.6 GÉNÉRATEUR AUTOMATIQUE DE FLASHCARDS IA
   ========================================================== */
function openAIFlashcardGeneratorModal() {
  const modal = document.getElementById('aiFlashcardPromptModal');
  if (!modal) return;

  // Alimentation de la liste des cours pour la sélection source
  const courseSelect = document.getElementById('aiFlashcardCourseSelect');
  if (courseSelect) {
    const courses = userVault?.courses || [];
    if (courses.length === 0) {
      courseSelect.innerHTML = `<option value="">(Aucun cours enregistré dans votre coffre)</option>`;
    } else {
      courseSelect.innerHTML = courses.map(c => `
        <option value="${c.id}">${escapeHtml(c.title)} (${escapeHtml(c.subject)})</option>
      `).join('');
    }
  }

  modal.classList.add('active');
  trapFocusInModal(modal);
}

function closeAIFlashcardGeneratorModal() {
  const modal = document.getElementById('aiFlashcardPromptModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function toggleAIFlashcardSourceType(val) {
  const themeRow = document.getElementById('aiFcThemeRow');
  const courseRow = document.getElementById('aiFcCourseRow');
  if (val === 'course') {
    if (themeRow) themeRow.style.display = 'none';
    if (courseRow) courseRow.style.display = 'block';
  } else {
    if (themeRow) themeRow.style.display = 'block';
    if (courseRow) courseRow.style.display = 'none';
  }
}

async function handleAIFlashcardPromptSubmit(event) {
  if (event) event.preventDefault();

  const sourceType = document.getElementById('aiFlashcardSourceSelect')?.value || 'theme';
  const topicInput = document.getElementById('aiFlashcardTopicInput');
  const courseSelect = document.getElementById('aiFlashcardCourseSelect');
  const countSelect = document.getElementById('aiFlashcardCountSelect');
  const submitBtn = document.getElementById('btnSubmitAIFlashcards');

  const count = parseInt(countSelect?.value || '8', 10);
  let contentToProcess = '';

  if (sourceType === 'course') {
    const selectedCourseId = parseInt(courseSelect?.value, 10);
    const course = (userVault.courses || []).find(c => c.id === selectedCourseId);
    if (!course) {
      showToast("Veuillez sélectionner un cours existant.", "error");
      return;
    }
    contentToProcess = `Titre du cours : ${course.title}\nMatière : ${course.subject}\nContenu :\n${course.content}`;
  } else {
    contentToProcess = topicInput?.value.trim();
    if (!contentToProcess) {
      showToast("Veuillez saisir un sujet ou une notion à réviser.", "error");
      return;
    }
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Création des cartes...`;
  }

  showToast("Extraction et création des flashcards par l'IA...", "info");

  try {
    if (typeof generateFlashcardsWithAI !== 'function') {
      throw new Error("Module de génération de flashcards non disponible.");
    }

    const cards = await generateFlashcardsWithAI(contentToProcess, count);
    if (!cards || cards.length === 0) {
      throw new Error("Aucune flashcard n'a pu être extraite.");
    }

    if (!userVault.flashcards) userVault.flashcards = [];

    // Ajout des nouvelles flashcards dans le coffre
    cards.forEach(c => {
      userVault.flashcards.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        q: c.q,
        a: c.a,
        subject: c.subject || 'Bac Pro CIEL',
        createdAt: new Date().toISOString()
      });
    });

    triggerAutoSave();
    fcCursor = userVault.flashcards.length - cards.length;
    fcFlipped = false;
    renderFlashcards();

    closeAIFlashcardGeneratorModal();
    showTab('tab-flashcards');
    showToast(`${cards.length} flashcards créées avec succès ! 🎉`, "success");
  } catch (err) {
    console.error("Erreur génération flashcards:", err);
    showToast(err.message || "Erreur lors de la génération des cartes", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Créer les flashcards`;
    }
  }
}

function generateFlashcardsForCourse(courseId) {
  const course = (userVault.courses || []).find(c => c.id === courseId);
  if (!course) return;

  openAIFlashcardGeneratorModal();
  const sourceSelect = document.getElementById('aiFlashcardSourceSelect');
  if (sourceSelect) {
    sourceSelect.value = 'course';
    toggleAIFlashcardSourceType('course');
  }
  const courseSelect = document.getElementById('aiFlashcardCourseSelect');
  if (courseSelect) {
    courseSelect.value = courseId.toString();
  }
}

/* ==========================================================
   8.7 PARAMÈTRES IA & GESTION DES MODÈLES GEMINI
   ========================================================== */
function renderGeminiModelOptions() {
  const select = document.getElementById('settingGeminiModel');
  if (!select || typeof GEMINI_MODELS === 'undefined') return;

  const currentModel = (typeof getSelectedGeminiModel === 'function') ? getSelectedGeminiModel() : 'gemini-2.5-flash';

  const tierGroups = [
    { id: 'tier_25', label: '⚡ Famille Gemini 2.5 (60k tokens / 5h — 250k / 7j)' },
    { id: 'tier_30', label: '🧠 Famille Gemini 3.0 à 3.5 (40k tokens / 5h — 160k / 7j)' },
    { id: 'tier_36', label: '✨ Famille Gemini 3.6 & 3.7 (25k tokens / 5h — 100k / 7j)' }
  ];

  select.innerHTML = tierGroups.map(group => {
    const models = GEMINI_MODELS.filter(m => m.tier === group.id);
    if (models.length === 0) return '';
    const options = models.map(m => `
      <option value="${m.id}" ${m.id === currentModel ? 'selected' : ''}>${m.name} [${m.tag}] — ${m.desc.slice(0, 48)}...</option>
    `).join('');
    return `<optgroup label="${group.label}">${options}</optgroup>`;
  }).join('');
}

function updateModelEndpointDesc(modelId) {
  const descEl = document.getElementById('settingModelEndpointDesc');
  if (!descEl) return;
  if (typeof GEMINI_MODELS === 'undefined') return;

  const found = GEMINI_MODELS.find(m => m.id === modelId);
  if (found) {
    descEl.innerText = `Endpoint API : ${found.id} (${found.desc})`;
  } else {
    descEl.innerText = `Endpoint API : ${modelId}`;
  }
}

function handleSettingModelChange(newModelId) {
  if (typeof setSelectedGeminiModel === 'function') {
    setSelectedGeminiModel(newModelId);
    updateModelEndpointDesc(newModelId);

    // Mettre à jour le badge dans l'en-tête de l'assistant si ouvert
    const badge = document.getElementById('aiHeaderCurrentModelBadge');
    if (badge && typeof GEMINI_MODELS !== 'undefined') {
      const modelObj = GEMINI_MODELS.find(m => m.id === newModelId);
      badge.innerText = modelObj ? modelObj.name : newModelId;
    }

    // Synchroniser le sélecteur rapide de StudyBot
    const quickSelect = document.getElementById('aiQuickModelSelect');
    if (quickSelect) quickSelect.value = newModelId;

    if (typeof updateAIQuotaUI === 'function') {
      updateAIQuotaUI();
    }

    showToast(`Modèle actif configuré sur ${newModelId}`, "info");
  }
}

function handleSettingApiKeyChange(newKey) {
  if (typeof setCustomGeminiApiKey === 'function') {
    setCustomGeminiApiKey(newKey);
    showToast(newKey ? "Clé API personnalisée enregistrée" : "Clé intégrée rétablie", "info");
  }
}

async function testCurrentGeminiKey() {
  const testBtn = document.getElementById('btnTestGeminiKey');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Test...`;
  }

  showToast("Test de connexion avec l'API Gemini...", "info");

  try {
    if (typeof callGeminiAPI !== 'function') {
      throw new Error("Module IA non chargé.");
    }

    const testPrompt = [{ role: 'user', text: "Réponds uniquement par le mot 'CONNECTÉ'." }];
    const response = await callGeminiAPI(testPrompt, { maxOutputTokens: 10 });

    if (response && response.length > 0) {
      showToast("Connexion API Gemini réussie à 100% ! ✅", "success");
    } else {
      throw new Error("Réponse inattendue de l'API");
    }
  } catch (err) {
    console.error("Test clé API échoué:", err);
    showToast(`Échec du test : ${err.message || "Vérifiez la clé API"}`, "error");
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = `<i class="fa-solid fa-vial"></i> Tester`;
    }
  }
}

function quickSwitchAIModel() {
  closeAIAssistantModal();
  openSettingsModal();
  setTimeout(() => {
    const select = document.getElementById('settingGeminiModel');
    if (select) select.focus();
  }, 250);
}

if (typeof window !== 'undefined') {
  // Raccourcis clavier globaux
  window.addEventListener('keydown', (e) => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('courseSearch');
      if (searchInput) {
        showTab('tab-courses');
        searchInput.focus();
        searchInput.select();
      }
    } else if (!isInput && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openCourseModal();
    } else if (!isInput && e.key === ' ') {
      const tabFc = document.getElementById('tab-flashcards');
      if (tabFc && tabFc.classList.contains('active')) {
        e.preventDefault();
        toggleFlashcardFlip();
      }
    } else if (!isInput && e.key === 'ArrowRight') {
      const tabFc = document.getElementById('tab-flashcards');
      if (tabFc && tabFc.classList.contains('active')) {
        e.preventDefault();
        nextFlashcard();
      }
    } else if (!isInput && e.key === 'ArrowLeft') {
      const tabFc = document.getElementById('tab-flashcards');
      if (tabFc && tabFc.classList.contains('active')) {
        e.preventDefault();
        prevFlashcard();
      }
    } else if (e.key === 'Escape') {
      const confirmModal = document.getElementById('customConfirmModal');
      if (confirmModal && confirmModal.classList.contains('active')) {
        const cancelBtn = document.getElementById('confirmModalCancel');
        if (cancelBtn) cancelBtn.click();
        return;
      }
      closeCourseModal();
      closeShareModal();
      closeProfileModal();
      closeSettingsModal();
      closeFolderModal();
      closeMoveCourseModal();
      closeAIAssistantModal();
      closeAICoursePromptModal();
      closeAIFlashcardGeneratorModal();
      closeLightbox();
      closeFocusModal();
    }
  });

  // Raccourcis Markdown (Ctrl+B, Ctrl+I) et synchronisation de scroll split view
  const mContentEl = document.getElementById('mContent');
  const mPreviewEl = document.getElementById('mdPreviewPane');
  if (mContentEl) {
    mContentEl.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'b') {
          e.preventDefault();
          insertMd('**', '**', 'texte en gras');
        } else if (e.key.toLowerCase() === 'i') {
          e.preventDefault();
          insertMd('*', '*', 'texte en italique');
        }
      }
    });

    if (mPreviewEl) {
      mContentEl.addEventListener('scroll', () => {
        const scrollableH = mContentEl.scrollHeight - mContentEl.clientHeight;
        if (scrollableH > 0) {
          const ratio = mContentEl.scrollTop / scrollableH;
          mPreviewEl.scrollTop = ratio * (mPreviewEl.scrollHeight - mPreviewEl.clientHeight);
        }
      }, { passive: true });
    }
  }

  // Bouton Retour en haut flottant
  window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTopBtn');
    if (!btn) return;
    if (window.scrollY > 280) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }, { passive: true });

  // PWA Service Worker avec mise à jour forcée
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('CIEL Service Worker registered:', reg.scope);
        // Forcer la vérification immédiate de nouvelle version
        reg.update().catch(() => {});
      }).catch(err => {
        console.warn('Service Worker registration failed:', err);
      });
    });
  }

  // Bindings globaux pour les gestionnaires d'événements HTML
  const globalBindings = {
    toggleSearchClear,
    clearCourseSearch,
    openCourseModal,
    openEditCourseModal,
    closeCourseModal,
    handleModalFiles,
    removePendingFile,
    submitCourse,
    openProfileModal,
    closeProfileModal,
    saveUserProfile,
    handleAvatarChange,
    getSubjectThemeInfo,
    insertMd,
    insertCodeBlock,
    insertTableTemplate,
    editorUndo,
    editorRedo,
    setEditorMode,
    handleMarkdownInput,
    triggerDraftSave,
    toggleCourseFavorite,
    filterByTag,
    clearTagFilter,
    openFocusModal,
    closeFocusModal,
    printFocusCourse,
    exportCourseToPDF,
    openShareModal,
    closeShareModal,
    switchShareMode,
    copyShareCourseLink,
    toggleSelectAllRecipients,
    confirmSendShare,
    scrollToTop,
    showTab,
    openLightbox,
    closeLightbox,
    importSharedCourse,
    deleteSharedCourse,
    deleteCourseById,
    toggleFlashcardFlip,
    nextFlashcard,
    prevFlashcard,
    addFlashcard,
    deleteCurrentFlashcard,
    renderTodos,
    createTodo,
    toggleTodo,
    deleteTodo,
    deleteTodoItem,
    logout,
    switchAuthMode,
    handleAuthSubmit,
    setFilter,
    switchCourseSubView,

    // Paramètres & Dernière Connexion
    openSettingsModal,
    closeSettingsModal,
    toggleSettingCompactMode,
    toggleSettingConfetti,
    exportVaultBackupJSON,
    forceVaultSync,

    // Gestion des Dossiers
    renderFoldersBar,
    setFolderFilter,
    updateFolderSelectOptions,
    openCreateFolderModal,
    openEditFolderModal,
    deleteFolder,
    closeFolderModal,
    renderColorPalette,
    selectFolderColor,
    handleFolderSubmit,
    openMoveCourseModal,
    closeMoveCourseModal,
    assignCourseToFolder,

    // Intelligence Artificielle (Gemini & StudyBot)
    openAIAssistantModal,
    closeAIAssistantModal,
    renderAIChatMessages,
    handleAIChatSubmit,
    sendAIAssistantMessage,
    handleAIChatKeydown,
    loadAIQuestionSuggestion,
    clearAIChatHistory,
    copyAIMessageText,
    createCourseFromAIMessage,
    openAICoursePrompt,
    closeAICoursePromptModal,
    handleAICoursePromptSubmit,
    enhanceCurrentContentWithAI,
    openAIFlashcardGeneratorModal,
    closeAIFlashcardGeneratorModal,
    toggleAIFlashcardSourceType,
    handleAIFlashcardPromptSubmit,
    generateFlashcardsForCourse,
    renderGeminiModelOptions,
    handleSettingModelChange,
    handleSettingApiKeyChange,
    testCurrentGeminiKey,
    quickSwitchAIModel,
    renderQuickModelSelect,
    handleQuickModelChange,
    toggleAIQuotaPanel,
    updateAIQuotaUI,
    retryAIMessage,
    promptSwitchModelForMessage
  };

  Object.assign(window, globalBindings);
}

/* ==========================================================
   9. EXPORTATION CONDITIONNELLE (NODE.JS & MODULES)
   ========================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Variables d'état
    get currentSession() { return currentSession; },
    set currentSession(v) { currentSession = v; },
    get userVault() { return userVault; },
    set userVault(v) { userVault = v; },
    get allSharedCourses() { return allSharedCourses; },
    set allSharedCourses(v) { allSharedCourses = v; },
    get pendingFiles() { return pendingFiles; },
    set pendingFiles(v) { pendingFiles = v; },
    get autoSaveTimer() { return autoSaveTimer; },
    set autoSaveTimer(v) { autoSaveTimer = v; },
    get authMode() { return authMode; },
    set authMode(v) { authMode = v; },
    get currentSubView() { return currentSubView; },
    set currentSubView(v) { currentSubView = v; },
    get activeFilter() { return activeFilter; },
    set activeFilter(v) { activeFilter = v; },
    get activeFolderId() { return activeFolderId; },
    set activeFolderId(v) { activeFolderId = v; },
    get courseToShare() { return courseToShare; },
    set courseToShare(v) { courseToShare = v; },
    get courseToMoveId() { return courseToMoveId; },
    set courseToMoveId(v) { courseToMoveId = v; },
    get editingCourseId() { return editingCourseId; },
    set editingCourseId(v) { editingCourseId = v; },
    get fcCursor() { return fcCursor; },
    set fcCursor(v) { fcCursor = v; },
    get fcFlipped() { return fcFlipped; },
    set fcFlipped(v) { fcFlipped = v; },

    // Helpers UI
    escapeHtml,
    getUserColor,
    renderAvatarHTML,
    showToast,
    customConfirm,
    setSync,
    toggleSearchClear,
    clearCourseSearch,

    // Auth & Profil & Dernière Connexion
    initApp,
    switchAuthMode,
    handleAuthSubmit,
    openUserSession,
    restoreSession,
    logout,
    trackUserLoginSession,
    getFormattedLastLogin,
    updateHeaderProfileUI,
    openProfileModal,
    closeProfileModal,
    handleAvatarChange,
    saveUserProfile,

    // Paramètres
    openSettingsModal,
    closeSettingsModal,
    applyUserSettings,
    toggleSettingCompactMode,
    toggleSettingConfetti,
    exportVaultBackupJSON,
    forceVaultSync,

    // Dossiers
    renderFoldersBar,
    setFolderFilter,
    updateFolderSelectOptions,
    openCreateFolderModal,
    openEditFolderModal,
    deleteFolder,
    closeFolderModal,
    renderColorPalette,
    selectFolderColor,
    handleFolderSubmit,
    openMoveCourseModal,
    closeMoveCourseModal,
    assignCourseToFolder,

    // Vault & Sync
    loadUserVault,
    triggerAutoSave,
    syncUserVault,

    // Cours & Partages
    fetchSharedCourses,
    switchCourseSubView,
    updateReceivedBadge,
    openShareModal,
    closeShareModal,
    confirmSendShare,
    importSharedCourse,
    deleteSharedCourse,
    setFilter,
    checkSubjectMatch,
    getSubjectThemeInfo,
    renderCourses,
    buildAttachmentsHTML,
    openCourseModal,
    openEditCourseModal,
    closeCourseModal,
    handleModalFiles,
    removePendingFile,
    renderPendingModalFiles,
    fileToBase64,
    uploadToUserUploadsFolder,
    submitCourse,
    deleteCourseById,

    // Flashcards & Todos
    renderFlashcards,
    toggleFlashcardFlip,
    nextFlashcard,
    prevFlashcard,
    addFlashcard,
    deleteCurrentFlashcard,
    renderTodos,
    createTodo,
    toggleTodo,
    deleteTodo,
    deleteTodoItem,

    // Navigation & Lightbox
    showTab,
    openLightbox,
    closeLightbox,

    // Intelligence Artificielle (Gemini & StudyBot)
    openAIAssistantModal,
    closeAIAssistantModal,
    renderAIChatMessages,
    handleAIChatSubmit,
    sendAIAssistantMessage,
    handleAIChatKeydown,
    loadAIQuestionSuggestion,
    clearAIChatHistory,
    copyAIMessageText,
    createCourseFromAIMessage,
    openAICoursePrompt,
    closeAICoursePromptModal,
    handleAICoursePromptSubmit,
    enhanceCurrentContentWithAI,
    openAIFlashcardGeneratorModal,
    closeAIFlashcardGeneratorModal,
    toggleAIFlashcardSourceType,
    handleAIFlashcardPromptSubmit,
    generateFlashcardsForCourse,
    renderGeminiModelOptions,
    handleSettingModelChange,
    handleSettingApiKeyChange,
    testCurrentGeminiKey,
    quickSwitchAIModel,
    renderQuickModelSelect,
    handleQuickModelChange,
    toggleAIQuotaPanel,
    updateAIQuotaUI,
    retryAIMessage,
    promptSwitchModelForMessage
  };
}
