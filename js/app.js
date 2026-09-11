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
let userVault = { courses: [], flashcards: [], todos: [], profile: { avatar: '', bio: '' }, lastUpdated: null };
let allSharedCourses = [];
let pendingFiles = [];
let autoSaveTimer = null;
let authMode = 'login';
let currentSubView = 'mine';
let activeFilter = 'all';
let courseToShare = null;
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
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
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

    const cleanUp = () => {
      modal.classList.remove('active');
      if (okBtn) okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
    };

    if (okBtn) okBtn.onclick = () => { cleanUp(); resolve(true); };
    if (cancelBtn) cancelBtn.onclick = () => { cleanUp(); resolve(false); };
  });
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
  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) userLabel.innerText = username;
  updateHeaderProfileUI();
  const authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'none';

  renderCourses();
  renderFlashcards();
  renderTodos();
  updateReceivedBadge();
  setSync('synced', 'Connecté');
}

async function restoreSession(username) {
  currentSession = { username, aesKey: null, saltHex: null };
  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) userLabel.innerText = username;

  // 1. Restaurer depuis le cache local immédiat
  const localData = localStorage.getItem(`ciel_vault_${username}`);
  if (localData) {
    try {
      userVault = JSON.parse(localData);
      updateHeaderProfileUI();
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
  if (modal) modal.classList.add('active');
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.remove('active');
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
      if (!userVault.profile) userVault.profile = { avatar: '', bio: '' };

      localStorage.setItem(`ciel_vault_${currentSession.username}`, JSON.stringify(userVault));
      setSync('synced', 'À jour');
    } else {
      userVault = { courses: [], flashcards: [], todos: [], profile: { avatar: '', bio: '' }, lastUpdated: new Date().toISOString() };
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
  renderCourses();
}

function updateReceivedBadge() {
  if (!currentSession.username) return;
  const received = allSharedCourses.filter(s => s.toUser === currentSession.username);
  const badge = document.getElementById('receivedCountBadge');
  if (badge) badge.innerText = received.length;
}

async function openShareModal(courseId) {
  const course = userVault.courses.find(c => c.id === courseId);
  if (!course) return;
  courseToShare = course;

  const titleEl = document.getElementById('shareCourseTitle');
  if (titleEl) titleEl.innerText = course.title;
  const listEl = document.getElementById('recipientsList');
  if (listEl) listEl.innerHTML = '<div style="padding:1.25rem; text-align:center; color:var(--text-sub);"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des camarades...</div>';
  const modal = document.getElementById('shareModal');
  if (modal) modal.classList.add('active');

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
          <input type="checkbox" value="${escapeHtml(u)}" class="share-recipient-cb" id="cb_${escapeHtml(u)}" style="width:18px; height:18px; cursor:pointer;" />
          ${avatarHTML}
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; color:#fff; font-size:0.9rem;">@${escapeHtml(u)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${bioText}</div>
          </div>
        `;
        row.onclick = (e) => {
          if (e.target.tagName !== 'INPUT') {
            const cb = row.querySelector('.share-recipient-cb');
            if (cb) cb.checked = !cb.checked;
          }
        };
        listEl.appendChild(row);
      });
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<p style="color:var(--accent-rose); padding:1rem; text-align:center;">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  if (modal) modal.classList.remove('active');
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

function renderCourses() {
  const feed = document.getElementById('coursesFeed');
  const counter = document.getElementById('coursesCounter');
  if (!feed) return;
  const searchInput = document.getElementById('courseSearch');
  const search = (searchInput?.value || '').toLowerCase();

  feed.innerHTML = '';

  if (currentSubView === 'mine') {
    const items = userVault.courses.filter(c => {
      const matchCat = checkSubjectMatch(c.subject, activeFilter);
      const matchSearch = !search || c.title.toLowerCase().includes(search) || (c.content || '').toLowerCase().includes(search);
      return matchCat && matchSearch;
    });

    if (counter) counter.innerText = `${items.length} cours personnel${items.length > 1 ? 's' : ''}`;

    if (items.length === 0) {
      feed.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-sub);">
          <i class="fa-solid fa-folder-open" style="font-size: 2.8rem; margin-bottom: 0.75rem; opacity: 0.3;"></i>
          <p style="font-size: 0.95rem;">Aucun cours dans cette catégorie.</p>
          <p style="font-size: 0.8rem; margin-top: 0.3rem;">Ajoutez un cours avec le bouton <strong>+</strong>.</p>
        </div>`;
      return;
    }

    items.forEach(c => {
      const card = document.createElement('div');
      card.className = 'course-card';

      let attachmentsHTML = buildAttachmentsHTML(c.attachments);
      const parsedContent = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(c.content || '') : (c.content || '');
      const sanitizedBody = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsedContent) : parsedContent;

      card.innerHTML = `
        <div class="course-card-top">
          <div>
            <span class="badge-sub">${escapeHtml(c.subject)}</span>
            <h4 class="course-title">${escapeHtml(c.title)}</h4>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn btn-share" style="padding: 0.35rem 0.65rem; min-height: 32px;" onclick="openShareModal(${c.id})" title="Partager avec un camarade">
              <i class="fa-solid fa-share-nodes"></i> Partager
            </button>
            <button class="btn btn-danger" style="padding: 0.35rem 0.6rem; min-height: 32px;" onclick="deleteCourseById(${c.id})">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div class="course-body">${sanitizedBody}</div>
        ${attachmentsHTML}
        <div style="margin-top: 0.85rem; color: var(--text-sub); font-size: 0.72rem;">
          Enregistré le ${new Date(c.date).toLocaleDateString('fr-FR')} • ${new Date(c.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      `;
      feed.appendChild(card);
    });

  } else {
    const received = allSharedCourses.filter(s => s.toUser === currentSession.username && checkSubjectMatch(s.course.subject, activeFilter) && (!search || s.course.title.toLowerCase().includes(search) || (s.course.content || '').toLowerCase().includes(search)));

    if (counter) counter.innerText = `${received.length} cours partagé${received.length > 1 ? 's' : ''}`;

    if (received.length === 0) {
      feed.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--text-sub);">
          <i class="fa-solid fa-inbox" style="font-size: 2.8rem; margin-bottom: 0.75rem; opacity: 0.3;"></i>
          <p style="font-size: 0.95rem;">Aucun cours reçu dans cette matière.</p>
        </div>`;
      return;
    }

    received.forEach(s => {
      const card = document.createElement('div');
      card.className = 'course-card';
      card.style.borderColor = 'rgba(99, 102, 241, 0.4)';

      let attachmentsHTML = buildAttachmentsHTML(s.course.attachments);
      const avatarHTML = renderAvatarHTML(s.fromUser, s.senderAvatar, 36);
      const senderBio = s.senderBio ? ` • ${escapeHtml(s.senderBio)}` : '';
      const parsedContent = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(s.course.content || '') : (s.course.content || '');
      const sanitizedBody = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(parsedContent) : parsedContent;

      card.innerHTML = `
        <div class="course-card-top">
          <div style="display:flex; align-items:flex-start; gap:0.65rem;">
            ${avatarHTML}
            <div>
              <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                <span style="font-weight:700; color:#fff; font-size:0.88rem;">@${escapeHtml(s.fromUser)}</span>
                <span class="badge-sub" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border-color: #6366f1;">
                  ${escapeHtml(s.course.subject)}
                </span>
              </div>
              <div style="font-size:0.75rem; color:var(--text-sub);">${senderBio}</div>
              <h4 class="course-title">${escapeHtml(s.course.title)}</h4>
            </div>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn btn-primary" style="padding: 0.35rem 0.65rem; min-height: 32px; font-size: 0.75rem;" onclick="importSharedCourse('${s.id}')">
              <i class="fa-solid fa-file-import"></i> Importer
            </button>
            <button class="btn btn-danger" style="padding: 0.35rem 0.6rem; min-height: 32px;" onclick="deleteSharedCourse('${s.id}')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div class="course-body">${sanitizedBody}</div>
        ${attachmentsHTML}
        <div style="margin-top: 0.85rem; color: var(--text-sub); font-size: 0.72rem;">
          Envoyé le ${new Date(s.sentAt).toLocaleDateString('fr-FR')} à ${new Date(s.sentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      `;
      feed.appendChild(card);
    });
  }
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
      html += `
        <a href="${safeUrl}" target="_blank" download="${escapeHtml(att.name)}" class="file-badge-download">
          <i class="fa-solid fa-file-arrow-down"></i>
          <span>${escapeHtml(att.name)}</span>
        </a>`;
    }
  });
  html += '</div>';
  return html;
}

function openCourseModal() {
  pendingFiles = [];
  renderPendingModalFiles();
  const modal = document.getElementById('courseModal');
  if (modal) modal.classList.add('active');
}

function closeCourseModal() {
  const modal = document.getElementById('courseModal');
  if (modal) modal.classList.remove('active');
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
    const isImg = f.type.startsWith('image/');
    const chip = document.createElement('span');
    chip.style = 'background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 99px; padding: 0.3rem 0.7rem; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.4rem;';
    chip.innerHTML = `
      <i class="${isImg ? 'fa-solid fa-image' : 'fa-solid fa-file'}" style="color: var(--primary);"></i>
      <span>${escapeHtml(f.name)}</span>
      <i class="fa-solid fa-xmark" style="color: var(--accent-rose); cursor: pointer;" onclick="removePendingFile(${idx})"></i>
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
    isImage: file.type.startsWith('image/'),
    size: file.size
  };
}

async function submitCourse() {
  const subjectEl = document.getElementById('mSubject');
  const titleEl = document.getElementById('mTitle');
  const contentEl = document.getElementById('mContent');
  const btn = document.getElementById('mSubmitBtn');

  const subject = subjectEl ? subjectEl.value : '';
  const title = titleEl ? titleEl.value.trim() : '';
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

    userVault.courses.unshift({
      id: Date.now(),
      subject,
      title,
      content,
      attachments: uploadedList,
      date: new Date().toISOString()
    });

    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';
    pendingFiles = [];

    closeCourseModal();
    renderCourses();
    triggerAutoSave();
    showToast("Cours enregistré avec succès !", "success");
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
  const box = document.getElementById('fcDisplayContent');
  const counter = document.getElementById('fcNumberLabel');
  const badge = document.getElementById('fcBadgeLabel');
  const cardEl = document.getElementById('fcInteractiveCard');

  if (!box || !cardEl) return;

  if (userVault.flashcards.length === 0) {
    box.innerHTML = "Aucune flashcard enregistrée.";
    if (counter) counter.innerText = "0 / 0";
    if (badge) badge.innerText = "Vide";
    cardEl.classList.remove('is-ans');
    return;
  }

  if (fcCursor >= userVault.flashcards.length) fcCursor = 0;
  if (fcCursor < 0) fcCursor = userVault.flashcards.length - 1;

  const item = userVault.flashcards[fcCursor];
  if (counter) counter.innerText = `${fcCursor + 1} / ${userVault.flashcards.length}`;
  if (badge) badge.innerText = item.s || "Général";

  if (fcFlipped) {
    cardEl.classList.add('is-ans');
    box.innerHTML = `<span style="color: var(--accent-green); font-size: 0.8rem; text-transform: uppercase;">[Réponse]</span><br>${escapeHtml(item.a)}`;
  } else {
    cardEl.classList.remove('is-ans');
    box.innerHTML = `<span style="color: var(--primary); font-size: 0.8rem; text-transform: uppercase;">[Question]</span><br>${escapeHtml(item.q)}`;
  }
}

function toggleFlashcardFlip() {
  if (userVault.flashcards.length === 0) return;
  fcFlipped = !fcFlipped;
  renderFlashcards();
}

function nextFlashcard() {
  if (userVault.flashcards.length === 0) return;
  fcFlipped = false;
  fcCursor = (fcCursor + 1) % userVault.flashcards.length;
  renderFlashcards();
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
    feed.innerHTML = `<p style="text-align: center; color: var(--text-sub); padding: 1.5rem 0;">Aucun objectif en attente.</p>`;
    return;
  }
  feed.innerHTML = '';
  userVault.todos.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'todo-row';
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.75rem; cursor:pointer; flex:1;" onclick="toggleTodo(${i})">
        <i class="fa-${t.done ? 'solid fa-circle-check' : 'regular fa-circle'}" style="font-size: 1.2rem; color:${t.done ? 'var(--accent-green)' : 'var(--text-sub)'};"></i>
        <span style="${t.done ? 'text-decoration: line-through; color: var(--text-sub);' : ''}">${escapeHtml(t.text)}</span>
      </div>
      <button class="btn btn-danger" style="padding: 0.25rem 0.55rem; min-height: 32px;" onclick="deleteTodo(${i})">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    feed.appendChild(row);
  });
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
  if (modal) modal.classList.add('active');
}

function closeLightbox() {
  const img = document.getElementById('lightboxImg');
  const modal = document.getElementById('lightboxModal');
  if (modal) modal.classList.remove('active');
  if (img) img.src = '';
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
    get courseToShare() { return courseToShare; },
    set courseToShare(v) { courseToShare = v; },
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

    // Auth & Profil
    initApp,
    switchAuthMode,
    handleAuthSubmit,
    openUserSession,
    restoreSession,
    logout,
    updateHeaderProfileUI,
    openProfileModal,
    closeProfileModal,
    handleAvatarChange,
    saveUserProfile,

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
    renderCourses,
    buildAttachmentsHTML,
    openCourseModal,
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
    closeLightbox
  };
}
