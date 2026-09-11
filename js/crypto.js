/**
 * CIEL StudyOS - Module Cryptographique & Encodage
 * 
 * Ce module gère les opérations de cryptographie côté client :
 * - Dérivation de clé PBKDF2 (SHA-256, 100 000 itérations)
 * - Chiffrement / Déchiffrement AES-GCM (256 bits, IV 12 octets)
 * - Calcul d'empreintes SHA-256
 * - Utilitaires d'encodage (Base64, Hexadécimal, ArrayBuffer, UTF-8)
 */

/* ==========================================================
   1. ENCODAGE & CONVERSION DE CHAÎNES ET TAMPONS (BUFFERS)
   ========================================================== */

/**
 * Encode une chaîne UTF-8 en chaîne Base64 en préservant les caractères multi-octets.
 * @param {string} str - La chaîne UTF-8 à encoder.
 * @returns {string} La représentation Base64.
 */
function utf8ToB64(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
}

/**
 * Décode une chaîne Base64 vers une chaîne UTF-8.
 * @param {string} str - La chaîne Base64 à décoder.
 * @returns {string} La chaîne décodée en UTF-8.
 */
function b64ToUtf8(str) {
  const clean = (str || '').replace(/[\r\n\s]/g, '');
  return decodeURIComponent(Array.prototype.map.call(atob(clean), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

/**
 * Convertit un tampon binaire (ArrayBuffer ou TypedArray) en chaîne hexadécimale.
 * @param {ArrayBuffer|Uint8Array} buf - Le tampon binaire d'entrée.
 * @returns {string} La chaîne hexadécimale correspondante.
 */
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convertit une chaîne hexadécimale en ArrayBuffer.
 * @param {string} hex - La chaîne hexadécimale.
 * @returns {ArrayBuffer} Le tampon binaire résultant.
 */
function hexToBuf(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Convertit un tampon binaire en chaîne Base64.
 * @param {ArrayBuffer|Uint8Array} buf - Le tampon binaire.
 * @returns {string} La chaîne Base64.
 */
function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/**
 * Convertit une chaîne Base64 en ArrayBuffer.
 * @param {string} b64 - La chaîne Base64.
 * @returns {ArrayBuffer} Le tampon binaire résultant.
 */
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

/* ==========================================================
   2. DÉRIVATION DE CLÉS & HASHAGE (PBKDF2 / SHA-256)
   ========================================================== */

/**
 * Dérive une clé AES-GCM 256 bits à partir d'un mot de passe et d'un sel via PBKDF2 (100 000 itérations).
 * @param {string} password - Le mot de passe utilisateur.
 * @param {ArrayBuffer|Uint8Array} saltBuffer - Le sel cryptographique.
 * @returns {Promise<CryptoKey>} La clé cryptographique dérivée prête pour AES-GCM.
 */
async function deriveKeyFromPassword(password, saltBuffer) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

/**
 * Calcule un vérificateur de mot de passe à stocker (sans révéler le mot de passe)
 * en dérivant 256 bits avec PBKDF2 et en renvoyant le résultat en hexadécimal.
 * @param {string} password - Le mot de passe.
 * @param {ArrayBuffer|Uint8Array} saltBuffer - Le sel cryptographique.
 * @returns {Promise<string>} L'empreinte vérificatrice en hexadécimal.
 */
async function computePasswordVerifier(password, saltBuffer) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' }, baseKey, 256);
  return bufToHex(bits);
}

/**
 * Calcule le hachage SHA-256 simple d'un mot de passe en hexadécimal (rétrocompatibilité).
 * @param {string} password - Le mot de passe en clair.
 * @returns {Promise<string>} Le hash SHA-256 en hexadécimal.
 */
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ==========================================================
   3. CHIFFREMENT & DÉCHIFFREMENT DE DONNÉES (AES-GCM)
   ========================================================== */

/**
 * Chiffre un objet JSON en AES-GCM avec un IV aléatoire de 12 octets.
 * @param {any} obj - Données JSON sérialisables à chiffrer.
 * @param {CryptoKey} aesKey - Clé AES-GCM.
 * @returns {Promise<{ iv: string, ciphertext: string }>} L'objet chiffré contenant l'IV en hex et le texte chiffré en Base64.
 */
async function encryptData(obj, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, encoded);
  return { iv: bufToHex(iv), ciphertext: bufToB64(ciphertext) };
}

/**
 * Déchiffre un objet protégé par AES-GCM et désérialise le JSON.
 * @param {{ iv: string, ciphertext: string }} encryptedObj - Objet contenant l'IV (hex) et le texte chiffré (Base64).
 * @param {CryptoKey} aesKey - Clé AES-GCM.
 * @returns {Promise<any>} L'objet initial désérialisé.
 */
async function decryptData(encryptedObj, aesKey) {
  const iv = hexToBuf(encryptedObj.iv);
  const cipherBuf = b64ToBuf(encryptedObj.ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, aesKey, cipherBuf);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

/* ==========================================================
   4. EXPORTATION CONDITIONNELLE (COMPATIBILITÉ NODE.JS & NAVIGATEUR)
   ========================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    utf8ToB64,
    b64ToUtf8,
    bufToHex,
    hexToBuf,
    bufToB64,
    b64ToBuf,
    deriveKeyFromPassword,
    computePasswordVerifier,
    hashPassword,
    encryptData,
    decryptData
  };
}
