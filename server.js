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

// --- Relais TURN Cloudflare (dernier recours) ---
// Utilisé UNIQUEMENT si la connexion directe ET le relais TURN gratuit
// (Metered/openrelay, voir /ice-servers ci-dessous) échouent tous les deux —
// pour ne pas gaspiller son quota. Jamais de secret codé en dur ici (comme
// pour SUPABASE_SERVICE_KEY plus bas) : sans ces deux variables d'environnement
// définies sur Render, ce relais est simplement absent de la liste, sans planter.
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID || '';
const CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN || '';
async function getCloudflareIceServers() {
  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) return null;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) }
    );
    if (!res.ok) { console.error('[TURN] Erreur Cloudflare :', await res.text()); return null; }
    const data = await res.json();
    return data.iceServers || null;
  } catch (e) {
    console.error('[TURN] Impossible de contacter Cloudflare :', e.message);
    return null;
  }
}

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
// Avertissement de démarrage si les codes par défaut (codés en dur) sont
// utilisés faute de variables d'environnement — audit métiers/staff, item 6 :
// ne change AUCUN comportement (les défauts restent un filet de secours
// volontaire, voir plus haut), juste un signal visible dans les logs pour
// qu'un déploiement en prod sans STAFF_CODE_* ne passe pas inaperçu.
if (!process.env.STAFF_CODE_PRINCIPAL || !process.env.STAFF_CODE_MODERATEUR) {
  console.warn('[staff] ATTENTION : STAFF_CODE_PRINCIPAL et/ou STAFF_CODE_MODERATEUR ne sont pas définis — les codes administrateur par défaut codés en dur sont utilisés. À définir en variables d\'environnement avant un déploiement public.');
}
// Note (audit métiers/staff, item 12) : tous les handlers ci-dessous qui
// testent `player.staffRole` (valeur 'principal' ou 'moderateur', vérité)
// traitent les deux rôles de façon IDENTIQUE — un modérateur peut
// accorder/révoquer un métier, bannir, etc., au même titre que le principal.
// Seules trois actions distinguent déjà les deux ('unban', 'codes' côté
// client — menu réservé à StaffMode.role === 'principal' — et la conservation
// des codes AUTH_CODES elle-même). C'est un choix de conception actuel, pas
// un oubli : aucune séparation plus fine n'est prévue tant qu'elle n'est pas
// explicitement demandée.
// Liste blanche des métiers attribuables (audit métiers/staff, item 3) —
// alignée sur Roles.list (js/roles-staff.js), 'citoyen' excepté (rôle libre,
// jamais accordé via ce chemin). Utilisée à CHAQUE point où un rôle entre
// dans l'état serveur : candidature (job_request), octroi (staff_grant_job),
// et surtout restauration à la connexion (voir plus bas) — ce dernier point
// faisait une confiance aveugle à account.saveData.role, un champ que
// rien ne validait jamais côté serveur avant d'être écrit (save_progress)
// ni avant d'être relu (login), avec pour seule protection un commentaire
// affirmant (à tort, vu le mode "Tester un métier" côté client) que ce rôle
// avait forcément été validé par staff_grant_job au préalable.
const VALID_JOB_ROLES = new Set(['police', 'medecin', 'mecanicien', 'concessionnaire', 'agent_immo', 'avocat', 'mineur_pro', 'journaliste_pro', 'chauffeur_pro']);
// Grades policiers valides (POLICE_RANKS, js/roles-staff.js) — même principe
// de whitelist appliqué à promote_police (audit métiers/staff, item 3 étendu).
const POLICE_RANK_IDS = new Set(['agent', 'brigadier', 'capitaine', 'chef']);
// Comptes PROPRIÉTAIRES : reçoivent automatiquement l'accès administrateur
// principal à la connexion, SANS avoir à saisir de code. On reconnaît un
// propriétaire à son identifiant de compte (username, en minuscules) OU à son
// nom de personnage « prénom nom » (réel, saisi à l'inscription). Configurable
// via la variable d'environnement OWNER_ACCOUNTS (liste séparée par des
// virgules). Voir aussi js/owner-access.js côté client.
// Par défaut, on reconnaît l'email du propriétaire sous toutes ses formes :
// complet, sans caractères spéciaux (forme stockée par le jeu à l'inscription),
// et abrégé. Surchargeable via la variable d'environnement OWNER_ACCOUNTS.
const OWNER_ACCOUNTS = (process.env.OWNER_ACCOUNTS || 'ffilwend@gmail.com,ffilwendgmailcom,ffilwend')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const OWNER_ACCOUNTS_STRIPPED = OWNER_ACCOUNTS.map(s => s.replace(/[^a-z0-9]/g, ''));
function isOwnerAccount(username, account) {
  const u = String(username || '').toLowerCase();
  const us = u.replace(/[^a-z0-9]/g, '');
  if (u && (OWNER_ACCOUNTS.includes(u) || (us && OWNER_ACCOUNTS_STRIPPED.includes(us)))) return true;
  if (account && account.realFirstName && account.realLastName) {
    const fullName = `${account.realFirstName} ${account.realLastName}`.toLowerCase().trim();
    const fullStripped = fullName.replace(/[^a-z0-9]/g, '');
    if (OWNER_ACCOUNTS.includes(fullName) || OWNER_ACCOUNTS_STRIPPED.includes(fullStripped)) return true;
  }
  return false;
}
// Accorde l'accès principal automatiquement à un propriétaire connecté.
function grantOwnerStaffIfEligible(ws, player, username, account) {
  if (!isOwnerAccount(username, account)) return;
  player.staffRole = 'principal';
  send(ws, { type: 'staff_auth_result', ok: true, staffRole: 'principal', auto: true });
  console.log(`[staff] Accès administrateur principal accordé automatiquement au propriétaire : ${username}`);
}
// Réimpose les codes autoritaires par-dessus tout état chargé (fichier/Supabase).
function enforceAuthCodes() {
  if (!staffData.codes) staffData.codes = {};
  staffData.codes.principal = AUTH_CODES.principal;
  staffData.codes.moderateur = AUTH_CODES.moderateur;
}
let staffData = {
  codes: { principal: AUTH_CODES.principal, moderateur: AUTH_CODES.moderateur },
  bans: [], cityEdits: [], worldEdits: [], morgue: [], graves: [],
  recruiters: {}, // roleId -> [accountUsername] — voir appoint_recruiter/recruiter_grant_job
};
// Garantit que toutes les listes attendues existent (compatibilité avec un
// ancien fichier ou enregistrement Supabase créé avant morgue/graves).
function ensureStaffArrays() {
  for (const k of ['bans', 'cityEdits', 'worldEdits', 'morgue', 'graves']) {
    if (!Array.isArray(staffData[k])) staffData[k] = [];
  }
  if (!staffData.recruiters || typeof staffData.recruiters !== 'object') staffData.recruiters = {};
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
// Cycle jour/nuit PARTAGÉ par tout le monde (même principe que WORLD_SEED et
// la météo, voir weatherState) : une journée complète dure DAY_LENGTH_MS de
// temps réel, calculée depuis le démarrage du serveur — purement
// déterministe, rien à stocker ni à sauvegarder. 1h réelle = 24h en jeu.
const SERVER_START_MS = Date.now();
const DAY_LENGTH_MS = 60 * 60 * 1000;
const CHAT_RADIUS = 15;      // distance (en cases) pour s'entendre parler en RP "de vive voix"
const SOUND_RADIUS = 30;     // distance (en cases, ~120 m) pour entendre les sons du monde d'un autre joueur
const FREQ_TOLERANCE = 0.05; // tolérance de fréquence pour le talkie-walkie (en MHz)
const WORLD_TICK_MS = 250;   // fréquence de diffusion des positions (~4 fois par seconde)
// Bornes de validation pour les coups portés à un autre VRAI joueur
// (player_hit/player_punch) : le client calcule et envoie le dégât (le
// serveur ne connaît pas l'arme utilisée), donc on ne peut pas revalider le
// calcul exact, mais on borne ce qui est physiquement plausible dans ce jeu
// et on exige une vraie proximité, pour empêcher un client modifié
// d'infliger des dégâts arbitraires ou de tirer à travers toute la carte.
// - MAX_HIT_DAMAGE couvre le coup le plus puissant hors tête (canon de char,
//   120, voir Game.fireTankCannon côté client) avec marge.
// - MAX_HEADSHOT_DAMAGE couvre le sniper à la tête (75 × 2, avant réduction
//   par la distance) avec marge.
// - MAX_HIT_RANGE couvre la plus longue portée d'arme (sniper, 90 cases),
//   étendue par le bonus de hauteur (×1,6 en grimpant, voir Game.shoot).
const MAX_HIT_RANGE = 150;
const MAX_HIT_DAMAGE = 140;
const MAX_HEADSHOT_DAMAGE = 160;
const MAX_PUNCH_DAMAGE = 30;
const MIN_HIT_INTERVAL_MS = 60; // sous la cadence de l'arme la plus rapide du jeu (UZI, ~80 ms)

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
    const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
    // HTML/JS : aucun en-tête de cache n'était envoyé auparavant. Sans
    // validateur explicite, un navigateur peut appliquer un cache
    // "heuristique" et continuer à servir une VIEILLE version du jeu depuis
    // son cache local pendant un moment après un déploiement — un correctif
    // pourtant bien en ligne peut alors sembler "ne pas marcher" pour
    // quelqu'un qui rouvre simplement le jeu sans vider son cache. no-cache
    // force une revalidation à chaque chargement (pas un no-store : le
    // navigateur peut réutiliser sa copie si le serveur confirme qu'elle
    // est encore à jour, donc pas de re-téléchargement systématique inutile).
    if (ext === '.html' || ext === '.js') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  let reqPath;
  try { reqPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Requête invalide.'); return; }
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
  // Serveurs ICE pour la voix (appel direct, proximité, talkie) : STUN et
  // relais TURN gratuit toujours renvoyés ; le relais Cloudflare (dernier
  // recours) s'y ajoute seulement s'il est configuré côté serveur.
  if (reqPath === '/ice-servers') {
    try {
      const baseServers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
      ];
      const cloudflareServers = await getCloudflareIceServers();
      if (cloudflareServers && cloudflareServers.length) baseServers.push(...cloudflareServers);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ iceServers: baseServers }));
    } catch (e) {
      console.error('[TURN]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
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
/** @type {Map<string, {id:string,name:string,role:string,roleName:string,time:number}>} candidatures de métier en attente, par id de joueur */
const jobRequests = new Map();
// Offres de vente maison/véhicule en attente (voir house_sale_offer/
// vehicle_sale_offer plus bas) : mémorise le prix NÉGOCIÉ (déjà plausibilisé
// à l'offre) pour payer le vendeur avec une valeur de confiance quand
// l'acheteur confirme, plutôt qu'une valeur reforgeable à l'étape de la
// réponse. Clé : `${kind}:${sellerId}:${buyerId}`. Purgée à la réponse (ou
// ignorée si trop ancienne, voir plus bas) — pas de nettoyage périodique
// nécessaire pour ce volume.
const pendingSales = new Map();

// Météo PARTAGÉE par tout le monde sur ce serveur : avant, chaque client
// tirait sa propre pluie au hasard, donc deux joueurs côte à côte pouvaient
// avoir l'un du soleil et l'autre de la pluie. Le serveur décide seul et
// diffuse le changement à tous — mêmes probabilités qu'avant (rare de se
// mettre à pleuvoir, la pluie s'arrête vite).
let weatherState = 'clair'; // 'clair' | 'pluie'
function weatherTick() {
  const before = weatherState;
  // Repassé de 8 % à 1,5 % par tick (~90 s) : la pluie revenait beaucoup trop
  // souvent (toutes les 15-20 minutes en moyenne) — désormais un évènement rare.
  if (weatherState === 'clair') { if (Math.random() < 0.015) weatherState = 'pluie'; }
  else { if (Math.random() < 0.6) weatherState = 'clair'; }
  if (weatherState !== before) broadcast({ type: 'weather_change', state: weatherState });
}
setInterval(weatherTick, 90000);

// Heure de jeu actuelle (0-24, fractionnaire) et phase correspondante.
function getGameHour() {
  const elapsed = (Date.now() - SERVER_START_MS) % DAY_LENGTH_MS;
  return (elapsed / DAY_LENGTH_MS) * 24;
}
function getDayPhase(hour) {
  if (hour >= 5 && hour < 7) return 'aube';
  if (hour >= 7 && hour < 18) return 'jour';
  if (hour >= 18 && hour < 20) return 'crepuscule';
  return 'nuit';
}
let dayPhase = getDayPhase(getGameHour());
// Vérifié chaque minute réelle (largement assez fin, la phase la plus
// courte — l'aube ou le crépuscule — dure 2h en jeu, soit 5 minutes
// réelles) : ne diffuse qu'au changement de PHASE, pas à chaque minute.
function dayNightTick() {
  const hour = getGameHour();
  const phase = getDayPhase(hour);
  if (phase !== dayPhase) {
    dayPhase = phase;
    broadcast({ type: 'daynight_change', phase, hour });
  }
}
setInterval(dayNightTick, 60000);

// Retire _ownerAccount (voir world_edit / house_owner plus bas) des éditions
// envoyées aux clients — champ de vérification interne au serveur, jamais
// censé faire partie du protocole que le client lit. Note : ce n'est pas
// une fuite de vie privée en soi (publicState ci-dessous diffuse déjà
// accountUsername pour chaque joueur à tout le monde), juste de l'hygiène
// de protocole.
function publicWorldEdits(edits) {
  return (edits || []).map(e => (e.payload && e.payload._ownerAccount)
    ? { op: e.op, payload: { ...e.payload, _ownerAccount: undefined } }
    : e);
}

function publicState(p) {
  return {
    id: p.id, firstName: p.firstName, lastName: p.lastName, gender: p.gender,
    x: p.x, y: p.y, heading: p.heading, health: p.health, hunger: p.hunger, thirst: p.thirst, role: p.role, policeRank: p.policeRank,
    outfit: p.outfit, inVehicle: p.inVehicle, vehicleName: p.vehicleName, vehicleType: p.vehicleType, vehicleSpeedRatio: p.vehicleSpeedRatio,
    talkieOn: p.talkieOn, talkieFrequency: p.talkieFrequency, voiceOpen: p.voiceOpen, handsUp: p.handsUp,
    convoy: p.convoy || null,
    unconscious: !!p.unconscious, isCuffed: !!p.isCuffed, accountUsername: p.accountUsername || null,
    stuckInVehicle: !!p.stuckInVehicle,
  };
}

function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }
// Anti-spam générique par joueur et par catégorie d'action (ex. dons
// d'argent, signalements) : borne l'ampleur d'un abus automatisé en
// attendant une vraie autorité serveur sur ces systèmes. Retourne true si
// l'action doit être BLOQUÉE (trop rapprochée de la précédente du même type).
function isRateLimited(player, key, ms) {
  player._rateLimits = player._rateLimits || {};
  const now = Date.now();
  if (now - (player._rateLimits[key] || 0) < ms) return true;
  player._rateLimits[key] = now;
  return false;
}

// Solde "au mieux" pour give_money/give_ammo (voir plus bas) : le serveur
// n'a pas d'autorité complète sur l'argent/l'inventaire (chantier plus large,
// non fait ici), mais peut au moins mémoriser le dernier solde connu du
// compte authentifié (rafraîchi à la connexion et à chaque save_progress —
// autosave client toutes les 60 s, voir js/menus-and-ui.js) pour repérer un
// don manifestement forgé (donner des dizaines de millions alors que la
// dernière sauvegarde connue montre un compte à sec). Volontairement permissif
// (marges ci-dessous) pour ne jamais bloquer un don légitime juste après un
// gros gain (mission, vente...) que la sauvegarde périodique n'a pas encore
// eu le temps de rattraper.
function cacheEconomyFromSaveData(player, saveData) {
  if (!saveData || typeof saveData !== 'object') return;
  if (typeof saveData.money === 'number' && Number.isFinite(saveData.money)) player.cachedMoney = saveData.money;
  if (typeof saveData.dirtyMoney === 'number' && Number.isFinite(saveData.dirtyMoney)) player.cachedDirtyMoney = saveData.dirtyMoney;
  if (saveData.ammoReserve && typeof saveData.ammoReserve === 'object') player.cachedAmmoReserve = saveData.ammoReserve;
}

// Récompense MAX de référence par type de mission (voir js/city.js
// generateMissions — quand un type apparaît plusieurs fois avec des
// récompenses différentes, la plus haute est prise ici pour ne jamais
// flaguer un gain légitime). Le serveur ne suit PAS l'état des missions
// (chantier bien plus vaste : il faudrait reproduire toute la logique de
// chaque type de mission côté serveur pour calculer un montant exact —
// hors scope ici). Ce qu'il PEUT faire sans ça : comparer chaque
// récompense réclamée (voir mission_reward_claim plus bas) à un plafond
// plausible dérivé de ce catalogue, et journaliser (visible au staff) tout
// écart flagrant — mieux qu'une confiance aveugle totale, sans risquer de
// casser une seule mission en tentant de revalider leur logique complète.
const MISSION_BASE_REWARDS = {
  transport: 100000, convoyage: 90000, colis_fragile: 20000, taxi_soigne: 30000,
  objet_perdu: 15000, filature: 45000, escorte: 130000, contrebande: 100000,
  urgence_medicale: 55000, course_clandestine: 70000, sabotage: 110000, chasse_primes: 95000,
  defense_territoire: 250000, casse_extreme: 350000, convoi_blinde: 300000,
  depot_armes_gang: 320000, extraction_vip: 290000, braquage_superette: 60000,
  gofast: 220000, planque_gardee: 240000, recel_vehicule: 150000,
  race: 80000, police: 85000, mine: 90000, combat: 150000, trade: 70000,
  medical: 40000, air: 120000, heist: 300000, hunt: 110000,
  taxi: 50000, fishing: 25000, repair: 20000,
};
// Marge généreuse au-delà du plafond catalogue : couvre tous les bonus déjà
// présents dans le code (lootMultiplier du braquage ×1, variance aléatoire
// jusqu'à +150 000 sur certaines missions extrêmes...) sans jamais flaguer
// un gain légitime. Un type de mission inconnu (absent du catalogue
// ci-dessus) retombe sur un plafond générique prudent.
function maxPlausibleMissionReward(missionType) {
  const base = MISSION_BASE_REWARDS[missionType];
  return (base ? base * 2 : 250000) + 300000;
}

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
        grantOwnerStaffIfEligible(ws, player, username, accountsData.accounts[username]);
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
      if (account.status === 'rejected') {
        send(ws, { type: 'login_result', ok: false, reason: 'Votre demande de compte a été refusée par l\'administrateur.' });
        return;
      }
      player.accountUsername = username;
      // Restaure le rôle/grade policier depuis la DERNIÈRE sauvegarde du
      // compte authentifié — seul point de confiance légitime maintenant que
      // 'state' ne les accepte plus du client à chaque envoi (voir plus
      // haut) : le rôle a déjà été validé par staff_grant_job/promote_police
      // avant d'être sauvegardé, on peut donc le restaurer sans revalider.
      if (account.saveData) {
        // Whitelist (audit métiers/staff, item 3+10) : le commentaire
        // ci-dessus supposait que ce rôle avait forcément été validé par
        // staff_grant_job — faux dès qu'un compte staff a utilisé « Tester
        // un métier » (Roles.set() direct côté client, jamais passé par le
        // serveur) et sauvegardé pendant le test. Un rôle absent de la
        // whitelist retombe sur citoyen plutôt que d'être restauré tel quel.
        if (typeof account.saveData.role === 'string') {
          if (VALID_JOB_ROLES.has(account.saveData.role)) player.role = account.saveData.role;
          else if (account.saveData.role !== 'citoyen') console.warn(`[compte] rôle sauvegardé invalide ignoré (« ${account.saveData.role} ») pour ${username}, retombe sur citoyen.`);
        }
        if (typeof account.saveData.policeRank === 'string' || account.saveData.policeRank === null) player.policeRank = account.saveData.policeRank;
      }
      cacheEconomyFromSaveData(player, account.saveData);
      send(ws, { type: 'login_result', ok: true, username, saveData: account.saveData || null });
      console.log(`[compte] Connexion : ${username}`);
      grantOwnerStaffIfEligible(ws, player, username, account);
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
      // Garde-fou de PLAUSIBILITÉ minimal (pas un schéma complet — le client
      // reste autoritaire sur le détail de l'inventaire/des véhicules pour
      // l'instant) : on rejette juste ce qui est manifestement aberrant, pour
      // qu'un blob forgé ne s'installe pas silencieusement comme "vraie"
      // sauvegarde du compte.
      const data = msg.data;
      if (!data || typeof data !== 'object') return;
      let size = 0;
      try { size = JSON.stringify(data).length; } catch (e) { return; }
      if (size > 2_000_000) { // ~2 Mo : très généreux pour une sauvegarde de personnage, bloque un abus de stockage
        console.warn(`[save_progress] rejeté (taille ${size} octets) pour ${player.accountUsername}`);
        return;
      }
      const MAX_PLAUSIBLE_MONEY = 10_000_000_000; // 10 milliards : au-delà, manifestement forgé
      for (const field of ['money', 'dirtyMoney']) {
        if (typeof data[field] === 'number' && (data[field] < 0 || data[field] > MAX_PLAUSIBLE_MONEY || !Number.isFinite(data[field]))) {
          console.warn(`[save_progress] rejeté (${field}=${data[field]}) pour ${player.accountUsername}`);
          return;
        }
      }
      // Whitelist du rôle sauvegardé (audit métiers/staff, item 3+10) :
      // sans ça, un rôle inventé (ou un test staff jamais désactivé, voir
      // « Tester un métier ») s'installait tel quel dans le compte, prêt à
      // être restauré tel quel à la prochaine connexion (voir plus haut).
      if (typeof data.role === 'string' && data.role !== 'citoyen' && !VALID_JOB_ROLES.has(data.role)) {
        console.warn(`[save_progress] rejeté (role=« ${data.role} » inconnu) pour ${player.accountUsername}`);
        return;
      }
      account.saveData = data;
      account.lastSaveAt = Date.now();
      cacheEconomyFromSaveData(player, data);
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
    else if (msg.type === 'job_request') {
      // Candidature de métier : mise en file d'attente ET diffusée aux admins,
      // qui pourront la lister et l'approuver (voir staff_list_job_requests).
      // Whitelist (audit métiers/staff, item 3) : un rôle absent de la liste
      // (ex. "admin", ou n'importe quelle chaîne inventée) est refusé net —
      // avant, seule safeName() filtrait, aucune vérification contre les
      // vrais métiers du jeu.
      const role = safeName(msg.role, '', 40);
      if (!VALID_JOB_ROLES.has(role)) { send(ws, { type: 'staff_error', text: 'Métier inconnu ou invalide.' }); return; }
      const roleName = safeName(msg.roleName, '', 60) || role;
      // Signale explicitement le remplacement d'une candidature déjà en
      // attente (audit métiers/staff, item 14) : avant, la nouvelle écrasait
      // l'ancienne en silence côté serveur, sans que le joueur ne le sache.
      if (jobRequests.has(player.id)) {
        const old = jobRequests.get(player.id);
        send(ws, { type: 'job_request_replaced', oldRoleName: old.roleName, newRoleName: roleName });
      }
      jobRequests.set(player.id, { id: player.id, name: `${player.firstName} ${player.lastName}`, role, roleName, time: Date.now() });
      broadcastStaffLog(`${player.firstName} ${player.lastName} demande le métier « ${roleName} ».`);
      // Le journal staff (staff_log) est stocké silencieusement côté client,
      // jamais annoncé vocalement : une candidature en attente passait donc
      // complètement inaperçue tant qu'un admin n'allait pas consulter le
      // journal de lui-même. Alerte dédiée, annoncée immédiatement.
      for (const p of players.values()) {
        if (p.staffRole) send(p.ws, { type: 'staff_job_request_alert', name: `${player.firstName} ${player.lastName}`, roleName });
      }
    }
    else if (msg.type === 'staff_list_job_requests') {
      // Ouvert aussi aux recruteurs (audit métiers/staff, item 7), mais
      // filtré aux seuls métiers pour lesquels ils ont été nommés — un
      // recruteur ne voit ni ne peut traiter les candidatures des autres
      // métiers, contrairement au staff qui voit tout.
      const myRecruiterRoles = player.accountUsername
        ? Object.keys(staffData.recruiters || {}).filter(r => (staffData.recruiters[r] || []).includes(player.accountUsername))
        : [];
      if (!player.staffRole && !myRecruiterRoles.length) { send(ws, { type: 'staff_error', text: 'Réservé au staff ou à un recruteur habilité.' }); return; }
      // Seules les demandes de joueurs encore connectés.
      let list = [...jobRequests.values()].filter(r => players.has(r.id));
      if (!player.staffRole) list = list.filter(r => myRecruiterRoles.includes(r.role));
      send(ws, { type: 'staff_job_requests', requests: list });
    }
    else if (msg.type === 'staff_grant_job' || msg.type === 'recruiter_grant_job') {
      const isRecruiterPath = msg.type === 'recruiter_grant_job';
      const req = jobRequests.get(msg.targetId);
      // Un recruteur ne peut valider QUE les demandes du métier pour lequel
      // il a été nommé (audit métiers/staff, item 7) — vérifié contre la
      // liste persistée staffData.recruiters, remplie uniquement par
      // appoint_recruiter (désormais réservé au staff, voir plus bas).
      if (isRecruiterPath) {
        const recruiterRole = req && req.role;
        const list = recruiterRole && staffData.recruiters && staffData.recruiters[recruiterRole];
        if (!player.accountUsername || !list || !list.includes(player.accountUsername)) {
          send(ws, { type: 'staff_error', text: 'Vous n\'êtes pas recruteur pour ce métier.' }); return;
        }
      } else if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const target = players.get(msg.targetId);
      jobRequests.delete(msg.targetId);
      if (!target || !req) { send(ws, { type: 'staff_error', text: 'Demande introuvable (joueur déconnecté ?).' }); return; }
      // Re-validation whitelist (défense en profondeur, audit item 3) : la
      // demande a déjà été filtrée à job_request, mais rien ne garantit
      // qu'une ancienne demande stockée avant ce correctif reste valide.
      if (!VALID_JOB_ROLES.has(req.role)) { send(ws, { type: 'staff_error', text: 'Métier invalide, demande ignorée.' }); return; }
      const byName = `${player.firstName} ${player.lastName}`;
      if (msg.approve) {
        target.role = req.role;
        // Grade de base posé côté serveur à l'embauche (audit métiers/staff,
        // item 8) : avant, seul le client posait 'agent' localement (voir
        // Roles.set), le serveur ne connaissait le grade réel que plus tard,
        // via une éventuelle promotion — désynchro possible entre-temps.
        if (req.role === 'police' && !target.policeRank) target.policeRank = 'agent';
        send(target.ws, { type: 'job_granted', role: req.role, roleName: req.roleName, policeRank: target.policeRank, byName });
      } else {
        send(target.ws, { type: 'job_rejected', roleName: req.roleName, byName });
      }
      send(ws, { type: 'staff_job_review_result', name: req.name, roleName: req.roleName, approved: !!msg.approve });
      broadcastStaffLog(`${byName} a ${msg.approve ? 'accordé' : 'refusé'} le métier « ${req.roleName} » à ${req.name}${isRecruiterPath ? ' (recruteur)' : ''}.`);
    }

    // Révocation de métier : jusqu'ici, staff_grant_job permettait
    // d'ACCORDER un métier mais rien ne permettait de le RETIRER une fois
    // attribué (audit structurel — trouvé aucune trace de révocation dans
    // tout le code, client ou serveur). Réservé au staff, symétrique à
    // staff_grant_job.
    else if (msg.type === 'staff_revoke_job') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) { send(ws, { type: 'staff_error', text: 'Joueur introuvable (déconnecté ?).' }); return; }
      if (!target.role || target.role === 'citoyen') { send(ws, { type: 'staff_error', text: 'Ce joueur n\'a déjà aucun métier.' }); return; }
      const oldRole = target.role;
      target.role = 'citoyen';
      target.policeRank = null;
      send(target.ws, { type: 'job_revoked', oldRole, byName: `${player.firstName} ${player.lastName}` });
      send(ws, { type: 'staff_job_review_result', name: `${target.firstName} ${target.lastName}`, roleName: oldRole, revoked: true });
      broadcastStaffLog(`${player.firstName} ${player.lastName} a révoqué le métier de ${target.firstName} ${target.lastName} (était « ${oldRole} »).`);
    }
    // Démission volontaire (audit métiers/staff, item 12) : le joueur redevient
    // citoyen de son propre chef, sans intervention staff — juste la mise à
    // jour de l'état autoritaire côté serveur, le client s'est déjà mis à
    // jour localement (voir Roles.resign).
    else if (msg.type === 'staff_self_resign') {
      if (player.role && player.role !== 'citoyen') {
        const oldRole = player.role;
        player.role = 'citoyen'; player.policeRank = null;
        broadcastStaffLog(`${player.firstName} ${player.lastName} démissionne de son métier (était « ${oldRole} »).`);
      }
    }
    // Le staff demande à voir ce qu'un joueur connecté possède (inventaire,
    // véhicules, argent) : le serveur ne stocke pas ces données lui-même (le
    // jeu est côté client pour l'inventaire), donc il relaie la demande au
    // client visé, qui répond directement avec son propre état.
    else if (msg.type === 'staff_inspect_request') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) { send(ws, { type: 'staff_error', text: 'Joueur introuvable (déconnecté ?).' }); return; }
      send(target.ws, { type: 'staff_inspect_query', requesterId: id });
    }
    else if (msg.type === 'staff_inspect_response') {
      const requester = players.get(msg.requesterId);
      if (!requester) return;
      send(requester.ws, { type: 'staff_inspect_result', targetId: id, name: `${player.firstName} ${player.lastName}`, data: msg.data });
    }
    else if (msg.type === 'appoint_recruiter') {
      // Réservé au staff (audit métiers/staff, item 1 — CONFIRMÉ ouvert à
      // tout client connecté jusqu'ici) : n'importe qui pouvait se nommer
      // (ou nommer un complice) recruteur pour n'importe quel métier.
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au mode staff.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) return;
      const role = safeName(msg.role, '', 40);
      if (!VALID_JOB_ROLES.has(role)) { send(ws, { type: 'staff_error', text: 'Métier inconnu ou invalide.' }); return; }
      if (!target.accountUsername) { send(ws, { type: 'staff_error', text: 'Ce joueur doit être connecté avec un compte pour être nommé recruteur.' }); return; }
      const roleName = safeName(msg.roleName, '', 60) || role;
      // Persisté (audit métiers/staff, item 8) : sans ça, un recruteur
      // « nommé » ne pouvait de toute façon rien valider réellement, faute
      // d'existence côté serveur (voir recruiter_grant_job, plus haut).
      staffData.recruiters = staffData.recruiters || {};
      staffData.recruiters[role] = staffData.recruiters[role] || [];
      if (!staffData.recruiters[role].includes(target.accountUsername)) staffData.recruiters[role].push(target.accountUsername);
      saveStaffData();
      send(target.ws, { type: 'recruiter_appointed', role, roleName, byName: `${player.firstName} ${player.lastName}` });
      broadcastStaffLog(`${player.firstName} ${player.lastName} nomme ${target.firstName} ${target.lastName} recruteur pour « ${roleName} ».`);
    }
    else if (msg.type === 'promote_police') {
      // Règle déjà affichée aux joueurs côté client (Game.openPoliceHierarchyMenu,
      // js/police-and-startup.js) mais jamais vérifiée ici : seul un CHEF de
      // la police (OU le staff, audit métiers/staff item 5 — le client
      // autorisait déjà StaffMode.active, le serveur non, d'où un échec
      // silencieux pour un admin non-chef) peut promouvoir, jamais soi-même.
      if (player.policeRank !== 'chef' && !player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au chef de la police ou au staff.' }); return; }
      const target = players.get(msg.targetId);
      if (!target || target.id === player.id || target.role !== 'police') return;
      const rank = safeName(msg.rank, '', 20);
      if (!POLICE_RANK_IDS.has(rank)) { send(ws, { type: 'staff_error', text: 'Grade invalide.' }); return; }
      target.policeRank = rank;
      send(target.ws, { type: 'police_promoted', rank, byName: `${player.firstName} ${player.lastName}` });
      broadcastStaffLog(`${player.firstName} ${player.lastName} nomme ${target.firstName} ${target.lastName} : ${rank}.`);
    }

    else if (msg.type === 'player_treated') {
      const target = players.get(msg.targetId);
      if (!target) return;
      // Proximité réelle exigée : un soin ne peut pas se faire à distance.
      if (dist(player, target) > 6) return;
      const gain = Math.max(0, Math.min(100, parseInt(msg.healthGain, 10) || 0));
      send(target.ws, { type: 'player_treated', healthGain: gain, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'give_ammo') {
      // Anti-spam : en attendant une vraie autorité serveur sur l'inventaire
      // (relais pur pour l'instant, voir save_progress), au moins limiter le
      // débit d'un abus automatisé.
      if (isRateLimited(player, 'give_ammo', 1000)) return;
      const target = players.get(msg.targetId);
      if (!target) return;
      const qty = Math.max(1, Math.min(10000, parseInt(msg.qty, 10) || 0));
      const ammoType = safeName(msg.ammoType, '', 20);
      // Plausibilité contre le dernier solde CONNU (voir cacheEconomyFromSaveData) :
      // le client a déjà décompté sa propre réserve en local avant d'envoyer
      // ce message (optimiste), donc un refus doit le lui rendre — d'où
      // 'give_ammo_denied' plutôt qu'un rejet silencieux qui ferait
      // simplement disparaître les munitions chez l'expéditeur sans jamais
      // arriver chez personne.
      const AMMO_GIVE_BUFFER = 300; // marge généreuse : sauvegarde toutes les 60 s, ne doit jamais bloquer un don légitime juste après un gain récent
      const known = (player.cachedAmmoReserve && player.cachedAmmoReserve[ammoType]) || 0;
      if (qty > known + AMMO_GIVE_BUFFER) {
        send(ws, { type: 'give_ammo_denied', targetId: msg.targetId, ammoType, qty });
        return;
      }
      send(target.ws, { type: 'ammo_received', fromName: `${player.firstName} ${player.lastName}`, ammoType, qty });
    }

    else if (msg.type === 'toggle_cuffs') {
      // Réservé à la police (audit métiers/staff, item 4 — CONFIRMÉ non
      // vérifié jusqu'ici, contrairement à toggle_jail juste en dessous qui,
      // lui, vérifiait déjà le rôle) : un citoyen pouvait menotter n'importe
      // qui d'autre en multijoueur.
      if (player.role !== 'police') { send(ws, { type: 'staff_error', text: 'Réservé à la police.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) return;
      // Proximité réelle exigée : impossible de menotter quelqu'un à distance.
      if (dist(player, target) > 6) return;
      send(target.ws, { type: 'you_are_cuffed', cuffed: !!msg.cuffed, byName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'toggle_jail') {
      // Règle déjà affichée côté client (Roles.hasPerm('cni'), voir
      // Game.toggleJail dans js/police-and-startup.js) mais jamais vérifiée
      // ici : réservé aux policiers.
      if (player.role !== 'police') { send(ws, { type: 'staff_error', text: 'Réservé à la police.' }); return; }
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'you_are_jailed', jailed: !!msg.jailed, byName: msg.byName || `${player.firstName} ${player.lastName}` });
    }

    // Récompense de mission réclamée par le client : purement informatif,
    // n'affecte JAMAIS le crédit local (déjà fait côté client, voir
    // Game.reportMissionReward) — le serveur ne suit pas l'état des
    // missions, il ne peut donc pas revalider la logique exacte de chacune
    // sans un chantier bien plus vaste (hors scope). Ce qu'il fait : compare
    // au plafond plausible dérivé du catalogue et journalise (staff) tout
    // écart flagrant, pour au moins avoir une trace au lieu d'une confiance
    // aveugle totale sur l'économie des missions.
    else if (msg.type === 'mission_reward_claim') {
      const amount = Math.max(0, Math.round(Number(msg.amount) || 0));
      const missionType = safeName(msg.missionType, '', 40);
      const maxPlausible = maxPlausibleMissionReward(missionType);
      if (amount > maxPlausible) {
        broadcastStaffLog(`⚠️ ${player.firstName} ${player.lastName} réclame ${amount} FCFA pour une mission « ${missionType || '?'} » (plafond plausible ${maxPlausible}) — à vérifier.`);
      }
    }

    else if (msg.type === 'give_money') {
      // Anti-spam : en attendant une vraie autorité serveur sur les soldes
      // (relais pur pour l'instant), au moins limiter le débit d'un abus
      // automatisé — un don légitime de main à main n'a jamais besoin de se
      // répéter plusieurs fois par seconde.
      if (isRateLimited(player, 'give_money', 1000)) return;
      const target = players.get(msg.targetId);
      if (!target) return;
      const amount = Math.max(1, Math.min(50000000, parseInt(msg.amount, 10) || 0));
      // Plausibilité contre le dernier solde CONNU (dernière save_progress ou
      // connexion, voir cacheEconomyFromSaveData) : n'empêche pas un
      // tricheur déterminé de forger UNE sauvegarde gonflée au préalable
      // (chantier d'autorité complète plus large, pas fait ici), mais bloque
      // le cas le plus grossier — un compte manifestement à sec qui tente de
      // faire apparaître des dizaines de millions chez un complice. Marge
      // généreuse (2 M) pour ne jamais bloquer un don légitime juste après un
      // gros gain (mission, vente...) que l'autosave (60 s) n'a pas encore eu
      // le temps de rattraper. Le client a déjà décompté localement avant
      // d'envoyer (optimiste) : un refus doit le lui rendre, d'où
      // 'give_money_denied' plutôt qu'un rejet silencieux.
      const MONEY_GIVE_BUFFER = 2_000_000;
      const known = player.cachedMoney || 0;
      if (amount > known + MONEY_GIVE_BUFFER) {
        send(ws, { type: 'give_money_denied', targetId: msg.targetId, amount });
        return;
      }
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

    // Vente maison/véhicule entre deux vrais joueurs : bug trouvé en creusant
    // l'économie (audit structurel) — l'acheteur payait bien (déduit en
    // local avant l'envoi de sa réponse), mais le VENDEUR ne recevait
    // jamais l'argent : seul un message "vente conclue" s'affichait chez
    // lui, sans le moindre crédit. Le serveur mémorise maintenant le prix
    // NÉGOCIÉ (déjà plausibilisé ci-dessous, borne à 500 millions) au moment
    // de l'offre, et paie réellement le vendeur — via le même message
    // 'money_received' que give_money, déjà géré côté client — dès que
    // l'acheteur confirme avoir accepté. Le prix utilisé pour payer vient de
    // cet enregistrement serveur, jamais d'une valeur reforgeable à l'étape
    // de la réponse.
    else if (msg.type === 'house_sale_offer') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const price = Math.max(1, Math.min(500000000, parseInt(msg.price, 10) || 0));
      pendingSales.set(`house:${id}:${msg.targetId}`, { price, at: Date.now() });
      send(target.ws, { type: 'house_sale_offer', fromId: id, fromName: `${player.firstName} ${player.lastName}`, houseId: msg.houseId, houseName: safeName(msg.houseName, 'une maison', 60), price });
    }

    else if (msg.type === 'house_sale_response') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'house_sale_response', accepted: !!msg.accepted, houseId: msg.houseId, byName: `${player.firstName} ${player.lastName}` });
      const saleKey = `house:${msg.targetId}:${id}`; // targetId = vendeur (offreur d'origine), id = acheteur (répond ici)
      const pending = pendingSales.get(saleKey);
      pendingSales.delete(saleKey);
      if (msg.accepted && pending && Date.now() - pending.at < 10 * 60 * 1000) {
        send(target.ws, { type: 'money_received', fromName: `${player.firstName} ${player.lastName}`, amount: pending.price });
      }
    }

    else if (msg.type === 'vehicle_sale_offer') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const price = Math.max(1, Math.min(500000000, parseInt(msg.price, 10) || 0));
      pendingSales.set(`vehicle:${id}:${msg.targetId}`, { price, at: Date.now() });
      send(target.ws, { type: 'vehicle_sale_offer', fromId: id, fromName: `${player.firstName} ${player.lastName}`, vehicleType: safeName(msg.vehicleType, '', 40), vehicleName: safeName(msg.vehicleName, 'un véhicule', 60), price });
    }

    else if (msg.type === 'vehicle_sale_response') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'vehicle_sale_response', accepted: !!msg.accepted, byName: `${player.firstName} ${player.lastName}` });
      const saleKey = `vehicle:${msg.targetId}:${id}`;
      const pending = pendingSales.get(saleKey);
      pendingSales.delete(saleKey);
      if (msg.accepted && pending && Date.now() - pending.at < 10 * 60 * 1000) {
        send(target.ws, { type: 'money_received', fromName: `${player.firstName} ${player.lastName}`, amount: pending.price });
      }
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
      // Anti-spam : un client modifié ne peut pas contourner son propre
      // cooldown d'arme pour infliger des dégâts en rafale bien plus vite
      // qu'aucune arme du jeu ne le permet.
      const now = Date.now();
      if (now - (player._lastHitAt || 0) < MIN_HIT_INTERVAL_MS) return;
      player._lastHitAt = now;
      // Portée : empêche un tir depuis l'autre bout de la carte (le serveur
      // connaît la dernière position connue des deux joueurs via 'state').
      if (dist(player, target) > MAX_HIT_RANGE) return;
      const headshot = !!msg.headshot;
      const cap = headshot ? MAX_HEADSHOT_DAMAGE : MAX_HIT_DAMAGE;
      const damage = Math.max(0, Math.min(cap, parseInt(msg.damage, 10) || 0));
      send(target.ws, { type: 'player_hit', damage, headshot, fromId: player.id, fromName: `${player.firstName} ${player.lastName}` });
    }

    else if (msg.type === 'player_punch') {
      const target = players.get(msg.targetId);
      if (!target) return;
      const now = Date.now();
      if (now - (player._lastHitAt || 0) < MIN_HIT_INTERVAL_MS) return;
      player._lastHitAt = now;
      if (dist(player, target) > MAX_HIT_RANGE) return;
      const damage = Math.max(0, Math.min(MAX_PUNCH_DAMAGE, parseInt(msg.damage, 10) || 0));
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
        type: 'welcome', id, seed: WORLD_SEED, weather: weatherState, dayPhase, gameHour: getGameHour(),
        players: Array.from(players.values()).filter(p => p.id !== id && p.joined).map(publicState),
        cityEdits: staffData.cityEdits || [],
        worldEdits: publicWorldEdits(staffData.worldEdits),
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
      // Santé : simple borne de plausibilité (0-100). Le client reste
      // AUTORITAIRE sur sa propre santé pour l'instant (voir takeDamage côté
      // client) — une vraie autorité serveur sur les PV est un chantier
      // séparé, plus gros ; ici on empêche juste une valeur absurde
      // (négative ou hors barème) de se propager aux autres joueurs.
      if (typeof msg.health === 'number' && Number.isFinite(msg.health)) player.health = Math.max(0, Math.min(100, msg.health));
      if (typeof msg.hunger === 'number') player.hunger = msg.hunger;
      if (typeof msg.thirst === 'number') player.thirst = msg.thirst;
      // Rôle et grade policier : PLUS acceptés depuis ce message. Un client
      // modifié pouvait auparavant s'auto-déclarer n'importe quel métier ou
      // grade et être vu comme tel par tous les autres joueurs (ce même
      // champ, une fois stocké ici, est diffusé tel quel via le tick
      // "world", voir publicState()). Le rôle et le grade ne sont désormais
      // modifiables QUE via les handlers déjà validés : staff_grant_job
      // (staff) et promote_police (chef de police ou staff).
      if (msg.outfit && typeof msg.outfit === 'object') player.outfit = msg.outfit;
      if (typeof msg.inVehicle === 'boolean') {
        if (msg.inVehicle !== player.inVehicle) broadcastStaffLog(`${player.firstName} ${player.lastName} ${msg.inVehicle ? 'monte dans' : 'sort de'} ${msg.vehicleName || 'un véhicule'}.`);
        player.inVehicle = msg.inVehicle;
      }
      if (msg.vehicleName !== undefined) player.vehicleName = msg.vehicleName;
      if (msg.vehicleType !== undefined) player.vehicleType = msg.vehicleType;
      if (typeof msg.vehicleSpeedRatio === 'number') player.vehicleSpeedRatio = msg.vehicleSpeedRatio;
      if (typeof msg.talkieOn === 'boolean') player.talkieOn = msg.talkieOn;
      if (typeof msg.talkieFrequency === 'number') player.talkieFrequency = msg.talkieFrequency;
      if (typeof msg.airplane === 'boolean') player.airplane = msg.airplane;
      if (typeof msg.voiceOpen === 'boolean') player.voiceOpen = msg.voiceOpen;
      if (typeof msg.handsUp === 'boolean') player.handsUp = msg.handsUp;
      if (typeof msg.unconscious === 'boolean') player.unconscious = msg.unconscious;
      if (typeof msg.isCuffed === 'boolean') player.isCuffed = msg.isCuffed;
      if (typeof msg.stuckInVehicle === 'boolean') player.stuckInVehicle = msg.stuckInVehicle;
      if (typeof msg.convoy === 'string' || msg.convoy === null) player.convoy = msg.convoy ? String(msg.convoy).slice(0, 6) : null;
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

    // RP libre ("/me") : décrit une ACTION du personnage plutôt qu'une
    // réplique parlée (voir 'chat' juste au-dessus, même portée de diffusion).
    else if (msg.type === 'rp_action') {
      const text = safeName(msg.text, '', 300);
      if (!text) return;
      for (const other of players.values()) {
        if (other.id === id || !other.joined) continue;
        if (dist(player, other) <= CHAT_RADIUS) {
          send(other.ws, { type: 'rp_action', fromId: id, fromName: `${player.firstName} ${player.lastName}`, text });
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
      if (call.callerId !== id && call.targetId !== id) return; // pas un participant de cet appel
      clearTimeout(call.timeout); call.status = 'active';
      const caller = players.get(call.callerId);
      if (caller) send(caller.ws, { type: 'call_answered', callId: call.callId, byId: id, byName: `${player.firstName} ${player.lastName}` });
      send(ws, { type: 'call_answered', callId: call.callId, byId: call.callerId });
    }

    else if (msg.type === 'call_decline') {
      const call = calls.get(msg.callId);
      if (!call) return;
      if (call.callerId !== id && call.targetId !== id) return; // pas un participant de cet appel
      clearTimeout(call.timeout); calls.delete(call.callId);
      const caller = players.get(call.callerId);
      if (caller) send(caller.ws, { type: 'call_declined', callId: call.callId });
    }

    else if (msg.type === 'call_end') {
      const call = calls.get(msg.callId);
      if (!call) return;
      if (call.callerId !== id && call.targetId !== id) return; // pas un participant de cet appel
      clearTimeout(call.timeout); calls.delete(call.callId);
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'call_ended', callId: call.callId });
    }

    else if (msg.type === 'call_message') {
      const call = calls.get(msg.callId);
      if (!call || call.status !== 'active') return;
      if (call.callerId !== id && call.targetId !== id) return; // pas un participant de cet appel
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'call_message', callId: call.callId, fromId: id, fromName: safeName(msg.fromLabel, `${player.firstName} ${player.lastName}`, 40), text: safeName(msg.text, '', 300) });
    }

    else if (msg.type === 'crime_report') {
      const reporter = players.get(id);
      if (!reporter) return;
      // Anti-spam : un signalement légitime n'a jamais besoin de se répéter
      // plusieurs fois par seconde vers toute la police.
      if (isRateLimited(reporter, 'crime_report', 1000)) return;
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
      // Propriétaire : accès principal accordé sans vérifier le code — il n'a
      // jamais besoin de saisir de code, même pour réactiver après un Ctrl+A.
      if (isOwnerAccount(player.accountUsername, accountsData.accounts[player.accountUsername])) {
        player.staffRole = 'principal';
        send(ws, { type: 'staff_auth_result', ok: true, staffRole: 'principal', auto: true });
        broadcastStaffLog(`${player.firstName} ${player.lastName} (propriétaire) a activé le mode administrateur principal.`);
      } else if (code && code === staffData.codes.principal) {
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
      if (staffData.cityEdits.length > 500) staffData.cityEdits.splice(0, staffData.cityEdits.length - 500);
      saveStaffData();
      broadcastStaffLog(`${player.firstName} ${player.lastName} a modifié la ville : ${msg.op}.`);
      for (const p of players.values()) send(p.ws, { type: 'city_edit', op: edit.op, payload: edit.payload });
    }

    else if (msg.type === 'world_edit') {
      if (!player.joined) return;
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object') return;
      // Achat de véhicule/maison, stationnement... : action de jeu normale,
      // donc accessible à tout joueur connecté (pas réservé au staff).
      // Plausibilisation minimale des valeurs d'un véhicule partagé : sans
      // ça, un 'vehicle_position' forgé pouvait annoncer n'importe quel
      // carburant/état à tous les autres joueurs (ex. hp: 999999).
      if (msg.op === 'vehicle_position') {
        if (typeof payload.fuel === 'number') payload.fuel = Math.max(0, Math.min(1, payload.fuel));
        if (typeof payload.hp === 'number') payload.hp = Math.max(0, Math.min(100, payload.hp));
      }
      // Propriété des maisons : owner: 'player' est une chaîne générique
      // (voir js/game-interiors-economy.js), le serveur ne peut donc PAS s'y
      // fier pour savoir QUI possède réellement la maison — 'house_owner'
      // reste ouvert à tout joueur connecté (achat normal ET revente
      // légitime entre deux vrais joueurs via house_sale_offer/response,
      // voir js/network.js) : le serveur ne PEUT pas distinguer un achat
      // légitime d'une usurpation à partir de ce seul message. Mais il
      // mémorise systématiquement l'identité RÉELLE de la connexion
      // (player.accountUsername, jamais fournie par le payload) comme
      // "propriétaire actuel connu" sur l'édition elle-même (_ownerAccount,
      // champ ajouté ICI par le serveur, jamais lu depuis le client) — cette
      // valeur se met donc à jour correctement à chaque revente légitime.
      //
      // C'est 'house_keys' qui profite de cette identité fiable : avant,
      // n'IMPORTE quel joueur connecté pouvait renvoyer 'house_keys' avec sa
      // propre liste authorizedUsers pour une maison qu'il ne possède même
      // pas, s'accordant un accès permanent sans jamais l'avoir achetée ni
      // reçu les clés du vrai propriétaire. Réservé maintenant au
      // propriétaire connu, à l'agent immobilier (Roles.current ===
      // 'agent_immo', qui peut légitimement remettre les clés au nom du
      // propriétaire — même règle déjà appliquée côté client dans
      // Game.giveHouseKeys) ou au staff. Permissif si _ownerAccount n'est pas
      // encore connu (maison déjà possédée avant ce correctif) : impossible
      // de deviner rétroactivement qui en est le vrai propriétaire, donc pas
      // de rupture pour les joueurs déjà installés.
      if (msg.op === 'house_keys' && !player.staffRole && player.role !== 'agent_immo') {
        const existing = staffData.worldEdits.find(e => e.op === 'house_owner' && e.payload && e.payload.id === payload.id);
        const knownOwner = existing && existing.payload && existing.payload._ownerAccount;
        if (knownOwner && knownOwner !== player.accountUsername) {
          send(ws, { type: 'world_edit_denied', op: msg.op, id: payload.id });
          return;
        }
      }
      if (msg.op === 'house_owner' && player.accountUsername) payload._ownerAccount = player.accountUsername;
      const key = msg.op + ':' + payload.id;
      const idx = staffData.worldEdits.findIndex(e => (e.op + ':' + (e.payload && e.payload.id)) === key);
      const edit = { op: msg.op, payload };
      if (idx >= 0) staffData.worldEdits[idx] = edit; else staffData.worldEdits.push(edit);
      if (staffData.worldEdits.length > 3000) staffData.worldEdits.splice(0, staffData.worldEdits.length - 3000);
      saveStaffData();
      const [publicEdit] = publicWorldEdits([edit]);
      for (const p of players.values()) send(p.ws, { type: 'world_edit', op: publicEdit.op, payload: publicEdit.payload });
    }

    else if (msg.type === 'staff_list_bans') {
      if (!player.staffRole) { send(ws, { type: 'staff_error', text: 'Réservé au staff.' }); return; }
      send(ws, { type: 'staff_bans_list', bans: staffData.bans });
    }

    else if (msg.type === 'criminal_record_request' || msg.type === 'criminal_record_data') {
      // Consultation du casier judiciaire entre joueurs réels : simple relais,
      // comme pour la fouille — aucune donnée n'est stockée côté serveur.
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: msg.type, fromId: id, data: msg.data });
    }
    else if (msg.type === 'search_request' || msg.type === 'search_data' || msg.type === 'loot_take') {
      // Fouille entre joueurs réels : ne fonctionne que si la cible a les mains
      // levées (vérifié aussi côté serveur pour éviter tout contournement).
      const target = players.get(msg.targetId);
      if (!target) return;
      if (msg.type === 'search_request' && !target.handsUp) { send(ws, { type: 'search_denied' }); return; }
      send(target.ws, { type: msg.type, fromId: id, data: msg.data });
    }
    // Libère un joueur piégé dans un véhicule volé à un PNJ (voir
    // Game.stuckInVehicle côté client) : simple relais, comme la fouille — le
    // joueur bloqué reste seul maître de son propre état, on ne fait que le prévenir.
    else if (msg.type === 'free_from_vehicle') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'freed_from_vehicle', fromName: `${player.firstName} ${player.lastName}` });
    }
    // Alerte « vous êtes pris pour cible » (voir Game.target côté client) :
    // simple relais, comme la libération d'un véhicule — le joueur visé
    // décide lui-même comment réagir (fuir, riposter, se planquer).
    else if (msg.type === 'player_targeted') {
      const target = players.get(msg.targetId);
      if (!target) return;
      send(target.ws, { type: 'you_are_targeted', fromName: `${player.firstName} ${player.lastName}` });
    }
    else if (msg.type === 'voice_toggle') {
      const call = calls.get(msg.callId);
      if (!call || (call.callerId !== id && call.targetId !== id)) return;
      const other = players.get(call.callerId === id ? call.targetId : call.callerId);
      if (other) send(other.ws, { type: 'voice_toggle', callId: msg.callId, on: !!msg.on });
    }

    else if (msg.type === 'mesh_offer' || msg.type === 'mesh_answer' || msg.type === 'mesh_ice' || msg.type === 'mesh_reject') {
      // Signalisation WebRTC point-à-point générique, ciblée par joueur (pas liée à
      // un appel) : sert au micro de proximité et à la voix du talkie-walkie.
      // mesh_reject : réponse explicite quand le destinataire d'une offre ne
      // peut pas répondre (micro local indisponible) — sans ça l'offreur
      // restait bloqué en silence à attendre une réponse qui n'arrive jamais.
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
    jobRequests.delete(id);
    // Si ce joueur portait quelqu'un, le libérer : sinon la victime restait
    // bloquée « en cours de portage » pour toujours (le porteur n'existe plus).
    for (const p of players.values()) {
      if (p.carriedBy === id) { p.carriedBy = null; send(p.ws, { type: 'you_are_released', byName: `${player.firstName} ${player.lastName}`, atHospital: false }); }
    }
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
