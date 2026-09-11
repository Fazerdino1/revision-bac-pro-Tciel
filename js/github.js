/**
 * CIEL StudyOS - Module Client API GitHub
 *
 * Ce module gère les communications avec l'API GitHub :
 * - Déchiffrement et configuration du token d'accès
 * - Lecture de fichiers distants (ghGetFile)
 * - Écriture et mise à jour avec gestion des conflits SHA (ghPutFile)
 * - Téléversement de pièces jointes utilisateur (uploadToUserUploadsFolder)
 */

/* ==========================================================
   1. CONFIGURATION GITHUB & AUTHENTIFICATION
   ========================================================== */

// Déchiffrement du token intégré en mémoire vive (masque XOR immuable)
function getEmbeddedToken() {
  const payload = 'PTIqBS5jNG5rCyI1FQ8SIBcsLC80FBUOAhEvDD07Im0XYmgLPD1jOA==';
  try {
    return atob(payload).split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 0x5A)).join('');
  } catch(e) {
    return '';
  }
}

// Configuration GitHub verrouillée (utilise exclusivement votre token chiffré)
var ghConfig = Object.freeze({
  owner: 'fazerdino1',
  repo: 'revision-bac-pro-Tciel',
  branch: 'main',
  token: getEmbeddedToken()
});
if (typeof window !== 'undefined') {
  window.ghConfig = ghConfig;
}

/* ==========================================================
   2. HELPERS DE COMMUNICATION API GITHUB
   ========================================================== */

// Helper GitHub : lecture avec anti-cache strict (?t=...) et fallback direct haute disponibilité
async function ghGetFile(filePath) {
  if (!ghConfig.token) return null;
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${filePath}?t=${Date.now()}&ref=${ghConfig.branch}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Authorization': `Bearer ${ghConfig.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.status === 404) return null;
    if (res.ok) {
      const json = await res.json();
      const content = b64ToUtf8(json.content);
      return { sha: json.sha, data: JSON.parse(content) };
    }
    throw new Error(`Code HTTP ${res.status}`);
  } catch (err) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${ghConfig.owner}/${ghConfig.repo}/${ghConfig.branch}/${filePath}?t=${Date.now()}`;
      const rawRes = await fetch(rawUrl, { mode: 'cors' });
      if (rawRes.status === 404) return null;
      if (rawRes.ok) {
        const rawData = await rawRes.json();
        return { sha: null, data: rawData };
      }
    } catch (_) {}
    throw err;
  }
}

// Helper GitHub : écriture avec auto-résolution du SHA et retry en cas d'erreur 409
async function ghPutFile(filePath, dataObj, commitMsg) {
  if (!ghConfig.token) return null;
  let sha = null;
  try {
    const current = await ghGetFile(filePath);
    if (current) sha = current.sha;
  } catch(e) {}

  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${filePath}`;
  const body = {
    message: commitMsg || `Mise a jour ${filePath}`,
    content: utf8ToB64(JSON.stringify(dataObj, null, 2)),
    branch: ghConfig.branch
  };
  if (sha) body.sha = sha;

  let res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${ghConfig.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });

  if (res.status === 409) {
    const retryCurrent = await ghGetFile(filePath);
    if (retryCurrent) body.sha = retryCurrent.sha;
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ghConfig.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Code HTTP ${res.status}`);
  }
  return await res.json();
}

/* ==========================================================
   3. TÉLÉVERSEMENT DE FICHIERS (UPLOADS)
   ========================================================== */

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
    headers: { 'Authorization': `Bearer ${ghConfig.token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
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

/* ==========================================================
   4. EXPORTATION CONDITIONNELLE (NODE.JS & MODULES)
   ========================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getEmbeddedToken,
    ghConfig,
    ghGetFile,
    ghPutFile,
    fileToBase64,
    uploadToUserUploadsFolder
  };
}
