const CONFIG = {
  W: 560, H: 560, // agrandie pour loger les villes lointaines Bobo-Dioulasso et Kongoussi (était 240×240, puis 420×420)
  METERS_PER_TILE: 4, // échelle officielle : 1 case = 4 mètres
  SCAN_RADIUS: 60,
  POCKET_CAPACITY: 15,
  BELT_BONUS: 6,
  BACKPACK_CAPACITY: 20,
  VEHICLE_CAPACITY: 30,
  HOUSE_CAPACITY: 80,
  WAREHOUSE_CAPACITY: 200,
  TRUCK_CAPACITY: 120,
  PASSENGER_CAPACITY: 8,
  BANK_CAPACITY: 10000000,
  DIRTY_LAUNDER_TAX: 0.15,
  NPC_COUNT: 160,
  HOUSE_COUNT: 120, // zone résidentielle pour 100+ personnes
  MISSION_COUNT: 38,
  GANG_COUNT: 5,
  MINING_SITES: 4,
  POLICE_STATIONS: 1, // un commissariat unique (l'admin peut en ajouter d'autres)
  HOSPITALS: 1,       // un hôpital unique (l'admin peut en ajouter d'autres)
  SHOP_TYPES: ['alimentation','vetements','restaurant','pharmacie','armurerie','quincaillerie','electronique','magasin_general','bar','station_essence','concessionnaire','agence_immo','banque','marche_noir','marche_noir_lointain','mine'],
  CURRENCY: 'FCFA',
  SPEECH_RATE: 1.08,
  SPEECH_PITCH: 1.0,
  AIM_PARTS: ['tete','torse','jambes'],
  MAX_HEIGHT: 8, // bâtiments de plusieurs étages
  NOTIFICATION_SOUND: 'sfx_notification', // clé dans SOUND_FILES ; modifiable via Réglages
  FREQ_TOLERANCE: 0.05,
  MAX_RADIO_PARTICIPANTS: 10, // limite indicative par fréquence (gérée côté client)
};

/* ============================================================
   PARAMÈTRES UTILISATEUR — persistés indépendamment de la sauvegarde
   de partie (vitesse de la voix, son de notification choisi parmi
   les sonneries fournies). Chargés au démarrage du script.
============================================================ */
const UserSettings = {
  KEY: 'blind_city_v18_settings',
  load() {
    try {
      const raw = localStorage.getItem(this.KEY) || localStorage.getItem('blind_city_v17_settings') || localStorage.getItem('city_blind_v16_settings') || localStorage.getItem('city_blind_v15_settings') || localStorage.getItem('city_blind_v12_settings');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.speechRate === 'number') CONFIG.SPEECH_RATE = d.speechRate;
      if (d.notificationSound && SOUND_FILES[d.notificationSound]) CONFIG.NOTIFICATION_SOUND = d.notificationSound;
    } catch (e) { /* ignore, on garde les valeurs par défaut */ }
  },
  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify({
        speechRate: CONFIG.SPEECH_RATE,
        notificationSound: CONFIG.NOTIFICATION_SOUND,
      }));
    } catch (e) { /* stockage indisponible, on ignore */ }
  },
};
window.UserSettings = UserSettings;
UserSettings.load();

const UTIL = {
  _rng: Math.random,
  // Génère un numéro de téléphone purement cosmétique (on ne compose jamais un
  // numéro dans ce jeu — les appels se font par contact — mais chaque
  // téléphone en affiche un, comme dans la vraie vie).
  generatePhoneNumber() {
    const rand4 = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `07 ${rand4().slice(0, 2)} ${rand4()}`;
  },
  // Générateur pseudo-aléatoire à graine (mulberry32), utilisé pour que tous
  // les joueurs connectés au même serveur génèrent EXACTEMENT la même ville.
  seedCity(seed) {
    let a = (seed >>> 0) || 1;
    this._rng = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  unseed() { this._rng = Math.random; },
  dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); },
  manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); },
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
  randInt(lo, hi) { return Math.floor(this._rng() * (hi - lo + 1)) + lo; },
  rand(lo, hi) { return this._rng() * (hi - lo) + lo; },
  chance(p) { return this._rng() < p; },
  pick(arr) { return arr[Math.floor(this._rng() * arr.length)]; },
  capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); },
  cardinals: ['nord','nord-est','est','sud-est','sud','sud-ouest','ouest','nord-ouest'],
  bearing(dx, dy) {
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const idx = Math.round(((angle < 0 ? angle + 360 : angle) + 22.5) / 45) % 8;
    return this.cardinals[idx];
  },
  formatMoney(n) { return n.toLocaleString('fr-FR') + ' ' + CONFIG.CURRENCY; },
  formatNumber(n) { return n.toLocaleString('fr-FR'); },
  gridKey(x, y) { return `${x},${y}`; },
  describeCount(n, sing, plur) { return n + ' ' + (n > 1 ? plur : sing); },
};

// UI helpers
function el(id) { return document.getElementById(id); }
function log(msg, type = 'system') {
  const logEl = el('log');
  const p = document.createElement('p'); p.className = type; p.textContent = msg;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
}
/* ============================================================
   CORRECTIF SON/VOIX MOBILE
   Sur mobile (Chrome/Android, Safari/iOS) trois bugs connus rendent le jeu
   totalement silencieux malgré des gestes qui fonctionnent :
   1) Le moteur vocal (speechSynthesis) et le contexte audio (Web Audio) ne
      démarrent vraiment qu'après avoir été "débloqués" par un vrai geste
      utilisateur — s'ils ne sont sollicités que plus tard (minuterie,
      boucle de jeu), certains navigateurs les gardent muets pour toujours.
   2) Appeler speechSynthesis.cancel() puis .speak() dans la même
      microtâche fait ignorer silencieusement la phrase sur Chrome/Android.
   3) speechSynthesis se met en pause toute seule après ~15 secondes sans
      "réveil" sur Chrome/Android (bug documenté), rendant la voix muette
      au bout d'un moment même si tout fonctionnait au départ.
============================================================ */
const SpeechFix = {
  unlocked: false, keepAliveTimer: null,
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0; u.rate = 10;
        window.speechSynthesis.speak(u);
      }
    } catch (e) { /* ignore */ }
    try { Audio.ensure(); } catch (e) { /* ignore */ }
    try { AudioLib.unlock(); } catch (e) { /* ignore */ }
    if (!this.keepAliveTimer) {
      this.keepAliveTimer = setInterval(() => {
        // Ne PAS faire pause()/resume() pendant que la voix parle : sur
        // iOS/Android, ça tronque l'annonce en cours. On se contente de
        // débloquer le moteur s'il s'est réellement mis en pause tout seul.
        if ('speechSynthesis' in window && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.ctx.resume();
        try { AudioLib.tickLoops(); } catch (e) { /* ignore */ }
      }, 4000);
    }
  },
};
// Détection de la plateforme : sert à proposer les bonnes commandes (gestes
// tactiles sur téléphone, raccourcis clavier sur ordinateur).
const Platform = (function() {
  const ua = navigator.userAgent || '';
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || (touch && /Mobi|Tablet/i.test(ua));
  const isMac = !isIOS && /Mac/i.test(navigator.platform || ua);
  const name = isIOS ? 'iPhone' : isAndroid ? 'Android' : isMobile ? 'téléphone' : isMac ? 'Mac' : 'ordinateur';
  return { isTouch: touch, isIOS, isAndroid, isMobile, isMac, name };
})();
['touchstart', 'pointerdown', 'mousedown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => SpeechFix.unlock(), { once: true, passive: true });
});
// Reprise réactive des ambiances : le keep-alive de SpeechFix est à 4 s, trop
// lent pour un redémarrage fluide. On vérifie chaque seconde, et immédiatement
// quand l'onglet/appli redevient actif (cas fréquent sur mobile où le système
// suspend l'audio quand l'écran s'éteint ou qu'on change d'application).
setInterval(() => { try { AudioLib.tickLoops(); } catch (e) { /* ignore */ } }, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.ctx.resume();
    try { AudioLib.tickLoops(); } catch (e) { /* ignore */ }
  }
});
/* ============================================================
   NET — connexion au serveur multijoueur Blind City Online
   Facultatif : sans adresse de serveur renseignée, le jeu reste
   jouable en solo exactement comme avant, sur cet appareil.
============================================================ */
