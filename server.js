/**
 * Blind City Online — serveur relais WebSocket + hébergement du jeu
 * -----------------------------------------------
 * Ce petit serveur fait deux choses :
 *  1. Il sert le jeu lui-même (blind-city-v18.html, le dossier js/, le
 *     dossier sounds/) à quiconque visite son adresse dans un navigateur —
 *     pas besoin de télécharger de fichiers séparément au préalable.
 *  2. Il relaie le multijoueur (WebSocket) entre tous les joueurs connectés :
 *  - il donne la même "graine" de génération de ville à tout le monde,
 *    afin que tous les clients affichent exactement les mêmes rues/lieux ;
 *  - il diffuse la position/apparence de chaque joueur aux autres ;
 *  - il relaie le chat RP (uniquement aux joueurs proches), le talkie-walkie
 *    (aux joueurs allumés sur la même fréquence, peu importe la distance),
 *    et les échanges d'objets/talkie entre deux joueurs précis.
 *
 * Installation :
 *   npm install ws
 *
 * Démarrage local :
 *   node server.js
 *   (le jeu est accessible sur http://localhost:3000, wss://localhost:3000
 *   pour la connexion multijoueur — ce sont la même adresse)
 *
 * Important : server.js, blind-city-v18.html, le dossier js/ et le dossier
 * sounds/ doivent rester ensemble, au même endroit, pour que l'hébergement
 * fonctionne.
 *
 * Déploiement (Render, Railway, Glitch, VPS...) :
 *   Le serveur lit automatiquement process.env.PORT, ce qui fonctionne sans
 *   configuration particulière sur la plupart des hébergeurs Node.js gratuits.
 *
 * Persistance : l'état "vivant" (positions, actualités) reste en mémoire,
 * tandis que les comptes joueurs et les données staff sont sauvegardés. Par
 * défaut dans des fichiers JSON locaux ; mais sur un hébergeur dont le disque
 * s'efface au redémarrage (Render gratuit), on peut activer une base Supabase
 * gratuite via les variables d'environnement SUPABASE_URL et
 * SUPABASE_SERVICE_KEY — les comptes survivent alors aux mises en veille.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

// --- Persistance des données (comptes joueurs + données staff) ---
// Par défaut, tout est stocké dans des fichiers JSON locaux. MAIS sur un
// hébergeur gratuit comme Render, le disque est "éphémère" : il est effacé à
// chaque mise en veille/redémarrage, ce qui ferait perdre les comptes joueurs.
// Pour éviter ça, on branche une base Supabase (gratuite) : il suffit de
// définir les variables d'environnement SUPABASE_URL et SUPABASE_SERVICE_KEY.
// Les données sont alors stockées dans la table game_state(key, data) et
// survivent aux redémarrages. Sans ces variables, on garde les fichiers locaux.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ewruthgmecfhldkuihid.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
let supabase = null;
if (SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    console.log('[persistance] Supabase activé — les données survivront aux redémarrages.');
  } catch (e) {
    console.error('[persistance] @supabase/supabase-js indisponible — retour aux fichiers locaux. Détail :', e.message);
  }
}
// État de la persistance, exposé sur la page /status (lisible au lecteur
// d'écran) pour diagnostiquer sans avoir à parcourir les logs à l'œil.
let persistenceReady = false; // true si le chargement initial Supabase a réussi
let persistenceError = null;  // message d'erreur Supabase, le cas échéant
// Lit une entrée de la table game_state. Renvoie null si la clé n'existe pas
// encore (normal au tout premier démarrage). Lève une erreur en cas de vrai
// problème (réseau, droits) : on préfère alors s'arrêter plutôt que risquer
// d'écraser des données existantes avec un état vide.
async function supabaseLoad(key) {
  const { data, error } = await supabase.from('game_state').select('data').eq('key', key).maybeSingle();
  if (error) throw new Error(`lecture "${key}" : ${error.message}`);
  return data ? data.data : null;
}
// Écrit (insère ou met à jour) une entrée. Appelée en "fire-and-forget".
async function supabaseSave(key, value) {
  const { error } = await supabase.from('game_state').upsert({ key, data: value }, { onConflict: 'key' });
  if (error) console.error(`[persistance] écriture "${key}" échouée :`, error.message);
}

const STAFF_FILE = path.join(__dirname, 'staff-data.json');
// Codes administrateur AUTORITAIRES : ils ont la PRIORITÉ absolue. On prend la
// variable d'environnement si elle est définie (recommandé pour garder le code
// secret), sinon la valeur ci-dessous. Ces codes écrasent toujours ceux qui
// pourraient être stockés dans staff-data.json ou dans Supabase — ainsi le code
// choisi ici fonctionne à coup sûr, sans être bloqué par une ancienne valeur.
const AUTH_CODES = {
  principal: process.env.STAFF_CODE_PRINCIPAL || 'admin200016',
  moderateur: process.env.STAFF_CODE_MODERATEUR || 'Admin002061',
};
// Réimpose les codes autoritaires par-dessus tout état chargé (fichier/Supabase).
function enforceAuthCodes() {
  if (!staffData.codes) staffData.codes = {};
  staffData.codes.principal = AUTH_CODES.principal;
  staffData.codes.moderateur = AUTH_CODES.moderateur;
}
let staffData = {
  codes: { principal: AUTH_CODES.principal, moderateur: AUTH_CODES.moderateur },
  bans: [], cityEdits: [], worldEdits: [], morgue: [], graves: [],
};
// Garantit que toutes les listes attendues existent (compatibilité avec un
// ancien fichier ou enregistrement Supabase créé avant morgue/graves).
function ensureStaffArrays() {
  for (const k of ['bans', 'cityEdits', 'worldEdits', 'morgue', 'graves']) {
    if (!Array.isArray(staffData[k])) staffData[k] = [];
  }
}
try {
  const raw = fs.readFileSync(STAFF_FILE, 'utf8');
  const loaded = JSON.parse(raw);
  if (loaded && loaded.codes) { staffData = loaded; ensureStaffArrays(); }
} catch (e) { /* fichier absent au premier démarrage : on garde les valeurs par défaut ci-dessus */ }
enforceAuthCodes(); // priorité aux codes autoritaires, quoi qu'il ait été chargé
function saveStaffData() {
  // En mode Supabase, on n'écrit que si le chargement initial a réussi
  // (persistenceReady), pour ne jamais écraser la base avec un état incomplet.
  if (supabase) { if (persistenceReady) supabaseSave('staff', staffData); return; }
  try { fs.writeFileSync(STAFF_FILE, JSON.stringify(staffData, null, 2), 'utf8'); } catch (e) { console.error('Impossible d\'enregistrer staff-data.json :', e); }
}

// Comptes joueurs persistants (façon FiveM) : un identifiant/mot de passe
// permet de retrouver sa progression depuis n'importe quel appareil.
// IMPORTANT — sécurité volontairement simple : hachage SHA-256 salé, stocké
// dans un simple fichier JSON. Suffisant pour jouer entre amis en confiance,
// mais ce n'est pas un niveau de sécurité "production" (pas de limite de
// tentatives, pas de récupération par e-mail, pas de chiffrement du fichier).
const ACCOUNTS_FILE = path.join(__dirname, 'accounts-data.json');
let accountsData = { accounts: {} }; // clé = pseudo en minuscules
try {
  const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
  const loaded = JSON.parse(raw);
  if (loaded && loaded.accounts) accountsData = loaded;
} catch (e) { /* fichier absent au premier démarrage */ }
function saveAccountsData() {
  if (supabase) { if (persistenceReady) supabaseSave('accounts', accountsData); return; }
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsData, null, 2), 'utf8'); } catch (e) { console.error('Impossible d\'enregistrer accounts-data.json :', e); }
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}

const PORT = process.env.PORT || 3000;
const WORLD_SEED = Math.floor(Math.random() * 2147483647); // même ville pour tout le monde, tant que le serveur tourne
const CHAT_RADIUS = 15;      // distance (en cases) pour s'entendre parler en RP "de vive voix"
const SOUND_RADIUS = 30;     // distance (en cases, ~120 m) pour entendre les sons du monde d'un autre joueur
const FREQ_TOLERANCE = 0.05; // tolérance de fréquence pour le talkie-walkie (en MHz)
const WORLD_TICK_MS = 250;   // fréquence de diffusion des positions (~4 fois par seconde)

// Sert aussi le jeu lui-même (HTML, JS, sons) : quelqu'un visitant l'adresse
// du serveur dans son navigateur reçoit directement le jeu, sans avoir à
// télécharger de fichiers séparément au préalable.
const GAME_HTML_FILE = 'blind-city-v18.html';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.json': 'application/json; charset=utf-8',
};
function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Fichier introuvable.'); return; }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}
const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  // Racine : le jeu lui-même.
  if (reqPath === '/' || reqPath === '/index.html') {
    serveStaticFile(res, path.join(__dirname, GAME_HTML_FILE));
    return;
  }
  // Fichiers JS et sons : uniquement dans js/ et sounds/, jamais en dehors
  // (protection basique contre la traversée de répertoire — pas de "..").
  if ((reqPath.startsWith('/js/') || reqPath.startsWith('/sounds/')) && !reqPath.includes('..')) {
    serveStaticFile(res, path.join(__dirname, reqPath));
    return;
  }
  // Page d'état accessible : indique en clair si Supabase est bien connecté,
  // et sinon le message d'erreur exact. Lisible au lecteur d'écran (et par un
  // outil), pour diagnostiquer sans fouiller les logs.
  if (reqPath === '/status') {
    const status = {
      serveur: 'en ligne',
      persistance: !supabase
        ? 'fichiers locaux (Supabase non configuré)'
        : (persistenceReady ? 'Supabase OK — les comptes sont sauvegardés' : 'Supabase EN ERREUR — sauvegardes en pause'),
      supabase_configure: !!supabase,
      supabase_operationnel: persistenceReady,
      supabase_erreur: persistenceError,
      joueurs_connectes: players.size,
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Blind City Online — serveur relais actif.\nConnectez le client en WebSocket sur cette même adresse (wss://...).\n');
});
const wss = new WebSocket.Server({ server });

let nextId = 1;
/** @type {Map<string, any>} id -> état complet du joueur (avec sa connexion ws) */
const players = new Map();
// Actualités publiées par les journalistes — en mémoire, partagées par tout
// le monde sur ce serveur (les 50 plus récentes suffisent, pas besoin de
// persistance au-delà d'un redémarrage pour ce genre de contenu éphémère).
const newsArticles = [];
/** @type {Map<string, any>} callId -> { callerId, targetId, status, timeout } */
const calls = new Map();

function publicState(p) {
  return {
    id: p.id, firstName: p.firstName, lastName: p.lastName, gender: p.gender,
    x: p.x, y: p.y, heading: p.heading, health: p.health, hunger: p.hunger, thirst: p.thirst, role: p.role, policeRank: p.policeRank,
    outfit: p.outfit, inVehicle: p.inVehicle, vehicleName: p.vehicleName,
    talkieOn: p.talkieOn, talkieFrequency: p.talkieFrequency, voiceOpen: p.voiceOpen, handsUp: p.handsUp,
    unconscious: !!p.unconscious, isCuffed: !!p.isCuffed, accountUsername: p.accountUsername || null,
  };
}

function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }

// Démarre un appel entre deux joueurs, que ce soit via un contact (call_offer)
// ou en composant un numéro (dial_number) — même minuterie de 30 secondes,
// même relais des messages une fois décroché.
function startCall(callerWs, callerId, callerPlayer, targetPlayer, fromLabel, masked) {
  const callId = 'c' + (nextId++);
  const call = { callId, callerId, targetId: targetPlayer.id, status: 'ringing' };
  calls.set(callId, call);
  call.timeout = setTimeout(() => {
    if (calls.get(callId)?.status !== 'ringing') return;
    calls.delete(callId);
    send(callerWs, { type: 'call_timeout', callId });
    send(targetPlayer.ws, { type: 'call_timeout', callId });
  }, 30000);
  // Appel masqué : le destinataire ne voit ni le nom ni de quoi identifier
  // l'appelant. On envoie quand même fromId (nécessaire au routage/à la voix)
  // mais avec le drapeau masked, que le client honnête respecte en n'affichant
  // pas l'identité.
  send(targetPlayer.ws, { type: 'call_offer', callId, fromId: callerId, fromName: masked ? 'Numéro masqué' : fromLabel, masked: !!masked });
  send(callerWs, { type: 'call_ringing', callId, targetId: targetPlayer.id, targetName: `${targetPlayer.firstName} ${targetPlayer.lastName}` });
}

function send(ws, msg) {
  try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
}

function broadcast(msg, exceptId) {
  for (const p of players.values()) if (p.id !== exceptId) send(p.ws, msg);
}

function broadcastStaffLog(text) {
  const entry = { type: 'staff_log', text, time: Date.now() };
  for (const p of players.values()) if (p.staffRole) send(p.ws, entry);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : null) || req.socket.remoteAddress || '';
}

function safeName(v, fallback, maxLen) {
  const s = (typeof v === 'string' ? v : '').trim();
  return (s || fallback).slice(0, maxLen);
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (staffData.bans.some(b => b.ip === ip)) {
    send(ws, { type: 'banned', reason: (staffData.bans.find(b => b.ip === ip) || {}).reason || 'Bannissement.' });
    try { ws.close(); } catch (e) { /* ignore */ }
    return;
  }
  const id = 'p' + (nextId++);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const player = {
    id, ws, ip,
    firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme',
    x: 120, y: 120, heading: 0, health: 100, role: 'citoyen',
    outfit: { haut: null, bas: null, chaussures: null, accessoires: [] },
    inVehicle: false, vehicleName: null,
    talkieOn: false, talkieFrequency: 151.5,
    voiceOpen: false,
    handsUp: false,
    airplane: false,
    staffRole: null, // null | 'moderateur' | 'principal', authentifié via staff_auth
    accountUsername: null, // pseudo du compte connecté (register/login), sinon pas de compte
    joined: false,
  };
  players.set(id, player);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    else if (msg.type === 'register') {
      const username = safeName(msg.username, '', 20).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const password = typeof msg.password === 'string' ? msg.password : '';
      const securityQuestion = safeName(msg.securityQuestion, '', 120);
      const securityAnswer = typeof msg.securityAnswer === 'string' ? msg.securityAnswer.trim().toLowerCase() : '';
      const realFirstName = safeName(msg.realFirstName, '', 40);
      const realLastName = safeName(msg.realLastName, '', 40);
      const rpScore = Math.max(0, Math.min(5, parseInt(msg.rpScore, 10) || 0));
      if (!username || username.length < 3) { send(ws, { type: 'register_result', ok: false, reason: 'Identifiant invalide (3 caractères minimum, lettres/chiffres/underscore).' }); return; }
      if (!password || password.length < 4) { send(ws, { type: 'register_result', ok: false, reason: 'Mot de passe trop court (4 caractères minimum).' }); return; }
      if (!securityQuestion || !securityAnswer) { send(ws, { type: 'register_result', ok: false, reason: 'Question et réponse de sécurité requises (pour récupérer le compte en cas d\'oubli).' }); return; }
      if (!realFirstName || !realLastName) { send(ws, { type: 'register_result', ok: false, reason: 'Votre vrai prénom et nom sont requis.' }); return; }
      if (accountsData.accounts[username]) { send(ws, { type: 'register_result', ok: false, reason: 'Cet identifiant est déjà pris.' }); return; }
      const salt = crypto.randomBytes(8).toString('hex');
      const answerSalt = crypto.randomBytes(8).toString('hex');
      // Score suffisant (4/5 ou plus) : compte accepté automatiquement.
      // Sinon : compte créé mais en attente, l'administrateur devra l'examiner
      // et l'accepter manuellement avant que la personne puisse se connecter.
      const status = rpScore >= 4 ? 'approved' : 'pending';
      accountsData.accounts[username] = {
        salt, hash: hashPassword(password, salt), saveData: null, createdAt: Date.now(),
        securityQuestion, answerSalt, answerHash: hashPassword(securityAnswer, answerSalt),
        realFirstName, realLastName, rpScore, rpTotal: 5, status,
      };
      saveAccountsData();
      if (status === 'pending') {
        send(ws, { type: 'register_result', ok: true, username, pending: true });
        broadcastStaffLog(`Nouveau compte "${username}" (${realFirstName} ${realLastName}) en attente de validation — entretien RP : ${rpScore}/5.`);
        console.log(`[compte] Compte en attente de validation : ${username} (score RP ${rpScore}/5)`);
      } else {
        player.accountUsername = username;
        send(ws, { type: 'register_result', ok: true, username });
        console.log(`[compte] Nouveau compte créé et approuvé automatiquement : ${username} (score RP ${rpScore}/5)`);
      }
    }

    else if (msg.type === 'login') {
      const username = safeName(msg.username, '', 20).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const password = typeof msg.password === 'string' ? msg.password : '';
      const account = accountsData.accounts[username];
      if (!account || hashPassword(password, account.salt) !== account.hash) {
        send(ws, { type: 'login_result', ok: false, reason: 'Identifiant ou mot de passe incorrect.' });
        return;
      }
      if (account.status === 'pending') {
        send(ws, { type: 'login_result', ok: false, reason: 'Votre compte est toujours en attente de validation par l\'administrateur.' });
        return;
      }
      player.accountUsername = username;
      send(ws, { type: 'login_result', ok: true, username, saveData: account.saveData || null });
      console.log(`[compte] Connexion : ${username}`);
    }

    else if (msg.type === 'get_security_question') {
      const username = safeName(msg.username, '', 20).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const account = accountsData.accounts[username];
      if (!account) { send(ws, { type: 'security_question_result', ok: false, reason: 'Identifiant introuvable.' }); return; }
      send(ws, { type: 'security_question_result', ok: true, question: account.securityQuestion });
    }

    else if (msg.type === 'staff_list_pending_accounts') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const pending = Object.entries(accountsData.accounts)
        .filter(([, acc]) => acc.status === 'pending')
        .map(([username, acc]) => ({ username, realFirstName: acc.realFirstName, realLastName: acc.realLastName, rpScore: acc.rpScore, rpTotal: acc.rpTotal, createdAt: acc.createdAt }));
      send(ws, { type: 'staff_pending_accounts', accounts: pending });
    }

    else if (msg.type === 'staff_review_account') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const username = safeName(msg.username, '', 20).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const account = accountsData.accounts[username];
      if (!account) { send(ws, { type: 'staff_error', text: 'Compte introuvable.' }); return; }
      account.status = msg.approve ? 'approved' : 'rejected';
      saveAccountsData();
      send(ws, { type: 'staff_review_result', username, status: account.status });
      broadcastStaffLog(`${player.firstName} ${player.lastName} a ${msg.approve ? 'approuvé' : 'rejeté'} le compte "${username}".`);
    }

    else if (msg.type === 'reset_password') {
      const username = safeName(msg.username, '', 20).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const answer = typeof msg.answer === 'string' ? msg.answer.trim().toLowerCase() : '';
      const newPassword = typeof msg.newPassword === 'string' ? msg.newPassword : '';
      const account = accountsData.accounts[username];
      if (!account) { send(ws, { type: 'reset_password_result', ok: false, reason: 'Identifiant introuvable.' }); return; }
      if (!account.answerHash || hashPassword(answer, account.answerSalt) !== account.answerHash) {
        send(ws, { type: 'reset_password_result', ok: false, reason: 'Réponse de sécurité incorrecte.' });
        return;
      }
      if (!newPassword || newPassword.length < 4) { send(ws, { type: 'reset_password_result', ok: false, reason: 'Nouveau mot de passe trop court (4 caractères minimum).' }); return; }
      const salt = crypto.randomBytes(8).toString('hex');
      account.salt = salt; account.hash = hashPassword(newPassword, salt);
      saveAccountsData();
      send(ws, { type: 'reset_password_result', ok: true });
      console.log(`[compte] Mot de passe réinitialisé : ${username}`);
    }

    else if (msg.type === 'save_progress') {
      // Seul le compte authentifié sur CETTE connexion peut écrire sa propre sauvegarde.
      if (!player.accountUsername || player.accountUsername !== msg.username) return;
      const account = accountsData.accounts[player.accountUsername];
      if (!account) return;
      account.saveData = msg.data;
      account.lastSaveAt = Date.now();
      saveAccountsData();
    }

    else if (msg.type === 'carry_request') {
      const target = players.get(msg.targetId);
      if (!target) return;
      target.carriedBy = player.id;
      send(target.ws, { type: 'you_are_carried', byId: player.id, byName: `${player.firstName} ${player.lastName}` });
      broadcastStaffLog(`${player.firstName} ${player.lastName} porte ${target.firstName} ${target.lastName} (inconscient(e)).`);
    }

    else if (msg.type === 'carry_release') {
      const target = players.get(msg.targetId);
      if (!target || target.carriedBy !== player.id) return;
      target.carriedBy = null;
      send(target.ws, { type: 'you_are_released', byName: `${player.firstName} ${player.lastName}`, atHospital: !!msg.atHospital });
    }
    else if (msg.type === 'promote_police') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const rank = safeName(msg.rank, '', 20);
      target.policeRank = rank;
      send(target.ws, { type: 'police_promoted', rank, byName: `${player.firstName} ${player.lastName}` });
      broadcastStaffLog(`${player.firstName} ${player.lastName} nomme ${target.firstName} ${target.lastName} : ${rank}.`);
    }

    else if (msg.type === 'player_treated') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const gain = Math.max(0, Math.min(100, parseInt(msg.healthGain, 10) || 0));
      send(target.ws, { type: 'player_treated', healthGain: gain, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'give_ammo') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const qty = Math.max(1, Math.min(10000, parseInt(msg.qty, 10) || 0));
      const ammoType = safeName(msg.ammoType, '', 20);
      send(target.ws, { type: 'ammo_received', fromName: `${player.firstName} ${player.lastName}`, ammoType, qty });
    }

    else if (msg.type === 'toggle_cuffs') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'you_are_cuffed', cuffed: !!msg.cuffed, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'give_money') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const amount = Math.max(1, Math.min(50000000, parseInt(msg.amount, 10) || 0));
      send(target.ws, { type: 'money_received', fromName: `${player.firstName} ${player.lastName}`, amount });
    }

    else if (msg.type === 'share_gps') {
      // Partage de position GPS : on prévient la cible, qui pourra se faire
      // guider en direct jusqu'à l'expéditeur (sa position est déjà diffusée par
      // les messages "state", donc rien d'autre à transmettre ici).
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'share_gps', fromId: id, fromName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'house_sale_offer') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const price = Math.max(1, Math.min(500000000, parseInt(msg.price, 10) || 0));
      send(target.ws, { type: 'house_sale_offer', fromId: id, fromName: `${player.firstName} ${player.lastName}`, houseId: msg.houseId, houseName: safeName(msg.houseName, 'une maison', 60), price });
    }

    else if (msg.type === 'house_sale_response') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'house_sale_response', accepted: !!msg.accepted, houseId: msg.houseId, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'vehicle_sale_offer') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const price = Math.max(1, Math.min(500000000, parseInt(msg.price, 10) || 0));
      send(target.ws, { type: 'vehicle_sale_offer', fromId: id, fromName: `${player.firstName} ${player.lastName}`, vehicleType: safeName(msg.vehicleType, '', 40), vehicleName: safeName(msg.vehicleName, 'un véhicule', 60), price });
    }

    else if (msg.type === 'taxi_request') {
      const x = Math.max(0, Math.min(1000, parseFloat(msg.x) || 0));
      const y = Math.max(0, Math.min(1000, parseFloat(msg.y) || 0));
      for (const p of players.values()) {
        if (p.joined && p.role === 'chauffeur_pro' && p.id !== id) {
          send(p.ws, { type: 'taxi_request', passengerId: id, passengerName: `${player.firstName} ${player.lastName}`, x, y });
        }
      }
    }

    else if (msg.type === 'taxi_accept') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'taxi_accept', byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'mechanic_request') {
      const x = Math.max(0, Math.min(1000, parseFloat(msg.x) || 0));
      const y = Math.max(0, Math.min(1000, parseFloat(msg.y) || 0));
      const vehicleName = safeName(msg.vehicleName, 'un véhicule', 60);
      for (const p of players.values()) {
        if (p.joined && p.role === 'mecanicien' && p.id !== id) {
          send(p.ws, { type: 'mechanic_request', clientId: id, clientName: `${player.firstName} ${player.lastName}`, x, y, vehicleName });
        }
      }
    }

    else if (msg.type === 'mechanic_accept') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'mechanic_accept', byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'issue_ticket') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const amount = Math.max(1, Math.min(10000000, parseInt(msg.amount, 10) || 0));
      const reason = safeName(msg.reason, 'infraction', 100);
      send(target.ws, { type: 'ticket_received', amount, reason, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'legal_negotiation') {
      const officer = players.get(msg.officerId);
      if (!officer) return;
      send(officer.ws, { type: 'legal_negotiation', fromId: id, fromName: `${player.firstName} ${player.lastName}`, clientId: msg.clientId, clientName: safeName(msg.clientName, 'le client', 60) });
    }

    else if (msg.type === 'legal_negotiation_result') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'legal_negotiation_result', accepted: !!msg.accepted, isClient: !!msg.isClient, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'publish_news') {
      const article = { title: safeName(msg.title, '', 100), content: safeName(msg.content, '', 800), author: safeName(msg.author, 'Anonyme', 60), time: Date.now() };
      newsArticles.unshift(article);
      if (newsArticles.length > 50) newsArticles.length = 50;
      broadcast({ type: 'news_published', article });
    }

    // Décès officiel d'un joueur : son corps est déposé à la morgue, en attente
    // d'enterrement. Partagé à tous et persisté (le joueur mort a quitté le jeu).
    else if (msg.type === 'death_notice') {
      const entry = { name: safeName(msg.name, 'Inconnu', 60), cause: safeName(msg.cause, '', 80), time: Date.now() };
      staffData.morgue.push(entry);
      if (staffData.morgue.length > 200) staffData.morgue.splice(0, staffData.morgue.length - 200);
      saveStaffData();
      broadcast({ type: 'death_state', morgue: staffData.morgue, graves: staffData.graves });
      broadcastStaffLog(`Décès officiel : ${entry.name} déposé(e) à la morgue (${entry.cause}).`);
    }

    // Enterrement : un joueur décide d'enterrer un défunt de la morgue. On le
    // déplace de la morgue vers le cimetière (tombes), partagé à tous.
    else if (msg.type === 'bury') {
      const name = safeName(msg.name, '', 60);
      const idx = staffData.morgue.findIndex(m => m.name === name);
      if (idx >= 0) {
        const entry = staffData.morgue.splice(idx, 1)[0];
        entry.buriedTime = Date.now();
        staffData.graves.push(entry);
        if (staffData.graves.length > 500) staffData.graves.splice(0, staffData.graves.length - 500);
        saveStaffData();
        broadcast({ type: 'death_state', morgue: staffData.morgue, graves: staffData.graves });
        broadcastStaffLog(`${player.firstName} ${player.lastName} a organisé l'enterrement de ${entry.name}.`);
      }
    }

    else if (msg.type === 'send_invoice') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const amount = Math.max(1, Math.min(50000000, parseInt(msg.amount, 10) || 0));
      const reason = safeName(msg.reason, 'services rendus', 100);
      send(target.ws, { type: 'invoice_received', fromId: id, fromName: `${player.firstName} ${player.lastName}`, amount, reason });
    }

    else if (msg.type === 'invoice_paid') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const amount = Math.max(0, Math.min(50000000, parseInt(msg.amount, 10) || 0));
      send(target.ws, { type: 'invoice_paid_notice', byName: `${player.firstName} ${player.lastName}`, amount });
    }

    else if (msg.type === 'assist_wake') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'assist_wake', fromName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'player_hit') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const damage = Math.max(0, Math.min(200, parseInt(msg.damage, 10) || 0));
      send(target.ws, { type: 'player_hit', damage, headshot: !!msg.headshot, fromId: player.id, fromName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'player_punch') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const damage = Math.max(0, Math.min(30, parseInt(msg.damage, 10) || 0));
      send(target.ws, { type: 'player_punch', damage, fromId: player.id, fromName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'delete_own_account') {
      // Auto-suppression uniquement : le compte authentifié sur CETTE
      // connexion supprime son propre compte, jamais celui d'un autre.
      if (!player.accountUsername || player.accountUsername !== msg.username) return;
      delete accountsData.accounts[player.accountUsername];
      saveAccountsData();
      broadcastStaffLog(`Le compte "${player.accountUsername}" a été supprimé définitivement (mort du personnage).`);
      console.log(`[compte] Suppression définitive (mort du personnage) : ${player.accountUsername}`);
      player.accountUsername = null;
    }

    else if (msg.type === 'join') {
      player.firstName = safeName(msg.firstName, 'Joueur', 24);
      player.lastName = safeName(msg.lastName, 'Anonyme', 24);
      player.gender = msg.gender === 'femme' ? 'femme' : 'homme';
      player.joined = true;
      send(ws, {
        type: 'welcome', id, seed: WORLD_SEED,
        players: Array.from(players.values()).filter(p => p.id !== id && p.joined).map(publicState),
        cityEdits: staffData.cityEdits || [],
        worldEdits: staffData.worldEdits || [],
        morgue: staffData.morgue || [],
        graves: staffData.graves || [],
        news: newsArticles,
      });
      broadcast({ type: 'player_joined', id, name: `${player.firstName} ${player.lastName}` }, id);
      broadcastStaffLog(`${player.firstName} ${player.lastName} (${id}) a rejoint la ville. IP ${ip}.`);
      console.log(`[+] ${player.firstName} ${player.lastName} (${id}) a rejoint la ville.`);
    }

    else if (msg.type === 'state') {
      if (typeof msg.x === 'number') player.x = msg.x;
      if (typeof msg.y === 'number') player.y = msg.y;
      if (typeof msg.heading === 'number') player.heading = msg.heading;
      if (typeof msg.health === 'number') player.health = msg.health;
      if (typeof msg.hunger === 'number') player.hunger = msg.hunger;
      if (typeof msg.thirst === 'number') player.thirst = msg.thirst;
      if (typeof msg.role === 'string' && msg.role !== player.role) {
        broadcastStaffLog(`${player.firstName} ${player.lastName} change de métier : ${player.role} → ${msg.role}.`);
        player.role = msg.role;
      }
      if (msg.outfit && typeof msg.outfit === 'object') player.outfit = msg.outfit;
      if (typeof msg.inVehicle === 'boolean') {
        if (msg.inVehicle !== player.inVehicle) broadcastStaffLog(`${player.firstName} ${player.lastName} ${msg.inVehicle ? 'monte dans' : 'sort de'} ${msg.vehicleName || 'un véhicule'}.`);
        player.inVehicle = msg.inVehicle;
      }
      if (msg.vehicleName !== undefined) player.vehicleName = msg.vehicleName;
      if (typeof msg.talkieOn === 'boolean') player.talkieOn = msg.talkieOn;
      if (typeof msg.talkieFrequency === 'number') player.talkieFrequency = msg.talkieFrequency;
      if (typeof msg.airplane === 'boolean') player.airplane = msg.airplane;
      if (typeof msg.voiceOpen === 'boolean') player.voiceOpen = msg.voiceOpen;
      if (typeof msg.handsUp === 'boolean') player.handsUp = msg.handsUp;
      if (typeof msg.unconscious === 'boolean') player.unconscious = msg.unconscious;
      if (typeof msg.isCuffed === 'boolean') player.isCuffed = msg.isCuffed;
      if (typeof msg.policeRank === 'string' || msg.policeRank === null) player.policeRank = msg.policeRank;
    }

    else if (msg.type === 'chat') {
      const text = safeName(msg.text, '', 300);
      if (!text) return;
      for (const other of players.values()) {
        if (other.id === id || !other.joined) continue;
        if (dist(player, other) <= CHAT_RADIUS) {
          send(other.ws, { type: 'chat', fromId: id, fromName: `${player.firstName} ${player.lastName}`, text });
        }
      }
    }

    // Sons du monde (moteur, pas, tir, klaxon, sirène, portes, collisions…) :
    // relayés aux joueurs assez proches pour les entendre, avec la position de
    // l'émetteur pour que chaque client les spatialise. Volontairement léger :
    // on ne transporte qu'une clé de son et quelques paramètres numériques.
    else if (msg.type === 'world_sound') {
      const key = safeName(msg.key, '', 48);
      if (!key) return;
      const payload = {
        type: 'world_sound', key, x: player.x, y: player.y, fromId: id,
        vol: typeof msg.vol === 'number' ? Math.max(0, Math.min(1, msg.vol)) : 0.5,
      };
      for (const other of players.values()) {
        if (other.id === id || !other.joined) continue;
        if (dist(player, other) <= SOUND_RADIUS) send(other.ws, payload);
      }
    }

    else if (msg.type === 'talkie_ptt') {
      if (!player.talkieOn) return;
      const text = safeName(msg.text, '', 300);
      if (!text) return;
      const freq = typeof msg.frequency === 'number' ? msg.frequency : player.talkieFrequency;
      for (const other of players.values()) {
        if (other.id === id || !other.joined) continue;
        if (other.talkieOn && Math.abs(other.talkieFrequency - freq) <= FREQ_TOLERANCE) {
          send(other.ws, { type: 'talkie_message', fromId: id, fromName: `${player.firstName} ${player.lastName}`, frequency: freq, text });
        }
      }
    }

    else if (msg.type === 'talkie_give' || msg.type === 'item_give') {
      const target = players.get(msg.targetId);
      if (target && target.joined) {
        send(target.ws, {
          type: msg.type === 'talkie_give' ? 'talkie_offer' : 'item_offer',
          fromId: id, fromName: `${player.firstName} ${player.lastName}`, payload: msg.payload,
        });
      }
    }

    else if (msg.type === 'offer_response') {
      const target = players.get(msg.targetId);
      if (target && target.joined) {
        send(target.ws, {
          type: 'offer_response', accepted: !!msg.accepted, kind: msg.kind, payload: msg.payload,
          fromId: id, fromName: `${player.firstName} ${player.lastName}`,
        });
      }
    }

    else if (msg.type === 'register_numbers') {
      // Chaque joueur fait connaître ses numéros au serveur (purement pour
      // permettre de composer un numéro et retrouver qui le possède —
      // aucune vérification d'unicité stricte, cohérent avec le reste du
      // serveur qui reste volontairement simple).
      if (Array.isArray(msg.numbers)) {
        player.phoneNumbers = msg.numbers.filter(n => n && typeof n.number === 'string').map(n => ({ number: safeName(n.number, '', 30), label: safeName(n.label, '', 40) }));
      }
    }

    else if (msg.type === 'dial_number') {
      const dialed = safeName(msg.number, '', 30).replace(/\s/g, '');
      let target = null, targetEntry = null;
      for (const p of players.values()) {
        const entry = (p.phoneNumbers || []).find(n => n.number.replace(/\s/g, '') === dialed);
        if (entry) { target = p; targetEntry = entry; break; }
      }
      if (!target || !target.joined || target.airplane) { send(ws, { type: 'dial_result', ok: false, reason: 'Numéro injoignable ou inconnu.' }); return; }
      startCall(ws, id, player, target, safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), !!msg.masked);
      send(ws, { type: 'dial_result', ok: true });
    }

    else if (msg.type === 'sms_send') {
      // Message texte à un contact précis (choisi dans la liste des joueurs
      // réels connectés) — pas un appel, livré même si le destinataire n'a
      // pas le téléphone ouvert.
      const target = players.get(msg.targetId);
      const text = safeName(msg.text, '', 300);
      if (!target || !target.joined || !text) { send(ws, { type: 'sms_result', ok: false, reason: 'Destinataire injoignable.' }); return; }
      send(target.ws, { type: 'sms_receive', fromId: id, fromName: safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), text });
      send(ws, { type: 'sms_result', ok: true, targetId: target.id, targetName: `${target.firstName} ${target.lastName}` });
    }

    else if (msg.type === 'sms_dial') {
      // Même chose, mais le destinataire est retrouvé en composant son numéro
      // plutôt qu'en le choisissant dans la liste des contacts.
      const dialed = safeName(msg.number, '', 30).replace(/\s/g, '');
      const text = safeName(msg.text, '', 300);
      let target = null;
      for (const p of players.values()) {
        const entry = (p.phoneNumbers || []).find(n => n.number.replace(/\s/g, '') === dialed);
        if (entry) { target = p; break; }
      }
      if (!target || !target.joined || !text) { send(ws, { type: 'sms_result', ok: false, reason: 'Numéro injoignable ou inconnu.' }); return; }
      send(target.ws, { type: 'sms_receive', fromId: id, fromName: safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), text });
      send(ws, { type: 'sms_result', ok: true, targetId: target.id, targetName: `${target.firstName} ${target.lastName}` });
    }

    else if (msg.type === 'call_offer') {
      const target = players.get(msg.targetId);
      if (!target || !target.joined || target.airplane) { send(ws, { type: 'call_unavailable', targetId: msg.targetId }); return; }
      startCall(ws, id, player, target, safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), !!msg.masked);
    }

    else if (msg.type === 'send_number') {
      // Envoyer son numéro à une cible (joueur verrouillé) : elle le reçoit et
      // peut l'enregistrer puis rappeler.
      const target = players.get(msg.targetId);
      if (!target || !target.joined) { send(ws, { type: 'send_number_result', ok: false }); return; }
      send(target.ws, { type: 'number_received', fromId: id, number: safeName(msg.number, '', 30), label: safeName(msg.label, `${player.firstName} ${player.lastName}`, 40) });
      send(ws, { type: 'send_number_result', ok: true, targetName: `${target.firstName} ${target.lastName}` });
    }

    else if (msg.type === 'find_number') {
      // Retrouver le(s) numéro(s) d'un utilisateur d'après un nom : on cherche
      // dans les noms affichés (labels) ET les vrais noms des joueurs connectés.
      const q = safeName(msg.query, '', 40).trim().toLowerCase();
      const results = [];
      if (q) {
        for (const p of players.values()) {
          if (!p.joined) continue;
          const realName = `${p.firstName} ${p.lastName}`;
          for (const n of (p.phoneNumbers || [])) {
            const shown = n.label || realName;
            if (shown.toLowerCase().includes(q) || realName.toLowerCase().includes(q)) {
              results.push({ number: n.number, name: shown });
              if (results.length >= 12) break;
            }
          }
          if (results.length >= 12) break;
        }
      }
      send(ws, { type: 'find_number_result', query: msg.query, results });
    }

    else if (msg.type === 'call_answer') {
      const call = calls.get(msg.callId);
      if (!call || call.status !== 'ringing') return;
      clearTimeout(call.timeout); call.status = 'active';
      const caller = players.get(call.callerId);
      if (caller) send(caller.ws, { type: 'call_answered', callId: call.callId, byId: id, byName: `${player.firstName} ${player.lastName}` });
      send(ws, { type: 'call_answered', callId: call.callId, byId: call.callerId });
    }

    else if (msg.type === 'call_decline') {
      const call = calls.get(msg.callId);
      if (!call) return;
      clearTimeout(call.timeout); calls.delete(call.callId);
      const caller = players.get(call.callerId);
      if (caller) send(caller.ws, { type: 'call_declined', callId: call.callId });
    }

    else if (msg.type === 'call_end') {
      const call = calls.get(msg.callId);
      if (!call) return;
      clearTimeout(call.timeout); calls.delete(call.callId);
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'call_ended', callId: call.callId });
    }

    else if (msg.type === 'call_message') {
      const call = calls.get(msg.callId);
      if (!call || call.status !== 'active') return;
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'call_message', callId: call.callId, fromId: id, fromName: safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), text: safeName(msg.text, '', 300) });
    }

    else if (msg.type === 'crime_report') {
      const reporter = players.get(id);
      if (!reporter) return;
      broadcastStaffLog(`Crime signalé : ${msg.kind}${msg.detail ? ' — ' + msg.detail : ''}, par ${reporter.firstName} ${reporter.lastName} en (${Math.round(reporter.x)}, ${Math.round(reporter.y)}).`);
      for (const p of players.values()) {
        if (p.joined && p.role === 'police' && p.id !== id) {
          send(p.ws, { type: 'crime_alert', kind: msg.kind, detail: msg.detail, x: reporter.x, y: reporter.y });
        }
      }
    }

    // --- Mode staff : authentification, changement des codes, bannissement ---
    else if (msg.type === 'staff_auth') {
      const code = typeof msg.code === 'string' ? msg.code : '';
      if (code && code === staffData.codes.principal) {
        player.staffRole = 'principal';
        send(ws, { type: 'staff_auth_result', ok: true, staffRole: 'principal' });
        broadcastStaffLog(`${player.firstName} ${player.lastName} a activé le mode staff (administrateur principal).`);
      } else if (code && code === staffData.codes.moderateur) {
        player.staffRole = 'moderateur';
        send(ws, { type: 'staff_auth_result', ok: true, staffRole: 'moderateur' });
        broadcastStaffLog(`${player.firstName} ${player.lastName} a activé le mode staff (modérateur).`);
      } else {
        send(ws, { type: 'staff_auth_result', ok: false });
      }
    }

    else if (msg.type === 'staff_deauth') {
      if (player.staffRole) broadcastStaffLog(`${player.firstName} ${player.lastName} a désactivé le mode staff.`);
      player.staffRole = null;
    }

    else if (msg.type === 'staff_change_code') {
      if (player.staffRole !== 'principal') { send(ws, { type: 'staff_error', text: 'Seul l\'administrateur principal peut changer les codes.' }); return; }
      const which = msg.which === 'moderateur' ? 'moderateur' : 'principal';
      const newCode = typeof msg.newCode === 'string' ? msg.newCode.trim() : '';
      if (!newCode || newCode.length < 6) { send(ws, { type: 'staff_error', text: 'Code invalide (6 caractères minimum).' }); return; }
      staffData.codes[which] = newCode;
      saveStaffData();
      send(ws, { type: 'staff_code_changed', which });
      broadcastStaffLog(`${player.firstName} ${player.lastName} a changé le code administrateur "${which}".`);
    }

    else if (msg.type === 'staff_ban') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au staff.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) { send(ws, { type: 'staff_error', text: 'Joueur introuvable (déjà déconnecté ?).' }); return; }
      const reason = safeName(msg.reason, 'Aucune raison précisée.', 200);
      staffData.bans.push({ ip: target.ip, name: `${target.firstName} ${target.lastName}`, reason, byName: `${player.firstName} ${player.lastName}`, time: Date.now() });
      saveStaffData();
      broadcastStaffLog(`${player.firstName} ${player.lastName} a banni ${target.firstName} ${target.lastName} (${reason}).`);
      send(target.ws, { type: 'banned', reason });
      try { target.ws.close(); } catch (e) { /* ignore */ }
    }

    else if (msg.type === 'staff_unban') {
      if (player.staffRole !== 'principal') { send(ws, { type: 'staff_error', text: 'Seul l\'administrateur principal peut lever un bannissement.' }); return; }
      const before = staffData.bans.length;
      staffData.bans = staffData.bans.filter(b => b.ip !== msg.ip);
      saveStaffData();
      send(ws, { type: 'staff_bans_list', bans: staffData.bans });
      broadcastStaffLog(`${player.firstName} ${player.lastName} a levé un bannissement (${before - staffData.bans.length} entrée(s) retirée(s)).`);
    }

    else if (msg.type === 'city_edit') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Modification de la ville réservée au staff.' }); return; }
      const edit = { op: msg.op, payload: msg.payload };
      staffData.cityEdits.push(edit);
      saveStaffData();
      broadcastStaffLog(`${player.firstName} ${player.lastName} a modifié la ville : ${msg.op}.`);
      for (const p of players.values()) send(p.ws, { type: 'city_edit', op: edit.op, payload: edit.payload });
    }

    else if (msg.type === 'world_edit') {
      // Achat de véhicule/maison, stationnement... : action de jeu normale,
      // donc accessible à tout joueur connecté (pas réservé au staff).
      if (!player.joined) return;
      const key = msg.op + ':' + (msg.payload && msg.payload.id);
      const idx = staffData.worldEdits.findIndex(e => (e.op + ':' + (e.payload && e.payload.id)) === key);
      const edit = { op: msg.op, payload: msg.payload };
      if (idx >= 0) staffData.worldEdits[idx] = edit; else staffData.worldEdits.push(edit);
      if (staffData.worldEdits.length > 3000) staffData.worldEdits.splice(0, staffData.worldEdits.length - 3000);
      saveStaffData();
      for (const p of players.values()) send(p.ws, { type: 'world_edit', op: edit.op, payload: edit.payload });
    }

    else if (msg.type === 'staff_list_bans') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au staff.' }); return; }
      send(ws, { type: 'staff_bans_list', bans: staffData.bans });
    }

    else if (msg.type === 'search_request' || msg.type === 'search_data' || msg.type === 'loot_take') {
      // Fouille entre joueurs réels : ne fonctionne que si la cible a les mains
      // levées (vérifié aussi côté serveur pour éviter tout contournement).
      const target = players.get(msg.targetId);
      if (!target) return;
      if (msg.type === 'search_request' && !target.handsUp) { send(ws, { type: 'search_denied' }); return; }
      send(target.ws, { type: msg.type, fromId: id, data: msg.data });
    }
    else if (msg.type === 'voice_toggle') {
      const call = calls.get(msg.callId);
      if (!call || (call.callerId !== id && call.targetId !== id)) return;
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'voice_toggle', callId: msg.callId, on: !!msg.on });
    }

    else if (msg.type === 'mesh_offer' || msg.type === 'mesh_answer' || msg.type === 'mesh_ice') {
      // Signalisation WebRTC point-à-point générique, ciblée par joueur (pas liée à
      // un appel) : sert au micro de proximité et à la voix du talkie-walkie.
      const target = players.get(msg.toId);
      if (target && target.joined) {
        send(target.ws, { type: msg.type, fromId: id, channel: msg.channel, data: msg.data });
      }
    }

    // --- Chat vocal direct (WebRTC) : le serveur relaie juste l'offre/réponse/ICE
    // entre les deux joueurs en appel actif. Il ne voit jamais l'audio lui-même
    // (celui-ci passe en pair-à-pair une fois la connexion établie).
    else if (msg.type === 'rtc_offer' || msg.type === 'rtc_answer' || msg.type === 'rtc_ice') {
      const call = calls.get(msg.callId);
      if (!call || (call.callerId !== id && call.targetId !== id)) return;
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: msg.type, callId: msg.callId, fromId: id, data: msg.data });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    for (const [callId, call] of calls.entries()) {
      if (call.callerId === id || call.targetId === id) {
        clearTimeout(call.timeout);
        calls.delete(callId);
        const otherId = call.callerId === id ? call.targetId : call.callerId;
        const other = players.get(otherId);
        if (other) send(other.ws, { type: 'call_ended', callId });
      }
    }
    if (player.joined) {
      broadcast({ type: 'player_left', id, name: `${player.firstName} ${player.lastName}` }, id);
      broadcastStaffLog(`${player.firstName} ${player.lastName} (${id}) a quitté la ville.`);
      console.log(`[-] ${player.firstName} ${player.lastName} (${id}) a quitté la ville.`);
    }
  });

  ws.on('error', () => { /* géré via 'close' */ });
});

// Diffusion périodique de la position de tout le monde à tout le monde
setInterval(() => {
  for (const p of players.values()) {
    if (!p.joined) continue;
    send(p.ws, {
      type: 'world',
      players: Array.from(players.values()).filter(o => o.id !== p.id && o.joined).map(publicState),
      time: Date.now(),
    });
  }
}, WORLD_TICK_MS);

// Heartbeat : toutes les 20 secondes, on vérifie que chaque connexion a bien
// répondu au ping précédent. Sans ça, un mobile qui perd le réseau brutalement
// (pas de fermeture propre) resterait indéfiniment dans la liste des joueurs
// aux yeux des autres. Important pour bien tenir plusieurs connexions dans la durée.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  });
}, 20000);

// Au démarrage : si Supabase est activé, on charge d'abord les comptes et les
// données staff depuis la base AVANT d'accepter des connexions. En cas d'erreur
// de chargement, on NE s'arrête PAS (le jeu reste en ligne) : on met simplement
// les sauvegardes en pause pour ne rien écraser, et on expose l'erreur sur la
// page /status afin de pouvoir la diagnostiquer de façon accessible.
// Tente de charger les comptes + données staff depuis Supabase. Renvoie true
// si tout s'est bien passé (persistance active), false sinon (mode dégradé :
// le jeu tourne mais sans sauvegarde, pour ne rien écraser).
async function loadFromSupabase() {
  try {
    const st = await supabaseLoad('staff');
    if (st && st.codes) {
      staffData = st;
      ensureStaffArrays();
      enforceAuthCodes(); // les codes autoritaires priment sur ceux stockés dans Supabase
      await supabaseSave('staff', staffData); // et on réécrit pour que la base reflète les bons codes
    } else {
      // Tout premier démarrage : on transfère les codes/données du fichier vers Supabase.
      await supabaseSave('staff', staffData);
    }
    const acc = await supabaseLoad('accounts');
    if (acc && acc.accounts) accountsData = acc;
    else await supabaseSave('accounts', accountsData);
    persistenceReady = true;
    persistenceError = null;
    console.log('[persistance] Comptes et données staff chargés depuis Supabase.');
    return true;
  } catch (e) {
    persistenceError = e.message;
    console.error('[persistance] ERREUR Supabase — sauvegardes en pause (aucune donnée écrasée). Voir /status. Détail :', e.message);
    return false;
  }
}

async function init() {
  if (supabase) {
    const ok = await loadFromSupabase();
    if (!ok) {
      // Réessaie automatiquement toutes les 30 s jusqu'à réussir (par exemple
      // après avoir corrigé les permissions Supabase) : plus besoin de
      // redéployer manuellement pour que la persistance reparte.
      const retry = setInterval(async () => {
        if (await loadFromSupabase()) clearInterval(retry);
      }, 30000);
    }
  }
  server.listen(PORT, () => {
    console.log(`Blind City Online — serveur relais en écoute sur le port ${PORT}`);
    console.log(`Graine de ville partagée pour cette session : ${WORLD_SEED}`);
  });
}
init();
