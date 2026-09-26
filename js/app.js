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

let courseLayoutMode = 'grid';
let draggedCourseId = null;

function getCourseStatusInfo(status) {
  if (status === 'mastered') {
    return { key: 'mastered', label: 'Maîtrisé', icon: 'fa-circle-check', class: 'status-mastered' };
  } else if (status === 'learning') {
    return { key: 'learning', label: 'En cours', icon: 'fa-circle-half-stroke', class: 'status-learning' };
  } else {
    return { key: 'todo', label: 'À réviser', icon: 'fa-circle-dot', class: 'status-todo' };
  }
}

function cycleCourseStatus(courseId, event) {
  if (event) event.stopPropagation();
  const c = userVault.courses.find(x => x.id === courseId);
  if (!c) return;
  const nextMap = { 'todo': 'learning', 'learning': 'mastered', 'mastered': 'todo' };
  const current = c.status || 'todo';
  c.status = nextMap[current] || 'todo';
  const info = getCourseStatusInfo(c.status);
  showToast(`Statut mis à jour : ${info.label}`, 'info');
  renderCourses();
  triggerAutoSave();
}

function setCourseLayoutMode(mode) {
  courseLayoutMode = mode === 'table' ? 'table' : 'grid';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ciel_course_layout_mode', courseLayoutMode);
  }
  if (typeof document !== 'undefined') {
    const btnGrid = document.getElementById('btnLayoutGrid');
    const btnTable = document.getElementById('btnLayoutTable');
    if (btnGrid) btnGrid.classList.toggle('active', courseLayoutMode === 'grid');
    if (btnTable) btnTable.classList.toggle('active', courseLayoutMode === 'table');
    renderCourses();
  }
}

function handleCourseDragStart(e, courseId) {
  draggedCourseId = courseId;
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', String(courseId));
    e.dataTransfer.effectAllowed = 'move';
  }
  const el = e.currentTarget;
  if (el) el.classList.add('is-dragging');
}

function handleCourseDragEnd(e) {
  const el = e.currentTarget;
  if (el) el.classList.remove('is-dragging');
  document.querySelectorAll('.folder-chip').forEach(fc => {
    fc.classList.remove('drag-target-valid', 'drag-target-invalid');
  });
}

function handleFolderDragOver(e, folderId) {
  e.preventDefault();
  if (!draggedCourseId) return;
  const course = (userVault.courses || []).find(c => String(c.id) === String(draggedCourseId));
  if (!course) return;

  const folder = (userVault.folders || []).find(f => f.id === folderId);
  const chip = e.currentTarget;

  if (folderId === 'all' || folderId === 'unassigned') {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    chip.classList.add('drag-target-valid');
    chip.classList.remove('drag-target-invalid');
    return;
  }

  if (folder) {
    if (checkFolderSubjectMatch(folder.subject, course.subject)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      chip.classList.add('drag-target-valid');
      chip.classList.remove('drag-target-invalid');
    } else {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      chip.classList.add('drag-target-invalid');
      chip.classList.remove('drag-target-valid');
    }
  }
}

function handleFolderDragLeave(e) {
  const chip = e.currentTarget;
  if (chip) chip.classList.remove('drag-target-valid', 'drag-target-invalid');
}

function handleFolderDrop(e, folderId) {
  e.preventDefault();
  const chip = e.currentTarget;
  if (chip) chip.classList.remove('drag-target-valid', 'drag-target-invalid');

  if (!draggedCourseId) return;
  const course = (userVault.courses || []).find(c => String(c.id) === String(draggedCourseId));
  if (!course) return;

  if (folderId === 'unassigned') {
    course.folderId = null;
    showToast(`Cours retiré de son dossier`, 'info');
    renderCourses();
    renderFoldersBar();
    triggerAutoSave();
    return;
  }

  if (folderId === 'all') return;

  const folder = (userVault.folders || []).find(f => f.id === folderId);
  if (!folder) return;

  if (!checkFolderSubjectMatch(folder.subject, course.subject)) {
    showToast(`Impossible : le dossier "${folder.name}" est réservé à la matière "${folder.subject}"`, 'error');
    return;
  }

  course.folderId = folder.id;
  showToast(`Cours rangé dans le dossier "${folder.name}" 📁`, 'success');
  renderCourses();
  renderFoldersBar();
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
    let items = (userVault.courses || []).filter(c => {
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

    // Affichage Mode Tableau Détaillé
    if (courseLayoutMode === 'table') {
      let tableHtml = `
        <div class="courses-table-container" style="grid-column: 1 / -1;">
          <table class="courses-table-view">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">⭐</th>
                <th style="width: 120px;">Statut</th>
                <th>Titre & Aperçu</th>
                <th style="width: 170px;">Matière</th>
                <th style="width: 140px;">Dossier</th>
                <th style="width: 110px;">Date</th>
                <th style="width: 140px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
      `;

      items.forEach(c => {
        const theme = getSubjectThemeInfo(c.subject);
        const statusInfo = getCourseStatusInfo(c.status);
        let folderName = '—';
        if (c.folderId && userVault.folders) {
          const fol = userVault.folders.find(f => f.id === c.folderId);
          if (fol) folderName = `<span style="color: ${fol.color};"><i class="fa-solid fa-folder"></i> ${escapeHtml(fol.name)}</span>`;
        }

        tableHtml += `
          <tr class="course-table-row" draggable="true" ondragstart="handleCourseDragStart(event, '${c.id}')" ondragend="handleCourseDragEnd(event)" onclick="openFocusModal(${c.id}, false)">
            <td style="text-align: center;" onclick="event.stopPropagation()">
              <button class="btn-card-action btn-action-fav ${c.isFavorite ? 'active' : ''}" onclick="toggleCourseFavorite(${c.id})" title="${c.isFavorite ? 'Retirer des favoris' : 'Marquer comme favori'}">
                <i class="fa-${c.isFavorite ? 'solid' : 'regular'} fa-star"></i>
              </button>
            </td>
            <td onclick="event.stopPropagation()">
              <span class="course-status-pill ${statusInfo.class}" onclick="cycleCourseStatus(${c.id}, event)" title="Cliquer pour changer de statut">
                <i class="fa-solid ${statusInfo.icon}"></i> ${statusInfo.label}
              </span>
            </td>
            <td>
              <div class="course-table-title">
                <strong>${escapeHtml(c.title)}</strong>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml((c.content || '').slice(0, 90))}
              </div>
            </td>
            <td>
              <span class="badge-sub" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;"><i class="${theme.icon}"></i> ${escapeHtml(c.subject.replace('CIEL - ', ''))}</span>
            </td>
            <td>${folderName}</td>
            <td style="font-size: 0.78rem; color: var(--text-muted);">
              ${new Date(c.date).toLocaleDateString('fr-FR')}
            </td>
            <td style="text-align: right;" onclick="event.stopPropagation()">
              <div class="card-actions" style="justify-content: flex-end;">
                <button class="btn-card-action" onclick="openFocusModal(${c.id}, false)" title="Lecture Zen"><i class="fa-solid fa-expand"></i></button>
                <button class="btn-card-action" onclick="openShareModal(${c.id})" title="Partager"><i class="fa-solid fa-share-nodes"></i></button>
                <button class="btn-card-action" onclick="openEditCourseModal(${c.id})" title="Modifier"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn-card-action" onclick="deleteCourseById(${c.id})" title="Supprimer"><i class="fa-solid fa-trash-can"></i></button>
              </div>
            </td>
          </tr>
        `;
      });

      tableHtml += `</tbody></table></div>`;
      feed.innerHTML = tableHtml;
      return;
    }

    // Affichage Mode Grille (Cartes classiques)
    items.forEach(c => {
      const card = document.createElement('div');
      const theme = getSubjectThemeInfo(c.subject);
      const statusInfo = getCourseStatusInfo(c.status);
      card.className = `course-card theme-${theme.key}`;
      card.setAttribute('draggable', 'true');
      card.setAttribute('ondragstart', `handleCourseDragStart(event, '${c.id}')`);
      card.setAttribute('ondragend', `handleCourseDragEnd(event)`);

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
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="badge-sub"><i class="${theme.icon}"></i> ${escapeHtml(c.subject)}</span>
            <span class="course-status-pill ${statusInfo.class}" onclick="cycleCourseStatus(${c.id}, event)" title="Cliquer pour changer de statut">
              <i class="fa-solid ${statusInfo.icon}"></i> ${statusInfo.label}
            </span>
          </div>
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
    const isImg = att.isImage || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.name || '');
    const iconClass = getFileIconClass(att.name);
    const sizeVal = att.size ? Number(att.size) : 0;
    const cleanName = escapeHtml(att.name || 'Fichier').replace(/'/g, "\\'");

    if (isImg) {
      html += `
        <div class="img-thumb-container" onclick="openFileViewer('${safeUrl}', '${cleanName}', { isImage: true, size: ${sizeVal} })" title="Agrandir dans la visionneuse intégrée">
          <img src="${safeUrl}" alt="${escapeHtml(att.name)}" loading="lazy" />
        </div>`;
    } else {
      html += `
        <div class="file-badge-download" onclick="openFileViewer('${safeUrl}', '${cleanName}', { isImage: false, size: ${sizeVal} })" style="cursor: pointer;" title="Ouvrir dans la visionneuse intégrée">
          <i class="${iconClass}"></i>
          <span>${escapeHtml(att.name)}</span>
        </div>`;
    }
  });
  html += '</div>';
  return html;
}

let currentViewerContentText = '';
let currentViewerFileUrl = '';
let currentViewerFileName = '';
let isViewerWrapActive = true;

async function triggerFileDownload(fileUrl, fileName) {
  const targetUrl = fileUrl || currentViewerFileUrl;
  const targetName = fileName || currentViewerFileName || 'fichier';
  if (!targetUrl) return;

  try {
    showToast('Téléchargement en cours...', 'info');
    if (targetUrl.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.download = targetName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('Téléchargement terminé !', 'success');
      return;
    }

    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error('Échec du téléchargement du fichier');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = targetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Téléchargement terminé !', 'success');
  } catch (err) {
    console.error('Erreur téléchargement direct:', err);
    // Fallback ouverture externe
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = targetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function toggleViewerWrap() {
  const contentEl = document.querySelector('.viewer-text-content');
  const btn = document.getElementById('btnViewerToggleWrap');
  if (!contentEl) return;
  isViewerWrapActive = !isViewerWrapActive;
  if (isViewerWrapActive) {
    contentEl.classList.remove('no-wrap');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-align-left"></i> <span>Retour à la ligne : Activé</span>';
  } else {
    contentEl.classList.add('no-wrap');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-bars"></i> <span>Retour à la ligne : Désactivé</span>';
  }
}

async function openFileViewer(fileUrl, fileName, options = {}) {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('fileViewerModal');
  const titleEl = document.getElementById('fileViewerTitle');
  const metaEl = document.getElementById('fileViewerBadgeType');
  const sizeEl = document.getElementById('fileViewerSize');
  const iconEl = document.getElementById('fileViewerIcon');
  const bodyEl = document.getElementById('fileViewerBody');
  const btnExternal = document.getElementById('fileViewerBtnExternal');
  const btnCopy = document.getElementById('fileViewerBtnCopy');

  if (!modal || !bodyEl) return;

  currentViewerFileUrl = fileUrl;
  currentViewerFileName = fileName || 'document';

  const ext = (fileName || '').split('.').pop().toLowerCase();
  const isImage = options.isImage || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';
  const isMd = ext === 'md';
  const isText = ['txt', 'json', 'py', 'c', 'cpp', 'js', 'html', 'css', 'sh', 'sql', 'csv', 'log', 'ini', 'xml', 'pkt'].includes(ext);

  if (titleEl) titleEl.innerText = fileName || 'Document';
  if (metaEl) metaEl.innerText = ext ? ext.toUpperCase() : 'FICHIER';
  if (sizeEl) {
    if (options.size && options.size > 0) {
      const kb = (options.size / 1024).toFixed(1);
      sizeEl.innerText = `${kb} Ko`;
    } else {
      sizeEl.innerText = '';
    }
  }

  if (iconEl) {
    iconEl.className = getFileIconClass(fileName);
  }

  if (btnExternal) {
    btnExternal.href = fileUrl;
  }

  if (btnCopy) btnCopy.style.display = 'none';
  currentViewerContentText = '';

  bodyEl.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; min-height: 250px; color: var(--text-muted); gap: 0.75rem;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--primary);"></i>
      <span>Chargement du fichier...</span>
    </div>
  `;

  modal.classList.add('active');
  trapFocusInModal(modal);

  try {
    if (isImage) {
      bodyEl.innerHTML = `
        <div class="viewer-img-wrapper">
          <img src="${fileUrl}" alt="${escapeHtml(fileName)}" class="viewer-img-content" />
        </div>
      `;
    } else if (isPdf) {
      bodyEl.innerHTML = `
        <iframe src="${fileUrl}" class="viewer-pdf-frame" title="${escapeHtml(fileName)}"></iframe>
      `;
    } else if (isMd || isText) {
      let textContent = '';
      if (fileUrl.startsWith('data:')) {
        const commaIdx = fileUrl.indexOf(',');
        const header = fileUrl.substring(0, commaIdx);
        const data = fileUrl.substring(commaIdx + 1);
        if (header.includes(';base64')) {
          try {
            textContent = decodeURIComponent(escape(atob(data)));
          } catch(e) {
            textContent = atob(data);
          }
        } else {
          textContent = decodeURIComponent(data);
        }
      } else {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error('Impossible de charger le contenu du fichier');
        textContent = await response.text();
      }

      currentViewerContentText = textContent;
      if (btnCopy) btnCopy.style.display = 'inline-flex';

      if (isMd) {
        const parsed = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(textContent) : textContent;
        const sanitized = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsed) : parsed;
        bodyEl.innerHTML = `<div class="viewer-markdown-content">${sanitized}</div>`;
      } else {
        const lines = textContent.split('\n');
        const lineCount = lines.length;
        const lineNumbersHtml = Array.from({ length: lineCount }, (_, i) => i + 1).join('<br>');
        bodyEl.innerHTML = `
          <div class="viewer-text-container">
            <div class="viewer-text-toolbar">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="viewer-badge">${escapeHtml(ext.toUpperCase())}</span>
                <span>${lineCount} ligne${lineCount > 1 ? 's' : ''}</span>
              </div>
              <div class="viewer-text-toolbar-actions">
                <button type="button" class="viewer-text-toggle-btn" id="btnViewerToggleWrap" onclick="toggleViewerWrap()">
                  <i class="fa-solid fa-align-left"></i> <span>Retour à la ligne : ${isViewerWrapActive ? 'Activé' : 'Désactivé'}</span>
                </button>
              </div>
            </div>
            <div class="viewer-text-wrapper">
              <div class="viewer-line-numbers">${lineNumbersHtml}</div>
              <pre class="viewer-text-content ${isViewerWrapActive ? '' : 'no-wrap'}"><code>${escapeHtml(textContent)}</code></pre>
            </div>
          </div>
        `;
      }

      if (typeof Prism !== 'undefined') {
        Prism.highlightAllUnder(bodyEl);
      }
    } else {
      bodyEl.innerHTML = `
        <div style="text-align: center; margin: auto; padding: 2rem;">
          <i class="${getFileIconClass(fileName)}" style="font-size: 3.5rem; color: var(--primary); margin-bottom: 1rem; opacity: 0.85;"></i>
          <h4 style="font-size: 1.1rem; color: #f1f5f9; margin-bottom: 0.5rem;">${escapeHtml(fileName)}</h4>
          <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.5rem;">Aperçu direct non disponible pour ce type de fichier.</p>
          <button type="button" onclick="triggerFileDownload('${fileUrl}', '${escapeHtml(fileName)}')" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-download"></i> Télécharger le fichier
          </button>
        </div>
      `;
    }
  } catch (err) {
    console.error("Erreur ouverture viewer:", err);
    bodyEl.innerHTML = `
      <div style="text-align: center; margin: auto; padding: 2rem; color: #f87171;">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 3rem; margin-bottom: 1rem;"></i>
        <p style="font-size: 1rem; font-weight: 600;">Erreur lors du chargement de l'aperçu.</p>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.35rem;">Vous pouvez toujours télécharger le fichier directement.</p>
        <button type="button" onclick="triggerFileDownload('${fileUrl}', '${escapeHtml(fileName)}')" class="btn" style="margin-top: 1rem;">
          <i class="fa-solid fa-download"></i> Télécharger
        </button>
      </div>
    `;
  }
}

function closeFileViewer() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('fileViewerModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function copyViewerContent() {
  if (!currentViewerContentText) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentViewerContentText).then(() => {
      showToast("Contenu copié dans le presse-papier !", "success");
    }).catch(() => {
      showToast("Impossible de copier automatiquement.", "error");
    });
  } else {
    showToast("Presse-papier non supporté.", "error");
  }
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

function scrollToFocusHeading(headingId) {
  const el = document.getElementById(headingId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Focus Mode & PDF
function openFocusModal(id, isShared = false) {
  let course;
  if (!isShared) {
    course = (userVault.courses || []).find(c => c.id === Number(id));
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
  const outlineEl = document.getElementById('focusModalOutline');
  const progressFill = document.getElementById('focusReadingProgress');

  if (metaEl) {
    metaEl.innerHTML = `<span class="badge-sub"><i class="${theme.icon}"></i> ${escapeHtml(course.subject)}</span>`;
  }
  if (titleEl) titleEl.innerText = course.title;
  if (bodyEl) {
    const parsed = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(course.content || '') : (course.content || '');
    bodyEl.innerHTML = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsed) : parsed;
    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bodyEl);

    // Génération du sommaire rapide (Table des matières)
    if (outlineEl) {
      const headings = bodyEl.querySelectorAll('h1, h2, h3');
      if (headings.length > 1) {
        let outlineHtml = '<div class="focus-outline-title"><i class="fa-solid fa-list-ol"></i> Sommaire du cours</div><ul class="focus-outline-list">';
        headings.forEach((h, idx) => {
          const hId = `focus-heading-${idx}`;
          h.id = hId;
          const prefix = h.tagName === 'H1' ? '• ' : (h.tagName === 'H2' ? '— ' : '› ');
          outlineHtml += `<li class="focus-outline-item"><a href="javascript:void(0)" onclick="scrollToFocusHeading('${hId}')">${prefix}${escapeHtml(h.innerText)}</a></li>`;
        });
        outlineHtml += '</ul>';
        outlineEl.innerHTML = outlineHtml;
        outlineEl.style.display = 'block';
      } else {
        outlineEl.innerHTML = '';
        outlineEl.style.display = 'none';
      }
    }
  }

  if (attEl) {
    attEl.innerHTML = buildAttachmentsHTML(course.attachments);
  }

  if (progressFill) progressFill.style.width = '0%';

  const modal = document.getElementById('focusModal');
  if (modal) {
    modal.classList.add('active');
    trapFocusInModal(modal);

    const sheet = modal.querySelector('.modal-sheet');
    if (sheet && progressFill) {
      sheet.onscroll = () => {
        const maxScroll = sheet.scrollHeight - sheet.clientHeight;
        const progress = maxScroll > 0 ? (sheet.scrollTop / maxScroll) * 100 : 0;
        progressFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
      };
    }
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

function changeAppTheme(themeName, saveToVault = true) {
  const allowed = ['cyber', 'matrix', 'midnight', 'paper'];
  const theme = allowed.includes(themeName) ? themeName : 'cyber';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    const select = document.getElementById('settingThemeSelect');
    if (select) select.value = theme;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ciel_theme', theme);
  }
  if (saveToVault && userVault) {
    if (!userVault.settings) userVault.settings = {};
    userVault.settings.theme = theme;
    triggerAutoSave();
  }
}

function initTheme() {
  const savedTheme = (userVault?.settings?.theme) || (typeof localStorage !== 'undefined' && localStorage.getItem('ciel_theme')) || 'cyber';
  changeAppTheme(savedTheme, false);
}

function applyUserSettings() {
  const isCompact = userVault.settings?.compactMode || (typeof localStorage !== 'undefined' && localStorage.getItem('ciel_setting_compact') === 'true');
  const feed = document.getElementById('coursesFeed');
  if (feed) {
    if (isCompact) feed.classList.add('compact-mode');
    else feed.classList.remove('compact-mode');
  }

  // Appliquer le thème
  initTheme();

  // Appliquer le mode de disposition des cours (grille ou tableau)
  const savedLayout = (typeof localStorage !== 'undefined' && localStorage.getItem('ciel_course_layout_mode')) || 'grid';
  if (savedLayout) {
    setCourseLayoutMode(savedLayout);
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

  const themeSelect = document.getElementById('settingThemeSelect');
  if (themeSelect) {
    const currentTheme = userVault.settings?.theme || localStorage.getItem('ciel_theme') || 'cyber';
    themeSelect.value = currentTheme;
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
   8.2 BIS. OUTIL CALCULATEUR IPV4 & SOUS-RÉSEAUX CIDR
   ========================================================== */
function calcSubnet(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return null;
  const parts = inputStr.trim().split('/');
  const ipStr = parts[0].trim();
  let prefix = parts.length > 1 ? parseInt(parts[1].trim(), 10) : 24;
  if (isNaN(prefix) || prefix < 0 || prefix > 32) prefix = 24;

  const octets = ipStr.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) {
    return null;
  }

  // Conversion en entier 32 bits non signé
  const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const maskInt = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
  const wildcardInt = (~maskInt) >>> 0;
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;

  const intToIp = (num) => [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');

  const intToBinary = (num) => [
    ((num >>> 24) & 255).toString(2).padStart(8, '0'),
    ((num >>> 16) & 255).toString(2).padStart(8, '0'),
    ((num >>> 8) & 255).toString(2).padStart(8, '0'),
    (num & 255).toString(2).padStart(8, '0')
  ].join('.');

  const totalHosts = Math.pow(2, 32 - prefix);
  let usableHosts = 0;
  let firstUsable = '';
  let lastUsable = '';

  if (prefix === 31) {
    usableHosts = 2;
    firstUsable = intToIp(networkInt);
    lastUsable = intToIp(broadcastInt);
  } else if (prefix === 32) {
    usableHosts = 1;
    firstUsable = intToIp(networkInt);
    lastUsable = intToIp(networkInt);
  } else {
    usableHosts = Math.max(0, totalHosts - 2);
    firstUsable = intToIp(networkInt + 1);
    lastUsable = intToIp(broadcastInt - 1);
  }

  // Classe et type d'adresse (RFC 1918)
  const firstOctet = octets[0];
  let ipClass = 'A';
  if (firstOctet >= 128 && firstOctet <= 191) ipClass = 'B';
  else if (firstOctet >= 192 && firstOctet <= 223) ipClass = 'C';
  else if (firstOctet >= 224 && firstOctet <= 239) ipClass = 'D (Multicast)';
  else if (firstOctet >= 240) ipClass = 'E (Expérimental)';

  let ipType = 'Publique';
  if (
    firstOctet === 10 ||
    (firstOctet === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (firstOctet === 192 && octets[1] === 168)
  ) {
    ipType = 'Privée (RFC 1918)';
  } else if (firstOctet === 127) {
    ipType = 'Loopback locale (127.0.0.1)';
  } else if (firstOctet === 169 && octets[1] === 254) {
    ipType = 'APIPA (Auto-IP)';
  }

  return {
    inputIp: ipStr,
    prefix,
    cidr: `${ipStr}/${prefix}`,
    network: intToIp(networkInt),
    netmask: intToIp(maskInt),
    wildcard: intToIp(wildcardInt),
    broadcast: intToIp(broadcastInt),
    firstUsable,
    lastUsable,
    totalHosts,
    usableHosts,
    ipClass,
    ipType,
    binaryIp: intToBinary(ipInt),
    binaryMask: intToBinary(maskInt),
    binaryNetwork: intToBinary(networkInt),
    binaryBroadcast: intToBinary(broadcastInt)
  };
}

let lastCalculatedSubnet = null;

function handleIpCalcInput(val) {
  const result = calcSubnet(val || '192.168.1.1/24');
  const resContainer = document.getElementById('ipCalcResults');
  if (!resContainer) return;

  if (!result) {
    resContainer.innerHTML = `
      <div style="text-align:center; padding: 1.5rem; color: #f87171;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.8rem; margin-bottom: 0.5rem;"></i>
        <p style="font-size: 0.9rem; font-weight: 600;">Format d'adresse IPv4 ou masque CIDR invalide.</p>
        <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">Exemples valides : 192.168.1.10/24 ou 10.0.0.1/26 ou 172.16.5.0/30</p>
      </div>
    `;
    lastCalculatedSubnet = null;
    return;
  }

  lastCalculatedSubnet = result;
  resContainer.innerHTML = `
    <div class="ipcalc-results-grid">
      <div class="ipcalc-card">
        <div class="ipcalc-card-title">Adresse Réseau</div>
        <div class="ipcalc-card-value">${result.network}/${result.prefix}</div>
        <div class="ipcalc-card-sub">Classe ${result.ipClass} • ${result.ipType}</div>
      </div>
      <div class="ipcalc-card">
        <div class="ipcalc-card-title">Masque de sous-réseau</div>
        <div class="ipcalc-card-value">${result.netmask}</div>
        <div class="ipcalc-card-sub">Wildcard : ${result.wildcard}</div>
      </div>
      <div class="ipcalc-card">
        <div class="ipcalc-card-title">Première IP Utilisable</div>
        <div class="ipcalc-card-value">${result.firstUsable}</div>
        <div class="ipcalc-card-sub">Plage utilisable : ${result.usableHosts.toLocaleString('fr-FR')} hôtes</div>
      </div>
      <div class="ipcalc-card">
        <div class="ipcalc-card-title">Dernière IP Utilisable / Broadcast</div>
        <div class="ipcalc-card-value">${result.lastUsable}</div>
        <div class="ipcalc-card-sub">Broadcast : ${result.broadcast}</div>
      </div>
    </div>
    <table class="ipcalc-binary-table">
      <tr>
        <td>Binaire IP</td>
        <td>${result.binaryIp}</td>
      </tr>
      <tr>
        <td>Binaire Masque</td>
        <td>${result.binaryMask}</td>
      </tr>
      <tr>
        <td>Binaire Réseau</td>
        <td>${result.binaryNetwork}</td>
      </tr>
    </table>
  `;
}

function applyIpCalcPreset(cidr) {
  const input = document.getElementById('ipCalcInput');
  if (!input) return;
  const currentVal = input.value.trim() || '192.168.1.1/24';
  const baseIp = currentVal.split('/')[0] || '192.168.1.1';
  input.value = `${baseIp}${cidr}`;
  handleIpCalcInput(input.value);
}

function openIpCalcModal() {
  const modal = document.getElementById('ipCalcModal');
  if (!modal) return;
  const input = document.getElementById('ipCalcInput');
  if (input && !input.value) {
    input.value = '192.168.1.1/24';
  }
  handleIpCalcInput(input?.value || '192.168.1.1/24');
  modal.classList.add('active');
  trapFocusInModal(modal);
}

function closeIpCalcModal() {
  const modal = document.getElementById('ipCalcModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function copyIpCalcMarkdown() {
  if (!lastCalculatedSubnet) return;
  const s = lastCalculatedSubnet;
  const md = `### Fiche Sous-Réseau CIDR : \`${s.cidr}\`
| Paramètre | Valeur |
|---|---|
| **Adresse Réseau** | \`${s.network}/${s.prefix}\` |
| **Masque de sous-réseau** | \`${s.netmask}\` |
| **Masque Générique (Wildcard)** | \`${s.wildcard}\` |
| **Première adresse hôte** | \`${s.firstUsable}\` |
| **Dernière adresse hôte** | \`${s.lastUsable}\` |
| **Adresse de Broadcast** | \`${s.broadcast}\` |
| **Nombre d'hôtes utilisables** | **${s.usableHosts.toLocaleString('fr-FR')}** |
| **Type / Classe** | Classe ${s.ipClass} (${s.ipType}) |
`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(md).then(() => {
      showToast('Fiche Markdown copiée dans le presse-papier ! 📋', 'success');
    }).catch(() => {
      showToast('Erreur lors de la copie', 'error');
    });
  } else {
    showToast('Presse-papier indisponible', 'error');
  }
}

/* ==========================================================
   8.2 TER. COMMAND PALETTE UNIVERSELLE (CTRL+K)
   ========================================================== */
let cmdPaletteItems = [];
let cmdPaletteFilteredItems = [];
let cmdPaletteSelectedIndex = 0;

function generateCommandPaletteItems() {
  const items = [];

  // Navigation
  items.push({ id: 'nav-courses', title: 'Aller aux Cours', category: 'Navigation', icon: 'fa-book-open', action: () => showTab('tab-courses') });
  items.push({ id: 'nav-flashcards', title: 'Aller aux Flashcards', category: 'Navigation', icon: 'fa-clone', action: () => showTab('tab-flashcards') });
  items.push({ id: 'nav-todos', title: 'Aller au Planning & Tâches', category: 'Navigation', icon: 'fa-list-check', action: () => showTab('tab-todos') });
  items.push({ id: 'nav-ipcalc', title: 'Ouvrir la Calculatrice IPv4 & CIDR', category: 'Outils CIEL', icon: 'fa-calculator', action: () => openIpCalcModal() });
  items.push({ id: 'nav-profile', title: 'Ouvrir Mon Profil Élève', category: 'Navigation', icon: 'fa-user-graduate', action: () => openProfileModal() });
  items.push({ id: 'nav-settings', title: 'Ouvrir les Paramètres', category: 'Navigation', icon: 'fa-gear', action: () => openSettingsModal() });

  // Quick Actions
  items.push({ id: 'act-new-course', title: 'Nouveau cours ou TP', category: 'Actions', icon: 'fa-plus', action: () => openCourseModal() });
  items.push({ id: 'act-new-folder', title: 'Créer un nouveau dossier', category: 'Actions', icon: 'fa-folder-plus', action: () => openCreateFolderModal() });
  items.push({ id: 'act-sync', title: 'Forcer la synchronisation GitHub', category: 'Actions', icon: 'fa-rotate', action: () => syncUserVault() });
  items.push({ id: 'act-backup', title: 'Exporter mon coffre (.json)', category: 'Actions', icon: 'fa-download', action: () => exportVaultBackupJSON() });

  // Themes
  items.push({ id: 'theme-cyber', title: 'Thème : 🌌 Cyber Night (Néon & Sombre)', category: 'Thèmes', icon: 'fa-palette', action: () => changeAppTheme('cyber') });
  items.push({ id: 'theme-matrix', title: 'Thème : 🛰️ Matrix Terminal (Vert Phosphore)', category: 'Thèmes', icon: 'fa-terminal', action: () => changeAppTheme('matrix') });
  items.push({ id: 'theme-midnight', title: 'Thème : 🌌 Midnight Gold (Nuit & Or)', category: 'Thèmes', icon: 'fa-moon', action: () => changeAppTheme('midnight') });
  items.push({ id: 'theme-paper', title: 'Thème : ☀️ Paper White (Clair)', category: 'Thèmes', icon: 'fa-sun', action: () => changeAppTheme('paper') });

  // Layout mode
  items.push({ id: 'layout-grid', title: 'Affichage : Grille de cartes', category: 'Affichage', icon: 'fa-table-cells-large', action: () => setCourseLayoutMode('grid') });
  items.push({ id: 'layout-table', title: 'Affichage : Tableau détaillé', category: 'Affichage', icon: 'fa-table-list', action: () => setCourseLayoutMode('table') });

  // Matières
  const subjects = [
    { key: 'reseaux', name: 'Réseaux & Informatique', icon: 'fa-network-wired' },
    { key: 'secu', name: 'Cybersécurité', icon: 'fa-shield-halved' },
    { key: 'elec', name: 'Électronique & IoT', icon: 'fa-bolt' },
    { key: 'projet', name: 'Projet CIEL', icon: 'fa-diagram-project' },
    { key: 'maths', name: 'Mathématiques', icon: 'fa-square-root-variable' },
    { key: 'physique', name: 'Physique-Chimie', icon: 'fa-atom' },
    { key: 'francais', name: 'Français', icon: 'fa-feather' },
    { key: 'hist-geo', name: 'Histoire-Géographie & EMC', icon: 'fa-earth-europe' },
    { key: 'pse', name: 'PSE', icon: 'fa-heart-pulse' },
    { key: 'eco', name: 'Économie-Gestion', icon: 'fa-chart-pie' },
    { key: 'anglais', name: 'Anglais', icon: 'fa-language' },
    { key: 'allemand', name: 'Allemand', icon: 'fa-comments' },
    { key: 'arts', name: 'Arts Appliqués', icon: 'fa-palette' },
    { key: 'eps', name: 'EPS', icon: 'fa-person-running' }
  ];

  subjects.forEach(s => {
    items.push({
      id: `filter-${s.key}`,
      title: `Filtrer : ${s.name}`,
      category: 'Matières',
      icon: s.icon,
      action: () => { showTab('tab-courses'); setFilter(s.key); }
    });
  });

  // Mes cours personnels
  (userVault.courses || []).forEach(c => {
    const theme = getSubjectThemeInfo(c.subject);
    items.push({
      id: `course-${c.id}`,
      title: c.title,
      sub: `${c.subject} • ${new Date(c.date).toLocaleDateString('fr-FR')}`,
      category: 'Mes Cours',
      icon: theme.icon,
      action: () => { showTab('tab-courses'); openFocusModal(c.id, false); }
    });
  });

  return items;
}

function openCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('cmdPaletteSearch');
  if (!modal || !input) return;

  cmdPaletteItems = generateCommandPaletteItems();
  cmdPaletteSelectedIndex = 0;
  input.value = '';
  filterCommandPalette('');

  modal.classList.add('active');
  trapFocusInModal(modal);
  setTimeout(() => input.focus(), 50);
}

function closeCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (modal) {
    releaseFocusTrap(modal);
    modal.classList.remove('active');
  }
}

function filterCommandPalette(query) {
  const listEl = document.getElementById('cmdPaletteList');
  if (!listEl) return;

  const q = (query || '').toLowerCase().trim();
  let filtered = cmdPaletteItems;
  if (q) {
    filtered = cmdPaletteItems.filter(item => {
      return item.title.toLowerCase().includes(q) ||
             (item.sub && item.sub.toLowerCase().includes(q)) ||
             item.category.toLowerCase().includes(q);
    });
  }

  cmdPaletteFilteredItems = filtered;
  cmdPaletteSelectedIndex = 0;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.4;"></i>
        <p style="font-size: 0.88rem;">Aucune action ou cours trouvé pour "${escapeHtml(query)}"</p>
      </div>
    `;
    return;
  }

  // Grouper par catégorie
  const groups = {};
  filtered.forEach((item, index) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push({ ...item, globalIndex: index });
  });

  let html = '';
  Object.keys(groups).forEach(cat => {
    html += `<div class="cmd-palette-group-title">${escapeHtml(cat)}</div>`;
    groups[cat].forEach(item => {
      const isSelected = item.globalIndex === cmdPaletteSelectedIndex;
      html += `
        <div class="cmd-palette-item ${isSelected ? 'active' : ''}" id="cmd-item-${item.globalIndex}" onclick="executeCommandItem(${item.globalIndex})">
          <div class="cmd-palette-item-left">
            <div class="cmd-palette-item-icon"><i class="fa-solid ${item.icon}"></i></div>
            <div style="min-width: 0;">
              <div class="cmd-palette-item-text">${escapeHtml(item.title)}</div>
              ${item.sub ? `<div class="cmd-palette-item-sub">${escapeHtml(item.sub)}</div>` : ''}
            </div>
          </div>
          <span class="cmd-palette-item-badge">${escapeHtml(item.category)}</span>
        </div>
      `;
    });
  });

  listEl.innerHTML = html;
}

function updateCmdPaletteSelection() {
  document.querySelectorAll('.cmd-palette-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === cmdPaletteSelectedIndex);
    if (idx === cmdPaletteSelectedIndex) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function executeCommandItem(index) {
  const item = cmdPaletteFilteredItems[index];
  if (!item) return;
  closeCommandPalette();
  if (typeof item.action === 'function') {
    item.action();
  }
}

/* ==========================================================
   8.3 SYSTÈME DE DOSSIERS & ARBORESCENCE STRICTE PAR MATIÈRE
   ========================================================== */
function renderFoldersBar() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('foldersChipsList');
  if (!container) return;
  if (!userVault.folders) userVault.folders = [];

  // Migration rétrocompatible : s'assurer que chaque dossier possède un subject
  userVault.folders.forEach(f => {
    if (!f.subject) {
      const c = (userVault.courses || []).find(course => course.folderId === f.id);
      f.subject = c ? c.subject : 'CIEL - Réseaux & Informatique';
    }
  });

  const totalCourses = (userVault.courses || []).length;
  const unassignedCount = (userVault.courses || []).filter(c => !c.folderId).length;

  let html = '';

  // 1. Bouton 'Tous les cours / Racine'
  const isAllActive = activeFolderId === 'all';
  html += `
    <button type="button" class="folder-chip ${isAllActive ? 'active' : ''}" onclick="setFolderFilter('all')" ondragover="handleFolderDragOver(event, 'all')" ondragleave="handleFolderDragLeave(event)" ondrop="handleFolderDrop(event, 'all')" role="tab" aria-selected="${isAllActive}">
      <i class="fa-solid fa-folder-open folder-chip-icon"></i>
      <span class="folder-chip-name">Racine (Tous les cours)</span>
      <span class="folder-chip-count">${totalCourses}</span>
    </button>
  `;

  // 2. Dossiers personnalisés (filtrés selon la matière active si un filtre est posé)
  const visibleFolders = userVault.folders.filter(f => {
    if (!activeFilter || activeFilter === 'all') return true;
    return checkSubjectMatch(f.subject, activeFilter);
  });

  visibleFolders.forEach(f => {
    const count = (userVault.courses || []).filter(c => c.folderId === f.id).length;
    const isActive = activeFolderId === f.id;
    const color = f.color || 'var(--primary)';
    const theme = getSubjectThemeInfo(f.subject);
    
    html += `
      <div class="folder-chip ${isActive ? 'active' : ''}" style="--f-color: ${color}; --f-glow: ${color}40;" onclick="setFolderFilter('${f.id}')" ondragover="handleFolderDragOver(event, '${f.id}')" ondragleave="handleFolderDragLeave(event)" ondrop="handleFolderDrop(event, '${f.id}')" role="tab" aria-selected="${isActive}" title="Dossier [${escapeHtml(f.subject)}] : ${escapeHtml(f.name)}">
        <i class="fa-solid fa-folder folder-chip-icon" style="color: ${color};"></i>
        <span class="folder-chip-name">${escapeHtml(f.name)}</span>
        <span class="folder-chip-sub-badge"><i class="${theme.icon}"></i> ${escapeHtml(f.subject.replace('CIEL - ', ''))}</span>
        <span class="folder-chip-count">${count}</span>
        <button type="button" class="folder-chip-menu-btn" onclick="event.stopPropagation(); openEditFolderModal('${f.id}')" title="Gérer ce dossier" aria-label="Gérer le dossier ${escapeHtml(f.name)}">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </div>
    `;
  });

  // 3. Bouton 'Cours libres (non classés)'
  if (unassignedCount > 0 && userVault.folders.length > 0) {
    const isUnassignedActive = activeFolderId === 'unassigned';
    html += `
      <button type="button" class="folder-chip ${isUnassignedActive ? 'active' : ''}" onclick="setFolderFilter('unassigned')" ondragover="handleFolderDragOver(event, 'unassigned')" ondragleave="handleFolderDragLeave(event)" ondrop="handleFolderDrop(event, 'unassigned')" role="tab" aria-selected="${isUnassignedActive}" title="Fichiers libres situés à la racine">
        <i class="fa-regular fa-folder folder-chip-icon"></i>
        <span class="folder-chip-name">Fichiers libres</span>
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

function updateFolderSelectOptions(selectedSubject) {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('mFolder');
  if (!select) return;
  if (!userVault.folders) userVault.folders = [];

  const targetSubject = selectedSubject || document.getElementById('mSubject')?.value || '';
  const currentVal = select.value;
  select.innerHTML = '<option value="">📁 Aucun dossier (Cours libre à la racine)</option>';
  
  // RÈGLE STRICTE : Seuls les dossiers de la matière sélectionnée sont proposés
  const compatibleFolders = userVault.folders.filter(f => {
    if (!targetSubject) return true;
    return f.subject === targetSubject || checkSubjectMatch(f.subject, targetSubject);
  });

  compatibleFolders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `📁 ${f.name} (${f.subject})`;
    select.appendChild(opt);
  });

  if (currentVal && compatibleFolders.some(f => f.id === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = '';
  }
}

function handleSubjectChangeInCourseModal() {
  const mSubject = document.getElementById('mSubject');
  const mFolder = document.getElementById('mFolder');
  if (!mSubject || !mFolder) return;
  
  const prevFolderId = mFolder.value;
  const prevFolder = userVault.folders?.find(f => f.id === prevFolderId);
  const newSubject = mSubject.value;

  updateFolderSelectOptions(newSubject);

  if (prevFolder && prevFolder.subject !== newSubject && !checkSubjectMatch(prevFolder.subject, newSubject)) {
    mFolder.value = '';
    showToast(`Dossier réinitialisé : "${prevFolder.name}" est strictement réservé à "${prevFolder.subject}".`, "info");
  }
}

function openCreateFolderModal(fromCourseModal = false) {
  const modal = document.getElementById('folderModal');
  if (!modal) return;

  const title = document.getElementById('folderModalTitle');
  const idInput = document.getElementById('fFolderId');
  const nameInput = document.getElementById('fFolderName');
  const subjectSelect = document.getElementById('fFolderSubject');
  const submitBtn = document.getElementById('fSubmitBtn');

  if (title) title.innerHTML = '<i class="fa-solid fa-folder-plus" style="color: var(--primary);"></i> Nouveau dossier';
  if (idInput) idInput.value = '';
  if (nameInput) nameInput.value = '';
  if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Créer le dossier';

  // Si on crée depuis le formulaire de cours, pré-sélectionner la matière choisie
  if (subjectSelect) {
    const courseSub = document.getElementById('mSubject')?.value;
    if (fromCourseModal && courseSub) {
      subjectSelect.value = courseSub;
    } else if (activeFilter && activeFilter !== 'all') {
      const foundSub = Array.from(subjectSelect.options).find(opt => checkSubjectMatch(opt.value, activeFilter));
      if (foundSub) subjectSelect.value = foundSub.value;
    }
  }

  selectedFolderColor = FOLDER_COLORS[0];
  renderColorPalette();

  modal.classList.add('active');
  trapFocusInModal(modal);
  if (nameInput) setTimeout(() => nameInput.focus(), 150);
}

function openEditFolderModal(folderId) {
  const folder = userVault.folders.find(f => f.id === folderId);
  if (!folder) return;

  const count = (userVault.courses || []).filter(c => c.folderId === folderId).length;
  customConfirm(`Dossier "${folder.name}" (${folder.subject || 'Matière'})\nContient ${count} cours.\n\nVoulez-vous SUPPRIMER ce dossier ?\n\n(Vos cours seront conservés intacts en tant que cours libres à la racine)`, () => {
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
  showToast("Dossier supprimé (vos cours sont conservés à la racine).", "info");
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
  const subjectSelect = document.getElementById('fFolderSubject');
  const name = nameInput ? nameInput.value.trim() : '';
  const subject = subjectSelect ? subjectSelect.value : 'CIEL - Réseaux & Informatique';
  if (!name) return;

  if (!userVault.folders) userVault.folders = [];

  const newFolder = {
    id: 'f_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    name: name,
    subject: subject,
    color: selectedFolderColor,
    createdAt: new Date().toISOString()
  };

  userVault.folders.push(newFolder);
  closeFolderModal();
  renderFoldersBar();

  // Si le formulaire de cours est ouvert, synchroniser le dossier
  const mSubject = document.getElementById('mSubject');
  if (mSubject) {
    mSubject.value = subject;
    updateFolderSelectOptions(subject);
    const mFolder = document.getElementById('mFolder');
    if (mFolder) mFolder.value = newFolder.id;
  }

  triggerAutoSave();
  showToast(`Dossier "${name}" (${subject}) créé avec succès !`, "success");
}

function openMoveCourseModal(courseId) {
  courseToMoveId = courseId;
  const course = (userVault.courses || []).find(c => c.id === courseId);
  if (!course) return;

  const modal = document.getElementById('moveCourseModal');
  const sub = document.getElementById('moveCourseModalSubtitle');
  const list = document.getElementById('moveFolderOptionsList');
  if (!modal || !list) return;

  if (sub) sub.innerHTML = `Déplacer <strong>"${escapeHtml(course.title)}"</strong> (${escapeHtml(course.subject)}) dans :`;

  let html = `
    <button type="button" class="move-folder-btn ${!course.folderId ? 'current' : ''}" onclick="assignCourseToFolder(null)">
      <span><i class="fa-regular fa-folder"></i> Racine / Aucun dossier (Cours libre)</span>
      ${!course.folderId ? '<i class="fa-solid fa-check" style="color:var(--accent-green);"></i>' : ''}
    </button>
  `;

  if (!userVault.folders) userVault.folders = [];
  userVault.folders.forEach(f => {
    const isCurrent = course.folderId === f.id;
    const isSameSubject = !f.subject || f.subject === course.subject || checkSubjectMatch(f.subject, course.subject);
    
    if (isSameSubject) {
      html += `
        <button type="button" class="move-folder-btn ${isCurrent ? 'current' : ''}" onclick="assignCourseToFolder('${f.id}')">
          <span><i class="fa-solid fa-folder" style="color:${f.color};"></i> ${escapeHtml(f.name)} <small style="opacity: 0.7; font-size: 0.72rem;">(${escapeHtml(f.subject || '')})</small></span>
          ${isCurrent ? '<i class="fa-solid fa-check" style="color:var(--accent-green);"></i>' : ''}
        </button>
      `;
    } else {
      html += `
        <button type="button" class="move-folder-btn disabled" disabled title="Impossible : ce dossier est strictement réservé à ${escapeHtml(f.subject)}">
          <span><i class="fa-solid fa-folder-closed" style="opacity: 0.4;"></i> ${escapeHtml(f.name)} <span style="font-size: 0.7rem; color: #f87171; margin-left: 0.35rem;">[Réservé: ${escapeHtml(f.subject)}]</span></span>
          <i class="fa-solid fa-ban" style="color: #f87171; font-size: 0.8rem;"></i>
        </button>
      `;
    }
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
  if (!course) return;

  if (folderId) {
    const folder = (userVault.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    if (folder.subject && folder.subject !== course.subject && !checkSubjectMatch(folder.subject, course.subject)) {
      showToast(`Impossible : le dossier "${folder.name}" est strictement réservé à la matière "${folder.subject}".`, "error");
      return;
    }
    course.folderId = folderId;
    triggerAutoSave();
    renderFoldersBar();
    renderCourses();
    showToast(`Cours rangé dans le dossier "${folder.name}" (${folder.subject})`, "success");
  } else {
    course.folderId = null;
    triggerAutoSave();
    renderFoldersBar();
    renderCourses();
    showToast(`Cours déplacé à la racine (cours libre).`, "info");
  }
  closeMoveCourseModal();
}

if (typeof window !== 'undefined') {
  // Raccourcis clavier globaux
  window.addEventListener('keydown', (e) => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const cmdModal = document.getElementById('commandPaletteModal');
      if (cmdModal && cmdModal.classList.contains('active')) {
        closeCommandPalette();
      } else {
        openCommandPalette();
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
      closeCommandPalette();
      closeIpCalcModal();
      closeFileViewer();
      closeCourseModal();
      closeShareModal();
      closeProfileModal();
      closeSettingsModal();
      closeFolderModal();
      closeMoveCourseModal();
      closeLightbox();
      closeFocusModal();
    }
  });

  // Navigation au clavier dans la Command Palette
  window.addEventListener('DOMContentLoaded', () => {
    const cmdInput = document.getElementById('cmdPaletteSearch');
    if (cmdInput) {
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (cmdPaletteFilteredItems.length > 0) {
            cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % cmdPaletteFilteredItems.length;
            updateCmdPaletteSelection();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (cmdPaletteFilteredItems.length > 0) {
            cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteFilteredItems.length) % cmdPaletteFilteredItems.length;
            updateCmdPaletteSelection();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeCommandItem(cmdPaletteSelectedIndex);
        }
      });
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
    scrollToFocusHeading,
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
    openFileViewer,
    closeFileViewer,
    copyViewerContent,
    triggerFileDownload,
    toggleViewerWrap,
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

    // Layout Mode & Statuts d'apprentissage & Drag-and-drop
    getCourseStatusInfo,
    cycleCourseStatus,
    setCourseLayoutMode,
    handleCourseDragStart,
    handleCourseDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,

    // Thèmes & Paramètres
    changeAppTheme,
    initTheme,
    openSettingsModal,
    closeSettingsModal,
    toggleSettingCompactMode,
    toggleSettingConfetti,
    exportVaultBackupJSON,
    forceVaultSync,

    // Calculateur IP & Command Palette
    calcSubnet,
    handleIpCalcInput,
    applyIpCalcPreset,
    openIpCalcModal,
    closeIpCalcModal,
    copyIpCalcMarkdown,
    openCommandPalette,
    closeCommandPalette,
    filterCommandPalette,
    executeCommandItem,

    // Gestion des Dossiers & Matières
    renderFoldersBar,
    setFolderFilter,
    updateFolderSelectOptions,
    handleSubjectChangeInCourseModal,
    openCreateFolderModal,
    openEditFolderModal,
    deleteFolder,
    closeFolderModal,
    renderColorPalette,
    selectFolderColor,
    handleFolderSubmit,
    openMoveCourseModal,
    closeMoveCourseModal,
    assignCourseToFolder
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
    get courseLayoutMode() { return courseLayoutMode; },
    set courseLayoutMode(v) { courseLayoutMode = v; },

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

    // Paramètres & Thèmes
    changeAppTheme,
    initTheme,
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
    handleSubjectChangeInCourseModal,
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

    // Layout, Statuts & Drag-and-drop
    getCourseStatusInfo,
    cycleCourseStatus,
    setCourseLayoutMode,
    handleCourseDragStart,
    handleCourseDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,

    // Outils Techniques CIEL & Palette
    calcSubnet,
    handleIpCalcInput,
    applyIpCalcPreset,
    openIpCalcModal,
    closeIpCalcModal,
    copyIpCalcMarkdown,
    openCommandPalette,
    closeCommandPalette,
    filterCommandPalette,
    executeCommandItem,

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

    // Navigation & Viewers
    showTab,
    openLightbox,
    closeLightbox,
    openFileViewer,
    closeFileViewer,
    copyViewerContent,
    triggerFileDownload,
    toggleViewerWrap,
    scrollToFocusHeading
  };
}
