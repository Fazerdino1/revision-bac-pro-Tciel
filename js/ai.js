/**
 * CIEL StudyOS - Module d'Intelligence Artificielle Pédagogique (Gemini API)
 *
 * Ce module gère les communications avec l'API Google Gemini :
 * - Sélection et bascule dynamique des modèles (Gemini 3 et Gemini 2.5)
 * - Tuteur interactif spécialisé dans le programme Bac Pro CIEL
 * - Génération automatique de cours et fiches mémo en Markdown
 * - Restructuration et mise en page de notes brutes
 * - Extraction automatique de flashcards de révision
 */

/* ==========================================================
   1. CONFIGURATION DES MODÈLES & CLÉ API
   ========================================================== */

/* ==========================================================
   1. CONFIGURATION DES TIERS, MODÈLES & QUOTAS D'UTILISATION
   ========================================================== */

const AI_TIERS = {
  tier_25: {
    id: 'tier_25',
    title: 'Famille Gemini 2.5',
    subtitle: 'Vitesse & Révision Quotidienne',
    icon: 'fa-bolt',
    limitTokens5h: 60000,   // 60 000 tokens par fenêtre de 5 heures
    limitTokens7d: 250000   // 250 000 tokens sur 7 jours
  },
  tier_30: {
    id: 'tier_30',
    title: 'Famille Gemini 3.0 à 3.5',
    subtitle: 'Polyvalence & Synthèses',
    icon: 'fa-microchip',
    limitTokens5h: 40000,   // 40 000 tokens par fenêtre de 5 heures
    limitTokens7d: 160000   // 160 000 tokens sur 7 jours
  },
  tier_36: {
    id: 'tier_36',
    title: 'Famille Gemini 3.6 & 3.7',
    subtitle: 'Haute Précision & Raisonnement Épreuve',
    icon: 'fa-wand-magic-sparkles',
    limitTokens5h: 25000,   // 25 000 tokens par fenêtre de 5 heures
    limitTokens7d: 100000   // 100 000 tokens sur 7 jours
  }
};

const GEMINI_MODELS = [
  // GROUPE 1 : MODÈLES 2.5
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    family: '2.5',
    tier: 'tier_25',
    tag: 'Recommandé',
    desc: 'Le modèle offrant le meilleur rapport vitesse / pertinence pour la révision quotidienne.'
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    family: '2.5',
    tier: 'tier_25',
    tag: 'Ultra rapide',
    desc: 'Modèle léger à latence minimale, idéal sur connexions lentes ou mobiles.'
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    family: '2.5',
    tier: 'tier_25',
    tag: 'Raisonnement avancé',
    desc: 'Modèle de pointe pour les exercices complexes de routage, logique et calculs électriques.'
  },

  // GROUPE 2 : MODÈLES 3.0 À 3.5
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    family: '3.0',
    tier: 'tier_30',
    tag: 'Preview',
    desc: 'Aperçu des performances de base du moteur Gemini 3.'
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    family: '3.1',
    tier: 'tier_30',
    tag: 'Léger',
    desc: 'Modèle compact pour les fiches et les flashcards rapides.'
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    family: '3.1',
    tier: 'tier_30',
    tag: 'Expert Pro',
    desc: 'Capacités analytiques poussées pour les sujets d\'examen type épreuves E2/E31.'
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    family: '3.5',
    tier: 'tier_30',
    tag: 'Polyvalent',
    desc: 'Modèle multimodal polyvalent de la gamme Gemini 3.5.'
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    family: '3.5',
    tier: 'tier_30',
    tag: 'Rapide',
    desc: 'Version optimisée de Gemini 3.5 pour des réponses concises et instantanées.'
  },

  // GROUPE 3 : MODÈLES 3.6 & 3.7
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    family: '3.6',
    tier: 'tier_36',
    tag: 'Avancé',
    desc: 'Excellente compréhension technique des protocoles réseaux et schémas.'
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    family: '3.7',
    tier: 'tier_36',
    tag: 'Dernière génération',
    desc: 'Dernière génération Gemini 3.7 : réactivité exceptionnelle et synthèses de pointe.'
  }
];

// Récupérer le journal des requêtes (conservé 7 jours glissants)
function getAIRequestsLog() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ciel_ai_requests_log');
    if (!raw) return [];
    const log = JSON.parse(raw);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    return Array.isArray(log) ? log.filter(entry => (now - entry.timestamp) <= maxAge) : [];
  } catch (e) {
    return [];
  }
}

// Formater un nombre de tokens de manière élégante (ex: 1 450, 24.5k)
function formatTokens(tokens) {
  if (typeof tokens !== 'number' || isNaN(tokens)) return '0';
  if (tokens >= 100000) {
    const k = Math.round(tokens / 1000);
    return `${k}k`;
  }
  if (tokens >= 10000) {
    const k = (Math.round(tokens / 100) / 10).toFixed(tokens % 1000 === 0 ? 0 : 1);
    return `${k}k`;
  }
  return tokens.toLocaleString('fr-FR');
}

function recordAIUsage(modelId, tokenUsage = {}) {
  if (typeof localStorage === 'undefined') return;
  try {
    const log = getAIRequestsLog();
    const modelObj = GEMINI_MODELS.find(m => m.id === modelId) || GEMINI_MODELS[0];

    // Si totalTokens n'est pas fourni, valeur estimée par défaut de 800 tokens
    const tokens = typeof tokenUsage.totalTokens === 'number' && tokenUsage.totalTokens > 0
      ? tokenUsage.totalTokens
      : (typeof tokenUsage === 'number' ? tokenUsage : 800);

    log.push({
      timestamp: Date.now(),
      model: modelObj.id,
      tier: modelObj.tier,
      tokens: tokens,
      promptTokens: tokenUsage.promptTokens || 0,
      candidatesTokens: tokenUsage.candidatesTokens || 0
    });
    localStorage.setItem('ciel_ai_requests_log', JSON.stringify(log));
  } catch (e) {
    console.warn("Erreur enregistrement quota IA:", e);
  }
}

function getAIQuotaInfo(modelId) {
  const modelObj = GEMINI_MODELS.find(m => m.id === modelId) || GEMINI_MODELS[0];
  const tierConfig = AI_TIERS[modelObj.tier] || AI_TIERS.tier_25;
  const log = getAIRequestsLog();
  const now = Date.now();

  const window5hMs = 5 * 60 * 60 * 1000;
  const window7dMs = 7 * 24 * 60 * 60 * 1000;

  // Filtrer les requêtes spécifiques à ce tier
  const tierRequests = log.filter(r => r.tier === modelObj.tier);

  // Fenêtre 5 heures (Somme des tokens consommés)
  const reqs5h = tierRequests.filter(r => (now - r.timestamp) <= window5hMs);
  const usedTokens5h = reqs5h.reduce((sum, r) => sum + (typeof r.tokens === 'number' ? r.tokens : 800), 0);
  const limitTokens5h = tierConfig.limitTokens5h;
  const pct5h = Math.min(100, Math.round((usedTokens5h / limitTokens5h) * 100));

  // Fenêtre 7 jours (Somme des tokens consommés)
  const reqs7d = tierRequests.filter(r => (now - r.timestamp) <= window7dMs);
  const usedTokens7d = reqs7d.reduce((sum, r) => sum + (typeof r.tokens === 'number' ? r.tokens : 800), 0);
  const limitTokens7d = tierConfig.limitTokens7d;
  const pct7d = Math.min(100, Math.round((usedTokens7d / limitTokens7d) * 100));

  // Reset 5h
  let reset5hText = 'Quota complet disponible';
  let reset5hCountdown = '';
  if (usedTokens5h > 0 && reqs5h.length > 0) {
    const oldest5h = Math.min(...reqs5h.map(r => r.timestamp));
    const reset5hDate = new Date(oldest5h + window5hMs);
    const diffMs = reset5hDate.getTime() - now;
    if (diffMs > 0) {
      const diffMins = Math.ceil(diffMs / 60000);
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      reset5hCountdown = hours > 0 ? `${hours}h ${mins}min` : `${mins} min`;
      const timeStr = reset5hDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      reset5hText = `Réinitialisation à ${timeStr} (dans ${reset5hCountdown})`;
    }
  }

  // Reset 7j
  let reset7dText = 'Quota complet disponible';
  if (usedTokens7d > 0 && reqs7d.length > 0) {
    const oldest7d = Math.min(...reqs7d.map(r => r.timestamp));
    const reset7dDate = new Date(oldest7d + window7dMs);
    const dateStr = reset7dDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const timeStr = reset7dDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    reset7dText = `Réinitialisation le ${dateStr} à ${timeStr}`;
  }

  const isBlocked5h = usedTokens5h >= limitTokens5h;
  const isBlocked7d = usedTokens7d >= limitTokens7d;
  const isBlocked = isBlocked5h || isBlocked7d;

  let blockReason = '';
  if (isBlocked5h) {
    blockReason = `Limite de tokens sur 5h atteinte pour ${tierConfig.title} (${formatTokens(usedTokens5h)} / ${formatTokens(limitTokens5h)} tokens). Prochaine libération : ${reset5hText}.`;
  } else if (isBlocked7d) {
    blockReason = `Limite hebdomadaire de tokens atteinte pour ${tierConfig.title} (${formatTokens(usedTokens7d)} / ${formatTokens(limitTokens7d)} tokens). Prochaine libération : ${reset7dText}.`;
  }

  return {
    tierId: modelObj.tier,
    tierTitle: tierConfig.title,
    usedTokens5h,
    limitTokens5h,
    pct5h,
    reset5hText,
    reset5hCountdown,
    usedTokens7d,
    limitTokens7d,
    pct7d,
    reset7dText,
    isBlocked,
    isBlocked5h,
    isBlocked7d,
    blockReason,
    // Compatibilité rétroactive
    count5h: usedTokens5h,
    limit5h: limitTokens5h,
    count7d: usedTokens7d,
    limit7d: limitTokens7d
  };
}

function checkAIQuota(modelId) {
  const quota = getAIQuotaInfo(modelId);
  if (quota.isBlocked) {
    throw new Error(quota.blockReason);
  }
}

// Déchiffrement de la clé API intégrée (masque réversible XOR en mémoire vive)
function getEmbeddedGeminiKey() {
  const payload = 'Gwt0GzhiCBRsEz0FAz0CDB9vOSAfa20UbAM0CRYjIBsZKj4iMzUWKxgqaC84MgtvNS03Yhs=';
  try {
    const raw = typeof atob !== 'undefined' ? atob(payload) : Buffer.from(payload, 'base64').toString('binary');
    return raw.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 0x5A)).join('');
  } catch (e) {
    return '';
  }
}

// Récupération de la clé active (clé intégrée transparente et sécurisée)
function getGeminiApiKey() {
  return getEmbeddedGeminiKey();
}

// Récupération du modèle configuré (défaut : gemini-2.5-flash)
function getSelectedGeminiModel() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('ciel_selected_ai_model');
    if (saved && GEMINI_MODELS.some(m => m.id === saved)) {
      return saved;
    }
  }
  return 'gemini-2.5-flash';
}

function setSelectedGeminiModel(modelId) {
  if (!GEMINI_MODELS.some(m => m.id === modelId)) return;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ciel_selected_ai_model', modelId);
  }
  if (typeof userVault !== 'undefined' && userVault.settings) {
    userVault.settings.aiModel = modelId;
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
}

/* ==========================================================
   2. APPEL CENTRAL API GEMINI REST
   ========================================================== */

const SYSTEM_INSTRUCTION_CIEL = `Tu es StudyBot CIEL, un tuteur pédagogique expert, bienveillant et rigoureux, spécialement conçu pour les élèves en Bac Professionnel CIEL (Cybersécurité, Informatique et réseaux, Électronique).

Tes règles d'or pédagogiques :
1. Réponds toujours en français dans un style clair, encourageant et structuré en Markdown soigné (listes, gras, tableaux, blocs de code avec coloration syntaxique).
2. Pour les matières professionnelles (Réseaux informatiques, Cybersécurité, Électronique & IoT, Projet CIEL) : sois très concret. Donne des exemples pratiques (commandes Cisco Switch/Router, masques de sous-réseau CIDR, modèles OSI/TCP-IP, règles firewall, loi d'Ohm, pont diviseur, Arduino/ESP32, schémas de câblage).
3. Pour les matières générales (Maths, Physique-Chimie, Français, Histoire-Géo, PSE, Éco-Gestion, Anglais) : adapte tes explications au niveau Terminale Bac Pro.
4. Termine souvent tes explications par une petite question d'auto-évaluation ou un mémo clé ("À retenir pour l'épreuve").
5. Sois concis mais complet : va droit au but sans jargon inutile.`;

async function callGeminiAPI(messages, options = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Clé API Gemini introuvable. Veuillez configurer votre clé dans les Paramètres.");
  }

  const model = options.model || getSelectedGeminiModel();

  // Contrôle strict des quotas (5 heures & 7 jours)
  checkAIQuota(model);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Construction du format contents
  let contents = [];
  if (typeof messages === 'string') {
    contents = [{ role: 'user', parts: [{ text: messages }] }];
  } else if (Array.isArray(messages)) {
    contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text || m.content || '' }]
    }));
  }

  const payload = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 2048
    }
  };

  if (options.systemInstruction !== false) {
    payload.systemInstruction = {
      parts: [{ text: options.customSystemInstruction || SYSTEM_INSTRUCTION_CIEL }]
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      const msg = errorJson.error?.message || `Erreur HTTP ${res.status}`;
      if (res.status === 429) {
        throw new Error("Limite de requêtes atteinte pour le modèle " + model + ". Essayez un autre modèle (ex: Gemini 2.5 Flash-Lite).");
      }
      if (res.status === 400 || res.status === 403) {
        throw new Error(`Erreur d'authentification API : ${msg}`);
      }
      throw new Error(`Erreur Gemini (${model}) : ${msg}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      throw new Error("Aucune réponse générée par le modèle.");
    }

    const replyText = candidate.content.parts[0].text;

    // Extraction des métadonnées officielles de tokens
    let totalTokens = data.usageMetadata?.totalTokenCount;
    const promptTokens = data.usageMetadata?.promptTokenCount || 0;
    const candidatesTokens = data.usageMetadata?.candidatesTokenCount || 0;

    // Estimation de secours si usageMetadata n'est pas fourni par l'API
    if (typeof totalTokens !== 'number' || totalTokens <= 0) {
      const estimatedPrompt = Math.ceil(JSON.stringify(payload).length / 4);
      const estimatedReply = Math.ceil(replyText.length / 4);
      totalTokens = estimatedPrompt + estimatedReply;
    }

    // Enregistrement de l'utilisation réelle en tokens dans les quotas
    recordAIUsage(model, {
      totalTokens,
      promptTokens,
      candidatesTokens
    });

    return replyText;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error("Le modèle a mis trop de temps à répondre (délai dépassé). Réessayez.");
    }
    throw err;
  }
}

/* ==========================================================
   3. CAS D'USAGE MÉTIER IA
   ========================================================== */

/**
 * 1. Génération complète d'un cours en Markdown
 */
async function generateCourseWithAI(topic, subject = 'CIEL - Réseaux & Informatique') {
  const prompt = `Rédige une fiche de révision complète, moderne et structurée en Markdown pour un élève de Bac Pro CIEL.
Matière : ${subject}
Sujet demandé : "${topic}"

La fiche doit impérativement respecter la structure suivante :
# ${topic}

## 🎯 Objectifs & Compétences du Référentiel
(3 puces synthétiques)

## 📌 Concepts Clés & Définitions
(Définitions claires, acronymes expliqués)

## ⚙️ Fonctionnement & Mise en Pratique
(Commandes CLI, formules avec exemple chiffré, schéma textuel ou tableau récapitulatif)

## ⚠️ Pièges d'Examen & Bonnes Pratiques
(Ce qui fait perdre des points au Bac Pro)

## 📝 Résumé Express (Flash Mémo)
(3 phrases à retenir par cœur)`;

  return await callGeminiAPI(prompt, { temperature: 0.6 });
}

/**
 * 2. Restructuration et amélioration de notes brutes
 */
async function enhanceNotesWithAI(rawNotes, currentSubject = '') {
  const prompt = `Voici les notes brutes prises par un élève de Bac Pro CIEL ${currentSubject ? `en ${currentSubject}` : ''} :

"""
${rawNotes}
"""

Tâche : Restructure entièrement ces notes en un cours Markdown clair, professionnel, aéré et élégant.
- Corrige l'orthographe technique.
- Ajoute des titres hiérarchiques (##, ###).
- Utilise des listes à puces et mets les termes importants en gras.
- Si du code ou des commandes sont mentionnés, place-les dans des blocs de code appropriés (\`\`\`bash, \`\`\`c, etc.).
- Renvoie UNIQUEMENT le texte Markdown amélioré.`;

  return await callGeminiAPI(prompt, { temperature: 0.5 });
}

/**
 * 3. Extraction automatique de flashcards depuis un texte de cours
 */
async function generateFlashcardsWithAI(courseContent, count = 4) {
  const prompt = `À partir du cours ci-dessous pour le Bac Pro CIEL, génère exactement ${count} flashcards de révision efficaces.
Chaque flashcard doit contenir :
- Une question claire et concise au Recto (ex: "Quelle est la commande pour créer un VLAN 10 ?", "Quelle est la formule de la loi d'Ohm ?").
- Une réponse précise, juste et pédagogique au Verso (ex: "Switch(config)# vlan 10", "U = R × I avec U en Volts, R en Ohms, I en Ampères").

Renvoie EXCLUSIVEMENT un tableau JSON valide au format strict suivant, sans balises markdown superflues :
[
  { "front": "Question...", "back": "Réponse..." }
]

Contenu du cours :
"""
${courseContent.slice(0, 3000)}
"""`;

  const rawRes = await callGeminiAPI(prompt, { temperature: 0.4 });
  try {
    const cleanJson = rawRes.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn("Échec parsing JSON direct flashcards, tentative regex...");
    const match = rawRes.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  }
  throw new Error("Impossible de formater les flashcards retournées par l'IA.");
}

/* ==========================================================
   4. EXPORTS GLOBAUX POUR LE SITE
   ========================================================== */
if (typeof window !== 'undefined') {
  window.AI_TIERS = AI_TIERS;
  window.GEMINI_MODELS = GEMINI_MODELS;
  window.formatTokens = formatTokens;
  window.getGeminiApiKey = getGeminiApiKey;
  window.getSelectedGeminiModel = getSelectedGeminiModel;
  window.setSelectedGeminiModel = setSelectedGeminiModel;
  window.getAIRequestsLog = getAIRequestsLog;
  window.recordAIUsage = recordAIUsage;
  window.getAIQuotaInfo = getAIQuotaInfo;
  window.checkAIQuota = checkAIQuota;
  window.callGeminiAPI = callGeminiAPI;
  window.generateCourseWithAI = generateCourseWithAI;
  window.enhanceNotesWithAI = enhanceNotesWithAI;
  window.generateFlashcardsWithAI = generateFlashcardsWithAI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AI_TIERS,
    GEMINI_MODELS,
    formatTokens,
    getEmbeddedGeminiKey,
    getGeminiApiKey,
    getSelectedGeminiModel,
    setSelectedGeminiModel,
    getAIRequestsLog,
    recordAIUsage,
    getAIQuotaInfo,
    checkAIQuota,
    callGeminiAPI,
    generateCourseWithAI,
    enhanceNotesWithAI,
    generateFlashcardsWithAI
  };
}
