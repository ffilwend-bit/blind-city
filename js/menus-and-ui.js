// ============================================================
//  MODE CONVOI — plusieurs VRAIS joueurs roulent en groupe et se repèrent
//  mutuellement à l'oreille (distance + cap de chaque membre), avec alerte
//  quand quelqu'un se sépare trop. Un convoi est identifié par un code
//  partagé (comme une fréquence talkie) : tous ceux qui affichent le même
//  code sont membres. Le repérage est 100 % côté client, à partir des
//  positions réseau réelles (Net.remotePlayers) — cohérent avec le fait
//  que les autres joueurs sont de VRAIS joueurs, pas des PNJ.
// ============================================================
const Convoy = {
  code: null,
  SEP_DIST: 40, // séparation (cases) au-delà de laquelle on alerte
  _lastSepWarn: {},
  inConvoy() { return !!this.code; },
  members() {
    if (!this.code || typeof Net === 'undefined' || !Net.connected) return [];
    return Array.from(Net.remotePlayers.values()).filter(p => p && p.convoy === this.code && !p.unconscious);
  },
  create() {
    this.code = String(UTIL.randInt(1000, 9999));
    announce(`Convoi créé. Code du convoi : ${this.code.split('').join(' ')}. Communiquez-le à votre groupe pour qu'il vous rejoigne.`, 'assertive');
  },
  join(code) {
    const c = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (!c) return announce('Code de convoi invalide.', 'assertive');
    this.code = c; this._lastSepWarn = {};
    announce(`Vous rejoignez le convoi ${c.split('').join(' ')}.`, 'assertive');
    setTimeout(() => this.locate(), 500);
  },
  leave() {
    if (!this.code) return announce('Vous n\'êtes dans aucun convoi.', 'polite');
    this.code = null; this._lastSepWarn = {};
    announce('Vous avez quitté le convoi.', 'assertive');
  },
  locate() {
    if (!this.code) return announce('Vous n\'êtes dans aucun convoi. Créez-en un ou rejoignez-en un.', 'assertive');
    if (typeof Net === 'undefined' || !Net.connected) return announce('Le convoi nécessite une connexion au serveur.', 'assertive');
    const mem = this.members();
    if (!mem.length) return announce(`Convoi ${this.code.split('').join(' ')} : aucun autre membre repéré pour le moment.`, 'assertive');
    const parts = mem.map(p => `${p.firstName || 'Membre'}, ${Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE)} mètres vers le ${UTIL.bearing(p.x - Game.x, p.y - Game.y)}`);
    announce(`Convoi, ${mem.length} membre${mem.length > 1 ? 's' : ''} : ${parts.join(' ; ')}.`, 'assertive');
  },
  // Alerte de séparation périodique : prévient quand un membre s'éloigne trop.
  tick() {
    if (!this.code || typeof Net === 'undefined' || !Net.connected) return;
    const now = Date.now();
    this.members().forEach(p => {
      if (UTIL.dist(p, Game) > this.SEP_DIST) {
        if (now - (this._lastSepWarn[p.id] || 0) > 12000) {
          this._lastSepWarn[p.id] = now;
          announce(`${p.firstName || 'Un membre'} du convoi s'éloigne : ${Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE)} mètres vers le ${UTIL.bearing(p.x - Game.x, p.y - Game.y)}.`, 'polite');
        }
      } else { delete this._lastSepWarn[p.id]; }
    });
  },
};
window.Convoy = Convoy;

function openConvoyMenu() {
  el('menuTitle').textContent = '🚗 Convoi';
  const items = [];
  if (Convoy.inConvoy()) {
    items.push({ id: 'locate', title: '📍 Repérer mon convoi', desc: `Distance et direction de chaque membre. Code : ${Convoy.code}.` });
    items.push({ id: 'leave', title: '🚪 Quitter le convoi', desc: 'Vous ne serez plus repéré par le groupe.' });
  } else {
    items.push({ id: 'create', title: '➕ Créer un convoi', desc: 'Génère un code à partager avec votre groupe.' });
    items.push({ id: 'join', title: '🔢 Rejoindre un convoi', desc: 'Saisissez le code communiqué par le groupe.' });
  }
  renderMenu(items, (it) => {
    if (it.id === 'locate') { closeMenu(); Convoy.locate(); }
    else if (it.id === 'leave') { Convoy.leave(); closeMenu(); }
    else if (it.id === 'create') { Convoy.create(); closeMenu(); }
    else if (it.id === 'join') { closeMenu(); AccessibleTextPrompt.open('Rejoindre un convoi', 'Saisissez le code du convoi communiqué par votre groupe.', '', (code) => Convoy.join(code)); }
  });
  el('menuOverlay').style.display = 'flex';
}
function openTalkieMenu() {
  el('menuTitle').textContent = '📻 Talkie-walkie';
  const t = Game.talkie;
  const items = [];
  if (!t.owned) {
    items.push({ id: 'buy', title: '🛒 Acheter un talkie-walkie', desc: 'Prix : 45 000 FCFA. Batterie livrée pleine.' });
  } else {
    items.push({ id: 'power', title: t.on ? '🔴 Éteindre' : '🟢 Allumer', desc: `Batterie : ${Math.round(t.battery * 100)}%. Fréquence : ${t.frequency.toFixed(3)} MHz.` });
    items.push({ id: 'freq', title: '🔢 Régler la fréquence', desc: 'Ouvrir le pavé numérique pour composer une nouvelle fréquence.' });
    items.push({ id: 'ptt', title: '🎙️ Parler (PTT)', desc: t.on ? 'Émettre un message sur la fréquence actuelle.' : 'Allumez d\'abord le talkie.' });
    items.push({ id: 'charge', title: '🔋 Recharger', desc: 'Dans un magasin ou une station-service, contre de l\'argent.' });
    items.push({ id: 'give', title: '🤝 Donner à la cible verrouillée', desc: 'Confier le talkie pour qu\'une autre personne règle la fréquence à votre place.' });
  }
  renderMenu(items, (it) => {
    if (it.id === 'buy') { Game.buyTalkie(); closeMenu(); }
    else if (it.id === 'power') { Game.toggleTalkiePower(); openTalkieMenu(); }
    else if (it.id === 'freq') { closeMenu(); FreqPicker.open(Game.talkie.frequency, (f) => Game.setTalkieFrequency(f)); }
    else if (it.id === 'ptt') { closeMenu(); AccessibleTextPrompt.open('Message talkie-walkie', 'Message à transmettre, facultatif.', '', (msg) => Game.talkiePTT(msg)); }
    else if (it.id === 'charge') { Game.chargeTalkie(); closeMenu(); }
    else if (it.id === 'give') { Game.giveTalkie(); closeMenu(); }
  });
  el('menuOverlay').style.display = 'flex';
}
function openInventoryMenu() {
  el('menuTitle').textContent = '🎒 Inventaire';
  const items = Game.inventory.map(it => ({
    id: it.id, title: `${it.name}${(it.q || 1) > 1 ? ' ×' + it.q : ''}`,
    desc: it.category ? `Catégorie : ${it.category}.` : 'Objet transportable.',
  }));
  if (!items.length) items.push({ id: 'empty', title: 'Inventaire vide', desc: 'Vous ne portez rien pour le moment.' });
  renderMenu(items, (it) => { if (it.id !== 'empty') openItemActionMenu(it.id); });
  el('menuOverlay').style.display = 'flex';
}
function openItemActionMenu(itemId) {
  const it = Game.inventory.find(i => i.id === itemId);
  if (!it) return openInventoryMenu();
  const qty = it.q || 1;
  el('menuTitle').textContent = `${it.name}${qty > 1 ? ' ×' + qty : ''}`;
  const actions = [
    { id: 'use', title: '🖐️ Utiliser / Porter', desc: 'Utiliser, porter ou consommer cet objet.' },
    { id: 'give', title: '🤝 Donner', desc: qty > 1 ? `Choisir la quantité à donner (jusqu'à ${qty}) à la cible verrouillée.` : 'Donner l\'objet à la cible verrouillée.' },
    { id: 'sellnpc', title: '💰 Vendre à un passant', desc: 'Proposer l\'objet à un passant proche ; s\'il a le budget, il vient l\'acheter. Le prix dépend du quartier.' },
    { id: 'vendor', title: (Game.vendorMode ? '🛑 Arrêter la vente automatique' : '🛒 Vente automatique (activer)'), desc: Game.vendorMode ? 'Vous vendez déjà en continu. Arrêter et faire le bilan.' : 'Installer votre étal : les passants viendront acheter cet objet tout seuls, tant que vous restez sur place.' },
    { id: 'drop', title: '⬇️ Déposer au sol', desc: qty > 1 ? `Choisir la quantité à déposer (jusqu'à ${qty}).` : 'Déposer l\'objet au sol.' },
    { id: 'back', title: '↩️ Retour à l\'inventaire', desc: 'Revenir à la liste des objets.' },
  ];
  renderMenu(actions, (a) => {
    if (a.id === 'back') { openInventoryMenu(); return; }
    if (a.id === 'use') { Game.useItem(itemId); closeMenu(); return; }
    if (a.id === 'give') {
      if (qty > 1) QtyPicker.open(`Donner ${it.name}`, qty, (n) => { Game.giveItem(itemId, null, n); });
      else Game.giveItem(itemId, null, 1);
      closeMenu(); return;
    }
    if (a.id === 'sellnpc') {
      if (qty > 1) QtyPicker.open(`Vendre ${it.name} à un passant`, qty, (n) => { Game.sellToNPC(itemId, n); });
      else Game.sellToNPC(itemId, 1);
      closeMenu(); return;
    }
    if (a.id === 'vendor') { Game.toggleVendorMode(itemId); closeMenu(); return; }
    if (a.id === 'drop') {
      if (qty > 1) QtyPicker.open(`Déposer ${it.name}`, qty, (n) => { Game.dropItem(itemId, n); });
      else Game.dropItem(itemId, 1);
      closeMenu(); return;
    }
  });
}
function openMainMenu() {
  el('menuTitle').textContent = 'Menu principal';
  const items = [
    { id: 'vehicles', title: '🚗 Véhicules', desc: 'Garage, conduite automatique, acheter/vente.' },
    { id: 'weapons', title: '🔫 Armes', desc: 'Équiper, recharger, acheter munitions.' },
    { id: 'inventory', title: '🎒 Inventaire', desc: 'Consulter, utiliser, vendre, donner ou déposer vos objets.' },
    { id: 'missions', title: '🎯 Missions', desc: 'Voir et activer des missions.' },
    { id: 'shops', title: '🛒 Boutiques', desc: 'Magasins, marché noir, concessionnaire.' },
    { id: 'talkie', title: '📻 Talkie-walkie', desc: 'Acheter, allumer, régler la fréquence, recharger, parler.' },
    { id: 'rptalk', title: '💬 Parler (RP)', desc: 'Dire un message audible par les joueurs réels proches de vous.' },
    { id: 'map', title: '🗺️ Carte', desc: 'Liste des lieux et navigation.' },
    { id: 'places', title: '📍 Lieux utiles', desc: 'Station-service la plus proche, boutique de vêtements, restaurant.' },
    { id: 'helmet', title: '🪖 Acheter un casque', desc: 'Protection contre un tir ou un coup à la tête, sinon mortel.' },
    { id: 'vest', title: '🦺 Acheter un gilet pare-balles', desc: 'Réduit les dégâts d\'un tir au corps.' },
    { id: 'burnerphone', title: '📱 Acheter un téléphone prépayé', desc: 'Un numéro de plus, renommable.' },
    { id: 'role', title: '🛡️ Métiers', desc: 'Demander un métier : police, médecin, garagiste, concessionnaire, agent immobilier, avocat, mineur...' },
    { id: 'outfit', title: '🧥 Ma tenue', desc: 'Ce que vous portez actuellement (haut, bas, chaussures, accessoires).' },
    { id: 'admin', title: '🛠️ Administration', desc: 'Mode staff : approuver les métiers, nommer des recruteurs.' },
    { id: 'save', title: '💾 Sauvegarder', desc: 'Enregistrer la partie.' },
    { id: 'bills', title: '🧾 Mes factures', desc: `Factures reçues à payer${Game.pendingBills.length ? ' (' + Game.pendingBills.length + ' en attente)' : ''}.` },
    { id: 'paycash', title: '💵 Payer en liquide', desc: 'Donner de l\'argent directement, ou le déposer au sol pour que l\'autre le ramasse.' },
    { id: 'sharegps', title: '📍 Partager ma position GPS', desc: 'Envoyer votre position à un joueur réel : il sera guidé vocalement, automatiquement, jusqu\'à vous.' },
    { id: 'realtaxi', title: '🚕 Appeler un vrai chauffeur', desc: 'Un joueur réel chauffeur professionnel viendra vous chercher, s\'il accepte.' },
    { id: 'callmechanic', title: '🔧 Appeler un garagiste', desc: 'Pour venir réparer votre véhicule sur place. Montez d\'abord dedans.' },
    { id: 'help', title: '❓ Aide', desc: 'Rappel vocal de toutes les commandes du jeu.' },
  ];
  if (['police', 'medecin', 'mecanicien', 'mineur_pro'].includes(Roles.current)) {
    items.splice(items.length - 1, 0, { id: 'myjob', title: '🧰 Menu de mon métier', desc: 'Actions propres à votre métier actuel.' });
  }
  if (Game.inWater) {
    items.push({ id: 'dive', title: '🌊 Plonger / remonter', desc: 'Basculer entre nager en surface et sous l\'eau.' });
  }
  renderMenu(items, handleMenuItem);
  el('menuOverlay').style.display = 'flex';
  announce('Menu principal ouvert. Choisissez une rubrique. Une carte Retour, deux doigts vers la gauche, ou la touche Échap, ramènent au niveau précédent.', 'polite');
}
// Historique des menus pour la fonction « Retour ». Tous les menus passent par
// renderMenu ; on y mémorise (titre, items, handler) de chaque menu affiché,
// ce qui permet de revenir au menu précédent d'un seul geste, sans que chaque
// sous-menu ait à gérer son propre bouton retour.
const MenuNav = { stack: [], navigating: false };
function renderMenu(items, handler) {
  const c = el('menuContent'); c.innerHTML = '';
  const title = el('menuTitle') ? el('menuTitle').textContent : '';
  if (MenuNav.navigating) {
    // On est en train de revenir en arrière : ne pas ré-empiler le menu.
    MenuNav.navigating = false;
  } else {
    // Si ce menu est déjà dans la pile (même titre), on déroule jusqu'à lui au
    // lieu d'empiler un doublon (cas d'un menu qui se ré-affiche après une
    // action, ou d'un retour explicite vers un menu parent).
    const idx = MenuNav.stack.findIndex(s => s.title === title);
    if (idx >= 0) { MenuNav.stack.length = idx + 1; MenuNav.stack[idx] = { title, items, handler }; }
    else MenuNav.stack.push({ title, items, handler });
  }
  items.forEach((it, i) => {
    const card = document.createElement('div'); card.className = 'menu-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.innerHTML = `<h4>${it.title}</h4><p>${it.desc}</p>`;
    card.addEventListener('click', () => handler(it));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(it); } });
    c.appendChild(card);
  });
  // Carte « Retour » ajoutée automatiquement dès qu'un menu précédent existe.
  if (MenuNav.stack.length > 1) {
    const prevTitle = MenuNav.stack[MenuNav.stack.length - 2].title;
    const back = document.createElement('div'); back.className = 'menu-card menu-card-back'; back.tabIndex = 0; back.setAttribute('role', 'button');
    back.innerHTML = `<h4>↩️ Retour</h4><p>Revenir au menu précédent${prevTitle ? ' : ' + prevTitle : ''}.</p>`;
    back.addEventListener('click', menuGoBack);
    back.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menuGoBack(); } });
    c.appendChild(back);
  }
  const first = c.querySelector('.menu-card');
  if (first) setTimeout(() => first.focus(), 30);
  announceTouchLabels();
}
// Remonte d'un niveau dans les menus. Au menu racine, ferme le menu.
function menuGoBack() {
  if (MenuNav.stack.length <= 1) { closeMenu(); return; }
  MenuNav.stack.pop();
  const prev = MenuNav.stack[MenuNav.stack.length - 1];
  if (el('menuTitle')) el('menuTitle').textContent = prev.title;
  MenuNav.navigating = true;
  renderMenu(prev.items, prev.handler);
  announce('Retour : ' + prev.title, 'polite');
}
function handleMenuItem(it) {
  if (it.id === 'vehicles') openVehicleMenu();
  else if (it.id === 'weapons') openWeaponsMenu();
  else if (it.id === 'inventory') { openInventoryMenu(); }
  else if (it.id === 'missions') { Game.openMissions(); closeMenu(); }
  else if (it.id === 'shops') openShopsMenu();
  else if (it.id === 'talkie') { openTalkieMenu(); }
  else if (it.id === 'rptalk') { Game.rpTalk(); closeMenu(); }
  else if (it.id === 'map') openMapMenu();
  else if (it.id === 'help') { Game.help(); closeMenu(); }
  else if (it.id === 'role') { openRoleMenu(); }
  else if (it.id === 'places') { openNearestMenu(); }
  else if (it.id === 'outfit') { Game.customizeAppearance(); }
  else if (it.id === 'admin') { openAdminMenu(); }
  else if (it.id === 'save') { Game.save(); closeMenu(); }
  else if (it.id === 'helmet') { Game.buyHelmet(); closeMenu(); }
  else if (it.id === 'vest') { Game.buyVest(); closeMenu(); }
  else if (it.id === 'burnerphone') { Game.buyBurnerPhone(); closeMenu(); }
  else if (it.id === 'dive') { Game.diveInWater(); closeMenu(); }
  else if (it.id === 'myjob') { Game.openMyJobMenu(); }
  else if (it.id === 'bills') { Game.openMyBills(); }
  else if (it.id === 'paycash') { Game.openPayCashMenu(); }
  else if (it.id === 'sharegps') { openShareGpsMenu(); }
  else if (it.id === 'realtaxi') { closeMenu(); Game.callRealTaxiDriver(); }
  else if (it.id === 'callmechanic') { closeMenu(); Game.callMechanic(); }
}
function closeMenu() { el('menuOverlay').style.display = 'none'; MenuNav.stack = []; MenuNav.navigating = false; document.activeElement?.blur(); }
// Choisir à quel joueur réel connecté envoyer sa position GPS.
function openShareGpsMenu() {
  el('menuTitle').textContent = 'Partager ma position GPS';
  if (!Net.connected) { renderMenu([{ id: 'none', title: 'Hors ligne', desc: 'Le partage de position nécessite une connexion au serveur multijoueur.' }], () => closeMenu()); return; }
  const players = Array.from(Net.remotePlayers.values());
  if (!players.length) { renderMenu([{ id: 'none', title: 'Aucun joueur connecté', desc: 'Personne à qui envoyer votre position pour le moment.' }], () => closeMenu()); return; }
  const items = players.map(p => ({ id: p.id, title: `${p.firstName} ${p.lastName}`, desc: `À ${Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE)} mètres. Lui envoyer votre position pour qu'il soit guidé jusqu'à vous.` }));
  renderMenu(items, (sel) => {
    const p = players.find(pp => pp.id === sel.id);
    closeMenu();
    if (p) Game.shareMyGPS(p.id, `${p.firstName} ${p.lastName}`);
  });
}
function openRoleMenu() {
  el('menuTitle').textContent = 'Métiers de la ville';
  const items = Object.entries(Roles.list).filter(([k, v]) => !v.hidden).map(([k, v]) => ({
    id: k, title: v.name,
    desc: v.free ? 'Rôle libre, aucune validation nécessaire.' : `Compétences : ${v.perms.join(', ')}. Nécessite la validation d'un administrateur ou d'un recruteur habilité.`
  }));
  if (Roles.pending) items.unshift({ id: 'pending_info', title: `⏳ Candidature en attente : ${Roles.list[Roles.pending.role].name}`, desc: 'Un administrateur ou un recruteur doit encore valider votre demande.' });
  if (StaffMode.active && Roles.pending) {
    items.push({ id: 'approve', title: '✅ Approuver (staff)', desc: 'Valider la candidature en attente.' });
    items.push({ id: 'reject', title: '❌ Refuser (staff)', desc: 'Refuser la candidature en attente.' });
  }
  renderMenu(items, (it) => {
    if (it.id === 'pending_info') return;
    if (it.id === 'approve') { Roles.approve(); closeMenu(); return; }
    if (it.id === 'reject') { Roles.reject(); closeMenu(); return; }
    Roles.applyFor(it.id); closeMenu();
  });
}
function openNearestMenu() {
  ensureMenuOpen();
  el('menuTitle').textContent = 'Lieux utiles les plus proches';
  const types = [
    { type: 'station_essence', label: '⛽ Station-service (essence + recharge électrique)' },
    { type: 'vetements', label: '👕 Boutique de vêtements' },
    { type: 'restaurant', label: '🍽️ Restaurant' },
  ];
  const items = types.map(t => {
    const list = City.pois.filter(p => p.type === t.type).map(p => ({ ...p, dist: UTIL.dist(p, Game) })).sort((a, b) => a.dist - b.dist);
    const nearest = list[0];
    return nearest
      ? { id: nearest.id, title: t.label, desc: `${nearest.name}, ${Math.round(nearest.dist)} m, cap ${UTIL.bearing(nearest.x - Game.x, nearest.y - Game.y)}.` }
      : { id: 'none_' + t.type, title: t.label, desc: 'Aucun lieu de ce type dans la ville pour le moment.' };
  });
  renderMenu(items, (it) => {
    const poi = City.pois.find(p => p.id === it.id);
    closeMenu();
    if (poi) { announce(`Direction ${poi.name}.`, 'assertive'); guideToPoi(poi); }
  });
}
function openAdminMenu() {
  el('menuTitle').textContent = 'Administration (mode staff)';
  const items = [];
  items.push({ id: 'toggle', title: StaffMode.active ? '🔓 Désactiver le mode staff' : '🔒 Activer le mode staff', desc: StaffMode.active ? `Actif (${StaffMode.role === 'principal' ? 'administrateur principal' : 'modérateur'}).` : 'Un code administrateur sera demandé.' });
  if (StaffMode.active) {
    items.push({ id: 'log', title: '📜 Journal d\'activité', desc: `${StaffMode.log.length} évènement(s) récent(s) : connexions, changements de métier, crimes signalés...` });
    items.push({ id: 'testrole', title: '🧪 Tester un métier', desc: 'Basculer temporairement sur n\'importe quel métier pour reproduire un bug signalé.' });
    items.push({ id: 'cheats', title: '🛠️ Accès total aux fonctionnalités', desc: 'Argent, soin complet, arsenal, véhicule, téléportation — pour tout tester rapidement.' });
    items.push({ id: 'citygrow', title: '🏗️ Agrandir la ville', desc: `Taille actuelle : ${City.W} × ${City.H}. Ajouter un quartier, un service (boutique, restaurant, garage...).` });
    items.push({ id: 'ban', title: '🚫 Bannir un joueur connecté', desc: 'Coupe sa connexion et bloque son adresse pour l\'avenir.' });
    if (StaffMode.role === 'principal') {
      items.push({ id: 'unban', title: '🔓 Gérer les bannissements', desc: 'Voir et lever les bannissements existants.' });
      items.push({ id: 'codes', title: '🔑 Changer les codes admin', desc: 'Réservé à l\'administrateur principal.' });
    }
    items.push({ id: 'pending', title: '📋 Candidature en attente', desc: Roles.pending ? `${Roles.pending.applicant} demande : ${Roles.list[Roles.pending.role].name}.` : 'Aucune candidature en attente.' });
    if (Roles.pending) {
      items.push({ id: 'approve', title: '✅ Approuver la candidature', desc: 'Valide le métier demandé.' });
      items.push({ id: 'reject', title: '❌ Refuser la candidature', desc: 'Refuse le métier demandé.' });
    }
    items.push({ id: 'recruiter', title: '🧑‍💼 Nommer un recruteur', desc: 'Autoriser une personne à valider les candidatures d\'un métier précis (chaque patron peut recruter ses employés).' });
    items.push({ id: 'pendingaccounts', title: '🎭 Comptes en attente (entretien RP)', desc: 'Voir les nouveaux comptes dont l\'entretien RP n\'a pas été assez concluant, et décider de les accepter ou non.' });
  }
  renderMenu(items, (it) => {
    if (it.id === 'toggle') {
      if (StaffMode.active) { StaffMode.toggle(); closeMenu(); }
      else { closeMenu(); AccessibleTextPrompt.open('Code administrateur', 'Saisissez le code du mode staff.', '', (code) => { if (code) StaffMode.toggle(code); }); }
    } else if (it.id === 'log') { openStaffLogMenu(); }
    else if (it.id === 'testrole') { openStaffRoleTestMenu(); }
    else if (it.id === 'cheats') { openStaffCheatMenu(); }
    else if (it.id === 'citygrow') { openStaffCityMenu(); }
    else if (it.id === 'ban') { openStaffBanMenu(); }
    else if (it.id === 'unban') { openStaffUnbanMenu(); }
    else if (it.id === 'codes') { openStaffCodeMenu(); }
    else if (it.id === 'approve') { Roles.approve(); closeMenu(); }
    else if (it.id === 'reject') { Roles.reject(); closeMenu(); }
    else if (it.id === 'recruiter') {
      closeMenu();
      AccessibleTextPrompt.open('Identifiant du métier', 'Exemples : concessionnaire, agent_immo, avocat, mecanicien, medecin, mineur_pro, police.', '', (role) => {
        if (!role || !Roles.list[role]) return announce('Métier inconnu.', 'assertive');
        AccessibleTextPrompt.open('Nom du recruteur', 'Nom de la personne à nommer recruteur pour ce métier.', '', (name) => {
          if (name) Roles.appointRecruiter(role, name);
        });
      });
    }
    else if (it.id === 'pendingaccounts') { openStaffPendingAccountsMenu(); }
  });
}
function openStaffPendingAccountsMenu() {
  if (!Net.connected) { closeMenu(); return announce('Nécessite une connexion au serveur.', 'assertive'); }
  Net.send({ type: 'staff_list_pending_accounts' });
  Net._pendingAccountsCallback = (accounts) => {
    el('menuTitle').textContent = 'Comptes en attente';
    if (!accounts.length) { renderMenu([{ id: 'empty', title: 'Aucun compte en attente', desc: '' }], () => {}); return; }
    const items = accounts.map(a => ({
      id: a.username,
      title: `${a.realFirstName} ${a.realLastName} (@${a.username})`,
      desc: `Entretien RP : ${a.rpScore}/${a.rpTotal}.`,
    }));
    renderMenu(items, (sel) => {
      el('menuTitle').textContent = `Compte @${sel.id}`;
      const subItems = [
        { id: 'approve', title: '✅ Approuver', desc: 'Le compte pourra se connecter.' },
        { id: 'reject', title: '❌ Rejeter', desc: 'Le compte restera bloqué.' },
        { id: 'back', title: '↩️ Retour', desc: '' },
      ];
      renderMenu(subItems, (sub) => {
        if (sub.id === 'back') return openStaffPendingAccountsMenu();
        if (sub.id === 'approve' || sub.id === 'reject') {
          Net.send({ type: 'staff_review_account', username: sel.id, approve: sub.id === 'approve' });
          closeMenu();
        }
      });
    });
  };
}
const DISTRICT_TYPES = {
  residentiel: 'Résidentiel', commercial: 'Commercial', industriel: 'Industriel',
  centre: 'Centre-ville', parc: 'Parc', ghetto: 'Quartier chaud', port: 'Portuaire',
  aeroport: 'Aéroport', mine: 'Zone minière',
};
const SERVICE_TYPES = {
  magasin: 'Boutique / magasin', restaurant: 'Restaurant', garage: 'Garage / concession auto',
  banque: 'Banque', hopital: 'Hôpital', police: 'Commissariat de police',
  prison: 'Prison', immeuble: 'Immeuble (logements)',
  tribunal: 'Cour pénale (tribunal)', monument: 'Monument de la Musique',
  gouvernorat: 'Gouvernorat', morgue: 'Morgue', cimetiere: 'Cimetière',
};
// Applique une modification de ville (agrandissement, quartier, service),
// que ce soit localement (solo) ou reçue du serveur (multijoueur, pour que
// tout le monde voie exactement les mêmes changements).
function applyCityEdit(op, payload) {
  if (op === 'grow') City.growCity(payload.extra, payload.direction);
  else if (op === 'addDistrict') City.addDistrict(payload.name, payload.type, payload.x1, payload.y1, payload.x2, payload.y2);
  else if (op === 'addPOI') City.addPOI(payload.name, payload.type, payload.districtName, payload.floors);
}
// Envoie une modification de ville : au serveur si connecté (persisté et
// diffusé à tous les joueurs), sinon appliquée seulement localement (solo).
function sendCityEdit(op, payload) {
  if (Net.connected) Net.send({ type: 'city_edit', op, payload });
  else applyCityEdit(op, payload);
}
window.applyCityEdit = applyCityEdit; window.sendCityEdit = sendCityEdit;

// Même principe que les modifications de ville, mais pour les objets du monde
// qui changent par le jeu normal (achat de véhicule/maison, stationnement...) :
// accessible à tout joueur, pas seulement au staff.
function applyWorldEdit(op, payload) {
  if (op === 'vehicle_create') {
    if (!City.vehicles.find(v => v.id === payload.id)) City.vehicles.push({ ...payload, inventory: payload.inventory || [], passengers: [], openDoors: new Set() });
  } else if (op === 'vehicle_position') {
    const v = City.vehicles.find(v => v.id === payload.id);
    if (v) { v.x = payload.x; v.y = payload.y; if (typeof payload.locked === 'boolean') v.locked = payload.locked; }
  } else if (op === 'vehicle_lock') {
    const v = City.vehicles.find(v => v.id === payload.id);
    if (v) v.locked = payload.locked;
  } else if (op === 'house_owner') {
    const h = City.houses.find(h => h.id === payload.id);
    if (h) h.owner = payload.owner;
  } else if (op === 'house_keys') {
    const h = City.houses.find(h => h.id === payload.id);
    if (h) h.authorizedUsers = payload.authorizedUsers;
  } else if (op === 'vehicle_remove') {
    const idx = City.vehicles.findIndex(v => v.id === payload.id);
    if (idx !== -1) City.vehicles.splice(idx, 1);
  }
}
function sendWorldEdit(op, payload) {
  if (Net.connected) Net.send({ type: 'world_edit', op, payload });
}
window.applyWorldEdit = applyWorldEdit; window.sendWorldEdit = sendWorldEdit;

function openStaffCityMenu() {
  el('menuTitle').textContent = `Agrandissement de la ville (${City.W} × ${City.H})`;
  const items = [
    { id: 'grow', title: '📐 Étendre la carte', desc: 'Ajoute de l\'espace neuf à l\'est ou au sud de la ville, pour pouvoir y bâtir un nouveau quartier.' },
    { id: 'district', title: '🏘️ Ajouter un quartier', desc: `${City.districts.length} quartier(s) existant(s). Choisissez un type et une zone.` },
    { id: 'service', title: '🏪 Ajouter un service (boutique, restaurant, garage...)', desc: 'Placé dans un quartier existant ou nouvellement ajouté.' },
    { id: 'list', title: '📋 Voir les quartiers existants', desc: 'Liste des quartiers et leurs coordonnées.' },
  ];
  renderMenu(items, (it) => {
    if (it.id === 'grow') openStaffGrowMenu();
    else if (it.id === 'district') openStaffAddDistrictMenu();
    else if (it.id === 'service') openStaffAddServiceMenu();
    else if (it.id === 'list') openStaffDistrictListMenu();
  });
}
function openStaffGrowMenu() {
  el('menuTitle').textContent = 'Étendre la carte';
  const items = [
    { id: 'est', title: '➡️ Étendre vers l\'est', desc: `Largeur actuelle : ${City.W}. Ajoute de l'espace à droite de la carte.` },
    { id: 'sud', title: '⬇️ Étendre vers le sud', desc: `Hauteur actuelle : ${City.H}. Ajoute de l'espace en bas de la carte.` },
  ];
  renderMenu(items, (it) => {
    closeMenu();
    AccessibleTextPrompt.open('Étendre la carte', 'Combien de cases ajouter ? Exemple : 60.', '60', (amountStr) => {
      const amount = parseInt(amountStr, 10);
      if (!amount || amount < 10) return announce('Valeur invalide (minimum 10).', 'assertive');
      const wasConnected = Net.connected;
      sendCityEdit('grow', { extra: amount, direction: it.id });
      const label = it.id === 'sud' ? 'vers le sud' : 'vers l\'est';
      announce(wasConnected
        ? `Demande d'agrandissement ${label} envoyée (${amount} cases) — appliquée pour tous les joueurs connectés.`
        : `Ville agrandie ${label}. Nouvelle taille : ${City.W} × ${City.H}.`, 'assertive');
    });
  });
}
function openStaffAddDistrictMenu() {
  el('menuTitle').textContent = 'Ajouter un quartier — choisir le type';
  const items = Object.entries(DISTRICT_TYPES).map(([id, label]) => ({ id, title: label, desc: `Créer un quartier de type ${label}.` }));
  renderMenu(items, (typeSel) => {
    closeMenu();
    AccessibleTextPrompt.open('Nom du nouveau quartier', '', DISTRICT_TYPES[typeSel.id], (name) => {
      if (!name) return;
      AccessibleTextPrompt.open(
        'Coordonnées du quartier',
        `Format x1,y1,x2,y2. La carte fait actuellement ${City.W} × ${City.H} : utilisez l'espace ajouté via "Étendre la carte" si besoin.`,
        `${City.W - 60},10,${City.W - 10},70`,
        (coords) => {
          if (!coords) return;
          const [x1, y1, x2, y2] = coords.split(',').map(s => parseInt(s.trim(), 10));
          if ([x1, y1, x2, y2].some(n => isNaN(n)) || x2 <= x1 || y2 <= y1) return announce('Coordonnées invalides.', 'assertive');
          if (x2 >= City.W || y2 >= City.H) return announce(`Ces coordonnées dépassent la taille actuelle de la carte (${City.W} × ${City.H}). Étendez d'abord la carte.`, 'assertive');
          const wasConnected = Net.connected;
          sendCityEdit('addDistrict', { name, type: typeSel.id, x1, y1, x2, y2 });
          announce(wasConnected
            ? `Demande d'ajout du quartier "${name}" envoyée — appliquée pour tous les joueurs connectés.`
            : `Quartier "${name}" (${DISTRICT_TYPES[typeSel.id]}) créé, de (${x1},${y1}) à (${x2},${y2}).`, 'assertive');
        }
      );
    });
  });
}
function openStaffAddServiceMenu() {
  el('menuTitle').textContent = 'Ajouter un service — choisir le type';
  const items = Object.entries(SERVICE_TYPES).map(([id, label]) => ({ id, title: label, desc: `Placer un(e) ${label.toLowerCase()}.` }));
  renderMenu(items, (typeSel) => {
    const districtItems = City.districts.map(d => ({ id: d.name, title: d.name, desc: `Type : ${DISTRICT_TYPES[d.type] || d.type}.` }));
    el('menuTitle').textContent = `Dans quel quartier placer : ${SERVICE_TYPES[typeSel.id]} ?`;
    renderMenu(districtItems, (distSel) => {
      closeMenu();
      AccessibleTextPrompt.open(`Nom du service`, `Nom de ce/cette ${SERVICE_TYPES[typeSel.id].toLowerCase()}.`, SERVICE_TYPES[typeSel.id], (name) => {
        if (!name) return;
        const wasConnected = Net.connected;
        sendCityEdit('addPOI', { name, type: typeSel.id, districtName: distSel.id });
        announce(wasConnected
          ? `Demande d'ajout de "${name}" envoyée dans le quartier ${distSel.id} — appliquée pour tous les joueurs connectés.`
          : `"${name}" ajouté dans le quartier ${distSel.id}.`, 'assertive');
      });
    });
  });
}
function openStaffDistrictListMenu() {
  el('menuTitle').textContent = `Quartiers existants (${City.districts.length})`;
  const items = City.districts.map(d => ({ id: d.name, title: d.name, desc: `Type : ${DISTRICT_TYPES[d.type] || d.type}. De (${d.x1},${d.y1}) à (${d.x2},${d.y2}).` }));
  renderMenu(items, () => {});
}
function openStaffLogMenu() {
  el('menuTitle').textContent = 'Journal d\'activité (staff)';
  const items = StaffMode.log.length
    ? StaffMode.log.slice(0, 40).map((entry, i) => ({ id: 'e' + i, title: new Date(entry.time).toLocaleTimeString('fr-FR'), desc: entry.text }))
    : [{ id: 'empty', title: 'Aucun évènement pour l\'instant', desc: 'Le journal se remplit en direct dès qu\'un joueur agit sur le serveur.' }];
  renderMenu(items, () => {}); // lecture seule : chaque carte annonce juste son contenu au focus
}
function openStaffRoleTestMenu() {
  el('menuTitle').textContent = 'Tester un métier';
  const items = Object.keys(Roles.list).map(id => ({ id, title: Roles.list[id].name, desc: id === Roles.current ? 'Métier actuel.' : 'Basculer sur ce métier pour test.' }));
  renderMenu(items, (it) => { Roles.set(it.id); closeMenu(); });
}
function openStaffCheatMenu() {
  el('menuTitle').textContent = 'Accès total (staff)';
  const items = [
    { id: 'money', title: '💰 Ajouter de l\'argent', desc: 'Ajoute 500 000 FCFA à votre compte.' },
    { id: 'heal', title: '❤️ Soin complet', desc: 'Rétablit votre santé au maximum.' },
    { id: 'weapons', title: '🔫 Débloquer toutes les armes', desc: 'Ajoute chaque arme du jeu à votre inventaire.' },
    { id: 'vehicle', title: '🚗 Faire apparaître un véhicule', desc: 'Fait apparaître une voiture juste à côté de vous.' },
    { id: 'teleport', title: '📍 Téléportation', desc: 'Se téléporter à des coordonnées précises.' },
    { id: 'wanted', title: '🚓 Remettre le niveau de recherche à zéro', desc: 'Efface votre niveau de recherche policière.' },
  ];
  renderMenu(items, (it) => {
    if (it.id === 'money') { Game.money += 500000; announce('500 000 FCFA ajoutés.', 'assertive'); updateHud(); closeMenu(); }
    else if (it.id === 'heal') { Game.health = 100; announce('Santé rétablie au maximum.', 'assertive'); updateHud(); closeMenu(); }
    else if (it.id === 'weapons') {
      Game.weapons = Game.weapons || [];
      Object.keys(WEAPON_CATALOG || {}).forEach(w => { if (!Game.weapons.includes(w)) Game.weapons.push(w); });
      announce('Toutes les armes ont été débloquées.', 'assertive');
      updateHud(); closeMenu();
    } else if (it.id === 'vehicle') {
      closeMenu();
      AccessibleTextPrompt.open('Type de véhicule', 'Exemples : berline, moto, camion.', 'berline', (type) => {
        (Game.spawnStaffVehicle ? Game.spawnStaffVehicle(type || 'berline') : announce('Fonction de génération de véhicule indisponible.', 'assertive'));
        updateHud();
      });
    } else if (it.id === 'teleport') {
      closeMenu();
      AccessibleTextPrompt.open('Téléportation', 'Coordonnées X,Y. Exemple : 120,120.', '', (coords) => {
        if (coords) {
          const [x, y] = coords.split(',').map(s => parseInt(s.trim(), 10));
          if (!isNaN(x) && !isNaN(y)) { Game.x = x; Game.y = y; announce(`Téléporté en (${x}, ${y}).`, 'assertive'); }
          else announce('Coordonnées invalides.', 'assertive');
        }
        updateHud();
      });
    } else if (it.id === 'wanted') { Game.wanted = 0; announce('Niveau de recherche remis à zéro.', 'assertive'); updateHud(); closeMenu(); }
  });
}
function openStaffBanMenu() {
  el('menuTitle').textContent = 'Bannir un joueur';
  const items = Array.from(Net.remotePlayers.entries()).map(([pid, p]) => ({ id: pid, title: `${p.firstName} ${p.lastName}`, desc: `Identifiant ${pid}.` }));
  if (!items.length) items.push({ id: 'empty', title: 'Aucun autre joueur connecté', desc: 'Il n\'y a personne à bannir pour le moment.' });
  renderMenu(items, (it) => {
    if (it.id === 'empty') { closeMenu(); return; }
    closeMenu();
    AccessibleTextPrompt.open('Bannissement', `Raison du bannissement de ${it.title} ?`, '', (reason) => {
      Net.send({ type: 'staff_ban', targetId: it.id, reason: reason || '' });
      announce(`Demande de bannissement envoyée pour ${it.title}.`, 'assertive');
    });
  });
}
function openStaffUnbanMenu() {
  el('menuTitle').textContent = 'Bannissements en cours';
  Net.send({ type: 'staff_list_bans' });
  const items = (StaffMode.bansList || []).map((b, i) => ({ id: String(i), title: b.name, desc: `${b.reason} — banni par ${b.byName}. Sélectionner pour lever ce bannissement.` }));
  if (!items.length) items.push({ id: 'empty', title: 'Aucun bannissement enregistré', desc: 'La liste se met à jour automatiquement.' });
  renderMenu(items, (it) => {
    if (it.id === 'empty') { closeMenu(); return; }
    const ban = StaffMode.bansList[parseInt(it.id, 10)];
    if (ban) Net.send({ type: 'staff_unban', ip: ban.ip });
    closeMenu();
  });
}
function openStaffCodeMenu() {
  el('menuTitle').textContent = 'Changer les codes admin';
  const items = [
    { id: 'principal', title: '🔑 Code administrateur principal', desc: 'Change le code du niveau le plus élevé.' },
    { id: 'moderateur', title: '🔑 Code modérateur', desc: 'Change le code du niveau modérateur.' },
  ];
  renderMenu(items, (it) => {
    closeMenu();
    AccessibleTextPrompt.open('Nouveau code', `Nouveau code pour "${it.id}", 6 caractères minimum.`, '', (newCode) => {
      if (newCode) Net.send({ type: 'staff_change_code', which: it.id, newCode });
    });
  });
}
function openVehicleMenu() {
  el('menuTitle').textContent = 'Véhicules';
  const items = [
    { id: 'garage', title: 'Sortir mon véhicule', desc: 'Faire sortir votre véhicule du garage.' },
    { id: 'info', title: 'Infos véhicule', desc: 'Puissance, essence, état, portes, passagers.' },
    { id: 'doors', title: 'Portes et coffre', desc: 'Ouvrir ou fermer les portes du véhicule proche.' },
    { id: 'trunk', title: 'Coffre : objets', desc: 'Déposer ou récupérer un objet dans le coffre du véhicule où vous êtes.' },
    { id: 'window', title: 'Vitre', desc: 'Monter ou descendre la vitre du véhicule où vous êtes.' },
    { id: 'auto', title: 'Conduite automatique', desc: 'Choisir une destination et laisser le véhicule conduire.' },
    { id: 'manual', title: 'Conduite manuelle', desc: 'Flèches pour avancer, tourner, freiner. Espace pour freiner.' },
    { id: 'buy', title: 'Acheter un véhicule', desc: 'Concessionnaire : voitures, motos, avions, hélicoptères.' },
  ];
  if (Game.inVehicle && Game.vehicle?.type === 'char') items.push({ id: 'cannon', title: 'Tirer au canon', desc: 'Réservé au char d\'assaut, rechargement de 8 secondes.' });
  renderMenu(items, (it) => {
    if (it.id === 'garage') { Game.openGarage(); closeMenu(); }
    else if (it.id === 'info') { Game.openVehicleMenu(); closeMenu(); }
    else if (it.id === 'doors') { openVehicleDoorsMenu(); }
    else if (it.id === 'trunk') { Game.openTrunkMenu(); }
    else if (it.id === 'window') { Game.toggleWindow(); closeMenu(); }
    else if (it.id === 'cannon') { Game.fireTankCannon(); closeMenu(); }
    else if (it.id === 'auto') { Game.autoDriveMenu(); closeMenu(); }
    else if (it.id === 'manual') { announce('Flèches pour conduire, espace pour freiner.', 'polite'); closeMenu(); }
    else if (it.id === 'buy') { const poi = City.pois.find(p => p.type === 'concessionnaire'); if (poi) Game.openVehicleShop(poi); closeMenu(); }
  });
}
function openVehicleDoorsMenu() {
  el('menuTitle').textContent = 'Portes du véhicule';
  const doors = ['porte_conducteur', 'porte_passager_avant_droit', 'porte_passager_avant_gauche', 'porte_passager_arriere_droit', 'porte_passager_arriere_gauche', 'coffre'];
  const items = doors.map(d => ({ id: d, title: d.replace(/_/g, ' '), desc: 'Ouvrir ou fermer.' }));
  renderMenu(items, (it) => { Game.openDoor(it.id); });
}
function openWeaponsMenu() {
  el('menuTitle').textContent = 'Armes';
  const items = Game.weapons.map((id, i) => {
    const w = WEAPON_CATALOG[id];
    const compat = !w.ammoType ? 'arme de contact' : ((Game.ammo[w.ammoType] || 0) + (Game.ammoReserve[w.ammoType] || 0) > 0 ? 'munitions compatibles disponibles' : 'aucune munition compatible');
    const equipped = (Game.lastWeaponId === id) ? ' (dernière sélectionnée)' : '';
    return { id: 'w_' + i, title: w.name + equipped, desc: `Calibre ${w.caliber}, dégâts ${w.dmg}, chargeur ${Game.ammo[w.ammoType] || 0}/${w.magazine}, réserve ${Game.ammoReserve[w.ammoType] || 0}, ${compat}. ${w.legal ? 'Légal' : 'Non légal'}.`, weaponId: id };
  });
  if (!items.length) items.push({ id: 'none', title: 'Aucune arme', desc: 'Achetez une arme à l\'armurerie ou au marché noir.' });
  items.push({ id: 'ammo_transfer', title: '📤 Donner ou déposer des munitions', desc: 'Transférer une partie de vos munitions à quelqu\'un d\'autre.' });
  renderMenu(items, (it) => {
    if (it.weaponId) { Game.selectWeapon(it.weaponId); closeMenu(); }
    else if (it.id === 'ammo_transfer') { closeMenu(); Game.openAmmoTransferMenu(); }
  });
}
function shopCategoryGroup(cat) {
  if (['vetement', 'pantalon', 'chaussure', 'accessoire'].includes(cat)) return '👕 Vêtements';
  if (['arme', 'munition', 'protection', 'outil', 'minerai'].includes(cat)) return '🛠️ Équipement';
  if (['nourriture', 'boisson', 'medicament'].includes(cat)) return '🍔 Consommables';
  if (cat === 'immobilier') return '🏠 Immobilier';
  return '📦 Divers';
}
function openShopCategoryMenu(poi) {
  const stock = Game.shopContext?.stock || poi.stock || [];
  el('menuTitle').textContent = `🛒 ${poi.name}`;
  const groups = {};
  stock.forEach((it, i) => { const g = shopCategoryGroup(it.category); (groups[g] = groups[g] || []).push(i); });
  const order = ['👕 Vêtements', '🛠️ Équipement', '🍔 Consommables', '🚗 Véhicules', '🏠 Immobilier', '📦 Divers'];
  const items = order.filter(g => groups[g] && groups[g].length).map(g => ({ id: 'cat_' + g, title: g, desc: `${groups[g].length} article(s) disponible(s).` }));
  if (!items.length) items.push({ id: 'empty', title: 'Boutique vide', desc: 'Aucun article en stock pour le moment.' });
  renderMenu(items, (c) => { if (c.id !== 'empty') openShopCategoryItems(poi, groups, c.title); });
  el('menuOverlay').style.display = 'flex';
}
function openShopCategoryItems(poi, groups, groupName) {
  const stock = Game.shopContext?.stock || poi.stock || [];
  const indices = groups[groupName] || [];
  el('menuTitle').textContent = groupName;
  const items = indices.map(i => {
    const it = stock[i];
    return { id: 'item_' + i, title: `${it.name}${it.q > 1 ? ' (stock ' + it.q + ')' : ''}`, desc: UTIL.formatMoney(it.price) };
  });
  items.push({ id: 'back', title: '↩️ Retour aux catégories', desc: 'Revenir à la liste des catégories.' });
  renderMenu(items, (sel) => {
    if (sel.id === 'back') { openShopCategoryMenu(poi); return; }
    const idx = parseInt(sel.id.replace('item_', ''), 10) + 1; // buyItemQty attend un index 1-based
    const it = stock[idx - 1];
    if (it.q > 1) { closeMenu(); QtyPicker.open(`Acheter ${it.name}`, it.q, (n) => { Game.buyItemQty(idx, n); }); }
    else { Game.buyItemQty(idx, 1); closeMenu(); }
  });
}
function openVehicleCategoryMenu(poi, available) {
  el('menuTitle').textContent = `🚗 ${poi.name}`;
  const groups = {};
  available.forEach((v, i) => { (groups[v.type] = groups[v.type] || []).push(i); });
  const order = ['2 roues', '3 roues', '4 roues', 'moto', 'voiture', 'poids lourd', 'air'];
  const items = order.filter(g => groups[g] && groups[g].length).map(g => ({ id: 'cat_' + g, title: `${vehicleCategoryIcon(g)} ${g}`, desc: `${groups[g].length} modèle(s) disponible(s).` }));
  if (!items.length) items.push({ id: 'empty', title: 'Aucun véhicule disponible', desc: '' });
  renderMenu(items, (c) => { if (c.id !== 'empty') openVehicleCategoryItems(poi, groups, c.id.replace('cat_', ''), available); });
  el('menuOverlay').style.display = 'flex';
}
function vehicleCategoryIcon(type) {
  return { '2 roues': '🚲', '3 roues': '🛺', '4 roues': '🏍️', moto: '🏍️', voiture: '🚗', 'poids lourd': '🚚', air: '🛩️' }[type] || '🚘';
}
function openVehicleCategoryItems(poi, groups, groupName, available) {
  const indices = groups[groupName] || [];
  el('menuTitle').textContent = `${vehicleCategoryIcon(groupName)} ${groupName}`;
  const items = indices.map(i => {
    const v = available[i];
    const tag = v.restricted ? ' — Réservé police' : '';
    return { id: 'veh_' + i, title: `${v.name}${tag} — ${UTIL.formatMoney(v.price)}`, desc: `${v.seats} place(s), coffre ${v.trunk}, ${v.electric ? 'électrique' : v.flies ? 'volant' : 'thermique'}.${v.restricted ? ' Achat réservé aux policiers en service, via le menu police.' : ''}` };
  });
  items.push({ id: 'back', title: '↩️ Retour aux catégories', desc: '' });
  renderMenu(items, (sel) => {
    if (sel.id === 'back') { openVehicleCategoryMenu(poi, available); return; }
    const idx = parseInt(sel.id.replace('veh_', ''), 10) + 1; // buyVehicle attend un index 1-based
    closeMenu();
    Game.buyVehicle(idx);
  });
}
function openShopsMenu() {
  el('menuTitle').textContent = 'Boutiques';
  const nearby = City.pois.filter(p => UTIL.dist(p, Game) < 40).sort((a, b) => UTIL.dist(a, Game) - UTIL.dist(b, Game)).slice(0, 10);
  const items = nearby.map(p => ({ id: p.id, title: p.name, desc: `${p.type}, ${Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE)} m.` }));
  if (!items.length) items.push({ id: 'none', title: 'Aucune boutique proche', desc: 'Déplacez-vous vers le centre-ville ou le sud.' });
  renderMenu(items, (it) => {
    if (it.id === 'none') { closeMenu(); return; }
    const poi = City.pois.find(p => p.id === it.id);
    closeMenu();
    // Choisir une boutique GUIDE désormais vers elle (au lieu de ne rien faire
    // si on n'est pas déjà collé dessus).
    guideToPoi(poi);
  });
}
// Ouvre l'overlay de menu s'il était fermé (ex. appelé depuis le téléphone),
// en repartant d'une pile de navigation propre. S'il est déjà ouvert (menu
// imbriqué), on ne touche à rien pour préserver la fonction Retour.
function ensureMenuOpen() {
  if (el('menuOverlay').style.display !== 'flex') {
    MenuNav.stack = []; MenuNav.navigating = false;
    el('menuOverlay').style.display = 'flex';
  }
}
// Guide vers un lieu : déjà sur place, on entre ; en véhicule, conduite auto ;
// à pied, guidage vocal pas-à-pas qui contourne les murs.
function guideToPoi(poi) {
  if (!poi) return;
  if (UTIL.dist(poi, Game) < 3) Game.enterPOI(poi);
  else if (Game.inVehicle) Game.setAutoDrive(poi.type, poi.name);
  else Game.setGuidance({ name: poi.name, x: poi.x, y: poi.y });
}
function openMapMenu() {
  ensureMenuOpen();
  el('menuTitle').textContent = 'Carte et lieux';
  // TOUS les lieux, du plus proche au plus loin (avant : 15 seulement), et
  // choisir un lieu GUIDE vers lui (à pied par défaut).
  const items = City.pois.map(p => ({ p, d: UTIL.dist(p, Game) })).sort((a, b) => a.d - b.d)
    .map(({ p, d }) => ({ id: p.id, title: p.name, desc: `${SERVICE_TYPES[p.type] || DISTRICT_TYPES[p.type] || p.type}, ${Math.round(d * CONFIG.METERS_PER_TILE)} m, ${UTIL.bearing(p.x - Game.x, p.y - Game.y)}.` }));
  renderMenu(items, (it) => { const poi = City.pois.find(p => p.id === it.id); closeMenu(); guideToPoi(poi); });
}

/* ============================================================
   INPUT HANDLING — clavier, tactile, gestes
============================================================ */
// Guide vocal de tous les gestes tactiles : permet d'apprendre les commandes
// du téléphone sans lecteur d'écran. Déclenché par 4 taps à 2 doigts, 4 taps à
// 3 doigts, un tap à 4 doigts, ou la touche H.
function announceGestureHelp() {
  const lignes = [
    'Guide des gestes tactiles de Blind City.',
    'Un doigt, glisser et garder le doigt appuyé : bouger en continu. Vers le haut, avancer ; vers le bas, reculer ; vers la gauche, tourner à gauche ; vers la droite, tourner à droite. Un glissement rapide fait un seul pas.',
    'Un doigt, taper : une fois, interagir ; deux fois, scanner les alentours ; trois fois, dire ma position ; quatre fois, freiner.',
    'Deux doigts, taper : une fois, inventaire ; deux fois, téléphone ; trois fois, menu principal ; quatre fois, micro de proximité.',
    'Deux doigts, glisser : haut, boussole ; bas, radar des lieux ; gauche, retrouver ma voiture ; droite, changer la fréquence radio.',
    'Trois doigts, glisser : haut, tirer ; bas, recharger ; gauche, sortir ou ranger l\'arme ; droite, coup de poing.',
    'Trois doigts, taper : une fois, cibler la personne la plus proche ; deux fois, sirène ; trois fois, menu police.',
    'Quatre doigts, glisser : haut, téléphone ; bas, ordinateur ; gauche, menu du véhicule ; droite, visite guidée de la ville.',
    'Quatre doigts, taper, ou quatre taps à deux ou trois doigts : réentendre ce guide.',
    'Dans un menu : un doigt glisser gauche ou droite pour parcourir, double tap pour valider ; deux doigts vers la gauche pour revenir au menu précédent ; deux doigts vers le bas pour fermer.',
  ];
  announce(lignes.join(' '), 'assertive');
}
// ============================================================
//  ROTOR CONTEXTUEL (façon VoiceOver iOS)
//  Appui long d'un doigt (sans bouger, ≥ 500 ms) : fait défiler les
//  actions disponibles selon le contexte — à pied, cible verrouillée,
//  ou dans un véhicule. Double-tap d'un doigt : exécute l'action
//  sélectionnée. N'altère AUCUN autre geste : l'appui long immobile
//  n'était rattaché à rien auparavant, et le double-tap conserve son
//  comportement (scanner) tant que le rotor n'est pas armé.
// ============================================================
const Rotor = {
  list: [], idx: 0, armed: false, _timer: null,
  buildList() {
    if (Game.inVehicle) {
      return [
        { label: 'menu du véhicule', run: () => Game.openVehicleMenu() },
        { label: 'klaxon', run: () => Game.honk() },
        { label: 'sirène', run: () => Game.toggleSiren() },
        { label: 'boussole sonore', run: () => Game.soundCompass() },
        { label: 'assistant de conduite', run: () => Game.toggleDriveAssist() },
      ];
    }
    if (typeof Game.getLiveTarget === 'function' && Game.getLiveTarget()) {
      return [
        { label: 'info de la cible', run: () => Game.announceTarget() },
        { label: 'fouiller', run: () => Game.searchTarget() },
        { label: 'menotter ou démenotter', run: () => Game.toggleCuffs() },
        { label: 'cibler la personne suivante', run: () => Game.target(1) },
        { label: 'ma position', run: () => Game.announceLocation() },
      ];
    }
    return [
      { label: 'interagir', run: () => Game.interact() },
      { label: 'scanner les alentours', run: () => Game.scan() },
      { label: 'radar de proximité', run: () => Game.soundRadar() },
      { label: 'ma position', run: () => Game.announceLocation() },
      { label: 'menu principal', run: () => openMainMenu() },
      { label: 'téléphone', run: () => Phone.openPhone() },
      { label: 'micro de proximité', run: () => toggleProxVoice() },
    ];
  },
  cycle() {
    if (!this.armed) { this.list = this.buildList(); this.idx = 0; this.armed = true; }
    else if (this.list.length) { this.idx = (this.idx + 1) % this.list.length; }
    this._rearm();
    const a = this.list[this.idx];
    if (!a) { this.disarm(); speak('Rotor, aucune action disponible.', 'assertive'); return; }
    speak(`Rotor, ${a.label}. ${this.idx + 1} sur ${this.list.length}. Tapez deux fois pour exécuter.`, 'assertive');
  },
  execute() {
    if (!this.armed) return false;
    const a = this.list[this.idx];
    this.disarm();
    if (a && a.run) { a.run(); return true; }
    return false;
  },
  _rearm() { clearTimeout(this._timer); this._timer = setTimeout(() => this.disarm(), 8000); },
  disarm() { this.armed = false; clearTimeout(this._timer); this._timer = null; },
};
window.Rotor = Rotor;

function setupInput() {
  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return; // ne pas capter les touches pendant une saisie de texte
    if (e.repeat) return;
    Game.keys.add(e.key.toLowerCase());
    const key = e.key.toLowerCase();
    // Les combinaisons avec Ctrl / Alt / Cmd sont TOUTES gérées par l'autre
    // gestionnaire (raccourcis de police-and-startup). Ici on ne traite que les
    // touches simples : on sort dès qu'un de ces modificateurs est présent, pour
    // ne jamais déclencher deux actions en même temps (ce qui « mangeait » ou
    // parasitait certains raccourcis Ctrl/Alt).
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Déplacement : uniquement sans modificateur. Sinon, le pavé numérique sans
    // Verr Num (qui envoie Arrow…) déclenchait un déplacement en même temps
    // qu'un raccourci Maj+Alt+chiffre — d'où les comportements « bizarres ».
    const noMod = !e.shiftKey && !e.altKey && !e.ctrlKey;
    if (key === 'arrowup' && noMod) Game.moveForward();
    else if (key === 'arrowdown' && noMod) Game.moveBackward();
    else if (key === 'arrowleft' && noMod) Game.turn(-1);
    else if (key === 'arrowright' && noMod) Game.turn(1);
    else if (key === ' ') { e.preventDefault(); Game.inVehicle ? Game.brakeVehicle() : Game.move(0, 1); }
    else if (key === 'e' && !e.ctrlKey && !e.shiftKey && !e.altKey) Game.interact();
    else if (key === 'm') openMainMenu();
    else if (key === 'v') toggleProxVoice(); // micro de proximité : bascule, on active puis on désactive
    else if (key === 's' && !e.ctrlKey && !e.shiftKey && !e.altKey) talkieVoiceStart(); // talkie : maintenir pour parler
    else if (key === 'w') Game.scan(); // 'q' est déjà pris par le déplacement à gauche (AZERTY)
    else if (key === 't' && !e.shiftKey) Game.startBurst();
    else if (key === 'r') Game.reload();
    else if (key === 'g' && Game.lockedTarget) Game.changeAim(1); // visée tête/torse/jambes
    else if (key === 'z' && !e.shiftKey) Game.announceTarget(); // rafraîchir/réentendre la cible verrouillée
    else if (key === 'n') Game.announceInventory();
    else if (key === 'i') Game.announceLocation();
    else if (key === 'o') Game.openGarage();
    else if (key === 'f') Game.soundRadar();
    else if (key === 'd') Game.pingNearestDoor(); // balise sonore de la porte la plus proche
    else if (key === 'h') Game.help();
    else if (key === 'c') Game.soundCompass();
    else if (key === 'u') { Game.toggleCuffs(); }
    else if (key === 'j') { const live = Game.getLiveTarget(); if (live?.menotte || live?.knockedOut || live?.dead) Game.searchTarget(); else announce('Cible non fouillable : menottez ou assommez-la d\'abord.', 'assertive'); }
    else if (key === 'pageup') { if (Game.inVehicle && VEHICLE_CATALOG[Game.vehicle.type].flies) { Game.altitude = Math.min(120, Game.altitude + 5); Game.vehicle.altitude = Game.altitude; announce('Altitude ' + Math.round(Game.altitude) + ' m.', 'polite'); } }
    else if (key === 'pagedown') { if (Game.inVehicle && VEHICLE_CATALOG[Game.vehicle.type].flies) { Game.altitude = Math.max(0, Game.altitude - 5); Game.vehicle.altitude = Game.altitude; announce('Altitude ' + Math.round(Game.altitude) + ' m.', 'polite'); } }
    // Verrouillage de cible 1 à 9. On lit e.code (Digit1.../Numpad1...) plutôt que
    // e.key : sur un clavier AZERTY, la rangée du haut sans Maj donne & é " ' ( etc.,
    // donc e.key n'était jamais "1".."9" et le ciblage ne marchait pas.
    else if (e.code && /^(Digit|Numpad)[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey && !e.ctrlKey) Game.target(parseInt(e.code.replace(/\D/g, ''), 10));
    else if (['1','2','3','4','5','6','7','8','9'].includes(key) && !e.shiftKey && !e.altKey && !e.ctrlKey) Game.target(parseInt(key, 10));
    else if (key === '!') Game.setHeadingDirect(0); // Nord
    else if (key === ';') Game.setHeadingDirect(2); // Est
    else if (key === ',') Game.setHeadingDirect(4); // Sud
    else if (key === ':') Game.setHeadingDirect(6); // Ouest
    updateHud();
  });
  document.addEventListener('keyup', (e) => {
    Game.keys.delete(e.key.toLowerCase());
    if (e.key.toLowerCase() === 't') Game.stopBurst();
    if (e.key.toLowerCase() === 's') talkieVoiceStop();
  });

  // Touch buttons
  el('closeMenu').addEventListener('click', closeMenu);
  el('qtyMinus').addEventListener('click', () => QtyPicker.change(-1));
  el('qtyPlus').addEventListener('click', () => QtyPicker.change(1));
  el('qtyMax').addEventListener('click', () => QtyPicker.setMax());
  el('qtyConfirm').addEventListener('click', () => QtyPicker.confirm());
  el('qtyCancel').addEventListener('click', () => QtyPicker.cancel());
  // Pavé numérique tactile pour la fréquence du talkie-walkie
  {
    const grid = el('freqKeypad');
    ['1','2','3','4','5','6','7','8','9','.','0','⌫'].forEach(ch => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = ch;
      b.setAttribute('aria-label', ch === '⌫' ? 'Effacer' : ch);
      b.addEventListener('click', () => FreqPicker.press(ch));
      grid.appendChild(b);
    });
  }
  el('freqConfirm').addEventListener('click', () => FreqPicker.confirm());
  el('freqCancel').addEventListener('click', () => FreqPicker.cancel());
  el('freqInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); FreqPicker.confirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); FreqPicker.cancel(); }
  });
  document.querySelectorAll('.touch-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => { const [dx, dy] = btn.dataset.dir.split(',').map(Number); Game.move(dx, dy); });
  });
  el('touchInteract').addEventListener('click', () => Game.interact());
  el('touchScan').addEventListener('click', () => Game.scan());
  {
    let shootPressTimer = null;
    const shootBtn = el('touchShoot');
    shootBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      shootPressTimer = setTimeout(() => Game.startBurst(), 350);
    }, { passive: false });
    shootBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (shootPressTimer) { clearTimeout(shootPressTimer); shootPressTimer = null; Game.shoot(); }
      Game.stopBurst();
    }, { passive: false });
    shootBtn.addEventListener('click', () => Game.shoot()); // clic souris (desktop) ; sur mobile, touchend fait preventDefault donc pas de double tir
  }
  el('touchGuide').addEventListener('click', () => Game.guide());
  el('touchInventory').addEventListener('click', () => Game.announceInventory());
  el('touchMenu').addEventListener('click', () => openMainMenu());
  el('touchProxMic').addEventListener('click', () => toggleProxVoice());
  {
    const talkieVoiceBtn = el('touchTalkieVoice');
    talkieVoiceBtn.addEventListener('touchstart', (e) => { e.preventDefault(); talkieVoiceStart(); }, { passive: false });
    talkieVoiceBtn.addEventListener('touchend', (e) => { e.preventDefault(); talkieVoiceStop(); }, { passive: false });
    talkieVoiceBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); talkieVoiceStop(); }, { passive: false });
    // Souris (test desktop) : maintenir le clic = parler, comme un vrai bouton PTT.
    talkieVoiceBtn.addEventListener('mousedown', () => talkieVoiceStart());
    talkieVoiceBtn.addEventListener('mouseup', () => talkieVoiceStop());
    talkieVoiceBtn.addEventListener('mouseleave', () => talkieVoiceStop());
  }
  el('touchBrake').addEventListener('click', () => Game.inVehicle ? Game.brakeVehicle() : Game.move(0, 1));
  el('touchCompass').addEventListener('click', () => Game.announceLocation());

  // ===== SYSTÈME DE GESTES TACTILES (mobile, lecteur d'écran désactivé) =====
  // Un doigt glissé ET maintenu = déplacement/rotation en continu (haut avancer,
  // bas reculer, gauche/droite tourner ; un glissement rapide = un seul pas).
  // Taps 1 à 4 fois et balayages 4 directions, à 1/2/3/4 doigts = autant de
  // raccourcis (voir announceGestureHelp). Actif uniquement une fois entré en
  // jeu : sur l'écran de création de compte, on laisse le lecteur d'écran natif.
  const isOpen = (id) => { const x = el(id); return !!x && x.style.display === 'flex'; };
  const inGame = () => { const s = el('startOverlay'); return !!s && s.style.display === 'none'; };
  const overlayOpen = () => (typeof QtyPicker !== 'undefined' && QtyPicker.active) || isOpen('menuOverlay') || isOpen('phoneOverlay') || isOpen('computerOverlay') || isOpen('shopDialog') || isOpen('freqOverlay') || isOpen('qtyOverlay') || isOpen('textPromptOverlay') || isOpen('confirmPromptOverlay') || isOpen('accountStatusOverlay');

  let gActive = false, gStartT = 0, gMaxFingers = 0, gStartX = 0, gStartY = 0, gMoved = false;
  let gHoldDir = null, gHoldTimer = null;
  let gTapCount = 0, gTapFingers = 0, gTapTimer = null, gLastTap = 0;
  const SW = 40; // seuil de balayage en pixels
  const TAP_WINDOW = 500; // délai (ms) avant d'exécuter un tap : laisse le temps de faire un double, triple ou quadruple tap
  // Coupe immédiatement la voix en cours : utile quand une longue annonce (ex. le
  // scan) doit céder la place à la nouvelle action que la personne déclenche.
  const interruptSpeech = () => { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } const a = el('announcerPolite'); if (a) a.textContent = ''; };

  function gStopHold() { if (gHoldTimer) { clearInterval(gHoldTimer); gHoldTimer = null; } gHoldDir = null; }
  function gStartHold(dir) {
    if (gHoldDir === dir) return;
    gStopHold(); gHoldDir = dir; interruptSpeech();
    const step = () => {
      if (dir === 'up') Game.moveForward();
      else if (dir === 'down') Game.moveBackward();
      else if (dir === 'left') Game.turn(-1);
      else if (dir === 'right') Game.turn(1);
    };
    step(); // action immédiate : un glissement rapide fait déjà un pas
    gHoldTimer = setInterval(step, 300);
  }
  function gFireTap(fingers, count) {
    interruptSpeech();
    if (fingers === 1) {
      if (count === 1) Game.interact();
      else if (count === 2) { if (Rotor.armed && Rotor.execute()) return; Game.scan(); }
      else if (count === 3) Game.announceLocation();
      else (Game.inVehicle ? Game.brakeVehicle() : Game.move(0, 1));
    } else if (fingers === 2) {
      if (count === 1) Game.announceInventory();
      else if (count === 2) (Phone.open ? Phone.closePhone() : Phone.openPhone());
      else if (count === 3) openMainMenu();
      else toggleProxVoice();
    } else if (fingers === 3) {
      if (count === 1) Game.target(1);
      else if (count === 2) Game.toggleSiren();
      else if (count === 3) Game.openPoliceMenu();
      else announceGestureHelp();
    } else {
      announceGestureHelp();
    }
  }
  function gFireSwipe(fingers, dir) {
    interruptSpeech();
    if (fingers === 2) {
      if (dir === 'up') Game.soundCompass();
      else if (dir === 'down') Game.soundRadar();
      else if (dir === 'left') Game.findMyCar();
      else FreqPicker.open();
    } else if (fingers === 3) {
      if (dir === 'up') Game.shoot();
      else if (dir === 'down') Game.reload();
      else if (dir === 'left') Game.toggleWeapon();
      else Game.punch();
    } else if (fingers >= 4) {
      if (dir === 'up') Phone.openPhone();
      else if (dir === 'down') Computer.boot();
      else if (dir === 'left') Game.openVehicleMenu();
      else Game.cityTour();
    }
  }
  const dirOf = (dx, dy) => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');

  document.body.addEventListener('touchstart', (e) => {
    if (!inGame()) return;
    const n = e.touches.length;
    if (!gActive) { gActive = true; gStartT = Date.now(); gMaxFingers = n; gMoved = false; const t = e.touches[0]; if (t) { gStartX = t.clientX; gStartY = t.clientY; } }
    else if (n > gMaxFingers) gMaxFingers = n;
    if (n >= 2 && !overlayOpen() && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.body.addEventListener('touchmove', (e) => {
    if (!gActive || !inGame() || overlayOpen()) return;
    const n = e.touches.length;
    if (n !== 1 || gMaxFingers !== 1) { if (n >= 2 && e.cancelable) e.preventDefault(); return; }
    const t = e.touches[0]; if (!t) return;
    const dx = t.clientX - gStartX, dy = t.clientY - gStartY;
    if (Math.abs(dx) > SW || Math.abs(dy) > SW) {
      gMoved = true; if (e.cancelable) e.preventDefault();
      gStartHold(dirOf(dx, dy));
    }
  }, { passive: false });

  document.body.addEventListener('touchend', (e) => {
    const allUp = e.touches.length === 0;
    const wasHolding = !!gHoldDir;
    // Filet anti « déplacement qui ne s'arrête jamais » : dès que tous les doigts
    // sont levés, on coupe TOUJOURS le déplacement continu — même si un overlay
    // s'est ouvert entre-temps (inGame() faux), sinon le personnage continuait
    // d'avancer ou de tourner tout seul en boucle.
    if (allUp && wasHolding) gStopHold();
    if (!inGame()) { if (allUp) { gActive = false; gMaxFingers = 0; } return; }
    if (e.touches.length > 0) return; // attendre que tous les doigts soient levés
    if (!gActive) return;
    gActive = false;
    const fingers = gMaxFingers, moved = gMoved, duration = Date.now() - gStartT;
    gMaxFingers = 0;
    if (wasHolding) return; // déplacement continu terminé
    const end = e.changedTouches && e.changedTouches[0];
    const dx = end ? end.clientX - gStartX : 0, dy = end ? end.clientY - gStartY : 0;
    const isSwipe = Math.abs(dx) > SW || Math.abs(dy) > SW;
    const dir = dirOf(dx, dy);
    const isTap = !moved && !isSwipe && duration < 500;

    // Sélecteur de quantité ouvert (dons, dépôts, munitions...).
    if (typeof QtyPicker !== 'undefined' && QtyPicker.active) {
      if (fingers === 2 && isSwipe && dir === 'down') { QtyPicker.cancel(); return; }
      if (fingers === 1 && isSwipe) { if (Math.abs(dy) > Math.abs(dx)) QtyPicker.change(dy < 0 ? 1 : -1); else QtyPicker.change(dx > 0 ? 5 : -5); return; }
      if (fingers === 1 && isTap) { const now = Date.now(); if (now - gLastTap < 350) { QtyPicker.confirm(); gLastTap = 0; } else { gLastTap = now; speak(String(QtyPicker.value), 'polite'); } return; }
      return;
    }
    // Menu à cartes ouvert : balayage gauche/droite pour parcourir, double-tap pour valider.
    if (isOpen('menuOverlay')) {
      const cards = Array.from(document.querySelectorAll('#menuContent .menu-card'));
      if (cards.length) {
        if (fingers === 1 && isSwipe && Math.abs(dx) > Math.abs(dy)) { let idx = cards.indexOf(document.activeElement); idx = idx === -1 ? 0 : (dx > 0 ? Math.min(cards.length - 1, idx + 1) : Math.max(0, idx - 1)); cards[idx].focus(); speak(cards[idx].querySelector('h4')?.textContent || '', 'polite'); return; }
        if (fingers === 1 && isTap) { const now = Date.now(); if (now - gLastTap < 350 && cards.includes(document.activeElement)) { document.activeElement.click(); gLastTap = 0; } else { gLastTap = now; if (!cards.includes(document.activeElement)) { cards[0].focus(); speak(cards[0].querySelector('h4')?.textContent || '', 'polite'); } } return; }
        if (fingers === 2 && isSwipe && dir === 'left') { menuGoBack(); return; } // 2 doigts vers la gauche : retour
        if (fingers === 2 && isSwipe && dir === 'down') { closeMenu(); return; }
      }
      return;
    }
    // Téléphone / ordinateur : 2 doigts vers le bas = fermer ; le reste passe par
    // leurs propres commandes.
    if (isOpen('phoneOverlay')) { if (isSwipe && fingers >= 2 && dir === 'down') Phone.closePhone(); return; }
    if (isOpen('computerOverlay')) { if (isSwipe && fingers >= 2 && dir === 'down') { const b = el('closeComputer'); if (b) b.click(); } return; }
    if (overlayOpen()) return;

    // --- EN JEU ---
    // Appui long d'un doigt, immobile : rotor contextuel (façon VoiceOver).
    if (fingers === 1 && !moved && !isSwipe && duration >= 500) { Rotor.cycle(); return; }
    if (isSwipe) {
      if (fingers === 1) { gStartHold(dir); gStopHold(); return; } // filet : un pas si touchmove n'a pas déclenché
      gFireSwipe(fingers, dir); return;
    }
    if (isTap) {
      if (gTapFingers !== fingers) { gTapFingers = fingers; gTapCount = 0; }
      gTapCount++;
      clearTimeout(gTapTimer);
      gTapTimer = setTimeout(() => { gFireTap(gTapFingers, gTapCount); gTapCount = 0; gTapFingers = 0; }, TAP_WINDOW);
    }
  }, { passive: false });

  document.body.addEventListener('touchcancel', () => { gStopHold(); gActive = false; gMaxFingers = 0; }, { passive: true });

  // Filet de sécurité clavier : si la fenêtre perd le focus (Alt-Tab, notification,
  // changement d'onglet...), un keyup peut être manqué et une flèche resterait
  // "enfoncée" dans Game.keys — le personnage avancerait/tournerait alors tout
  // seul sans fin. On vide les touches et on coupe tout déplacement continu.
  const stopAllContinuous = () => { Game.keys.clear(); gStopHold(); };
  window.addEventListener('blur', stopAllContinuous);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllContinuous(); });

  // Prevent zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

/* ============================================================
   GAME LOOP — NPCs, ambience, missions, survival
============================================================ */
function gameLoop() {
  try {
    // Passager assis dans un véhicule (sans chauffeur réel suivi) : on suit la
    // position du véhicule — s'il n'existe plus, on descend.
    if (Game.ridingWith && Game.ridingWith.vehicleId && !Game.ridingWith.id) {
      const rv = City.vehicles.find(v => v.id === Game.ridingWith.vehicleId);
      if (rv) { Game.x = rv.x; Game.y = rv.y; } else { Game.ridingWith = null; }
    }
    // Déplacement/rotation continus tant qu'une touche reste enfoncée. Le premier
    // appui a déjà fait un pas (voir setupInput, qui ignore les répétitions
    // automatiques du système) ; ici on prend le relais à un rythme régulier et
    // maîtrisé, pour avancer/tourner en continu sans dépendre de la vitesse de
    // répétition (très variable) du clavier de l'utilisateur.
    const menuIsOpen = el('menuOverlay').style.display === 'flex';
    // À PIED : PLUS de répétition automatique au clavier. Une pression de flèche
    // = un seul pas ou une seule rotation (géré dans setupInput au keydown, qui
    // ignore déjà les répétitions système via e.repeat). Pour avancer plusieurs
    // fois / "courir", on appuie plusieurs fois. Le geste tactile "glisser et
    // garder" reste, lui, un déplacement continu voulu.
    if (Game.inVehicle && Game.vehicle && !Game.vehicle.auto && !menuIsOpen) {
      // Conduite : accélération/freinage à chaque image pour une sensation fluide
      // et continue (contrairement au pas-à-pas piéton, volontairement cadencé).
      const fwd = Game.keys.has('arrowup');
      const back = Game.keys.has('arrowdown');
      const { dx, dy } = Game.headingToDelta(Game.vehicle.heading);
      if (fwd) Game.driveVehicle(dx, dy);
      else if (back) Game.driveVehicle(-dx, -dy);
      else Game.driveVehicle(0, 0); // relâché : freinage naturel jusqu'à l'arrêt
      const now2 = Date.now();
      if (now2 - (Game._lastContinuousMove || 0) > 220) {
        if (Game.keys.has('arrowleft')) { Game.turn(-1); Game._lastContinuousMove = now2; }
        else if (Game.keys.has('arrowright')) { Game.turn(1); Game._lastContinuousMove = now2; }
      }
    }
    // Auto-drive step
    if (Game.inVehicle && Game.vehicle?.auto) Game.autoDriveStep();

    // En véhicule, la POSITION et le CAP du joueur suivent le véhicule. Sans
    // ça, la position du joueur restait figée à l'endroit où il était monté :
    // le guidage vocal, la détection d'arrivée des missions (et donc le
    // versement de la récompense) et la proximité des lieux ne marchaient pas
    // du tout en conduisant. On rafraîchit aussi le guidage à ce moment.
    if (Game.inVehicle && Game.vehicle) {
      Game.x = Game.vehicle.x; Game.y = Game.vehicle.y; Game.heading = Game.vehicle.heading;
      if (Game.guidanceTarget) Game.updateGuidance();
      // Retour de progression (tic de roulement, quartiers, routes, vitesse) :
      // c'est ce qui fait « sentir » qu'on avance, en manuel comme en auto.
      Game.updateVehicleProgress();
      // Assistant de conduite : prévenir des obstacles devant avant l'impact.
      Game.warnVehicleHazard();
    }

    // Son de conduite : le vélo a son propre système de boucles (pédalage /
    // roue libre), les autres véhicules gardent le moteur de synthèse.
    const _cls = (Game.inVehicle && Game.vehicle) ? VEHICLE_CATALOG[Game.vehicle.type] : null;
    if (_cls && _cls.human) {
      Game.updateBikeAudio();
    } else {
      Game.stopBikeAudio(); // au cas où on vient de descendre du vélo
      // Les autres véhicules ont leur VRAI moteur (RealEngine / RealEngine2 /
      // RealElectricEngine / RealAirEngine) déjà joué dans driveVehicle. On
      // n'ajoute PLUS le moteur synthétique de playEngine, qui se superposait au
      // fichier audio réel (double moteur).
    }

    // Sons partagés en réseau : moteur (quand on roule) et sirène (si active),
    // émis à intervalle régulier pour que les joueurs proches les entendent,
    // spatialisés selon notre position (voir Game.playRemoteSound).
    if (Net.connected && Game.inVehicle && Game.vehicle) {
      const nowS = Date.now();
      if (Math.abs(Game.vehicle.speed) > 0 && nowS - (Game._lastEngineEmit || 0) > 400) {
        Net.emitSound('synth:engine', { vol: 0.5 });
        Game._lastEngineEmit = nowS;
      }
      if (Game.vehicle.siren && nowS - (Game._lastSirenEmit || 0) > 850) {
        Net.emitSound('synth:siren', { vol: 0.7 });
        Game._lastSirenEmit = nowS;
      }
    }

    // Véhicule immobile en pleine route = circulation bloquée : au bout de
    // quelques secondes, des automobilistes impatients se manifestent.
    if (Game.inVehicle && Game.vehicle && Game.vehicle.speed === 0 && City.isRoad(Game.vehicle.x, Game.vehicle.y)) {
      if (!Game._roadBlockSince) Game._roadBlockSince = Date.now();
      else if (Date.now() - Game._roadBlockSince > 6000 && Date.now() - (Game._lastImpatientReaction || 0) > 20000) {
        Game.npcVoiceReaction(Game.vehicle.x, Game.vehicle.y, { group: 'impatient', radius: 12, count: 2 });
        Game._lastImpatientReaction = Date.now();
        Game._roadBlockSince = Date.now(); // évite de redéclencher en boucle tant qu'on ne bouge pas
      }
    } else {
      Game._roadBlockSince = null;
    }

    // Road ambience (son synthétique qui simule le son de la ville)
    Audio.updateRoadAmbience(Game.x, Game.y, City);

    // Police awareness decay
    if (Game.wanted > 0 && Math.random() < 0.01) Game.wanted = Math.max(0, Game.wanted - 1);

    // Police dispatch tick
    Police.tick();

    // Black market dynamic prices
    if (Math.random() < 0.02) BlackMarket.update();

    // Mission proximity check
    if (Game.activeMission) Game.checkMission();

    // Chien guide : suivi, guidage à la laisse, besoins (faim/soif/fatigue).
    if (typeof GuideDog !== 'undefined') GuideDog.tick();
  } catch (e) {
    // Une erreur ponctuelle ici ne doit jamais arrêter toute la boucle de jeu
    // (sons d'ambiance, moteur, police, missions) pour le reste de la session.
    console.error('gameLoop error:', e);
  }
  requestAnimationFrame(gameLoop);
}

function moveNPCs() {
  for (const n of City.npcs) {
    if (n.dead) continue;
    if (Math.random() < 0.3) continue;
    const dx = UTIL.randInt(-1, 1), dy = UTIL.randInt(-1, 1);
    const nx = n.x + dx, ny = n.y + dy;
    if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { n.x = nx; n.y = ny; }
    if (n.follow && n.menotte) { n.x = Game.x; n.y = Game.y; }
  }
}

function startGame(seed) {
  try { Audio.ensure(); } catch (e) { console.error('Audio.ensure() a échoué :', e); }
  AudioLib.playOnce('son_intro_jeu', { volume: 0.6 });
  el('startOverlay').style.display = 'none';
  try {
    UTIL.seedCity(seed || Date.now());
    City.generate();
    UTIL.unseed();
    // Réapplique les agrandissements/quartiers/services déjà validés par le
    // staff sur ce serveur, pour que tout le monde voie la même ville.
    (Net.pendingCityEdits || []).forEach(e => applyCityEdit(e.op, e.payload));
    (Net.pendingWorldEdits || []).forEach(e => applyWorldEdit(e.op, e.payload));
  } catch (e) {
    console.error('Erreur pendant la génération de la ville :', e);
  }
  // Si un compte serveur vient de fournir une sauvegarde, elle est prioritaire
  // sur la sauvegarde locale (elle vient s'appliquer après la génération de la
  // ville, comme Game.load(), puisque la resynchronisation en a besoin).
  if (Game._pendingAccountSaveData) {
    try { Game.applySaveData(Game._pendingAccountSaveData); } catch (e) { console.error('applySaveData (compte) a échoué :', e); }
    Game._pendingAccountSaveData = null;
  } else {
    try { Game.load(); } catch (e) { console.error('Game.load() a échoué :', e); }
  }
  // Nouveau joueur (aucune sauvegarde restaurée) : il ATTERRIT au point
  // d'arrivée, près de l'aéroport. Un joueur qui recharge sa partie, lui, garde
  // la position qu'il avait quittée.
  if (!Game._loadedFromSave && City.spawnPoint) { Game.x = City.spawnPoint.x; Game.y = City.spawnPoint.y; }
  // Ensure player is on free tile
  try {
    let guard = 0;
    const fallback = () => { const s = City.spawnPoint || { x: 120, y: 120 }; Game.x = UTIL.clamp(s.x + UTIL.randInt(-3, 3), 0, City.W - 1); Game.y = UTIL.clamp(s.y + UTIL.randInt(-3, 3), 0, City.H - 1); };
    while (City.isSolid(Game.x, Game.y) && guard < 500) { fallback(); guard++; }
    // Filet supplémentaire : si le joueur charge une partie où les 4 cases
    // adjacentes sont TOUTES solides (encerclé, impossible de bouger), on le
    // repositionne aussi — sinon il serait coincé sans issue.
    const surrounded = () => [[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dy]) => City.isSolid(Game.x + dx, Game.y + dy));
    guard = 0;
    while (surrounded() && guard < 500) { fallback(); guard++; }
  } catch (e) { console.error('Placement initial du joueur en échec :', e); const s = City.spawnPoint || { x: 120, y: 120 }; Game.x = s.x; Game.y = s.y; }
  // Vélo offert à TOUT joueur qui n'en possède pas encore : posé déverrouillé
  // juste à côté, pour que personne ne soit sans moyen de transport (conduite
  // automatique possible, aucun permis requis). Nouveaux joueurs comme anciens.
  try {
    const ownsBike = (Game.ownedVehicles || []).map(vid => City.vehicles.find(v => v.id === vid)).some(v => v && v.type === 'velo');
    if (!ownsBike && typeof VEHICLE_CATALOG !== 'undefined' && VEHICLE_CATALOG.velo) {
      const id = 'freebike_' + (Net.accountUsername || Net.id || 'solo');
      const free = City.findFree(Game.x - 2, Game.y - 2, Game.x + 2, Game.y + 2) || { x: Game.x + 1, y: Game.y + 1 };
      if (!City.vehicles.some(v => v.id === id)) {
        City.vehicles.push({ id, type: 'velo', name: VEHICLE_CATALOG.velo.name, x: free.x, y: free.y, fuel: 1, hp: 100, locked: false, owner: 'player', inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: 0, trunk: VEHICLE_CATALOG.velo.trunk, passengers: [], openDoors: new Set() });
      }
      Game.ownedVehicles = Game.ownedVehicles || [];
      if (!Game.ownedVehicles.includes(id)) Game.ownedVehicles.push(id);
      setTimeout(() => announce('Un vélo vous est offert, déverrouillé, juste à côté de vous : aucun permis n\'est requis pour vous déplacer avec, y compris en conduite automatique.', 'polite'), 6000);
    }
    // Chien guide offert à TOUS les joueurs (existants et nouveaux) : s'ils n'en
    // ont pas déjà un, on leur en attribue un gratuitement.
    if (typeof GuideDog !== 'undefined' && !GuideDog.has()) {
      GuideDog.acquire();
      setTimeout(() => announce(`Un chien guide, ${Game.guideDog ? Game.guideDog.name : 'votre compagnon'}, vous est offert. Prenez la laisse avec Maj+Alt+0 et choisissez une destination : il vous mènera. Menu du chien : Maj+Alt+1.`, 'polite'), 9000);
    }
  } catch (e) { console.error('Vélo / chien offert : échec', e); }
  // Numéro de téléphone principal : généré une seule fois, à la toute
  // première partie (ou pour une ancienne sauvegarde qui n'en a pas encore).
  if (!Array.isArray(Game.phones) || !Game.phones.length) {
    Game.phones = [{ number: UTIL.generatePhoneNumber(), label: `${Game.player.firstName} ${Game.player.lastName}` }];
    Game.activePhoneIndex = 0;
  }
  Net.registerNumbers();
  // setupInput() DOIT toujours s'exécuter, même si tout ce qui précède a échoué :
  // sans ça, plus aucun raccourci clavier (flèches comprises) n'est branché.
  try { setupInput(); } catch (e) { console.error('setupInput() a échoué :', e); }
  try { updateHud(); } catch (e) { console.error('updateHud() a échoué :', e); }
  try { announceTouchLabels(); } catch (e) { console.error('announceTouchLabels() a échoué :', e); }
  const p = Game.player;
  try {
    const repere = Platform.isMobile
      ? `Vous jouez sur ${Platform.name}. Pour vous déplacer, glissez un doigt et gardez-le appuyé : vers le haut avancer, vers le bas reculer, vers la gauche et la droite tourner. Un glissement rapide fait un seul pas. Pour vous repérer : balayez deux doigts vers le haut pour la boussole, ou deux doigts vers le bas pour le radar des lieux. Pour entendre la liste complète des gestes, tapez quatre fois avec deux doigts.`
      : `Pour vous repérer : appuyez sur Maj plus C pour une visite guidée de la ville, F pour balayer les lieux autour de vous, C pour la boussole, et Maj plus B pour activer les balises sonores.`;
    const arrivee = !Game._loadedFromSave ? 'Vous venez d\'arriver à l\'aéroport de la capitale. ' : '';
    announce(`Vous êtes maintenant dans Blind City, la capitale. ${arrivee}À partir de maintenant, le jeu décrit tout à voix haute : veuillez désactiver votre lecteur d'écran, VoiceOver, TalkBack ou NVDA, pour ne pas entendre deux voix en même temps. Bienvenue, ${p.firstName} ${p.lastName}. ${repere} Les champs de texte sont lus par le jeu lui-même. Rendez-vous au commissariat pour votre enregistrement avant de choisir un métier.`, 'assertive');
    setTimeout(() => Game.help(), 1500);
  } catch (e) { console.error('Annonce de bienvenue en échec :', e); }
  // Intervals : protégés eux aussi, pour que gameLoop() démarre toujours ci-dessous
  try {
    setInterval(moveNPCs, 1200);
    setInterval(() => Game.survivalTick(), 2000);
    setInterval(() => {
      if (Game.health < 100 && Game.hunger < 50 && Game.thirst < 50) Game.heal(0.5);
    }, 3000);
    setInterval(() => Game.save(), 60000);
    // Sauvegarde silencieuse à la fermeture de l'onglet, sans attendre la
    // prochaine sauvegarde automatique (jusqu'à 60 secondes de perdues sinon).
    window.addEventListener('beforeunload', () => { try { Game.save(); } catch (e) {} });
    setInterval(() => Game.talkieTick(), 5000);
    setInterval(() => Net.sendState(), 300);
    setInterval(() => Weather.tick(), 90000);
    setInterval(() => AmbientZones.check(), 3000);
    setInterval(() => Game.updateBeacons(), 150);
    setInterval(() => Game.updateVehicleDelivery(), 1000);
    setInterval(() => Game.updateGangCombat(), 1500);
    setInterval(() => Game.updateWantedResponseCombat(), 1500);
    setInterval(() => Game.updateWantedChase(), 800);
    setInterval(() => Convoy.tick(), 2500);
    setInterval(() => Game.vendorTick(), 2000);
    setInterval(() => Game.refreshTargetValidity(), 1500);
    setInterval(() => Game.tickUnconscious(), 5000);
    setInterval(() => Game.tickDrivingExam(), 1000);
    setInterval(() => Game.tickFlightExam(), 1000);
  } catch (e) { console.error('Mise en place des intervalles en échec :', e); }
  gameLoop();
}

/* ============================================================
   PHONE SYSTEM — contacts, messages, calls, garage app, voice chat
============================================================ */
/* ============================================================
   VOICE CHAT — communication vocale RÉELLE entre deux joueurs en appel
   (le micro de chacun, pas une voix synthétique), via WebRTC.
   Le serveur relais (server.js) ne fait que transmettre l'offre, la
   réponse et les candidats ICE (rtc_offer / rtc_answer / rtc_ice) :
   une fois la connexion établie, l'audio passe directement d'un
   appareil à l'autre (pair-à-pair), ce qui minimise la latence, y
   compris avec une connexion modeste. Sur certains réseaux très
   restrictifs (double NAT, pare-feu d'entreprise), un serveur TURN
   peut être nécessaire en complément des serveurs STUN publics
   utilisés ici — à ajouter dans ICE_SERVERS si besoin.
============================================================ */
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
// Demande l'accès au micro en prévenant d'abord l'utilisateur, une seule fois
// par session : la fenêtre d'autorisation du navigateur est une fenêtre système
// que le jeu ne peut pas rendre accessible lui-même, et certains lecteurs
// d'écran (NVDA en particulier) ne la lisent pas toujours automatiquement.
let micWarningGiven = false;
async function requestMicrophoneAccess() {
  if (!micWarningGiven) {
    micWarningGiven = true;
    announce('Le navigateur va demander l\'autorisation d\'utiliser le microphone. C\'est une fenêtre du système, pas du jeu : si vous n\'avez aucun lecteur d\'écran actif pour l\'entendre, demandez à quelqu\'un de cliquer une seule fois sur Autoriser, ou autorisez le micro pour ce site à l\'avance dans les réglages du navigateur. Une fois accepté, le navigateur retient ce choix et ne redemandera plus. Si vous parlez mais que les autres joueurs ne vous entendent pas, c\'est probablement que cette autorisation n\'a jamais été donnée : activez temporairement votre lecteur d\'écran pour l\'accorder si ce n\'est pas déjà fait.', 'assertive');
    await new Promise(r => setTimeout(r, 3500)); // laisser le temps d'entendre l'avertissement avant que la fenêtre système n'apparaisse
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
  });
}
window.requestMicrophoneAccess = requestMicrophoneAccess;

// Narration de saisie autonome : le jeu joue ici le rôle du lecteur d'écran
// pour ses propres champs de texte, sans dépendre de NVDA/VoiceOver/TalkBack
// (qui peuvent très bien être totalement désactivés — c'est même l'usage
// normal prévu). À l'arrivée sur le champ, on annonce son rôle et son contenu
// actuel. Ensuite, chaque caractère tapé est lu immédiatement, chaque mot
// terminé (espace) est relu en entier, et chaque suppression est annoncée.
