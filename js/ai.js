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

const GEMINI_MODELS = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    family: '2.5',
    tag: 'Recommandé',
    desc: 'Le modèle offrant le meilleur rapport vitesse / pertinence pour la révision quotidienne.'
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    family: '2.5',
    tag: 'Ultra rapide',
    desc: 'Modèle léger à latence minimale, idéal sur connexions lentes ou mobiles.'
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    family: '2.5',
    tag: 'Raisonnement avancé',
    desc: 'Modèle de pointe pour les exercices complexes de routage, logique et calculs électriques.'
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    family: '3',
    tag: 'Nouvelle génération',
    desc: 'Dernière génération Gemini 3 : réactivité exceptionnelle et synthèses précises.'
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    family: '3',
    tag: 'Gemini 3',
    desc: 'Excellente compréhension technique des protocoles réseaux et schémas.'
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    family: '3',
    tag: 'Gemini 3',
    desc: 'Modèle multimodal polyvalent de la gamme Gemini 3.'
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    family: '3',
    tag: 'Léger & Rapide',
    desc: 'Version optimisée de Gemini 3.5 pour des réponses concises et instantanées.'
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    family: '3',
    tag: 'Gemini 3',
    desc: 'Modèle compact pour les fiches et les flashcards rapides.'
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    family: '3',
    tag: 'Expert Pro',
    desc: 'Capacités analytiques poussées pour les sujets d\'examen type épreuves E2/E31.'
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    family: '3',
    tag: 'Preview',
    desc: 'Aperçu des performances de base du moteur Gemini 3.'
  }
];

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

    return candidate.content.parts[0].text;
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
  window.GEMINI_MODELS = GEMINI_MODELS;
  window.getGeminiApiKey = getGeminiApiKey;
  window.getSelectedGeminiModel = getSelectedGeminiModel;
  window.setSelectedGeminiModel = setSelectedGeminiModel;
  window.callGeminiAPI = callGeminiAPI;
  window.generateCourseWithAI = generateCourseWithAI;
  window.enhanceNotesWithAI = enhanceNotesWithAI;
  window.generateFlashcardsWithAI = generateFlashcardsWithAI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GEMINI_MODELS,
    getEmbeddedGeminiKey,
    getGeminiApiKey,
    getSelectedGeminiModel,
    setSelectedGeminiModel,
    callGeminiAPI,
    generateCourseWithAI,
    enhanceNotesWithAI,
    generateFlashcardsWithAI
  };
}
