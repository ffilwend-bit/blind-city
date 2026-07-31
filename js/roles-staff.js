const KIT_CATALOG = [
  { id: 'kit_repair_voiture', name: 'Kit réparation voiture', category: 'outil', price: 15000, size: 2, repairType: 'vehicle', amount: 35, desc: 'Répare un véhicule terrestre.' },
  { id: 'kit_repair_moto', name: 'Kit réparation moto', category: 'outil', price: 9000, size: 1.2, repairType: 'vehicle', amount: 30, desc: 'Répare une moto ou un 2/3 roues.' },
  { id: 'kit_repair_avion', name: 'Kit réparation avion', category: 'outil', price: 45000, size: 2.5, repairType: 'aircraft', amount: 40, desc: 'Répare un avion.' },
  { id: 'kit_repair_helico', name: 'Kit réparation hélicoptère', category: 'outil', price: 38000, size: 2.5, repairType: 'aircraft', amount: 40, desc: 'Répare un hélicoptère.' },
  { id: 'kit_soins', name: 'Kit de soins', category: 'medicament', price: 8000, size: 1, heal: 40, desc: 'Soigne 40% de santé.' },
  { id: 'kit_incendie', name: 'Kit anti-feu', category: 'outil', price: 12000, size: 1.5, desc: 'Eteint un feu de véhicule.' },
  { id: 'ordinateur', name: 'Ordinateur portable', category: 'electronique', price: 180000, size: 2, desc: 'Permet de hacker et gérer des fichiers.' },
  { id: 'coffre_fort', name: 'Coffre-fort', category: 'meuble', price: 250000, size: 6, desc: 'Coffre sécurisé pour maison. Capacité 50.' },
];
SHOP_CATALOG.push(...KIT_CATALOG);

const VALUABLE_CATALOG = [
  { id: 'lingot_or', name: 'Lingot d\'or', category: 'valeur', price: 250000, size: 1.5, dirty: true, desc: 'Lingot précieux, revendable sur le marché noir.' },
  { id: 'diamant', name: 'Diamant', category: 'valeur', price: 180000, size: 0.2, dirty: true, desc: 'Pierre précieuse, valeur élevée.' },
  { id: 'bague_or', name: 'Bague en or', category: 'valeur', price: 45000, size: 0.1, dirty: true, desc: 'Bijou de valeur, revendable.' },
  { id: 'billet_sale', name: 'Liasse d\'argent sale', category: 'argent', price: 10000, size: 0.3, dirty: true, desc: 'Argent sale à blanchir.' },
];
SHOP_CATALOG.push(...VALUABLE_CATALOG);

/* ============================================================
   NPC ROUTINES & REACTIONS
============================================================ */
function npcTick() {
  for (const n of City.npcs) {
    if (n.dead) continue;
    // Passant venu acheter un objet au joueur : il se dirige vers le vendeur et
    // conclut la vente à son arrivée. Abandon si le délai expire.
    if (n.wantsToBuyItem) {
      if (Date.now() > n.wantsToBuyItem.expires) {
        announce(`${n.name} s'est lassé d'attendre et renonce à l'achat.`, 'polite');
        n.wantsToBuyItem = null;
      } else if (UTIL.dist(n, Game) < 2) {
        Game.completeNPCSale(n);
      } else {
        const dx = Math.sign(Game.x - n.x), dy = Math.sign(Game.y - n.y);
        const nx = n.x + (dx || 0), ny = n.y + (dy || 0);
        if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { n.x = nx; n.y = ny; }
      }
      continue;
    }
    // Un fugitif recherché (chasse aux primes) fuit activement le joueur tant
    // qu'il n'est pas menotté, au lieu d'errer au hasard.
    if (n.job === 'fugitif' && !n.menotte && !n.knockedOut && UTIL.dist(n, Game) < 8) {
      const dx = Math.sign(n.x - Game.x), dy = Math.sign(n.y - Game.y);
      const nx = n.x + (dx || UTIL.randInt(-1, 1)), ny = n.y + (dy || UTIL.randInt(-1, 1));
      if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { n.x = nx; n.y = ny; }
      continue;
    }
    // --- Réaction à une arme braquée (bug #11) ---
    // Un civil non armé prend peur quand on sort une arme près de lui. La cible
    // VISÉE (verrouillée) réagit le plus fort : mains en l'air si elle est
    // acculée (tout près), sinon elle prend la fuite. Les témoins proches
    // s'affolent aussi. Les hostiles/fugitifs/policiers ne sont pas concernés.
    if (Game.weaponOut && !n.hostile && !n.menotte && !n.knockedOut && n.job !== 'police' && n.job !== 'fugitif') {
      const d = UTIL.dist(n, Game);
      const aimed = Game.lockedTarget && !Game.lockedTarget.isPlayer && Game.lockedTarget.id === n.id;
      if ((aimed || d < 6) && !n.handsUp && !n.fleeing) {
        n.relation = Math.max(-100, (n.relation || 0) - 15);
        if (d < 3) { n.handsUp = true; if (aimed) announce(`${n.name} lève les mains, terrifié(e).`, 'assertive'); log(`${n.name} lève les mains !`, 'npc'); }
        else { n.fleeing = true; if (aimed) announce(`${n.name} prend la fuite !`, 'assertive'); }
        Game.npcVoiceReaction(n.x, n.y, { group: 'panique', count: 1, radius: 12 });
      } else if (d < 9 && !n.fleeing && !n.handsUp && Math.random() < 0.2) {
        n.fleeing = true; // témoin proche qui s'affole
      }
    }
    // Mains en l'air : figé tant qu'on le braque de près ; se calme sinon.
    if (n.handsUp) {
      if (!Game.weaponOut || UTIL.dist(n, Game) > 8) n.handsUp = false;
      else continue;
    }
    // Fuite : court à l'opposé du joueur ; s'arrête quand la menace s'éloigne.
    if (n.fleeing) {
      if (!Game.weaponOut || UTIL.dist(n, Game) > 16) { n.fleeing = false; }
      else {
        const dx = Math.sign(n.x - Game.x) || UTIL.randInt(-1, 1), dy = Math.sign(n.y - Game.y) || UTIL.randInt(-1, 1);
        const nx = n.x + dx, ny = n.y + dy;
        if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { n.x = nx; n.y = ny; }
        continue; // pas de déambulation tant qu'il fuit
      }
    }
    // Routine: move toward home or work district
    if (Math.random() < 0.4) {
      const dx = Math.sign((n.home?.x || n.x) - n.x + UTIL.randInt(-2, 2)); const dy = Math.sign((n.home?.y || n.y) - n.y + UTIL.randInt(-2, 2));
      const nx = n.x + dx, ny = n.y + dy;
      if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { n.x = nx; n.y = ny; }
    }
    // Illegal clients
    if (n.job === 'civil' && Math.random() < 0.02 && Game.inventory.some(i => i.category === 'munition' || i.id === 'coffre_fort' || !i.legal)) {
      const illegal = Game.inventory.find(i => !i.legal || i.category === 'munition');
      if (illegal) { const price = Math.floor((illegal.price || 1000) * 1.3); log(`${n.name} propose d'acheter ${illegal.name} pour ${UTIL.formatMoney(price)}.`, 'trade'); }
    }
  }
}

/* ============================================================
   ROLES & PROGRESSION — Police, Médecin, Garagiste, Auto-école
============================================================ */
// Hiérarchie policière : grade de base à l'embauche, jusqu'au chef. Seul un
// chef (ou le staff) peut promouvoir un autre policier.
const POLICE_RANKS = {
  agent: { name: 'Agent de police', order: 1 },
  brigadier: { name: 'Brigadier', order: 2 },
  capitaine: { name: 'Capitaine', order: 3 },
  chef: { name: 'Chef de la police', order: 4 },
};
const POLICE_RANK_ORDER = ['agent', 'brigadier', 'capitaine', 'chef'];
const Roles = {
  list: {
    citoyen: { name: 'Citoyen', badge: 'citoyen', perms: [], free: true },
    police: { name: 'Policier', badge: 'police', perms: ['cni', 'fourriere', 'cameras', 'arrest'] },
    medecin: { name: 'Médecin', badge: 'medecin', perms: ['advanced_heal', 'revive'] },
    mecanicien: { name: 'Garagiste', badge: 'meca', perms: ['full_repair', 'tow'] },
    concessionnaire: { name: 'Concessionnaire', badge: 'metier', perms: ['vendre_vehicules', 'estimer_vehicules'] },
    agent_immo: { name: 'Agent immobilier', badge: 'metier', perms: ['vendre_maisons', 'estimer_maisons'] },
    avocat: { name: 'Avocat', badge: 'metier', perms: ['defense_juridique', 'reduire_pv'] },
    mineur_pro: { name: 'Mineur professionnel', badge: 'metier', perms: ['machine_extraction'] },
    journaliste_pro: { name: 'Journaliste', badge: 'metier', perms: ['diffuser_infos'] },
    chauffeur_pro: { name: 'Chauffeur professionnel (taxi)', badge: 'metier', perms: ['taxi'] },
  },
  current: 'citoyen',
  pending: null, // { role, time } — candidature de métier en attente de validation
  recruiters: {}, // roleId -> [noms autorisés à valider/recruter pour ce métier]
  set(role) {
    if (!this.list[role]) return;
    this.current = role; Game.role = role;
    if (role === 'police' && !Game.policeRank) Game.policeRank = 'agent';
    announce(`Vous êtes maintenant ${this.list[role].name}${role === 'police' ? ', grade : ' + POLICE_RANKS[Game.policeRank].name : ''}. Compétences : ${this.list[role].perms.join(', ') || 'aucune'}.`, 'assertive');
    updateHud();
  },
  hasPerm(perm) { return this.list[this.current].perms.includes(perm); },
  applyFor(role) {
    if (!this.list[role]) return announce('Métier inconnu.', 'assertive');
    if (!Game.player.registered) return announce('Enregistrez-vous d\'abord au commissariat.', 'assertive');
    if (this.list[role].free) { this.set(role); return; }
    if (this.pending) return announce(`Une candidature pour ${this.list[this.pending.role].name} est déjà en attente.`, 'assertive');
    this.pending = { role, time: Date.now(), applicant: `${Game.player.firstName} ${Game.player.lastName}` };
    // Notifie les administrateurs connectés : sans ça, une candidature restait
    // purement locale et aucun admin distant ne la « recevait ».
    if (typeof Net !== 'undefined' && Net.connected) Net.send({ type: 'job_request', role, roleName: this.list[role].name });
    announce(`Candidature envoyée pour le métier ${this.list[role].name}. En attente de validation par un administrateur ou un recruteur habilité.`, 'assertive');
  },
  approve() {
    if (!this.pending) return announce('Aucune candidature en attente.', 'polite');
    const roleName = this.list[this.pending.role].name;
    this.set(this.pending.role);
    announce(`Candidature approuvée : ${roleName}.`, 'assertive');
    this.pending = null;
  },
  reject() {
    if (!this.pending) return announce('Aucune candidature en attente.', 'polite');
    announce(`Candidature refusée pour ${this.list[this.pending.role].name}.`, 'assertive');
    this.pending = null;
  },
  appointRecruiter(role, name) {
    if (!this.list[role]) return announce('Métier inconnu.', 'assertive');
    if (!name) return;
    this.recruiters[role] = this.recruiters[role] || [];
    if (!this.recruiters[role].includes(name)) this.recruiters[role].push(name);
    announce(`${name} peut désormais recruter pour le métier ${this.list[role].name}.`, 'assertive');
  },
};
// Mode Staff : un administrateur local peut valider/refuser les candidatures de métier
// et nommer des recruteurs par domaine. Ce fichier étant un jeu autonome côté
// navigateur (sans serveur), ce mode fonctionne par code local — changez le code
// ci-dessous avant toute diffusion publique du jeu.
const StaffMode = {
  active: false,
  role: null, // null | 'moderateur' | 'principal'
  log: [],    // journal d'activité en direct (rempli par les messages staff_log du serveur)
  pendingAuthCallback: null,
  toggle(inputCode) {
    if (this.active) {
      this.active = false; this.role = null;
      if (Net.connected) Net.send({ type: 'staff_deauth' });
      announce('Mode staff désactivé.', 'assertive'); updateHud();
      return;
    }
    if (!Net.connected) { announce('Le mode staff ne fonctionne qu\'en multijoueur, connecté au serveur avec un compte. Vous êtes actuellement en solo (hors ligne) : rechargez le jeu et, à l\'écran d\'accueil, choisissez de créer ou d\'utiliser un compte au lieu de « jouer seul », pour vous connecter au serveur. Ensuite seulement, le code administrateur sera vérifié.', 'assertive'); return; }
    if (!inputCode) { announce('Code administrateur requis.', 'assertive'); return; }
    Net.send({ type: 'staff_auth', code: inputCode });
    announce('Vérification du code...', 'polite');
  },
  // Réactivation de l'accès administrateur pour le PROPRIÉTAIRE, sans code.
  // Appelée par Ctrl+A quand le mode staff est fermé et que le joueur est
  // reconnu comme propriétaire — il ne doit jamais avoir à saisir de code.
  reactivateOwner() {
    if (this.active) { openAdminMenu(); return; }
    if (typeof Net !== 'undefined' && Net.connected) {
      // Le serveur reconnaît le propriétaire et accorde l'accès sans vérifier
      // le code (voir isOwnerAccount côté serveur).
      Net.send({ type: 'staff_auth', code: '' });
      announce('Réactivation de votre accès administrateur...', 'polite');
    } else if (typeof OwnerAccess !== 'undefined') {
      OwnerAccess.grantLocalPrincipal();
    }
  },
  onAuthResult(ok, role, auto) {
    if (ok) {
      this.active = true; this.role = role;
      if (typeof OwnerAccess !== 'undefined') OwnerAccess._granted = true;
      if (auto) {
        announce(`Bienvenue. Accès ${role === 'principal' ? 'administrateur principal' : 'modérateur'} accordé automatiquement, sans code. Raccourci Ctrl+Alt+Maj+P pour ouvrir le panneau staff à tout moment.`, 'assertive');
      } else {
        announce(`Mode staff activé (${role === 'principal' ? 'administrateur principal' : 'modérateur'}). Raccourci Ctrl+Alt+Maj+P pour rouvrir ce panneau à tout moment.`, 'assertive');
        openAdminMenu();
      }
    } else {
      announce('Code administrateur incorrect.', 'assertive');
    }
    updateHud();
  },
  onLog(text) {
    this.log.unshift({ text, time: Date.now() });
    if (this.log.length > 300) this.log.length = 300;
  },
};
window.StaffMode = StaffMode;

/* ============================================================
   SÉLECTEUR DE QUANTITÉ — pour donner/déposer/vendre plusieurs
   objets d'un coup (munitions, nourriture, minerai...).
   Même geste (haut/bas/gauche/droite) que pour naviguer les menus.
============================================================ */
const QtyPicker = {
  active: false, value: 1, min: 1, max: 1, onConfirm: null, label: '',
  open(label, max, onConfirm, initial) {
    this.active = true; this.min = 1; this.max = Math.max(1, Math.floor(max) || 1);
    this.value = Math.min(Math.max(Math.floor(initial) || 1, this.min), this.max);
    this.onConfirm = onConfirm; this.label = label;
    el('qtyTitle').textContent = 'Choisir une quantité';
    el('qtySub').textContent = `${label} (maximum ${this.max})`;
    this.render();
    el('qtyOverlay').style.display = 'flex';
    announce(`Quantité pour ${label}. Maximum ${this.max}. Actuellement ${this.value}. Flèches ou gestes pour ajuster, Entrée ou double-tap pour valider, Échap pour annuler.`, 'assertive');
  },
  render() { const v = el('qtyValue'); if (v) v.textContent = this.value; },
  change(delta) {
    if (!this.active) return;
    const next = Math.min(this.max, Math.max(this.min, this.value + delta));
    // 'interrupt' : en passant à la valeur suivante, la voix COUPE l'annonce en
    // cours et énonce tout de suite la nouvelle — pas d'empilement ni de retard.
    if (next === this.value) { speak('Limite atteinte.', 'interrupt'); return; }
    this.value = next; this.render(); speak(String(this.value), 'interrupt');
  },
  setMax() { if (!this.active) return; this.value = this.max; this.render(); speak(String(this.value), 'interrupt'); },
  confirm() {
    if (!this.active) return;
    const v = this.value; const cb = this.onConfirm;
    this.close();
    if (cb) cb(v);
  },
  cancel() { if (!this.active) return; this.close(); announce('Annulé.', 'polite'); },
  close() { this.active = false; this.onConfirm = null; el('qtyOverlay').style.display = 'none'; document.activeElement?.blur(); },
};
window.QtyPicker = QtyPicker;

/* ============================================================
   COMPOSITION DE FRÉQUENCE — pavé numérique accessible pour le talkie-walkie
============================================================ */
const FreqPicker = {
  active: false, onConfirm: null,
  open(current, onConfirm) {
    this.active = true; this.onConfirm = onConfirm;
    const input = el('freqInput'); input.value = (current || 151.5).toFixed(3);
    el('freqOverlay').style.display = 'flex';
    announce(`Composez la fréquence du talkie-walkie. Actuellement ${input.value} mégahertz.`, 'assertive');
    setTimeout(() => focusTextInput(input), 30);
  },
  press(char) {
    const input = el('freqInput'); if (!input) return;
    // 'interrupt' : chaque chiffre pressé coupe l'annonce précédente et est
    // énoncé immédiatement (retour direct, sans attendre ni empiler).
    if (char === '⌫') { input.value = input.value.slice(0, -1); speak('Effacé.', 'interrupt'); }
    else if (char === '.' && input.value.includes('.')) return;
    else { input.value += char; speak(char === '.' ? 'point' : String(char), 'interrupt'); }
  },
  confirm() {
    const input = el('freqInput');
    const val = parseFloat((input.value || '').replace(',', '.'));
    if (isNaN(val) || val < 1 || val > 999) { announce('Fréquence invalide. Entrez un nombre entre 1 et 999.', 'assertive'); return; }
    const cb = this.onConfirm; this.close();
    announce(`Fréquence ${val.toFixed(3)} mégahertz composée.`, 'assertive');
    if (cb) cb(val);
  },
  cancel() { this.close(); announce('Composition annulée.', 'polite'); },
  close() { this.active = false; this.onConfirm = null; el('freqOverlay').style.display = 'none'; document.activeElement?.blur(); },
};
window.FreqPicker = FreqPicker;

// Remplace prompt() : un prompt() natif du navigateur est une fenêtre système
// que le jeu ne peut pas narrer (comme la fenêtre d'autorisation du micro).
// Cette boîte, elle, fait partie de la page : le champ est donc lu par le
// narrateur du jeu caractère par caractère, sans avoir besoin de NVDA.
const AccessibleTextPrompt = {
  active: false, onConfirm: null,
  open(title, desc, defaultValue, onConfirm) {
    this.active = true; this.onConfirm = onConfirm;
    el('textPromptTitle').textContent = title;
    el('textPromptDesc').textContent = desc || '';
    const input = el('textPromptInput'); input.value = defaultValue || '';
    input._speakableWired = false; // reforcer la narration même si le champ a déjà servi
    el('textPromptOverlay').style.display = 'flex';
    // Clavier tactile intégré : affiché toujours (utile aussi à la souris) ;
    // sur mobile il remplace le clavier natif.
    if (typeof TouchKeyboard !== 'undefined') TouchKeyboard.open();
    const onMobile = (typeof Platform !== 'undefined' && Platform.isMobile);
    announce(`${title}. ${desc || ''} ${onMobile ? 'Clavier tactile : glissez le doigt pour entendre les lettres, levez le doigt pour écrire. En bas, touche Valider pour enregistrer, Annuler pour abandonner.' : ''}`, 'assertive');
    if (!onMobile) setTimeout(() => focusTextInput(input, title), 30);
  },
  confirm() {
    const input = el('textPromptInput');
    const val = input.value || '';
    const cb = this.onConfirm; this.close();
    if (cb) cb(val);
  },
  cancel() { this.close(); announce('Saisie annulée.', 'polite'); },
  close() { this.active = false; this.onConfirm = null; if (typeof TouchKeyboard !== 'undefined') TouchKeyboard.close(); el('textPromptOverlay').style.display = 'none'; document.activeElement?.blur(); },
};
window.AccessibleTextPrompt = AccessibleTextPrompt;

// Clavier tactile intégré (Touch Typing, standard VoiceOver) : on glisse le
// doigt sur les touches (chaque touche survolée est LUE, rien n'est écrit), et
// la lettre est écrite quand on LÈVE le doigt. Permet d'écrire un nom, un
// message ou une fréquence sans lecteur d'écran natif. Écrit dans le même champ
// textPromptInput, donc AccessibleTextPrompt.confirm() récupère la valeur
// normalement. Le clavier physique (ordinateur) continue de fonctionner.
const TouchKeyboard = {
  active: false, shift: false, lastRead: null, wired: false,
  ROWS: [
    ['a','b','c','d','e','f','g','h'],
    ['i','j','k','l','m','n','o','p'],
    ['q','r','s','t','u','v','w','x'],
    ['y','z','0','1','2','3','4','5'],
    ['6','7','8','9','@','.','-','_'],
    [{k:'shift',l:'Majuscules'},{k:'space',l:'Espace'},{k:'back',l:'Effacer'}],
    [{k:'cancel',l:'Annuler'},{k:'enter',l:'Valider'}],
  ],
  _labelFor(k) {
    if (k === 'space') return 'Espace';
    if (k === 'back') return 'Effacer';
    if (k === 'enter') return 'Valider';
    if (k === 'cancel') return 'Annuler';
    if (k === 'shift') return this.shift ? 'Majuscules activées' : 'Majuscules';
    if (k === '.') return 'point'; if (k === '-') return 'tiret'; if (k === '_') return 'trait bas'; if (k === '@') return 'arobase';
    if (/[a-z]/.test(k)) return (this.shift ? 'majuscule ' : '') + k.toUpperCase();
    return k;
  },
  build() {
    const box = el('touchKeyboard'); if (!box) return;
    box.innerHTML = '';
    this.ROWS.forEach(row => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex; gap:5px; justify-content:center; margin-bottom:5px;';
      row.forEach(cell => {
        const k = typeof cell === 'string' ? cell : cell.k;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'kb-key'; btn.dataset.key = k;
        btn.textContent = typeof cell === 'string' ? cell : cell.l;
        btn.setAttribute('aria-label', this._labelFor(k));
        btn.dataset.voiceLabel = this._labelFor(k);
        const wide = (k === 'space') ? 'flex:2;' : (k === 'shift' || k === 'back' || k === 'enter' || k === 'cancel') ? 'flex:2;' : 'flex:1;';
        btn.style.cssText = `${wide} min-width:34px; min-height:44px; font-size:1rem; background:#11161e; color:#fff; border:1px solid var(--border); border-radius:8px;`;
        r.appendChild(btn);
      });
      box.appendChild(r);
    });
  },
  _read(k) {
    if (k == null) return;
    this.lastRead = k;
    speak(this._labelFor(k), 'interrupt');
  },
  _commit(k) {
    const input = el('textPromptInput'); if (!input) return;
    // Valider / Annuler : indispensables sur mobile (le champ est en lecture
    // seule, Entrée n'existe pas) — avant, on restait bloqué dans la saisie.
    if (k === 'enter') { if (typeof AccessibleTextPrompt !== 'undefined' && AccessibleTextPrompt.active) AccessibleTextPrompt.confirm(); return; }
    if (k === 'cancel') { if (typeof AccessibleTextPrompt !== 'undefined' && AccessibleTextPrompt.active) AccessibleTextPrompt.cancel(); return; }
    if (k === 'shift') { this.shift = !this.shift; this._refreshLabels(); speak(this.shift ? 'Majuscules activées' : 'Majuscules désactivées', 'interrupt'); return; }
    if (typeof Audio !== 'undefined' && Audio.click) Audio.click(0);
    if (k === 'space') { input.value += ' '; speak('espace', 'assertive'); return; }
    if (k === 'back') { input.value = input.value.slice(0, -1); speak('effacé. ' + (input.value || 'champ vide'), 'assertive'); return; }
    const ch = /[a-z]/.test(k) && this.shift ? k.toUpperCase() : k;
    input.value += ch;
    speak(this._labelFor(k) + '. ' + input.value, 'assertive');
  },
  _refreshLabels() {
    const box = el('touchKeyboard'); if (!box) return;
    box.querySelectorAll('.kb-key').forEach(btn => { const lbl = this._labelFor(btn.dataset.key); btn.setAttribute('aria-label', lbl); btn.dataset.voiceLabel = lbl; });
  },
  _keyAt(x, y) {
    const el2 = document.elementFromPoint(x, y);
    const btn = el2 && el2.closest && el2.closest('.kb-key');
    const box = el('touchKeyboard');
    return (btn && box && box.contains(btn)) ? btn.dataset.key : null;
  },
  open() {
    const box = el('touchKeyboard'); if (!box) return;
    this.build();
    box.style.display = 'block'; box.setAttribute('aria-hidden', 'false');
    this.active = true; this.shift = false; this.lastRead = null;
    // Sur mobile, on bloque le clavier natif du téléphone (le jeu est son propre
    // lecteur d'écran) ; sur ordinateur, le champ reste éditable au clavier.
    const input = el('textPromptInput');
    if (typeof Platform !== 'undefined' && Platform.isMobile && input) { input.readOnly = true; input.inputMode = 'none'; try { input.blur(); } catch (e) {} }
    if (!this.wired) {
      this.wired = true;
      box.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.changedTouches[0]; const k = this._keyAt(t.clientX, t.clientY); if (k && k !== this.lastRead) this._read(k); }, { passive: false });
      box.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; const k = this._keyAt(t.clientX, t.clientY); this.lastRead = null; if (k) this._read(k); }, { passive: false });
      box.addEventListener('touchend', (e) => { e.preventDefault(); const t = e.changedTouches[0]; const k = this._keyAt(t.clientX, t.clientY); if (k) this._commit(k); }, { passive: false });
      // Souris/clic (ordinateur) : un clic écrit directement la touche.
      box.addEventListener('click', (e) => { const btn = e.target.closest('.kb-key'); if (btn) this._commit(btn.dataset.key); });
    }
  },
  close() {
    const box = el('touchKeyboard'); if (box) { box.style.display = 'none'; box.setAttribute('aria-hidden', 'true'); }
    const input = el('textPromptInput'); if (input) { input.readOnly = false; input.inputMode = 'text'; }
    this.active = false;
  },
};
window.TouchKeyboard = TouchKeyboard;

el('textPromptConfirm').addEventListener('click', () => AccessibleTextPrompt.confirm());
el('textPromptCancel').addEventListener('click', () => AccessibleTextPrompt.cancel());
el('textPromptInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); AccessibleTextPrompt.confirm(); }
  else if (e.key === 'Escape') { e.preventDefault(); AccessibleTextPrompt.cancel(); }
});

// Remplace confirm() : mêmes raisons que AccessibleTextPrompt ci-dessus.
const AccessibleConfirm = {
  active: false, onResult: null,
  open(title, desc, onResult) {
    this.active = true; this.onResult = onResult;
    el('confirmPromptTitle').textContent = title;
    el('confirmPromptDesc').textContent = desc || '';
    el('confirmPromptOverlay').style.display = 'flex';
    const yesBtn = el('confirmPromptYes');
    setTimeout(() => yesBtn.focus(), 30);
    // La question est annoncée APRÈS la prise de focus du bouton "Oui" : sinon
    // l'annonce automatique du bouton au focus ("Oui, bouton") coupait la
    // question et on n'entendait plus que "oui / non" sans savoir de quoi il
    // s'agissait (par ex. « Acheter cette maison ? »). Ainsi la question passe
    // en dernier et est lue en entier.
    setTimeout(() => { if (this.active) announce(`${title}. ${desc || ''} Oui ou non ?`, 'assertive'); }, 140);
  },
  resolve(val) {
    const cb = this.onResult; this.close();
    if (cb) cb(val);
  },
  close() { this.active = false; this.onResult = null; el('confirmPromptOverlay').style.display = 'none'; document.activeElement?.blur(); },
};
window.AccessibleConfirm = AccessibleConfirm;
el('confirmPromptYes').addEventListener('click', () => AccessibleConfirm.resolve(true));
el('confirmPromptNo').addEventListener('click', () => AccessibleConfirm.resolve(false));
el('confirmPromptOverlay').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); AccessibleConfirm.resolve(false); }
});

Game.role = 'citoyen';
Game.licenses = { driving: false, flying: false, weapon: false };
Game.theoryPassed = false;
Game.openDrivingSchool = function() {
  if (this.licenses.driving) return announce('Vous avez déjà votre permis de conduire.', 'polite');
  el('menuTitle').textContent = 'Auto-école';
  const items = [
    { id: 'tuto', title: '🎙️ Tutoriel vocal', desc: 'Rappel des commandes de conduite avant de vous lancer.' },
    { id: 'theorie', title: this.theoryPassed ? '✅ Théorie déjà validée' : '📖 Examen théorique (code de la route)', desc: this.theoryPassed ? 'Vous pouvez passer à la pratique.' : 'Obligatoire avant l\'examen pratique : quelques questions sur les règles de conduite.' },
    { id: 'exam', title: this.theoryPassed ? '📋 Passer l\'examen pratique (20 000 FCFA)' : '🔒 Examen pratique (verrouillé)', desc: this.theoryPassed ? 'Un vrai circuit à parcourir, avec un nombre de collisions maximum toléré.' : 'Réussissez d\'abord la théorie.' },
  ];
  el('menuOverlay').style.display = 'flex';
  announce('Auto-école. Choisissez : tutoriel vocal, examen théorique, ou examen pratique. Commencez par le tutoriel puis la théorie.', 'polite');
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'tuto') this.drivingTutorial();
    else if (sel.id === 'theorie') { if (!this.theoryPassed) this.startTheoryExam(); }
    else if (this.theoryPassed) this.startDrivingExam();
    else announce('Réussissez d\'abord l\'examen théorique.', 'assertive');
  });
};
Game.drivingTutorial = function() {
  announce('Tutoriel de conduite : flèche haut pour avancer dans le cap actuel, flèche bas pour reculer ou freiner, flèches gauche et droite pour tourner sur vous-même. Espace pour le frein d\'urgence en véhicule. Restez sur la route : sortir de la chaussée ralentit fortement. Une collision compte contre vous à l\'examen — roulez prudemment. Quand vous êtes prêt, revenez à l\'auto-école pour passer l\'examen théorique puis pratique.', 'assertive');
};
// Examen théorique : 5 questions sur le code de la route, une par une via des
// menus accessibles. 4 bonnes réponses sur 5 requises pour valider.
Game.startTheoryExam = function() {
  const questions = [
    { q: 'Que devez-vous faire à un feu rouge ?', options: ['Ralentir seulement', 'Vous arrêter complètement', 'Klaxonner et continuer'], correct: 1 },
    { q: 'La ceinture de sécurité, c\'est... ?', options: ['Obligatoire pour le conducteur et les passagers', 'Facultative en ville', 'Utile seulement sur autoroute'], correct: 0 },
    { q: 'Quelqu\'un traverse sur un passage piéton devant vous. Que faites-vous ?', options: ['Vous accélérez pour passer avant', 'Vous vous arrêtez pour le laisser traverser', 'Vous klaxonnez pour qu\'il se dépêche'], correct: 1 },
    { q: 'Que signifie une ligne continue au sol ?', options: ['On peut doubler si la voie est libre', 'Interdiction de la franchir ou de doubler', 'C\'est juste décoratif'], correct: 1 },
    { q: 'Après une collision, que faites-vous en priorité ?', options: ['Vous fuyez les lieux', 'Vous vérifiez les blessés et signalez si besoin', 'Vous prenez une photo et repartez'], correct: 1 },
  ];
  let index = 0, score = 0;
  const askNext = () => {
    if (index >= questions.length) {
      this.theoryPassed = score >= 4;
      announce(this.theoryPassed
        ? `Théorie validée : ${score} sur ${questions.length} bonnes réponses ! Vous pouvez passer à l'examen pratique.`
        : `Théorie insuffisante : ${score} sur ${questions.length} bonnes réponses (4 requises). Revenez réessayer.`, 'assertive');
      return;
    }
    const q = questions[index];
    el('menuTitle').textContent = `Question ${index + 1} : ${q.q}`;
    const items = q.options.map((opt, i) => ({ id: String(i), title: opt, desc: '' }));
    el('menuOverlay').style.display = 'flex';
    // La question elle-même doit être lue à voix haute — le focus des cartes ne
    // lit que les réponses. On l'annonce juste après le rendu (léger délai pour
    // ne pas être coupée par le focus), avec l'énoncé des réponses possibles.
    setTimeout(() => announce(`Question ${index + 1} sur ${questions.length}. ${q.q} Réponses possibles : ${q.options.map((o, i) => `${i + 1}, ${o}`).join(' ; ')}. Choisissez.`, 'assertive'), 260);
    renderMenu(items, (sel) => {
      if (parseInt(sel.id, 10) === q.correct) score++;
      index++;
      closeMenu();
      askNext();
    });
  };
  announce('Examen théorique : 5 questions, 4 bonnes réponses minimum pour valider.', 'assertive');
  askNext();
};
Game.drivingExamState = null;
Game.startDrivingExam = function() {
  if (!this.theoryPassed) return announce('Réussissez d\'abord l\'examen théorique.', 'assertive');
  const price = 20000;
  if (this.money < price) return announce(`Examen pratique : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
  const school = City.pois.find(p => p.type === 'auto_ecole');
  if (!school || UTIL.dist(school, this) > 4) return announce('Revenez à l\'auto-école pour passer l\'examen.', 'assertive');
  this.money -= price; Audio.cash();
  // Trouve une tuile praticable (de préférence une route) proche du joueur pour
  // y garer le véhicule-école : il ne faut SURTOUT pas le créer sur la tuile de
  // l'auto-école, qui est un bâtiment solide — le véhicule y serait coincé et
  // introuvable. On le pose juste à côté du candidat.
  const freeSpotNear = (cx, cy) => {
    for (let rad = 1; rad <= 8; rad++) {
      let best = null;
      for (let ox = -rad; ox <= rad; ox++) for (let oy = -rad; oy <= rad; oy++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== rad) continue;
        const x = UTIL.clamp(cx + ox, 0, City.W - 1), y = UTIL.clamp(cy + oy, 0, City.H - 1);
        if (City.isSolid(x, y) || City.getTile(x, y) === 'eau') continue;
        if (City.isRoad(x, y)) return { x, y };   // route = idéal, on prend tout de suite
        if (!best) best = { x, y };
      }
      if (best) return best;
    }
    return { x: UTIL.clamp(cx, 0, City.W - 1), y: UTIL.clamp(cy, 0, City.H - 1) };
  };
  const spot = freeSpotNear(Math.round(this.x), Math.round(this.y));
  // Circuit de 4 points praticables formant une boucle autour de l'auto-école.
  const r = 12;
  const waypoints = [0, 1, 2, 3].map(k => {
    const angle = (Math.PI / 2) * k;
    return freeSpotNear(Math.round(school.x + Math.cos(angle) * r), Math.round(school.y + Math.sin(angle) * r));
  });
  const vid = 'exam_vehicle_' + Date.now();
  City.vehicles.push({ id: vid, type: 'berline', name: 'Véhicule-école', x: spot.x, y: spot.y, fuel: 1, hp: 100, locked: false, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG.berline.trunk, examVehicle: true });
  this.drivingExamState = { waypoints, current: 0, collisions: 0, vehicleId: vid, startHp: 100 };
  announce(`Examen commencé ! Un véhicule-école vous attend juste à côté : appuyez sur E pour monter côté conducteur, aucun permis n'est requis. Suivez ensuite le guidage vocal jusqu'aux 4 points du circuit. 2 collisions maximum tolérées.`, 'assertive');
  // Repère sonore (synthétique) vers le véhicule-école, puis guidage vers le premier point.
  if (typeof Game !== 'undefined' && Game.doorCue) Game.doorCue(UTIL.clamp((spot.x - this.x) / 6, -1, 1));
  this.setGuidance({ name: 'Point 1 du circuit', x: waypoints[0].x, y: waypoints[0].y });
};
// Appelé en continu tant qu'un examen est en cours (voir gameLoop).
Game.tickDrivingExam = function() {
  const es = this.drivingExamState; if (!es) return;
  if (!this.inVehicle || !this.vehicle || this.vehicle.id !== es.vehicleId) return; // en pause hors du véhicule-école
  // Collision détectée par la perte de points de vie du véhicule depuis le début.
  if (this.vehicle.hp < es.startHp) {
    es.collisions += Math.ceil((es.startHp - this.vehicle.hp) / 15);
    es.startHp = this.vehicle.hp;
    if (es.collisions > 2) {
      announce(`Trop de collisions (${es.collisions}) : examen échoué. Vous pouvez retenter plus tard.`, 'assertive');
      City.vehicles = City.vehicles.filter(v => v.id !== es.vehicleId);
      this.drivingExamState = null; this.stopGuidance();
      return;
    }
  }
  const target = es.waypoints[es.current];
  // Rayon d'arrivée élargi selon la vitesse actuelle : à pleine vitesse le
  // véhicule parcourt largement plus de 4 cases entre deux vérifications,
  // et le franchissait sans jamais être détecté « arrivé ».
  const arrivalRadius = Math.max(4, Math.abs(this.vehicle.speed) * this.MOVE_SCALE * 20);
  if (UTIL.dist(this.vehicle, target) < arrivalRadius) {
    es.current++;
    if (es.current >= es.waypoints.length) {
      this.licenses.driving = true;
      announce(`Circuit terminé avec ${es.collisions} collision(s) : examen réussi ! Vous obtenez votre permis de conduire.`, 'assertive');
      City.vehicles = City.vehicles.filter(v => v.id !== es.vehicleId);
      this.drivingExamState = null; this.stopGuidance();
      updateHud();
    } else {
      announce(`Point ${es.current} validé. Direction le point ${es.current + 1}.`, 'assertive');
      this.setGuidance({ name: `Point ${es.current + 1} du circuit`, x: es.waypoints[es.current].x, y: es.waypoints[es.current].y });
    }
  }
};

/* ============================================================
   ÉCOLE DE PILOTAGE — avions et hélicoptères
============================================================ */
Game.flightTheoryPassed = false;
Game.openFlightSchool = function() {
  if (this.licenses.flying) return announce('Vous avez déjà votre permis de pilotage.', 'polite');
  el('menuTitle').textContent = 'École de pilotage';
  const items = [
    { id: 'tuto', title: '🎙️ Tutoriel vocal', desc: 'Rappel des commandes de vol avant de vous lancer.' },
    { id: 'theorie', title: this.flightTheoryPassed ? '✅ Théorie déjà validée' : '📖 Examen théorique (règles de vol)', desc: this.flightTheoryPassed ? 'Vous pouvez passer à la pratique.' : 'Obligatoire avant l\'examen pratique.' },
    { id: 'exam', title: this.flightTheoryPassed ? '📋 Passer l\'examen pratique (35 000 FCFA)' : '🔒 Examen pratique (verrouillé)', desc: this.flightTheoryPassed ? 'Un circuit aérien en hélicoptère-école (plein d\'essence fourni), avec prise d\'altitude, à parcourir sans collision. Le permis obtenu vaut aussi pour les avions.' : 'Réussissez d\'abord la théorie.' },
  ];
  el('menuOverlay').style.display = 'flex';
  announce('École de pilotage. Choisissez : tutoriel vocal, examen théorique, ou examen pratique. Commencez par le tutoriel puis la théorie.', 'polite');
  renderMenu(items, (sel) => {
    closeMenu();
    if (sel.id === 'tuto') this.flightTutorial();
    else if (sel.id === 'theorie') { if (!this.flightTheoryPassed) this.startFlightTheoryExam(); }
    else if (this.flightTheoryPassed) this.startFlightExam();
    else announce('Réussissez d\'abord l\'examen théorique.', 'assertive');
  });
};
Game.flightTutorial = function() {
  announce('Tutoriel de pilotage : un seul permis de pilotage vous permet de piloter aussi bien un avion qu\'un hélicoptère, tous deux se commandent pareil. Montez à bord, flèches pour avancer et tourner comme au sol. Maj pour prendre de l\'altitude, Ctrl pour descendre. Ne redescendez jamais brutalement à zéro en plein vol : un atterrissage se fait progressivement. Vérifiez le niveau d\'essence avant de décoller : sans essence, l\'appareil n\'avance quasiment plus. Une collision compte contre vous à l\'examen, qui se déroule en hélicoptère (mais valide le permis pour les deux types d\'appareil). Quand vous êtes prêt, revenez à l\'école de pilotage pour la théorie puis la pratique.', 'assertive');
};
Game.startFlightTheoryExam = function() {
  const questions = [
    { q: 'Avant de décoller, que devez-vous vérifier ?', options: ['Rien, on décolle directement', 'Le niveau de carburant et que la voie est dégagée', 'Juste la couleur de l\'appareil'], correct: 1 },
    { q: 'Comment doit se faire une descente vers l\'atterrissage ?', options: ['Le plus vite possible', 'Progressivement, pas d\'un coup', 'Peu importe, ça n\'a pas d\'importance'], correct: 1 },
    { q: 'Que faire si un autre appareil est proche en vol ?', options: ['Foncer quand même', 'Garder ses distances et ajuster son altitude', 'Klaxonner'], correct: 1 },
    { q: 'Voler à très basse altitude au-dessus de la ville, c\'est... ?', options: ['Toujours prudent', 'Risqué : collisions avec les bâtiments', 'Obligatoire'], correct: 1 },
    { q: 'En cas de mauvais temps (pluie, vent fort), que privilégier ?', options: ['Voler plus vite pour en sortir', 'Rester prudent, voire ne pas décoller', 'Ça ne change rien'], correct: 1 },
  ];
  let index = 0, score = 0;
  const askNext = () => {
    if (index >= questions.length) {
      this.flightTheoryPassed = score >= 4;
      announce(this.flightTheoryPassed
        ? `Théorie validée : ${score} sur ${questions.length} bonnes réponses ! Vous pouvez passer à l'examen pratique.`
        : `Théorie insuffisante : ${score} sur ${questions.length} bonnes réponses (4 requises). Revenez réessayer.`, 'assertive');
      return;
    }
    const q = questions[index];
    el('menuTitle').textContent = `Question ${index + 1} : ${q.q}`;
    const items = q.options.map((opt, i) => ({ id: String(i), title: opt, desc: '' }));
    el('menuOverlay').style.display = 'flex';
    // La question elle-même doit être lue à voix haute — le focus des cartes ne
    // lit que les réponses. On l'annonce juste après le rendu (léger délai pour
    // ne pas être coupée par le focus), avec l'énoncé des réponses possibles.
    setTimeout(() => announce(`Question ${index + 1} sur ${questions.length}. ${q.q} Réponses possibles : ${q.options.map((o, i) => `${i + 1}, ${o}`).join(' ; ')}. Choisissez.`, 'assertive'), 260);
    renderMenu(items, (sel) => {
      if (parseInt(sel.id, 10) === q.correct) score++;
      index++;
      closeMenu();
      askNext();
    });
  };
  announce('Examen théorique de pilotage : 5 questions, 4 bonnes réponses minimum pour valider.', 'assertive');
  askNext();
};
Game.flightExamState = null;
Game.startFlightExam = function() {
  if (!this.flightTheoryPassed) return announce('Réussissez d\'abord l\'examen théorique.', 'assertive');
  const price = 35000;
  if (this.money < price) return announce(`Examen pratique : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
  const school = City.pois.find(p => p.type === 'ecole_pilotage');
  if (!school || UTIL.dist(school, this) > 4) return announce('Revenez à l\'école de pilotage pour passer l\'examen.', 'assertive');
  this.money -= price; Audio.cash();
  // Circuit aérien : 3 points en boucle, chacun exigeant d'être en altitude,
  // plus un retour au sol final pour "atterrir" et valider l'examen.
  const r = 16;
  const waypoints = [0, 1, 2].map(k => {
    const angle = (Math.PI * 2 / 3) * k;
    return { x: UTIL.clamp(Math.round(school.x + Math.cos(angle) * r), 0, City.W - 1), y: UTIL.clamp(Math.round(school.y + Math.sin(angle) * r), 0, City.H - 1), altitude: 25 };
  });
  waypoints.push({ x: school.x, y: school.y, altitude: 0 }); // atterrissage final
  const vid = 'exam_flight_' + Date.now();
  City.vehicles.push({ id: vid, type: 'helico', name: 'Hélicoptère-école', x: school.x, y: school.y, fuel: 1, hp: 100, locked: false, owner: null, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG.helico.trunk, examVehicle: true });
  this.flightExamState = { waypoints, current: 0, collisions: 0, vehicleId: vid, startHp: 100 };
  announce('Examen de pilotage commencé ! Montez dans l\'hélicoptère-école. 3 points en altitude à passer, puis un atterrissage final. 2 collisions maximum tolérées.', 'assertive');
  this.setGuidance({ name: 'Point 1 du circuit aérien', x: waypoints[0].x, y: waypoints[0].y });
};
Game.tickFlightExam = function() {
  const es = this.flightExamState; if (!es) return;
  if (!this.inVehicle || !this.vehicle || this.vehicle.id !== es.vehicleId) return;
  if (this.vehicle.hp < es.startHp) {
    es.collisions += Math.ceil((es.startHp - this.vehicle.hp) / 15);
    es.startHp = this.vehicle.hp;
    if (es.collisions > 2) {
      announce(`Trop de collisions (${es.collisions}) : examen échoué. Vous pouvez retenter plus tard.`, 'assertive');
      City.vehicles = City.vehicles.filter(v => v.id !== es.vehicleId);
      this.flightExamState = null; this.stopGuidance();
      return;
    }
  }
  const target = es.waypoints[es.current];
  // Même correctif que l'examen de conduite : rayon élargi selon la vitesse
  // actuelle, sinon l'appareil dépasse le point sans jamais être détecté.
  const arrivalRadius = Math.max(4, Math.abs(this.vehicle.speed) * this.MOVE_SCALE * 20);
  const closeEnough = UTIL.dist(this.vehicle, target) < arrivalRadius;
  const altitudeOk = target.altitude === 0 ? this.vehicle.altitude < 3 : this.vehicle.altitude >= target.altitude - 8;
  if (closeEnough && altitudeOk) {
    es.current++;
    if (es.current >= es.waypoints.length) {
      this.licenses.flying = true;
      announce(`Circuit aérien terminé avec ${es.collisions} collision(s), atterrissage réussi : examen réussi ! Vous obtenez votre permis de pilotage.`, 'assertive');
      City.vehicles = City.vehicles.filter(v => v.id !== es.vehicleId);
      this.flightExamState = null; this.stopGuidance();
      updateHud();
    } else {
      const next = es.waypoints[es.current];
      const msg = next.altitude === 0 ? `Point ${es.current} validé. Ramenez l'appareil se poser à l'école.` : `Point ${es.current} validé. Direction le point ${es.current + 1}, en maintenant l'altitude.`;
      announce(msg, 'assertive');
      this.setGuidance({ name: next.altitude === 0 ? 'Atterrissage à l\'école de pilotage' : `Point ${es.current + 1} du circuit aérien`, x: next.x, y: next.y });
    }
  } else if (closeEnough && !altitudeOk) {
    // Au bon endroit mais pas à la bonne altitude : le prévenir sans faire
    // avancer l'examen, pour qu'il comprenne pourquoi ça ne valide pas.
    const now = Date.now();
    if (now - (es.lastAltWarn || 0) > 4000) {
      es.lastAltWarn = now;
      announce(target.altitude === 0 ? 'Vous êtes au-dessus du point d\'atterrissage : redescendez progressivement.' : `Vous êtes au bon endroit mais trop bas : montez à environ ${target.altitude} mètres.`, 'assertive');
    }
  }
};
Game.checkLicense = function(type) {
  if (type === 'driving' && !this.licenses.driving) { announce('Pas de permis de conduire. Passez à l\'auto-école.', 'assertive'); return false; }
  if (type === 'flying' && !this.licenses.flying) { announce('Pas de permis de pilotage. Passez à l\'école de pilotage, près de l\'aéroport.', 'assertive'); return false; }
  return true;
};

// Police interactions (réservées aux joueurs humains avec le rôle police)
Game.policeCNI = function() {
  if (!Roles.hasPerm('cni')) return announce('Réservé à la police.', 'assertive');
  const nearby = City.npcs.filter(n => !n.dead && UTIL.dist(n, Game) < 10).sort((a, b) => UTIL.dist(a, Game) - UTIL.dist(b, Game))[0];
  if (nearby) { nearby.relation = Math.min(100, nearby.relation + 10); announce(`Vous vérifiez l\'identité de ${nearby.name}.`, 'polite'); }
};
Game.impoundVehicle = function() {
  if (!Roles.hasPerm('fourriere')) return announce('Réservé à la police.', 'assertive');
  const veh = City.vehicles.find(v => UTIL.dist(v, Game) < 8 && !v.owner && !v._beingTowed);
  if (!veh) return announce('Aucun véhicule non-possédé à proximité à mettre en fourrière.', 'assertive');
  veh._beingTowed = true;
  const dist = UTIL.dist(veh, Game) * CONFIG.METERS_PER_TILE;
  const delay = Math.min(30000, Math.max(9000, dist * 60));
  announce(`Fourrière demandée pour ${veh.name}. Une dépanneuse est envoyée.`, 'assertive');
  const truck = { id: 'depanneuse_' + Date.now(), type: 'camion', name: 'Dépanneuse', x: veh.x + (UTIL.chance(0.5) ? 2 : -2), y: veh.y + (UTIL.chance(0.5) ? 2 : -2), fuel: 1, hp: 100, locked: true, owner: null, inventory: [], passengers: [], openDoors: new Set(), auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG.camion.trunk };
  City.vehicles.push(truck);
  sendWorldEdit('vehicle_create', truck);
  setTimeout(() => {
    const stillThere = City.vehicles.find(v => v.id === veh.id);
    if (stillThere) { const idx = City.vehicles.indexOf(stillThere); City.vehicles.splice(idx, 1); sendWorldEdit('vehicle_remove', { id: veh.id }); }
    const truckStillThere = City.vehicles.find(v => v.id === truck.id);
    if (truckStillThere) { const idx = City.vehicles.indexOf(truckStillThere); City.vehicles.splice(idx, 1); sendWorldEdit('vehicle_remove', { id: truck.id }); }
    announce(`${veh.name} a été remorqué à la fourrière par la dépanneuse.`, 'assertive');
    AudioLib.playNotification();
  }, delay);
};
// Avant, ceci cherchait des POI de type 'camera', qui n'a jamais existé dans
// la génération de ville (voir city.js) : le filtre ne matchait donc jamais
// que les immeubles génériques, et la fonctionnalité "caméra" ne faisait en
// pratique que lister des bâtiments sans aucune information utile. Les vrais
// commerces équipés de caméras (banque, armurerie, magasin, concessionnaire,
// garage, station-service, bar) sont maintenant surveillés pour de vrai :
// pour chacun, on rapporte qui s'y trouve en ce moment (PNJ, joueurs réels,
// individus hostiles repérés), sans avoir à s'y rendre physiquement.
const CAMERA_POI_TYPES = ['banque', 'magasin', 'armurerie', 'bar', 'concessionnaire', 'garage', 'station_essence'];
Game.cameraControl = function() {
  if (!Roles.hasPerm('cameras')) return announce('Réservé à la police.', 'assertive');
  const cams = City.pois.filter(p => CAMERA_POI_TYPES.includes(p.type)).map(p => ({ ...p, dist: UTIL.dist(p, Game) })).sort((a, b) => a.dist - b.dist).slice(0, 6);
  if (!cams.length) return announce('Aucune caméra de surveillance disponible dans cette ville.', 'assertive');
  const parts = cams.map(c => {
    const npcsHere = City.npcs.filter(n => !n.dead && UTIL.dist(n, c) < 5);
    const playersHere = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, c) < 5);
    const hostileCount = npcsHere.filter(n => n.hostile).length;
    const total = npcsHere.length + playersHere.length;
    const activity = total === 0 ? 'rien à signaler' : `${total} personne(s) présente(s)${hostileCount ? `, dont ${hostileCount} individu(s) suspect(s)` : ''}`;
    return `${c.name}, à ${Math.round(c.dist * CONFIG.METERS_PER_TILE)} m : ${activity}`;
  });
  announce('Caméras de surveillance. ' + parts.join('. '), 'assertive');
};

/* ============================================================
   SHOP DIALOG — immersive real menu
============================================================ */
Game.openShopDialog = function(poi) {
  this.shopContext = { poi, stock: poi.stock || [] };
  el('shopName').textContent = poi.name;
  el('shopMoney').textContent = 'Liquide : ' + UTIL.formatMoney(this.money) + ' · Banque : ' + UTIL.formatMoney(this.bank) + ' · Sale : ' + UTIL.formatMoney(this.dirtyMoney);
  const list = el('shopList'); list.innerHTML = '';
  if (!this.shopContext.stock.length) list.innerHTML = '<p style="color:var(--muted);">Stock vide.</p>';
  this.shopContext.stock.forEach((it, i) => {
    const price = BlackMarket.priceFor(it);
    const div = document.createElement('div'); div.className = 'shop-item'; div.tabIndex = 0; div.setAttribute('role', 'button');
    div.innerHTML = `<div class="name">${it.name}</div><div class="price">${UTIL.formatMoney(price)}${it.q > 1 ? ' · stock ' + it.q : ''}</div><div class="desc">${it.desc || ''}</div>`;
    div.addEventListener('click', () => this.buyFromDialog(i));
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.buyFromDialog(i); } });
    list.appendChild(div);
  });
  el('shopDialog').style.display = 'flex';
  // Sans focus automatique, le dialogue s'affichait mais restait invisible/
  // inaccessible au clavier (aucun élément focalisé pour le lire ou naviguer
  // avec Tab) : c'est ce qui donnait l'impression qu'on ne pouvait pas voir
  // le menu de la carte.
  const firstItem = list.querySelector('.shop-item');
  if (firstItem) setTimeout(() => firstItem.focus(), 30);
  announce(`${poi.name} ouvert. ${this.shopContext.stock.length} articles disponibles. Utilisez Tab pour parcourir, Entrée pour acheter.`, 'polite');
};
Game.buyFromDialog = function(index) {
  const it = this.shopContext.stock[index]; if (!it) return;
  const price = BlackMarket.priceFor(it);
  if (this.money < price) return alertUser('Fonds insuffisants.');
  if (it.q <= 0) return alertUser('Rupture de stock.');
  this.money -= price; it.q--;
  const bought = { ...it, q: 1 };
  delete bought.price; bought.price = it.price;
  this.addItem(bought);
  Audio.cash(); el('shopMoney').textContent = 'Liquide : ' + UTIL.formatMoney(this.money) + ' · Banque : ' + UTIL.formatMoney(this.bank) + ' · Sale : ' + UTIL.formatMoney(this.dirtyMoney);
  announce(`Vous achetez ${it.name}.`, 'assertive');
};
Game.closeShopDialog = function() { el('shopDialog').style.display = 'none'; this.shopContext = null; };

// Override talkTo to add role actions
const originalTalkTo = Game.talkTo;
Game.talkTo = function(npc) {
  originalTalkTo.call(this, npc);
  if (npc.job === 'medecin') { this.doctorHeal(npc); }
  if (npc.job === 'mecanicien') { this.mechanicRepair(npc); }
  if (npc.job === 'policier') { this.policeCNI(); }
  if (Roles.current === 'police') { this.policeCNI(); }
};

/* ============================================================
   CONTROL OPTIMIZATION — mobile gestures & Windows shortcuts
============================================================ */
