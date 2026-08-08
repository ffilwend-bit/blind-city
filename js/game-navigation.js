/* ============================================================
   GAME-NAVIGATION.JS — suite de l'objet Game (voir js/game.js).
   Le fichier game.js est devenu trop volumineux pour rester
   maintenable en un seul bloc : il est désormais scindé en
   plusieurs fichiers, tous chargés à la suite dans le HTML et
   fusionnés sur le MÊME objet Game via Object.assign (donc
   strictement équivalent à avant, juste réparti physiquement).
   Contenu : outils de navigation piétonne, combat de base.
============================================================ */
Object.assign(Game, {
  /* ==========================================================
     OUTILS DE NAVIGATION PIÉTONNE (accessibilité non-voyants)
     ========================================================== */

  // C — Boussole sonore : annonce le cap actuel + le premier lieu droit devant.
  soundCompass() {
    const bearing = UTIL.cardinals[this.heading];
    // "Droit devant" = un cône ÉTROIT (~20°). Avant, le cône faisait 57° de
    // chaque côté : des lieux franchement sur le côté étaient annoncés comme
    // "droit devant" et changeaient à chaque pas sans qu'on ait tourné —
    // déroutant. Maintenant : cône étroit pour "droit devant", et ce qui est
    // entre 20° et 45° est annoncé honnêtement "légèrement à gauche/droite".
    const candidates = City.pois
      .map(p => ({ p, dist: UTIL.dist(p, this), ang: this.relativeAngle(p.x, p.y) }))
      .filter(o => o.ang < 0.8 && o.dist < 40)
      .sort((a, b) => a.dist - b.dist);
    const straight = candidates.find(o => o.ang < 0.35);
    const side = !straight ? candidates[0] : null;
    // Petit son de repère devant (centré).
    Audio.tone({ freq: 660, type: 'sine', duration: 0.15, gain: 0.1, pan: 0 });
    if (straight) {
      announce(`Cap vers le ${bearing}. Droit devant : ${straight.p.name}, à ${Math.round(straight.dist * CONFIG.METERS_PER_TILE)} mètres.`, 'interrupt');
    } else if (side) {
      const pan = this.panForPoint(side.p.x, side.p.y);
      const cote = pan < 0 ? 'légèrement à gauche' : 'légèrement à droite';
      announce(`Cap vers le ${bearing}. Rien droit devant. ${side.p.name} se trouve ${cote}, à ${Math.round(side.dist * CONFIG.METERS_PER_TILE)} mètres.`, 'interrupt');
    } else {
      announce(`Cap vers le ${bearing}. Rien d'identifié droit devant.`, 'interrupt');
    }
  },

  // Angle (radians) entre la direction du regard et la direction d'un point.
  relativeAngle(tx, ty) {
    const headingRad = this.heading * Math.PI / 4; // 0=nord, sens horaire
    // Vecteur "regard" : nord = (0,-1), est = (1,0)...
    const hx = Math.sin(headingRad), hy = -Math.cos(headingRad);
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const dot = (hx * dx + hy * dy) / len;
    return Math.acos(Math.max(-1, Math.min(1, dot))); // 0 = pile devant, PI = derrière
  },

  // Joue un son émis par un autre joueur (reçu du serveur), spatialisé et
  // atténué selon la distance et sa position relative à notre cap. Sons du
  // monde partagés : moteurs, pas, tirs, klaxon, sirène, portes, collisions.
  playRemoteSound(msg) {
    if (!msg || typeof msg.x !== 'number' || !msg.key) return;
    const R = 30; // rayon audible (doit correspondre au SOUND_RADIUS serveur)
    const d = UTIL.dist(msg, this);
    if (d > R) return;
    const pan = this.panForPoint(msg.x, msg.y);
    const atten = Math.max(0, 1 - d / R);
    const vol = Math.max(0.03, (typeof msg.vol === 'number' ? msg.vol : 0.5) * atten);
    // Clés « synth:… » : effets synthétisés rejoués localement (mêmes sons que
    // ceux entendus par l'émetteur), spatialisés par le pan.
    if (msg.key.slice(0, 6) === 'synth:') {
      const fx = msg.key.slice(6);
      if (!window.Audio) return;
      if (fx === 'gunshot') { Audio.gunshot('', pan); if (typeof GuideDog !== 'undefined') GuideDog.onDangerNear(msg.x, msg.y); }
      else if (fx === 'impact') Audio.impact(pan);
      else if (fx === 'siren') Audio.siren(vol);
      else if (fx === 'screech') Audio.screech(pan);
      else if (fx === 'engine') Audio.tone({ freq: 90, type: 'sawtooth', duration: 0.3, gain: vol * 0.25, pan });
      return;
    }
    // Sinon : fichier audio joué de façon panoramique.
    if (window.AudioLib) {
      if (AudioLib.playPositional) AudioLib.playPositional(msg.key, pan, vol);
      else if (AudioLib.playOnce) AudioLib.playOnce(msg.key, { volume: vol });
    }
  },

  // Pan stéréo (-1 gauche, +1 droite) d'un point selon l'orientation du joueur.
  panForPoint(tx, ty) {
    const headingRad = this.heading * Math.PI / 4;
    const hx = Math.sin(headingRad), hy = -Math.cos(headingRad);
    // Vecteur perpendiculaire (droite du joueur)
    const rx = -hy, ry = hx;
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy) || 1;
    return Math.max(-1, Math.min(1, (rx * dx + ry * dy) / len));
  },

  // F — Radar de PROXIMITÉ : « photo sonore » instantanée de tout ce qui vous
  // entoure — personnes (PNJ ET vrais joueurs), véhicules et lieux — chacun
  // joué comme un bip spatialisé (position stéréo = direction réelle, hauteur =
  // proximité) avec un TIMBRE distinct par catégorie (reconnaissable à l'oreille),
  // balayé de la gauche vers la droite, puis un résumé parlé du plus proche de
  // chaque type. Le détail verbal complet reste sur le Scan.
  RADAR_CATS: {
    joueur:   { type: 'square',   base: 560, label: 'joueur réel' },
    personne: { type: 'sine',     base: 500, label: 'personne' },
    vehicule: { type: 'sawtooth', base: 340, label: 'véhicule' },
    lieu:     { type: 'triangle', base: 280, label: 'lieu' },
  },
  soundRadar() {
    const R = 35;
    const items = [];
    City.npcs.forEach(n => { const d = UTIL.dist(n, this); if (d < R) items.push({ x: n.x, y: n.y, dist: d, name: n.name || 'personne', cat: 'personne' }); });
    if (Net.connected) Array.from(Net.remotePlayers.values()).forEach(p => { if (!p || p.unconscious) return; const d = UTIL.dist(p, this); if (d < R) items.push({ x: p.x, y: p.y, dist: d, name: (p.firstName || 'Joueur') + ' (joueur réel)', cat: 'joueur' }); });
    City.vehicles.forEach(v => { if (v.owner) return; const d = UTIL.dist(v, this); if (d < R) items.push({ x: v.x, y: v.y, dist: d, name: v.name || 'véhicule', cat: 'vehicule' }); });
    City.pois.forEach(p => { const d = UTIL.dist(p, this); if (d < R) items.push({ x: p.x, y: p.y, dist: d, name: p.name, cat: 'lieu' }); });
    if (!items.length) { announce('Radar de proximité : rien à signaler autour de vous.', 'interrupt'); Audio.tone({ freq: 300, type: 'sine', duration: 0.2, gain: 0.08, pan: 0 }); return; }
    // On garde les plus proches, puis on les ordonne de la gauche vers la droite.
    const near = items.slice().sort((a, b) => a.dist - b.dist).slice(0, 12).map(o => ({ ...o, pan: this.panForPoint(o.x, o.y) })).sort((a, b) => a.pan - b.pan);
    const c = { personne: 0, joueur: 0, vehicule: 0, lieu: 0 };
    near.forEach(o => c[o.cat]++);
    const people = c.personne + c.joueur;
    announce(`Radar de proximité : ${people} personne${people > 1 ? 's' : ''}, ${c.vehicule} véhicule${c.vehicule > 1 ? 's' : ''}, ${c.lieu} lieu${c.lieu > 1 ? 'x' : ''}. Balayage de la gauche vers la droite.`, 'interrupt');
    // Phase 1 : bip spatialisé par entité, timbre selon le type.
    near.forEach((o, i) => {
      setTimeout(() => {
        const cat = this.RADAR_CATS[o.cat];
        Audio.tone({ freq: cat.base + Math.max(0, (R - o.dist)) * 12, type: cat.type, duration: 0.13, gain: 0.09, pan: o.pan });
      }, i * 220);
    });
    // Phase 2 : résumé parlé — l'entité la plus proche de chaque type.
    const nearestOf = (kinds) => items.filter(o => kinds.includes(o.cat)).sort((a, b) => a.dist - b.dist)[0];
    const lines = [];
    [['personne', 'joueur'], ['vehicule'], ['lieu']].forEach(kinds => {
      const o = nearestOf(kinds);
      if (o) lines.push(`${o.name}, ${Math.round(o.dist * CONFIG.METERS_PER_TILE)} mètres vers le ${UTIL.bearing(o.x - this.x, o.y - this.y)}`);
    });
    if (lines.length) setTimeout(() => speak('Le plus proche : ' + lines.join(' ; ') + '.', 'polite'), near.length * 220 + 250);
  },

  // Balises sonores de proximité : appelé en boucle par le gameLoop. Chaque type
  // de lieu proche émet périodiquement un bip discret, spatialisé, dont la
  // cadence augmente à l'approche — comme un détecteur. Activable/désactivable.
  beaconsOn: false,
  toggleBeacons() {
    this.beaconsOn = !this.beaconsOn;
    announce(this.beaconsOn
      ? 'Balises sonores activées : les lieux proches émettent un bip, plus rapide en approchant.'
      : 'Balises sonores désactivées.', 'interrupt');
  },
  _lastBeacon: 0,
  updateBeacons() {
    if (!this.beaconsOn || this.inVehicle) return;
    const now = Date.now();
    // Source de la balise : la DESTINATION guidée si un guidage est actif (vraie
    // balise de ralliement, jusqu'à 500 m), sinon le lieu le plus proche (30 m).
    let target = null, nd = Infinity;
    if (this.guidanceTarget) { target = this.guidanceTarget; nd = UTIL.dist(target, this); }
    else { for (const p of City.pois) { const d = UTIL.dist(p, this); if (d < nd) { nd = d; target = p; } } }
    const maxRange = this.guidanceTarget ? 500 : 30;
    if (!target || nd > maxRange) return;
    // Cadence : plus c'est proche, plus les bips s'enchaînent (200 ms près,
    // ~1200 ms loin), comme un détecteur qui s'affole à l'approche.
    const interval = Math.max(200, 200 + (Math.min(nd, 40) / 40) * 1000);
    if (now - this._lastBeacon < interval) return;
    this._lastBeacon = now;
    // Cadrage directionnel : le pan gauche/droite place la cible dans l'espace,
    // et la hauteur du son dit si elle est DEVANT (aigu) ou DERRIÈRE (grave). On
    // tourne jusqu'à ce que le bip soit à la fois centré ET aigu : on est pile
    // en face. Un vrai repère sonore bien cadré, pas juste un bip.
    const pan = this.panForPoint(target.x, target.y);
    const facing = 1 - this.relativeAngle(target.x, target.y) / Math.PI; // 1 devant, 0 derrière
    const freq = 380 + facing * 620 + Math.max(0, (30 - Math.min(nd, 30))) * 6;
    Audio.tone({ freq, type: 'sine', duration: 0.08, gain: 0.07, pan });
  },

  // GPS piéton guidé : on fixe une destination, une voix guide pas à pas
  // (tourne à gauche/droite, tout droit, distance restante) avec un bip
  // d'approche. Réévalué à chaque déplacement via updateGuidance().
  //
  // Important : on ne calcule PAS un angle continu vers la cible (ça oscille
  // sans arrêt entre gauche/droite/tout droit à cause de l'imprécision, comme
  // signalé). On raisonne uniquement en cases entières et en cap discret
  // (0/2/4/6 = nord/est/sud/ouest, les 4 seules directions où l'on peut
  // avancer) : on choisit UN axe à corriger en priorité (est-ouest ou
  // nord-sud), avec une marge qui empêche de changer d'avis sans arrêt, et on
  // ne change de consigne que quand cet axe est vraiment aligné.
  guidanceTarget: null,
  guidanceAxis: null,
  setGuidance(poi) {
    this.guidanceTarget = poi;
    this.guidanceAxis = null; this.guidanceFollowId = null;
    this.guidancePath = null; this._pathGoal = null; // force un nouveau calcul de chemin
    announce(`Guidage activé vers ${poi.name}. Je vous indique la direction au fur et à mesure, en contournant les obstacles.`, 'interrupt');
    this._lastGuidanceMsg = 0;
    this.updateGuidance(true);
  },
  stopGuidance() {
    if (this.guidanceTarget) { announce('Guidage arrêté.', 'interrupt'); this.guidanceTarget = null; this.guidanceAxis = null; this.guidanceFollowId = null; this.guidancePath = null; this._pathGoal = null; }
  },
  // Guidage automatique EN DIRECT vers un joueur réel qui a partagé sa position
  // GPS avec vous. Le chemin (qui contourne les murs) se met à jour au fur et à
  // mesure qu'il se déplace, jusqu'à ce que vous le rejoigniez.
  followPlayerGPS(id, name) {
    const live = Net.remotePlayers.get(id);
    if (!live) return announce(`${name} n'est pas joignable pour le moment.`, 'assertive');
    this.guidanceFollowId = id;
    this.guidanceTarget = { name, x: live.x, y: live.y };
    this.guidanceAxis = null; this.guidancePath = null; this._pathGoal = null;
    announce(`Guidage automatique vers ${name}. Je vous mène jusqu'à cette personne en contournant les obstacles ; le trajet s'adapte si elle bouge.`, 'interrupt');
    this._lastGuidanceMsg = 0;
    this.updateGuidance(true);
  },
  // Envoie votre position GPS à un joueur réel : il pourra se faire guider
  // vocalement, automatiquement, jusqu'à vous.
  shareMyGPS(targetId, targetName) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    if (!targetId) return announce('Aucune personne sélectionnée.', 'assertive');
    Net.send({ type: 'share_gps', targetId });
    announce(`Votre position GPS a été envoyée à ${targetName || 'cette personne'}. Elle peut maintenant se faire guider automatiquement jusqu'à vous.`, 'assertive');
  },
  _lastGuidanceMsg: 0,
  guidancePath: null, _pathGoal: null, _pathComputedAt: 0, _pathIdx: 0, guidanceFollowId: null,
  updateGuidance(force) {
    const t = this.guidanceTarget; if (!t) return;
    // Cible mobile : guidage EN DIRECT vers un joueur qui a partagé sa position.
    // On rafraîchit ses coordonnées à chaque calcul ; s'il se déplace, le chemin
    // se recalcule tout seul (voir _ensurePath).
    if (this.guidanceFollowId) {
      const live = Net.remotePlayers.get(this.guidanceFollowId);
      if (!live) {
        announce(`${t.name} n'est plus joignable. Guidage arrêté.`, 'assertive');
        this.guidanceTarget = null; this.guidanceFollowId = null; this.guidancePath = null; this._pathGoal = null; return;
      }
      t.x = live.x; t.y = live.y;
    }
    const dist = UTIL.dist(t, this);
    if (dist < 2) {
      // Arrivée : on invite explicitement à l'action à faire sur place (petit
      // tutoriel contextuel), pour ne pas laisser le joueur planté sans savoir
      // quoi faire. Un bâtiment/véhicule proche ? On dit d'appuyer sur E.
      let hint = '';
      if (!this.guidanceFollowId) {
        const canInteract = City.pois.some(p => UTIL.dist(p, this) < 4)
          || City.houses.some(h => UTIL.dist(h, this) < 4)
          || City.vehicles.some(v => UTIL.dist(v, this) < 3)
          || City.npcs.some(n => !n.dead && UTIL.dist(n, this) < 3);
        if (canInteract) {
          const nearBuilding = City.pois.some(p => UTIL.dist(p, this) < 4) || City.houses.some(h => UTIL.dist(h, this) < 4);
          hint = ' Appuyez sur E pour interagir' + (nearBuilding ? ', ou la touche Q pour entrer' : '') + '.';
        }
      }
      announce((this.guidanceFollowId ? `Vous avez rejoint ${t.name}.` : `Vous êtes arrivé à ${t.name}.`) + hint, 'interrupt');
      Audio.cash();
      this.guidanceTarget = null; this.guidanceAxis = null; this.guidancePath = null; this._pathGoal = null; this.guidanceFollowId = null; return;
    }
    // Silence total si on ne progresse pas : avant, la voix continuait à
    // répéter la consigne toutes les 2,5 s même à l'arrêt complet (stationné
    // à pied ou véhicule immobile) — inutile et dérangeant.
    const moving = (this.inVehicle && this.vehicle) ? Math.abs(this.vehicle.speed || 0) > 0.02
      : UTIL.dist({ x: this.x, y: this.y }, this._lastGuidancePos || { x: this.x, y: this.y }) > 0.05;
    this._lastGuidancePos = { x: this.x, y: this.y };
    if (!force && !moving) return;

    const now = Date.now();
    // Intervalle de réévaluation adapté à la vitesse : plus on va vite, plus
    // tôt une consigne de virage arrive (jusqu'à deux fois plus tôt à pleine
    // vitesse), pour avoir le temps de réagir — avant, un intervalle fixe de
    // 2,5 s ne tenait aucun compte de l'allure.
    const speedRatio = (this.inVehicle && this.vehicle) ? UTIL.clamp(Math.abs(this.vehicle.speed || 0) / ((VEHICLE_CATALOG[this.vehicle.type] || {}).maxSpeed || 1), 0, 1) : 0;
    if (!force && now - this._lastGuidanceMsg < 2500 - speedRatio * 1200) return;
    this._lastGuidanceMsg = now;

    // En vol (aéronef, altitude > 0) : on survole les bâtiments, donc une
    // ligne DROITE (diagonale comprise) vers la cible, jamais le chemin au sol
    // qui contourne les immeubles — sinon le guidage faisait "tourner" un
    // avion en plein ciel comme s'il marchait entre des maisons.
    const vcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    // Mémorisé AVANT de recalculer l'instruction (qui écrase _lastTurnDiff en
    // sous-main, voir _turnInstruction) : sert plus bas à ne reparler que si
    // le VIRAGE À FAIRE change réellement, indépendamment de la distance en
    // mètres qui, elle, varie en continu et rendait la comparaison de texte
    // ("Tout droit, 40 mètres" puis "Tout droit, 37 mètres"...) presque
    // toujours "différente" — d'où la voix qui semblait répéter sans arrêt.
    const prevTurnDiff = this._lastTurnDiff;
    let instruction;
    if (vcls && vcls.flies && this.vehicle.altitude > 0) {
      instruction = this._flightInstruction(t);
    } else {
      // Guidage le long d'un VRAI chemin praticable (contourne les bâtiments et
      // l'eau) : on ne dirige jamais quelqu'un vers un mur. Si aucun chemin n'est
      // trouvé (destination trop lointaine ou isolée), on retombe sur l'ancien
      // guidage direct par axe.
      this._ensurePath(t);
      instruction = this._pathInstruction();
      if (!instruction) instruction = this._axisInstruction(t);
    }

    // Détection de sur-place : si exactement la même consigne à la même
    // distance revient plusieurs fois d'affilée, c'est que le joueur ne
    // progresse pas — on le lui dit clairement au lieu de répéter en boucle.
    if (instruction === this._lastGuidanceInstruction) {
      this._sameGuidanceCount = (this._sameGuidanceCount || 0) + 1;
      if (this._sameGuidanceCount >= 3) {
        this._sameGuidanceCount = 0;
        speak('Vous ne progressez pas vers la destination. Un obstacle vous bloque peut-être : essayez de contourner, ou faites F pour un balayage.', 'interrupt');
        return;
      }
    } else {
      this._sameGuidanceCount = 0;
      this._lastGuidanceInstruction = instruction;
    }
    // Mode bips directionnels : pour ceux que la voix répétée dérange, un
    // simple bip suffit à indiquer où tourner (activé/désactivé par Maj+N).
    // La voix classique reste le mode par défaut, inchangé.
    if (CONFIG.GPS_BEEP_MODE) { this._playGuidanceBeep(this._lastTurnDiff || 0); return; }
    // Petit bip de confirmation à CHAQUE recalcul (toujours audible, discret,
    // jamais gênant) ; la phrase complète, elle, n'est reparlée que si le
    // virage à faire a réellement changé (nouveau virage, ou retour à "tout
    // droit") — avant, elle repassait en priorité 'interrupt' toutes les
    // 2,5 s même sans rien de nouveau à dire, coupant systématiquement
    // n'importe quelle autre annonce en cours, plus importante ou non.
    Audio.tone({ freq: 700, type: 'sine', duration: 0.1, gain: 0.08, pan: this.panForPoint(t.x, t.y) });
    // Tag 'guidance' : si une instruction de virage est encore en train
    // d'être lue (ou en attente) quand une NOUVELLE instruction, différente,
    // devient due, l'ancienne est forcément périmée — elle est coupée/
    // remplacée au lieu de s'empiler derrière, pour ne plus jamais avoir
    // "tu pars à gauche, tu pars à droite, tu pars à gauche..." qui
    // s'accumule et se joue en retard.
    if (force || this._lastTurnDiff !== prevTurnDiff) speak(instruction, 'assertive', { tag: 'guidance' });
  },
  // Bip directionnel (mode Maj+N) : un bip aigu centré tout droit, un bip
  // panoramique à droite/gauche selon le virage, doublé si le virage est
  // franc, deux bips graves pour un demi-tour — reconnaissable sans écouter
  // aucune phrase.
  _playGuidanceBeep(diff) {
    diff = ((diff % 8) + 8) % 8;
    const beep = (freq, pan, delay) => setTimeout(() => { if (window.Audio && Audio.tone) Audio.tone({ freq, type: 'sine', duration: 0.12, gain: 0.12, pan }); }, delay || 0);
    if (diff === 0 || diff === 1 || diff === 7) beep(880, 0);
    else if (diff === 4) { beep(300, 0); beep(300, 0, 160); }
    else if (diff === 2) beep(600, 0.8);
    else if (diff === 3) { beep(600, 0.8); beep(600, 0.8, 160); }
    else if (diff === 6) beep(600, -0.8);
    else if (diff === 5) { beep(600, -0.8); beep(600, -0.8, 160); }
  },
  // Bascule le mode de guidage GPS entre voix parlée (par défaut) et bips
  // directionnels seuls, pour ceux que les annonces vocales répétées
  // dérangent en conduite. Persisté indépendamment de la sauvegarde de partie.
  toggleGpsBeeps() {
    CONFIG.GPS_BEEP_MODE = !CONFIG.GPS_BEEP_MODE;
    UserSettings.save();
    announce(CONFIG.GPS_BEEP_MODE ? 'Guidage GPS par bips sonores activé : un bip aigu tout droit, un bip à droite ou à gauche selon le virage, deux bips graves pour un demi-tour.' : 'Guidage GPS vocal réactivé.', 'assertive');
  },
  // Direction cardinale d'une case à sa voisine (0=nord,2=est,4=sud,6=ouest ;
  // -1 si pas cardinalement adjacentes).
  _dirOf(x0, y0, x1, y1) { const dx = x1 - x0, dy = y1 - y0; if (dx > 0 && dy === 0) return 2; if (dx < 0 && dy === 0) return 6; if (dy > 0 && dx === 0) return 4; if (dy < 0 && dx === 0) return 0; return -1; },
  // Consigne de virage selon l'écart de cap (en huitièmes de tour, 0..7) : gère
  // aussi les diagonales, puisqu'à pied on s'oriente maintenant par 45°.
  // 0 devant, 1 légèrement à droite, 2 à droite, 3 franchement à droite,
  // 4 demi-tour, 5 franchement à gauche, 6 à gauche, 7 légèrement à gauche.
  _turnInstruction(diff, meters) {
    diff = ((diff % 8) + 8) % 8;
    this._lastTurnDiff = diff; // mémorisé pour le mode bips (voir updateGuidance)
    // Un écart de 45° ou moins (diff 0, 1 ou 7) est traité comme « tout droit » :
    // avec la rotation fine à 45°, un simple dépassement d'un cran faisait sinon
    // dire « légèrement à gauche » puis « légèrement à droite » en boucle (le
    // zigzag signalé). On ne demande un virage que pour un écart d'au moins 90°.
    if (diff === 0 || diff === 1 || diff === 7) return `Tout droit, ${meters} mètres`;
    if (diff === 4) return `Faites demi-tour, puis ${meters} mètres`;
    const cote = diff <= 3 ? 'à droite' : 'à gauche';
    const nuance = (diff === 3 || diff === 5) ? 'franchement ' : '';
    return `Tournez ${nuance}${cote}, puis ${meters} mètres`;
  },
  // (Re)calcule le chemin vers la destination quand c'est nécessaire : au
  // changement de but, si le joueur a quitté le chemin, ou périodiquement (le
  // monde peut changer). Mémorise l'index du point de chemin le plus proche.
  _ensurePath(t) {
    const now = Date.now();
    const px = Math.round(this.x), py = Math.round(this.y);
    const gx = Math.round(t.x), gy = Math.round(t.y);
    const goalMoved = !this._pathGoal || this._pathGoal.x !== gx || this._pathGoal.y !== gy;
    let offPath = true;
    if (this.guidancePath && this.guidancePath.length && !goalMoved) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < this.guidancePath.length; i++) {
        const d = Math.abs(this.guidancePath[i].x - px) + Math.abs(this.guidancePath[i].y - py);
        if (d < best) { best = d; bi = i; }
      }
      this._pathIdx = bi; offPath = best > 1;
    }
    const stale = now - (this._pathComputedAt || 0) > 6000;
    if (goalMoved || !this.guidancePath || !this.guidancePath.length || offPath || stale) {
      this.guidancePath = this.computePath(px, py, t.x, t.y);
      this._pathGoal = { x: gx, y: gy }; this._pathComputedAt = now; this._pathIdx = 0;
    }
  },
  // Consigne pas-à-pas déduite du chemin : direction du segment droit en cours,
  // distance jusqu'au prochain virage, et aperçu du virage suivant. Comme le
  // segment est toujours praticable, "tout droit" ne mène jamais dans un mur.
  _pathInstruction() {
    const path = this.guidancePath;
    if (!path || path.length < 2) return null;
    const px = Math.round(this.x), py = Math.round(this.y);
    let i = Math.min(this._pathIdx || 0, path.length - 1);
    while (i < path.length - 1 && path[i].x === px && path[i].y === py) i++;
    const firstDir = this._dirOf(px, py, path[i].x, path[i].y);
    if (firstDir < 0) return null; // désaligné : repli, recalcul au prochain tick
    let e = i;
    while (e < path.length - 1 && this._dirOf(path[e].x, path[e].y, path[e + 1].x, path[e + 1].y) === firstDir) e++;
    const distToTurn = Math.abs(path[e].x - px) + Math.abs(path[e].y - py);
    const meters = Math.max(CONFIG.METERS_PER_TILE, Math.round(distToTurn * CONFIG.METERS_PER_TILE));
    const diff = ((firstDir - this.heading) % 8 + 8) % 8;
    let instr = this._turnInstruction(diff, meters);
    let nextDir = -1;
    if (e < path.length - 1) nextDir = this._dirOf(path[e].x, path[e].y, path[e + 1].x, path[e + 1].y);
    if (nextDir < 0) {
      instr += ', vous arrivez';
    } else if (distToTurn <= 6) {
      // Aperçu du virage suivant donné seulement s'il est PROCHE : annoncé dès
      // le début d'un long segment droit (ex. "Tout droit, 92 mètres, puis à
      // droite"), ce "puis à droite" final ressemblait à une consigne
      // immédiate et poussait à tourner bien trop tôt — d'où le zigzag
      // rapporté (le joueur tournait puis devait sans cesse se corriger).
      const nd = ((nextDir - firstDir) % 8 + 8) % 8;
      const w = nd === 2 ? 'à droite' : nd === 6 ? 'à gauche' : nd === 4 ? 'demi-tour' : '';
      if (w) instr += `, bientôt ${w}`;
    }
    return instr + '.';
  },
  // Guidage en vol (aéronef en altitude) : cap direct (les 8 directions, donc
  // diagonales comprises) vers la cible, en ligne droite puisqu'on survole
  // tout. Contrairement à _axisInstruction (qui corrige un axe puis l'autre,
  // donc "tourne" deux fois), un seul cap diagonal suffit ici la plupart du
  // temps — d'où beaucoup moins de virages annoncés en vol.
  _flightInstruction(t) {
    const dx = t.x - this.x, dy = t.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
    const targetHeading = Math.round((angle < 0 ? angle + 360 : angle) / 45) % 8;
    const meters = Math.max(CONFIG.METERS_PER_TILE, Math.round(dist * CONFIG.METERS_PER_TILE));
    const diff = ((targetHeading - this.heading) % 8 + 8) % 8;
    return this._turnInstruction(diff, meters) + '.';
  },
  // Ancien guidage direct (repli) : vise l'axe le plus urgent en ligne droite.
  _axisInstruction(t) {
    const dx = t.x - this.x, dy = t.y - this.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (!this.guidanceAxis) this.guidanceAxis = absDx >= absDy ? 'x' : 'y';
    else {
      const current = this.guidanceAxis === 'x' ? absDx : absDy;
      const other = this.guidanceAxis === 'x' ? absDy : absDx;
      if (current === 0 || other > current + 5) this.guidanceAxis = this.guidanceAxis === 'x' ? 'y' : 'x';
    }
    let axis = this.guidanceAxis;
    let remaining = axis === 'x' ? absDx : absDy;
    if (remaining === 0) { axis = this.guidanceAxis = (axis === 'x' ? 'y' : 'x'); remaining = axis === 'x' ? absDx : absDy; }
    const targetHeading = axis === 'x' ? (dx > 0 ? 2 : 6) : (dy > 0 ? 4 : 0);
    const diff = ((targetHeading - this.heading) % 8 + 8) % 8;
    const meters = Math.round(remaining * CONFIG.METERS_PER_TILE);
    let instruction = this._turnInstruction(diff, meters) + '.';
    if (diff === 0) {
      const { dx: hdx, dy: hdy } = this.headingToDelta(this.heading);
      const nx = Math.round(this.x + hdx), ny = Math.round(this.y + hdy);
      if (City.isSolid(nx, ny)) instruction = `Attention, obstacle juste devant. ${instruction}`;
    }
    return instruction;
  },
  // Ligne de vue directe entre deux points (tracé de Bresenham) : renvoie
  // faux dès qu'un bâtiment (case solide) se trouve entre les deux — sert à
  // la dissimulation (se planquer derrière un pâté de maisons) et à rendre
  // les poursuites/le repérage moins « à travers les murs ».
  hasLineOfSight(x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    let guard = 0;
    while ((x !== x1 || y !== y1) && guard++ < 2000) {
      if ((x !== x0 || y !== y0) && (x !== x1 || y !== y1) && City.isSolid(x, y)) return false;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  },
  // Se planquer/se relever : accroupi près d'une couverture (véhicule ou
  // bâtiment tout proche) et immobile, on devient bien plus difficile à
  // repérer — voir hidden dans _updatePnjChase/_updateRealChase et scan().
  // Répond au « on ne peut que scanner puis tirer, c'est trop simple » : une
  // vraie planque change maintenant l'issue d'une poursuite ou d'un scan.
  toggleHide() {
    if (this.hidden) {
      this.hidden = false;
      announce('Vous sortez de votre cachette.', 'assertive');
      updateHud();
      return;
    }
    if (this.inVehicle) return announce('Descendez d\'abord du véhicule pour vous cacher.', 'assertive');
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    const hasCover = City.vehicles.some(v => UTIL.dist(v, this) < 2.2) || (City.houses || []).some(h => UTIL.dist(h, this) < 2.2) || City.pois.some(p => UTIL.dist(p, this) < 2.2);
    if (!hasCover) return announce('Rien à proximité pour vous couvrir : approchez-vous d\'un véhicule ou d\'un bâtiment.', 'assertive');
    this.hidden = true;
    AudioLib.playOnce('sfx_notification', { volume: 0.2 });
    announce('Vous vous planquez, accroupi. Restez immobile : bougez ou attaquez et vous serez repéré à nouveau.', 'assertive');
    updateHud();
  },
  // A* piéton sur la grille : ne traverse ni bâtiment (case solide) ni eau.
  // Renvoie la liste des cases de la position au but (case praticable la plus
  // proche du but si le but lui-même est un bâtiment), ou null si rien.
  computePath(sx, sy, tx, ty) {
    const W = City.W, H = City.H;
    const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !City.isSolid(x, y) && City.getTile(x, y) !== 'eau';
    const nearestWalkable = (cx, cy) => {
      cx = UTIL.clamp(Math.round(cx), 0, W - 1); cy = UTIL.clamp(Math.round(cy), 0, H - 1);
      if (walkable(cx, cy)) return { x: cx, y: cy };
      for (let r = 1; r <= 10; r++) {
        for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (walkable(cx + ox, cy + oy)) return { x: cx + ox, y: cy + oy };
        }
      }
      return null;
    };
    const start = nearestWalkable(sx, sy), goal = nearestWalkable(tx, ty);
    if (!start || !goal) return null;
    const sIdx = start.y * W + start.x, gIdx = goal.y * W + goal.x;
    if (sIdx === gIdx) return [{ x: start.x, y: start.y }];
    const came = new Int32Array(W * H).fill(-1);
    const gScore = new Float64Array(W * H);
    const closed = new Uint8Array(W * H);
    const inOpen = new Uint8Array(W * H);
    // Direction empruntée pour ARRIVER à chaque case (0=est,1=ouest,2=sud,
    // 3=nord) : sert à pénaliser légèrement un changement de direction, pour
    // que l'algorithme préfère une ligne droite à un chemin en escalier (même
    // distance totale, mais ça donnait "gauche, droite, gauche, droite" en
    // boucle à la voix au lieu d'un "tout droit" qui dure).
    const dirAt = new Int8Array(W * H).fill(-1);
    const TURN_PENALTY = 0.35;
    const heapF = [], heapI = [];
    const push = (f, idx) => {
      heapF.push(f); heapI.push(idx); let c = heapF.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heapF[p] <= heapF[c]) break; const tf = heapF[p]; heapF[p] = heapF[c]; heapF[c] = tf; const ti = heapI[p]; heapI[p] = heapI[c]; heapI[c] = ti; c = p; }
    };
    const pop = () => {
      const ri = heapI[0], n = heapF.length - 1;
      heapF[0] = heapF[n]; heapI[0] = heapI[n]; heapF.pop(); heapI.pop();
      let c = 0; const len = heapF.length;
      while (true) { const l = 2 * c + 1, r = 2 * c + 2; let s = c;
        if (l < len && heapF[l] < heapF[s]) s = l;
        if (r < len && heapF[r] < heapF[s]) s = r;
        if (s === c) break;
        const tf = heapF[s]; heapF[s] = heapF[c]; heapF[c] = tf; const ti = heapI[s]; heapI[s] = heapI[c]; heapI[c] = ti; c = s;
      }
      return ri;
    };
    gScore[sIdx] = 0; push(Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y), sIdx); inOpen[sIdx] = 1;
    let processed = 0; const MAX = 90000;
    while (heapF.length) {
      const cur = pop(); inOpen[cur] = 0;
      if (cur === gIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++processed > MAX) return null; // trop coûteux : repli sur guidage direct
      const cx = cur % W, cy = (cur / W) | 0, g0 = gScore[cur];
      const cand = [[cx + 1, cy, cur + 1, 0], [cx - 1, cy, cur - 1, 1], [cx, cy + 1, cur + W, 2], [cx, cy - 1, cur - W, 3]];
      for (let k = 0; k < 4; k++) {
        const nx = cand[k][0], ny = cand[k][1], ni = cand[k][2], dir = cand[k][3];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || closed[ni] || !walkable(nx, ny)) continue;
        const turnCost = (dirAt[cur] !== -1 && dirAt[cur] !== dir) ? TURN_PENALTY : 0;
        const ng = g0 + 1 + turnCost;
        if (inOpen[ni] && ng >= gScore[ni]) continue;
        gScore[ni] = ng; came[ni] = cur; dirAt[ni] = dir;
        push(ng + Math.abs(nx - goal.x) + Math.abs(ny - goal.y), ni); inOpen[ni] = 1;
      }
    }
    if (gIdx !== sIdx && came[gIdx] === -1) return null;
    const path = []; let c = gIdx;
    while (c !== -1) { path.push({ x: c % W, y: (c / W) | 0 }); if (c === sIdx) break; c = came[c]; }
    path.reverse();
    return path;
  },

  // Détection de bord : bip discret quand on passe du trottoir à la route ou
  // inversement, pour "sentir" le bord comme avec une canne. Appelé au déplacement.
  _lastOnRoad: null,
  checkEdge() {
    const onRoad = City.isRoad(this.x, this.y);
    if (this._lastOnRoad === null) { this._lastOnRoad = onRoad; return; }
    if (onRoad !== this._lastOnRoad) {
      this._lastOnRoad = onRoad;
      // Son grave = on entre sur la route (attention voitures) ; aigu = trottoir.
      Audio.tone({ freq: onRoad ? 240 : 900, type: 'sine', duration: 0.12, gain: 0.1, pan: 0 });
      speak(onRoad ? 'Vous êtes sur la route.' : 'Vous êtes sur le trottoir.', 'polite');
    }
  },

  // Lieux personnels enregistrés par le joueur (repères sur la carte).
  savePlaceHere(name) {
    const clean = (name || '').trim().slice(0, 40);
    if (!clean) return announce('Il faut donner un nom au lieu.', 'assertive');
    this.savedPlaces = this.savedPlaces || [];
    this.savedPlaces.push({ name: clean, x: this.x, y: this.y });
    announce(`Lieu "${clean}" enregistré ici.`, 'assertive');
  },
  removeSavedPlace(index) {
    if (!this.savedPlaces || !this.savedPlaces[index]) return;
    const name = this.savedPlaces[index].name;
    this.savedPlaces.splice(index, 1);
    announce(`Lieu "${name}" supprimé.`, 'assertive');
  },
  // Renommer un lieu enregistré (ex. « Ma maison 1 » -> « Chez moi »).
  renameSavedPlace(index, newName) {
    if (!this.savedPlaces || !this.savedPlaces[index]) return;
    const clean = (newName || '').trim().slice(0, 40);
    if (!clean) return announce('Il faut donner un nom au lieu.', 'assertive');
    this.savedPlaces[index].name = clean;
    announce(`Lieu renommé « ${clean} ».`, 'assertive');
  },
  // Enregistre automatiquement une propriété achetée (maison, entrepôt,
  // boutique) dans « Mes lieux », avec un nom numéroté et renommable.
  // On peut en posséder plusieurs : « Ma maison 1 », « Ma maison 2 »…
  registerOwnedProperty(kind, obj) {
    if (!obj) return;
    this.savedPlaces = this.savedPlaces || [];
    const base = kind === 'maison' ? 'Ma maison'
      : kind === 'entrepôt' ? 'Mon entrepôt'
      : kind === 'boutique' ? 'Ma boutique'
      : 'Ma propriété';
    const propId = 'prop_' + kind + '_' + (obj.id != null ? obj.id : (Math.round(obj.x) + '_' + Math.round(obj.y)));
    // Déjà enregistrée ? (rachat/relance) -> on ne duplique pas.
    if (this.savedPlaces.some(p => p.propId === propId)) return;
    const n = this.savedPlaces.filter(p => p.name && p.name.indexOf(base) === 0).length + 1;
    this.savedPlaces.push({
      name: `${base} ${n}`,
      x: obj.x, y: obj.y,
      propId, kind,
    });
    announce(`Propriété ajoutée à Mes lieux : « ${base} ${n} ».`, 'polite');
  },
  // Balise sonore de porte : localise la porte accessible la plus proche
  // (bâtiment ou véhicule) et la fait « sonner » avec spatialisation stéréo,
  // puis annonce la direction et la distance en pas. Touche D.
  pingNearestDoor() {
    // À L'INTÉRIEUR d'un lieu avec un comptoir/guichet (banque, etc.) : rien
    // ne guidait jusque-là vers ce point de service une fois entré — seuls
    // les noms de pièce étaient annoncés en marchant, sans direction ni
    // distance, ce qui rendait le guichet introuvable à l'aveugle (« aucune
    // réaction »). Même touche D, réutilisée pour guider vers le service.
    if (this.interior && this.interior.service) {
      const it = this.interior, svc = it.service;
      const dx = svc.x - it.ix, dy = svc.y - it.iy;
      if (dx === 0 && dy === 0) { announce(`${svc.label}, juste devant vous.`, 'assertive'); return; }
      const pas = Math.max(1, Math.abs(dx) + Math.abs(dy)); // cases réelles à franchir, comme dehors
      this.doorCue(UTIL.clamp(dx, -1, 1) * 0.6);
      announce(`${svc.label}, ${UTIL.bearing(dx, dy)}, ${pas} pas.`, 'assertive');
      return;
    }
    const candidates = [];
    const R = 20; // rayon de recherche en tuiles
    // Points d'intérêt (bâtiments) avec une porte.
    (City.pois || []).forEach(poi => {
      const d = UTIL.dist(poi, this);
      if (d <= R) candidates.push({ x: poi.x, y: poi.y, name: poi.name || 'bâtiment', d });
    });
    // Véhicules à proximité (portières).
    (City.vehicles || []).forEach(v => {
      const d = UTIL.dist(v, this);
      if (d <= R) candidates.push({ x: v.x, y: v.y, name: v.name || 'véhicule', d });
    });
    if (!candidates.length) {
      return announce('Aucune porte à proximité. Rapprochez-vous d\'un bâtiment ou d\'un véhicule.', 'assertive');
    }
    candidates.sort((a, b) => a.d - b.d);
    const t = candidates[0];
    // « pas » = nombre réel de déplacements (cases) à franchir pour y
    // arriver, pas une fausse unité de 30 cm sans rapport avec le
    // déplacement réel (qui avance d'une case entière par pression) — sinon
    // le compte annoncé ne correspondait jamais au nombre d'actions
    // nécessaires pour y arriver.
    const pas = Math.max(1, Math.round(t.d));
    // Direction relative au cap du joueur pour spatialiser + décrire.
    const pan = this.panForPoint(t.x, t.y);         // -1 gauche … +1 droite
    const rel = this.relativeAngle(t.x, t.y);        // 0 devant … PI derrière
    let cote;
    if (rel < 0.55) cote = 'droit devant';
    else if (rel > Math.PI - 0.55) cote = 'derrière vous';
    else cote = (pan < 0) ? 'à gauche' : 'à droite';
    // Son de porte synthétique spatialisé (le bip directionnel ci-dessous
    // complète le repérage).
    const vol = Math.max(0.15, Math.min(0.9, 1 - t.d / (R + 4)));
    this.doorCue(pan);
    // Bip directionnel panoramique en renfort (grave = loin, aigu = proche).
    if (window.Audio && Audio.tone) {
      Audio.tone({ freq: 480 + (1 - vol) * -160 + 220 * vol, type: 'triangle', duration: 0.18, gain: 0.14, pan });
    }
    announce(`Porte de ${t.name}, ${cote}, ${pas} pas.`, 'assertive');
  },

  // Y a-t-il quelqu'un DE VIVANT pile à cet endroit (PNJ ou joueur réel) ?
  // Sert à empêcher un aéronef de se poser directement sur quelqu'un.
  groundOccupiedAt(x, y) {
    const nx = Math.round(x), ny = Math.round(y);
    if (City.npcs.some(n => !n.dead && Math.round(n.x) === nx && Math.round(n.y) === ny)) return true;
    if (Net.connected && Array.from(Net.remotePlayers.values()).some(p => Math.round(p.x) === nx && Math.round(p.y) === ny)) return true;
    return false;
  },
  // Scan manuel du point d'atterrissage (touche dédiée), pour savoir AVANT
  // de descendre ce qu'il y a au sol, plutôt que de le découvrir en
  // atterrissant dessus au hasard — demandé explicitement : impossible
  // jusque-là de savoir ce qu'il y avait sous un avion/hélicoptère en vol.
  scanLandingZone() {
    if (!this.inVehicle || !this.vehicle) return announce('Vous n\'êtes pas en véhicule.', 'assertive');
    const cls = VEHICLE_CATALOG[this.vehicle.type];
    if (!cls || !cls.flies) return announce('Cette balise ne concerne que le pilotage d\'un aéronef.', 'assertive');
    const v = this.vehicle;
    const occupant = City.npcs.find(n => !n.dead && UTIL.dist(n, v) < 1)
      || (Net.connected ? Array.from(Net.remotePlayers.values()).find(p => UTIL.dist(p, v) < 1) : null);
    if (occupant) {
      const name = occupant.firstName ? `${occupant.firstName} ${occupant.lastName}` : occupant.name;
      return announce(`Attention : ${name} se trouve juste en dessous. N'atterrissez pas ici.`, 'assertive');
    }
    const solid = City.isSolid(Math.round(v.x), Math.round(v.y));
    const tile = City.getTile(Math.round(v.x), Math.round(v.y));
    if (solid) announce(`Sous vous : toit ou structure (${tile}). Personne détecté à cet endroit, mais un atterrissage sur un bâtiment reste risqué pour l'appareil.`, 'assertive');
    else announce(`Sous vous : ${tile}, dégagé. Vous pouvez vous poser ici en toute sécurité.`, 'assertive');
  },

  // Positions surélevées (étages). On peut monter dans un bâtiment à étages
  // pour prendre un avantage de tireur embusqué : +5 % de précision par étage
  // gravi. On redescend automatiquement au rez-de-chaussée en quittant le
  // bâtiment. Bornage à MAX_FLOOR_BONUS pour rester équilibré.
  MAX_FLOOR_BONUS: 0.4, // +40 % max (au-delà du 8e étage, plus de gain)

  // Grimper sur un véhicule ou le toit d'une maison proche : meilleure vue,
  // donc meilleure précision ET portée de tir effective (voir shoot()). Se
  // redescend en bougeant (_syncFloorOnMove) ou en rappuyant sur la touche.
  climbedOn: null,
  toggleClimb() {
    if (this.climbedOn) {
      const name = this.climbedOn.name;
      this.x = this.climbedOn.returnX; this.y = this.climbedOn.returnY;
      this.climbedOn = null;
      announce(`Vous redescendez de ${name}.`, 'assertive');
      updateHud();
      return;
    }
    if (this.inVehicle) return announce('Descendez d\'abord du véhicule.', 'assertive');
    // Rayon aligné sur celui de toggleIndoor() (entrer dans un lieu) : 2,5
    // cases était plus strict, donnant l'impression que la touche ne
    // réagissait pas alors qu'on se croyait déjà "à côté" (juste hors de
    // cette portée plus étroite).
    const v = City.vehicles.filter(vv => UTIL.dist(vv, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    const h = (City.houses || []).filter(hh => UTIL.dist(hh, this) < 4).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    const vd = v ? UTIL.dist(v, this) : Infinity;
    const hd = h ? UTIL.dist(h, this) : Infinity;
    if (!v && !h) return announce('Rien à proximité sur quoi grimper : approchez-vous d\'un véhicule ou d\'une maison.', 'assertive');
    const returnX = this.x, returnY = this.y;
    if (vd <= hd) {
      this.climbedOn = { type: 'vehicle', name: v.name, x: v.x, y: v.y, returnX, returnY, level: 1 };
      this.x = v.x; this.y = v.y;
      announce(`Vous grimpez sur ${v.name}. Meilleure vue pour viser au loin.`, 'assertive');
    } else {
      const level = Math.max(1, h.floors || 1);
      this.climbedOn = { type: 'house', name: h.name, x: h.x, y: h.y, returnX, returnY, level };
      this.x = h.x; this.y = h.y;
      announce(`Vous grimpez sur le toit de ${h.name}. Meilleure vue pour viser au loin.`, 'assertive');
    }
    updateHud();
  },
  // Bâtiment à étages sur lequel se tient le joueur (rez-de-chaussée compris).
  getCurrentTallBuilding() {
    let best = null, bd = 2.5;
    (City.pois || []).forEach(p => {
      if ((p.floors || 1) <= 1) return;
      const d = UTIL.dist(p, this);
      if (d < bd) { bd = d; best = p; }
    });
    // Les maisons à étages (City.houses, séparées des POI) doivent aussi
    // compter : sinon Shift+E répondait toujours « vous n'êtes pas dans un
    // immeuble » chez soi dans une maison à étages.
    (City.houses || []).forEach(h => {
      if ((h.floors || 1) <= 1) return;
      const d = UTIL.dist(h, this);
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  },
  // Monte (+1) ou descend (−1) d'un étage dans le bâtiment courant.
  changeFloor(dir) {
    if (this.inVehicle) return announce('Impossible de changer d\'étage en véhicule.', 'assertive');
    const b = this.getCurrentTallBuilding();
    if (!b) return announce('Vous n\'êtes pas dans un bâtiment à étages. Approchez-vous d\'un immeuble.', 'assertive');
    const maxFloor = (b.floors || 1) - 1;
    const nf = UTIL.clamp((this.floor || 0) + dir, 0, maxFloor);
    if (nf === this.floor) {
      return announce(dir > 0 ? `Dernier étage atteint : étage ${nf} sur ${maxFloor}.` : 'Vous êtes déjà au rez-de-chaussée.', 'assertive');
    }
    this.floor = nf;
    // Son d'ascension/descente (aigu en montant, grave en descendant).
    if (window.Audio && Audio.tone) Audio.tone({ freq: dir > 0 ? 660 : 330, type: 'sine', duration: 0.14, gain: 0.1, pan: 0 });
    const bonus = Math.min(this.MAX_FLOOR_BONUS, this.floor * 0.05);
    const etage = this.floor === 0 ? 'rez-de-chaussée' : `étage ${this.floor}`;
    announce(`${b.name}, ${etage}${this.floor > 0 ? `, précision de tir plus ${Math.round(bonus * 100)} pour cent` : ''}.`, 'assertive');
  },
  // Appelé au déplacement à pied : si l'on s'éloigne du bâtiment, on redescend.
  _syncFloorOnMove() {
    if ((this.floor || 0) > 0 && !this.getCurrentTallBuilding()) {
      this.floor = 0;
      announce('Vous quittez le bâtiment. Retour au rez-de-chaussée.', 'polite');
    }
    // Grimpé sur un véhicule/toit : le moindre déplacement en fait descendre
    // (comme sauter au sol), plutôt que de rester "collé" en l'air ailleurs.
    if (this.climbedOn && (this.x !== this.climbedOn.x || this.y !== this.climbedOn.y)) {
      const name = this.climbedOn.name;
      this.climbedOn = null;
      announce(`Vous redescendez de ${name}.`, 'polite');
    }
  },

  // Visite guidée vocale de la ville : structure générale, quartiers et leur
  // direction depuis la position actuelle. Relançable par une touche.
  cityTour() {
    const parts = [`Bienvenue. La ville fait ${City.W * CONFIG.METERS_PER_TILE} mètres sur ${City.H * CONFIG.METERS_PER_TILE} mètres. Voici les quartiers autour de vous.`];
    const here = City.getDistrictAt(this.x, this.y);
    parts.push(`Vous êtes actuellement dans ${here.name}.`);
    City.districts.forEach(d => {
      const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
      if (Math.abs(cx - this.x) < 2 && Math.abs(cy - this.y) < 2) return;
      const dir = UTIL.bearing(cx - this.x, cy - this.y);
      const dist = Math.round(UTIL.dist({ x: cx, y: cy }, this) * CONFIG.METERS_PER_TILE);
      parts.push(`${d.name}, vers le ${dir}, à environ ${dist} mètres.`);
    });
    parts.push('Utilisez F pour le radar de proximité qui balaye tout ce qui vous entoure, C pour la boussole, et le menu carte du téléphone pour vous faire guider vers une destination.');
    announce(parts.join(' '), 'interrupt');
  },

  // Rafraîchit silencieusement scannedTargets (mêmes filtres que scan(), sans
  // la moindre annonce ni le bip) : sans ça, la liste numérotée (touches
  // 1-9) restait figée sur l'instantané du DERNIER scan manuel — tirer sur
  // quelqu'un qui vient de mourir laissait sa fiche dans la liste, et un
  // nouvel assaillant arrivé entre-temps restait invisible tant qu'on ne
  // relançait pas un scan complet. Appelée après chaque tir (voir shoot())
  // pour que la liste reste juste sans avoir à re-scanner à la voix.
  refreshScannedTargets() {
    const cls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    const airborne = !!(cls && cls.flies && this.altitude > 5);
    const RADIUS = airborne ? CONFIG.SCAN_RADIUS * 2.5 : CONFIG.SCAN_RADIUS;
    const npcs = City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < RADIUS).map(n => ({ ...n, dist: UTIL.dist(n, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(n.x - this.x, n.y - this.y) }));
    const realPlayers = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < RADIUS).map(p => {
      const masked = !!p.outfit?.masque;
      const contactMatch = !masked ? this.resolveContactName({ isPlayer: true, accountUsername: p.accountUsername }) : null;
      const displayName = masked ? 'Individu masqué' : (contactMatch ? contactMatch.label : `${p.firstName} ${p.lastName}`);
      return {
        id: p.id, name: displayName, job: 'joueur réel', gender: p.gender, outfit: p.outfit, isPlayer: true,
        x: p.x, y: p.y, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y),
      };
    });
    const people = [...realPlayers, ...npcs].sort((a, b) => a.dist - b.dist).slice(0, 9);
    const vehicles = City.vehicles.filter(v => UTIL.dist(v, this) < RADIUS).map(v => ({ ...v, isVehicle: true, dist: UTIL.dist(v, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(v.x - this.x, v.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    this.scannedTargets = [...people, ...vehicles];
  },
  // Scanner and targeting
  scan() {
    Audio.beep(0, 1200);
    // Survol en avion/hélicoptère à altitude : rayon de recherche bien plus
    // large (on voit large depuis le ciel), utile pour la police en
    // patrouille aérienne à la recherche de criminels au sol — avant, le
    // scan gardait le même rayon qu'à pied, inutile depuis les airs.
    const cls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    const airborne = !!(cls && cls.flies && this.altitude > 5);
    const RADIUS = airborne ? CONFIG.SCAN_RADIUS * 2.5 : CONFIG.SCAN_RADIUS;
    // !n.dead : un PNJ éliminé (voir killNPC) reste sur place, fouillable,
    // mais ne doit plus apparaître comme cible vivante — avant, un scan après
    // avoir descendu un garde continuait à l'afficher exactement comme s'il
    // était toujours debout, sans le moindre indice qu'il était hors combat.
    const npcs = City.npcs.filter(n => !n.dead && UTIL.dist(n, this) < RADIUS).map(n => ({ ...n, dist: UTIL.dist(n, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(n.x - this.x, n.y - this.y) }));
    // Nom affiché : masqué (cagoule) -> identité cachée, comme describePerson/
    // greetPlayer déjà en face-à-face ; sinon, le nom enregistré dans VOS
    // contacts s'il y en a un (resolveContactName), sinon le vrai nom du
    // personnage. Avant, le scan révélait toujours le vrai nom brut, sans
    // tenir compte ni d'un masque ni d'un contact enregistré — les deux
    // avaient beau déjà exister pour l'interaction directe (E), le scan les
    // ignorait complètement.
    const realPlayers = Array.from(Net.remotePlayers.values()).filter(p => UTIL.dist(p, this) < RADIUS).map(p => {
      const masked = !!p.outfit?.masque;
      const contactMatch = !masked ? this.resolveContactName({ isPlayer: true, accountUsername: p.accountUsername }) : null;
      const displayName = masked ? 'Individu masqué' : (contactMatch ? contactMatch.label : `${p.firstName} ${p.lastName}`);
      return {
        id: p.id, name: displayName, job: 'joueur réel', gender: p.gender, outfit: p.outfit, isPlayer: true,
        x: p.x, y: p.y, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y),
      };
    });
    const people = [...realPlayers, ...npcs].sort((a, b) => a.dist - b.dist).slice(0, 9);
    const pois = City.pois.filter(p => UTIL.dist(p, this) < RADIUS).map(p => ({ ...p, dist: UTIL.dist(p, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(p.x - this.x, p.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 9);
    // Les véhicules (dont avions/hélicoptères posés ou en vol si assez proches)
    // sont maintenant aussi CIBLABLES, pas juste annoncés : on peut tirer
    // dessus (crever un pneu, l'endommager, l'empêcher de rouler/voler — voir
    // shoot() et enterAsDriver()). Numérotés à la suite des personnes, pour ne
    // pas changer la numérotation existante (Ctrl+1-9) pour cibler une personne.
    const vehicles = City.vehicles.filter(v => UTIL.dist(v, this) < RADIUS).map(v => ({ ...v, isVehicle: true, dist: UTIL.dist(v, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(v.x - this.x, v.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    const ground = (City.groundItems || []).filter(it => UTIL.dist(it, this) < RADIUS).map(it => ({ ...it, dist: UTIL.dist(it, this) * CONFIG.METERS_PER_TILE, bearing: UTIL.bearing(it.x - this.x, it.y - this.y) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    this.scannedTargets = [...people, ...vehicles];
    let msg = airborne ? `Recherche aérienne : ${people.length} personnes repérées au sol, dont ${npcs.filter(n => n.hostile).length} individu(s) suspect(s), ${vehicles.length} véhicules. ` : `Scan : ${people.length} personnes, ${pois.length} lieux, ${vehicles.length} véhicules, ${ground.length} objets au sol. `;
    if (people.length) msg += 'Personnes : ' + people.map((n, i) => `${i + 1}, ${n.name}${n.isPlayer ? ' (joueur réel)' : n.hostile ? ', suspect' : ', ' + n.job}, ${Math.round(n.dist)} m, ${n.bearing}`).join('. ');
    if (pois.length) msg += 'Lieux : ' + pois.map(p => `${p.name}, ${Math.round(p.dist)} m, ${p.bearing}`).join('. ');
    if (vehicles.length) msg += 'Véhicules : ' + vehicles.map((v, i) => `${people.length + i + 1}, ${v.name}, ${Math.round(v.dist)} m, ${v.bearing}`).join('. ');
    if (ground.length) msg += 'Au sol : ' + ground.map(it => `${it.name}${it.q > 1 ? ' ×' + it.q : ''}, ${Math.round(it.dist)} m, ${it.bearing}`).join('. ');
    announce(msg, 'assertive');
    if (people.length || vehicles.length) announce('Tapez 1 à 9 pour cibler une personne ou un véhicule.', 'polite');
  },
  // Repère un tireur (PNJ) sans avoir à refaire un scan complet : à chaque
  // tir essuyé, une chance croissante de révéler sa position exacte et de
  // pouvoir le verrouiller directement — avant, rien ne permettait de
  // retrouver qui tirait si le dernier scan ne l'avait pas repéré (embuscade
  // apparue après coup, tireur hors du dernier balayage...).
  revealShooter(npc) {
    if (!npc || npc.dead) return;
    this.scannedTargets = this.scannedTargets || [];
    if (this.scannedTargets.some(t => t.id === npc.id)) return; // déjà repéré
    const dist = UTIL.dist(npc, this) * CONFIG.METERS_PER_TILE;
    const bearing = UTIL.bearing(npc.x - this.x, npc.y - this.y);
    this.scannedTargets.push({ ...npc, dist, bearing });
    Audio.beep(0, 900);
    announce(`Tir repéré : ${npc.name}, ${Math.round(dist)} m, ${bearing}. Touche ${this.scannedTargets.length} pour le verrouiller.`, 'assertive');
  },
  target(index) {
    const n = this.scannedTargets[index - 1];
    // Cibler (touches 1-9) est une COMMANDE explicite du joueur, pas une
    // narration passive : elle doit couper net ce qui est en train d'être
    // dit (la narration du scan, souvent longue, ou toute autre annonce) —
    // avant, la priorité 'assertive'/'combat' ne faisait QUE se mettre en
    // file d'attente sans jamais interrompre la parole en cours, donnant
    // l'impression que la touche ne réagissait pas tant que le scan parlait.
    if (!n) return announce('Cible invalide.', 'interrupt');
    this.lockedTarget = n;
    if (n.isVehicle) {
      announce(`Cible verrouillée : ${n.name} (véhicule), ${Math.round(n.dist)} mètres, ${n.bearing}.`, 'interrupt');
      updateHud();
      return;
    }
    // Verrouiller un VRAI joueur (potentiellement un allié venu avec vous, pas
    // forcément un ennemi) mérite une confirmation qu'on ne peut pas louper :
    // un bip distinct, pour éviter de tirer par erreur sur quelqu'un de son
    // groupe faute d'avoir bien entendu qui vient d'être verrouillé.
    if (n.isPlayer && window.Audio && Audio.beep) Audio.beep(0, 500);
    announce(`Cible verrouillée : ${n.name}, ${n.isPlayer ? 'joueur réel' : n.job}, ${Math.round(n.dist)} mètres, ${n.bearing}.`, 'interrupt');
    // Braquer une arme en verrouillant : la cible PNJ réagit tout de suite
    // (mains en l'air si acculée, sinon fuite) — le reste est géré par npcTick.
    if (this.weaponOut && !n.isPlayer) {
      const live = City.npcs.find(x => x.id === n.id);
      if (live && !live.hostile && !live.menotte && !live.knockedOut && !live.handsUp && !live.fleeing && live.job !== 'police') {
        if (UTIL.dist(live, this) < 3) { live.handsUp = true; announce(`${live.name} lève les mains, terrifié(e).`, 'polite'); }
        else { live.fleeing = true; announce(`${live.name} prend la fuite !`, 'polite'); }
        // Réaction PERSONNELLE de la cible menacée (pas les témoins alentour) :
        // le nouveau groupe dédié (voix homme uniquement, contenu fourni) pour
        // un PNJ homme, l'ancien groupe générique "panique" sinon (pas de
        // contenu équivalent en voix femme pour l'instant).
        this.npcVoiceReaction(live.x, live.y, { group: live.gender === 'homme' ? 'menace_directe' : 'panique', count: 1, radius: 12 });
      }
    }
    // Verrouiller un VRAI joueur, arme sortie : intention de tirer. Il
    // reçoit une alerte sonore distincte (voir Audio.targetedWarning /
    // onPlayerTargetedMe) pour pouvoir réagir — se mettre à couvert, fuir,
    // riposter — au lieu de se faire tirer dessus sans le moindre signe
    // avant-coureur.
    if (this.weaponOut && n.isPlayer && Net.connected) {
      Net.send({ type: 'player_targeted', targetId: n.id });
    }
    updateHud();
  },
  // Résout la cible verrouillée EN DIRECT plutôt que d'utiliser la photo
  // figée prise au moment du scan (bug corrigé : avant, position/santé/état
  // restaient bloqués à l'instant du scan, et menotter un PNJ modifiait une
  // copie sans jamais toucher le vrai PNJ de la ville). Pour un PNJ, renvoie
  // directement l'objet réel de City.npcs (les modifications s'appliquent
  // pour de vrai) ; pour un joueur réel, son état réseau le plus récent.
  getLiveTarget() {
    if (!this.lockedTarget) return null;
    let live;
    if (this.lockedTarget.isVehicle) {
      const v = City.vehicles.find(vv => vv.id === this.lockedTarget.id);
      if (!v) return null;
      live = { id: v.id, name: v.name, isVehicle: true, x: v.x, y: v.y, health: v.hp };
      this.lockedTarget.x = live.x; this.lockedTarget.y = live.y; this.lockedTarget.hp = v.hp;
      return live;
    }
    if (this.lockedTarget.isPlayer) {
      const p = Net.remotePlayers.get(this.lockedTarget.id);
      if (!p) return null; // déconnecté ou hors de portée réseau
      live = { id: p.id, name: this.lockedTarget.name, isPlayer: true, x: p.x, y: p.y, health: p.health, unconscious: p.unconscious, isCuffed: p.isCuffed, outfit: p.outfit, role: p.role, policeRank: p.policeRank };
    } else {
      live = City.npcs.find(n => n.id === this.lockedTarget.id) || null;
      if (!live) return null;
    }
    // Rafraîchit la « photo » du verrou (position et santé) : l'affichage HUD et
    // toute lecture qui s'appuie encore sur lockedTarget restent ainsi à jour
    // quand la cible se déplace ou encaisse des dégâts.
    this.lockedTarget.x = live.x; this.lockedTarget.y = live.y;
    if (typeof live.health === 'number') this.lockedTarget.health = live.health;
    return live;
  },
  // Rafraîchit et RÉANNONCE la cible verrouillée en direct : distance, cap,
  // santé et état à jour. Si elle n'est plus repérable (PNJ disparu, joueur
  // déconnecté), on déverrouille proprement.
  announceTarget() {
    if (!this.lockedTarget) return announce('Aucune cible verrouillée. Scannez, puis tapez 1 à 9 pour en choisir une.', 'assertive');
    const live = this.getLiveTarget();
    if (!live) { const name = this.lockedTarget.name; this.lockedTarget = null; updateHud(); return announce(`${name} n'est plus repérable. Cible déverrouillée.`, 'assertive'); }
    const d = Math.round(UTIL.dist(live, this) * CONFIG.METERS_PER_TILE);
    const bearing = UTIL.bearing(live.x - this.x, live.y - this.y);
    let state = '';
    if (live.dead) state = ', à terre, sans vie';
    else if (live.knockedOut || live.unconscious) state = ', inconsciente';
    if (live.menotte || live.isCuffed) state += ', menottée';
    const hp = typeof live.health === 'number' ? `, santé ${Math.round(live.health)} pour cent` : '';
    announce(`Cible : ${this.lockedTarget.name || live.name}, ${d} mètres vers le ${bearing}${hp}${state}. Visée : ${this.aimPart}.`, 'assertive');
    if (window.Audio && Audio.tone) Audio.tone({ freq: 700, type: 'sine', duration: 0.12, gain: 0.1, pan: this.panForPoint(live.x, live.y) });
  },
  // Marcher vers la cible verrouillée : cette localisation-là (pour SE
  // DÉPLACER, pas pour tirer) est toujours fiable à 100%, quelle que soit la
  // distance — seule la précision au TIR (voir shoot) dépend de la distance.
  // Avant, ce n'était possible qu'en passant par le chien guide
  // (GuideDog.guideToCurrentTarget) ; désormais accessible à tout le monde.
  guideToLockedTarget() {
    const live = this.getLiveTarget();
    if (!live) return announce('Aucune cible verrouillée ou repérable. Scannez, puis tapez 1 à 9 pour en choisir une.', 'assertive');
    const name = this.lockedTarget?.name || live.name || 'la cible';
    this.setGuidance({ name, x: live.x, y: live.y });
    announce(`Guidage activé vers ${name}.`, 'assertive');
  },
  // Invalidation automatique : si la cible verrouillée n'est plus repérable
  // (disparue/déconnectée), on la déverrouille au lieu de la garder figée.
  refreshTargetValidity() {
    if (!this.lockedTarget) return;
    if (!this.getLiveTarget()) {
      const name = this.lockedTarget.name; this.lockedTarget = null; updateHud();
      announce(`${name} n'est plus en vue. Cible déverrouillée.`, 'polite');
    }
  },
  changeAim(dir) {
    const idx = CONFIG.AIM_PARTS.indexOf(this.aimPart);
    this.aimPart = CONFIG.AIM_PARTS[(idx + dir + CONFIG.AIM_PARTS.length) % CONFIG.AIM_PARTS.length];
    announce(`Visée : ${this.aimPart}.`, 'polite'); updateHud();
  },

  // Weapons
  // État des munitions d'une arme (compatibilité) : sert à prévenir tout de
  // suite si l'arme est utilisable ou s'il manque le bon calibre (bug #13).
  _weaponAmmoStatus(w) {
    if (!w) return '';
    if (!w.ammoType) return 'Arme de contact, pas de munitions nécessaires.'; // matraque, etc.
    const loaded = this.ammo[w.ammoType] || 0;
    const reserve = this.ammoReserve[w.ammoType] || 0;
    const calibre = (typeof AMMO_CATALOG !== 'undefined' && AMMO_CATALOG[w.ammoType]?.name) || w.caliber || w.ammoType;
    if (loaded + reserve <= 0) return `Attention : aucune munition de calibre ${calibre}. Arme inutilisable tant que vous n'en avez pas.`;
    return `Chargeur ${loaded} sur ${w.magazine}, réserve ${reserve}, calibre ${calibre}.`;
  },
  toggleWeapon() {
    if (!this.weapons.length) return announce('Vous n\'avez pas d\'arme.', 'assertive');
    if (this.weaponOut) { this.weaponOut = false; announce('Arme rangée.', 'polite'); }
    else {
      // On ressort la DERNIÈRE arme sélectionnée si on la possède encore,
      // sinon la première de la liste.
      const id = (this.lastWeaponId && this.weapons.includes(this.lastWeaponId)) ? this.lastWeaponId : this.weapons[0];
      this.weapon = WEAPON_CATALOG[id] || null; this.lastWeaponId = id; this.weaponOut = !!this.weapon;
      if (this.weapon) { announce(`${this.weapon.name} sorti. ${this._weaponAmmoStatus(this.weapon)}`, 'assertive'); this.reactNearbyToWeapon(); }
    }
    updateHud();
  },
  selectWeapon(id) {
    if (!this.weapons.includes(id)) return announce('Arme non possédée.', 'assertive');
    const alreadyOut = this.weaponOut;
    this.weapon = WEAPON_CATALOG[id]; this.lastWeaponId = id; this.weaponOut = true;
    this.weaponJammed = false; // une autre arme qu'on prend en main n'est jamais déjà enrayée
    announce(`${this.weapon.name} équipé. ${this._weaponAmmoStatus(this.weapon)}`, 'assertive'); updateHud();
    if (!alreadyOut) this.reactNearbyToWeapon();
  },
  // PNJ civils qui REMARQUENT une arme sortie à proximité, même sans être
  // verrouillés comme cible : avant, seule la cible explicitement verrouillée
  // réagissait (voir target()), tous les autres PNJ à côté restaient
  // totalement indifférents à une arme brandie devant eux.
  reactNearbyToWeapon() {
    // En plein vol (aéronef en altitude), les PNJ sont au sol, bien trop
    // loin pour voir ni entendre une arme sortie dans le cockpit — sinon
    // ils réagissaient à tort comme si l'arme était brandie juste devant eux.
    const vcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    if (vcls && vcls.flies && this.altitude > 5) return;
    const nearby = City.npcs.filter(n => !n.dead && !n.hostile && !n.menotte && !n.knockedOut && !n.handsUp && !n.fleeing && n.job !== 'police' && UTIL.dist(n, this) < 6);
    if (!nearby.length) return;
    nearby.forEach(n => { n.fleeing = true; });
    const closest = nearby.reduce((a, b) => UTIL.dist(a, this) < UTIL.dist(b, this) ? a : b);
    this.npcVoiceReaction(closest.x, closest.y, { group: 'panique', count: Math.min(3, nearby.length), radius: 8 });
    announce(`${nearby.length > 1 ? nearby.length + ' personnes proches paniquent' : `${closest.name} panique`} en voyant votre arme.`, 'polite');
  },
  reload() {
    if (!this.weapon) return;
    // Arme enrayée (voir shoot) : R sert d'abord à la dégager, sans
    // consommer de munition — un vrai rechargement suit sur un appui suivant.
    if (this.weaponJammed) {
      this.weaponJammed = false;
      Audio.click();
      AudioLib.playOnce('sfx_recharge', { volume: 0.5 });
      announce(`Vous dégagez l'enrayage de ${this.weapon.name}. Prête à retirer.`, 'assertive');
      updateHud();
      return;
    }
    const type = this.weapon.ammoType;
    if (!type) return announce('Cette arme ne se recharge pas.', 'polite');
    const loaded = this.ammo[type] || 0;
    const capacity = this.weapon.magazine;
    const missing = capacity - loaded;
    if (missing <= 0) return announce('Chargeur déjà plein.', 'polite');
    const reserve = this.ammoReserve[type] || 0;
    const calibre = (typeof AMMO_CATALOG !== 'undefined' && AMMO_CATALOG[type]?.name) || this.weapon.caliber || type;
    if (reserve <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce(`Pas de munitions de calibre ${calibre} en réserve. Achetez-en à l'armurerie ou au marché noir.`, 'assertive'); return; }
    const transfer = Math.min(missing, reserve);
    this.ammo[type] = loaded + transfer;
    this.ammoReserve[type] = reserve - transfer;
    Audio.click();
    AudioLib.playOnce('sfx_recharge');
    announce(`${this.weapon.name} rechargé : ${this.ammo[type]}/${capacity} dans le chargeur, ${this.ammoReserve[type]} en réserve.`, 'polite');
    updateHud();
  },
  shoot() {
    if (this.cooldown) return; // cadence de l'arme : this.cooldown était défini mais jamais vérifié, la cadence n'était jamais appliquée
    if (this.unconscious) return announce('Vous êtes inconscient.', 'polite');
    if (this.isCuffed) return announce('Vous êtes menotté(e), impossible d\'agir.', 'polite');
    if (this.hidden) { this.hidden = false; announce('Le coup de feu révèle votre position.', 'polite'); } // tirer casse la planque

    if (!this.weaponOut || !this.weapon) return announce('Sortez d\'abord une arme.', 'assertive');
    if (this.weaponJammed) return announce(`${this.weapon.name} est enrayée. Dégagez-la avec R avant de retirer.`, 'assertive');
    if (this.ammo[this.weapon.ammoType] <= 0) { AudioLib.playOnce('sfx_arme_vide'); announce('Chargeur vide. Rechargez avec R.', 'assertive'); return; }
    const w = this.weapon;
    // Enrayage : une arme à feu (pas une arme de contact comme la matraque,
    // magazine: 0) peut occasionnellement se bloquer au tir. Ne consomme pas
    // de munition ; il faut la dégager (touche R) avant de pouvoir retirer.
    if (w.magazine > 0 && UTIL.chance(this.JAM_CHANCE)) {
      this.weaponJammed = true;
      AudioLib.playOnce('sfx_arme_enrayee', { volume: 0.6, exclusive: 'weapon_shot' });
      if (Net.connected) Net.emitSound('sfx_arme_enrayee', { vol: 0.5 });
      announce(`${w.name} s'enraye ! Dégagez-la avec R avant de pouvoir retirer.`, 'assertive');
      this.cooldown = true; setTimeout(() => this.cooldown = false, w.fireRate * 1000);
      updateHud();
      return;
    }
    const live = this.getLiveTarget();
    const target = live ? { ...this.lockedTarget, ...live } : null;
    const range = target ? UTIL.dist(target, this) : 0;
    // Avantage de hauteur : altitude (véhicule volant), étage, OU grimpé sur
    // un véhicule/toit de maison (voir toggleClimb) — ce dernier étend aussi
    // la PORTÉE effective (viser plus loin depuis un point haut), pas
    // seulement la précision.
    const heightBonus = this.altitude > 0 ? Math.min(0.15, this.altitude * 0.01) : 0;
    const floorBonus = (!this.inVehicle && this.floor > 0) ? Math.min(this.MAX_FLOOR_BONUS, this.floor * 0.05) : 0;
    const climbBonus = this.climbedOn ? Math.min(this.MAX_FLOOR_BONUS, (this.climbedOn.level || 1) * 0.08) : 0;
    const effRange = this.climbedOn ? w.range * 1.6 : w.range;
    let acc = w.accuracy;
    if (this.aimPart === 'tete') acc *= 0.75; else if (this.aimPart === 'jambes') acc *= 0.85;
    if (range > effRange) {
      acc *= 0.3; // au-delà de la portée effective : très imprécis
    } else {
      // Comme dans la vraie vie : plus la cible est proche, plus elle est
      // facile à toucher ; plus elle est loin (jusqu'à la portée de l'arme),
      // plus c'est difficile. Avant, seule la limite de portée comptait — un
      // tir à bout portant et un tir à la limite de portée avaient exactement
      // la même précision, ce qui ne visait jamais que 100% ou presque.
      const distRatio = effRange > 0 ? UTIL.clamp(range / effRange, 0, 1) : 0;
      acc *= (1 - distRatio * 0.55); // jusqu'à -55% de précision à portée max
    }
    acc += heightBonus + floorBonus + climbBonus;
    this.ammo[w.ammoType]--;
    // Armes lourdes avec un son de tir réel dédié (voir WEAPON_CATALOG) :
    // sinon, tir synthétisé générique comme avant.
    if (w.shotSound) AudioLib.playOnce(w.shotSound, { volume: 0.9, exclusive: 'weapon_shot' });
    else Audio.gunshot(w.name, 0);
    if (Net.connected) Net.emitSound(w.shotSound || 'synth:gunshot', { vol: 0.95 }); // audible par les joueurs proches
    if (typeof GuideDog !== 'undefined') GuideDog.onDangerNear(this.x, this.y); // le chien alerte / se cache
    setTimeout(() => Audio.shellDrop(0), 150);
    if (Date.now() - (this._lastGunfireReport || 0) > 8000) {
      this._lastGunfireReport = Date.now();
      Game.reportCrimeToPolice('coups_de_feu', 'Coups de feu entendus');
    }
    if (target && range <= effRange) {
      if (Math.random() < acc) {
        let dmg = w.dmg * (this.aimPart === 'tete' ? 2 : this.aimPart === 'jambes' ? 0.6 : 1);
        // Comme dans la vraie vie : un projectile perd de la vitesse (donc de
        // l'énergie/du pouvoir d'arrêt) en parcourant de la distance — un tir
        // à bout portant fait plus mal qu'un tir à la limite de portée
        // effective de l'arme, tête comprise (jusqu'à -35 % à portée max ;
        // au-delà, déjà très imprécis, voir le calcul de acc ci-dessus).
        if (effRange > 0) dmg *= (1 - UTIL.clamp(range / effRange, 0, 1) * 0.35);
        if (target.isVehicle) {
          const v = City.vehicles.find(vv => vv.id === target.id);
          if (v) {
            v.hp = Math.max(0, (v.hp || 100) - Math.round(dmg));
            Audio.impact(0);
            if (Net.connected) Net.emitSound('veh_kolision_1', { vol: 0.5 });
            announce(`Véhicule touché : ${target.name}, vie à ${Math.round(v.hp)} pour cent.`, 'assertive');
            if (v.hp <= 0) announce(`${target.name} est hors d'usage.`, 'assertive');
          }
        } else if (target.isPlayer) {
          // Chaque client est seul autorité sur sa propre santé : on relaie le
          // coup au joueur visé via le serveur, il s'applique les dégâts lui-même.
          if (!Net.connected) return;
          Net.send({ type: 'player_hit', targetId: target.id, damage: Math.round(dmg), headshot: this.aimPart === 'tete' });
          Audio.impact(0);
          announce(`Touché ${target.name} à la ${this.aimPart}. ${Math.round(dmg)} dégâts.`, 'assertive');
        } else {
          const npc = City.npcs.find(n => n.id === target.id);
          if (npc) {
            npc.health -= Math.round(dmg);
            Audio.impact(0);
            this.playNpcHitCry(npc);
            announce(`Touché ${target.name} à la ${this.aimPart}. ${Math.round(dmg)} dégâts.`, 'assertive');
            if (npc.health <= 0) { this.killNPC(npc); }
            else {
              if (npc.hostile) npc.relation -= 40;
              // Le cri d'impact (playNpcHitCry, ci-dessus) reste inchangé — ceci
              // est la réaction PARLÉE qui suit, propre à la victime elle-même.
              this.npcPanicReaction(npc.x, npc.y, { count: 1, group: npc.gender === 'homme' ? 'menace_directe' : 'panique' });
            }
          }
        }
      } else {
        announce(`Tir manqué sur ${target.name}.`, 'polite');
      }
    } else {
      announce('Tir dans le vide.', 'polite');
    }
    if (w.fireRate) {
      this.cooldown = true; setTimeout(() => this.cooldown = false, w.fireRate * 1000);
    }
    if (w.legal === false) { this.wanted = Math.min(100, this.wanted + 5); this.policeAwareness = Math.min(100, this.policeAwareness + 10); }
    Police.dispatch('tir', this.x, this.y, this.lockedTarget);
    // Liste de ciblage (1-9) tenue à jour après chaque tir, sans re-scanner
    // à la voix (voir refreshScannedTargets) : les nouveaux assaillants
    // arrivés depuis le dernier scan deviennent immédiatement ciblables.
    this.refreshScannedTargets();
    updateHud();
  },
  startBurst() {
    if (this.burstTimer) return;
    if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.shoot(); return; } // arme non automatique : un seul coup
    if (this.weaponJammed) { this.shoot(); return; } // laisse shoot() annoncer l'enrayage
    if ((this.ammo[this.weapon.ammoType] || 0) <= 0) { AudioLib.playOnce('sfx_arme_vide'); return announce('Chargeur vide. Rechargez avec R.', 'assertive'); }
    // Le son de rafale boucle tant que le doigt/la touche de tir reste enfoncé.
    // Les armes très rapides (cadence ≤ 0.09 s entre coups, comme l'UZI) ont
    // une rafale plus intense et saturée ; les autres armes automatiques
    // (AK-47, M4, plus lentes) gardent la rafale normale.
    this._burstKey = this.weapon.fireRate <= 0.09 ? 'rafale_puissante' : 'sfx_rafale';
    AudioLib.playLoop(this._burstKey);
    const fire = () => {
      if (!this.weaponOut || !this.weapon || !this.weapon.auto) { this.stopBurst(); return; }
      // Enrayage en cours de rafale : coupe la rafale, un seul avertissement.
      if (this.weaponJammed) { this.stopBurst(); return; }
      if ((this.ammo[this.weapon.ammoType] || 0) <= 0) { this.stopBurst(); return; }
      this.shoot();
    };
    fire();
    this.burstTimer = setInterval(fire, Math.max(80, this.weapon.fireRate * 1000));
    announce('Rafale !', 'assertive');
  },
  stopBurst() {
    if (this.burstTimer) { clearInterval(this.burstTimer); this.burstTimer = null; }
    AudioLib.stopLoop(this._burstKey || 'sfx_rafale');
  },
  throwGrenade() {
    const it = this.inventory.find(i => i.category === 'explosif');
    if (!it) return announce('Vous n\'avez pas de grenade. Le marché noir en vend.', 'assertive');
    if (this.grenadeFusing) return announce('Une grenade est déjà dégoupillée, attendez l\'explosion.', 'assertive');
    const target = this.getLiveTarget();
    // Portée réaliste d'un lancer de grenade à la main : environ 35 m (~9
    // cases à 4 m/case) pour un lancer efficace — avant, elle pouvait
    // exploser sur une cible verrouillée à n'importe quelle distance, ce qui
    // n'a aucun sens pour un lancer à bras. Au-delà, elle retombe avant
    // d'arriver, plus près de vous, comme dans la vraie vie.
    const MAX_THROW = 9;
    let cx = target ? target.x : this.x, cy = target ? target.y : this.y;
    if (target) {
      const throwDist = UTIL.dist(target, this);
      if (throwDist > MAX_THROW) {
        const ratio = MAX_THROW / throwDist;
        cx = this.x + (target.x - this.x) * ratio;
        cy = this.y + (target.y - this.y) * ratio;
        announce(`${target.name} est hors de portée de lancer (${Math.round(throwDist * CONFIG.METERS_PER_TILE)} m, portée maximale environ ${MAX_THROW * CONFIG.METERS_PER_TILE} m) : la grenade retombe avant d'arriver.`, 'assertive');
      }
    }
    this.removeItem(it.id, 1);
    this.grenadeFusing = true;
    announce('Grenade dégoupillée ! Mettez-vous à couvert.', 'assertive');
    const FUSE_LOOPS = 3; // le compte à rebours joue au moins 3 fois avant l'explosion
    AudioLib.playRepeated('sfx_decompte', FUSE_LOOPS, () => {
      this.grenadeFusing = false;
      AudioLib.playOnce('sfx_explosion');
      const radius = 6;
      let touched = 0;
      City.npcs.filter(n => !n.dead && UTIL.dist(n, { x: cx, y: cy }) <= radius).forEach(n => {
        n.health -= UTIL.randInt(40, 90); touched++;
        if (n.health <= 0) this.killNPC(n);
      });
      City.vehicles.filter(v => UTIL.dist(v, { x: cx, y: cy }) <= radius).forEach(v => { v.hp = Math.max(0, v.hp - UTIL.randInt(40, 80)); });
      if (UTIL.dist({ x: cx, y: cy }, this) <= radius) this.takeDamage(UTIL.randInt(20, 50), { explosion: true });
      this.wanted = Math.min(100, this.wanted + 25);
      Game.reportCrimeToPolice('explosion', 'Explosion entendue');
      announce(`Explosion ! Zone touchée autour de ${target ? target.name : 'votre position'}. ${touched} personne(s) affectée(s).`, 'assertive');
      this.npcVoiceReaction(cx, cy, { radius: radius + 8, count: 3 });
      updateHud();
    });
  },
  killNPC(npc) {
    // Le bruit de chute (ci-dessous) suffit déjà à savoir que la cible est
    // hors combat : l'annonce vocale qui redisait "X est hors combat" en
    // 'assertive' n'apportait rien de plus, mais coupait systématiquement
    // toute autre annonce en cours (souvent plus importante en plein combat).
    const deathX = npc.x, deathY = npc.y;
    npc.dead = true; npc.knockedOut = true; // le corps reste sur place, fouillable (voir Game.searchTarget)
    AudioLib.playOnce('bruit_chute', { volume: 0.6 });
    this.npcPanicReaction(deathX, deathY, { count: 2 });
  },
  // Cri d'un PNJ touché (coup ou balle) — voix d'homme, choisi au hasard
  // parmi les 7 variantes disponibles.
  playNpcHitCry(npc) {
    // Un seul cri par personne dans un court laps de temps : frapper plusieurs
    // fois de suite ne doit pas empiler des cris qui se chevauchent.
    const now = Date.now();
    if (npc && npc._lastCry && now - npc._lastCry < 700) return;
    if (npc) npc._lastCry = now;
    const key = UTIL.pick(['cri_png_1', 'cri_png_2', 'cri_png_3', 'cri_png_4', 'cri_png_5', 'cri_png_6', 'cri_png_7']);
    if (AudioLib.playVoice) AudioLib.playVoice(key, { volume: 0.6 });
    else AudioLib.playOnce(key, { volume: 0.6 });
    // Les autres joueurs réels à proximité entendent aussi ce cri de douleur.
    if (Net.connected) Net.emitSound(key, { vol: 0.5 });
  },

  // Réactions vocales des PNJ selon la situation (témoins de violence, PNJ
  // hostiles/territoriaux, etc.). `opts.group` choisit le groupe de voix
  // (NPCVoiceGroups) à utiliser : "panique" par défaut, "enerve" pour les
  // PNJ hostiles, et d'autres groupes viendront s'ajouter à l'avenir.
  npcVoiceReaction(cx, cy, opts = {}) {
    // Anti-empilement : on ne déclenche pas une nouvelle salve de voix si la
    // précédente vient tout juste de partir (sinon les réactions se compilent).
    const now = Date.now();
    if (now - (this._lastNpcVoice || 0) < 800) return;
    this._lastNpcVoice = now;
    const radius = opts.radius || 14;
    const count = opts.count || 1;
    const groupName = opts.group || 'panique';
    const group = NPCVoiceGroups[groupName] || NPCVoiceGroups.panique;
    const witnesses = City.npcs.filter(n => !n.dead && UTIL.dist(n, { x: cx, y: cy }) < radius);
    if (!witnesses.length) return;
    const chosen = [];
    for (let i = 0; i < Math.min(count, witnesses.length); i++) chosen.push(UTIL.pick(witnesses));
    const muffle = this.vehicleSoundMuffle();
    chosen.forEach((n, i) => {
      setTimeout(() => {
        const pool = group.filter(l => l.gender === n.gender);
        const line = UTIL.pick(pool.length ? pool : group);
        const pan = Math.max(-1, Math.min(1, (n.x - this.x) / 15));
        AudioLib.playPositional(line.key, pan, 0.85 * muffle);
        // Comme dans GTA RP : les autres joueurs réels à proximité entendent
        // aussi cette réaction de PNJ, pas seulement soi-même.
        if (Net.connected) Net.emitSound(line.key, { vol: 0.6 });
      }, i * UTIL.randInt(150, 500)); // léger décalage pour éviter que les voix se superposent exactement
    });
  },
  // Alias conservé pour compatibilité avec le code existant.
  npcPanicReaction(cx, cy, opts = {}) { this.npcVoiceReaction(cx, cy, opts); },
  // Atténuation des sons extérieurs (paroles des PNJ) selon où l'on se
  // trouve : dans la vraie vie, un habitacle fermé étouffe déjà beaucoup les
  // bruits du dehors, et en plein vol on n'entend quasiment plus rien au
  // sol — avant, les répliques des PNJ passaient exactement comme à pied,
  // que l'on soit enfermé dans une voiture ou en plein vol en avion/hélico.
  vehicleSoundMuffle() {
    if (!this.inVehicle || !this.vehicle) return 1;
    const vcls = VEHICLE_CATALOG[this.vehicle.type];
    if (!vcls) return 1;
    if (vcls.flies && this.altitude > 5) return 0.08; // en plein vol : quasiment rien du sol
    if (!vcls.human && vcls.doors > 0) return 0.3; // habitacle fermé (pas une moto) : très étouffé
    return 1;
  },

  // Bribes de conversation de passants entendues en marchant près d'un PNJ
  // (pas d'interaction directe) : donne l'impression d'une ville vivante,
  // avec de vraies voix positionnées à la vraie position du PNJ (contrairement
  // à randomEncounters() ci-dessous, dont le panoramique est purement
  // aléatoire, sans PNJ réel derrière).
  tickPassersby() {
    if (this.inVehicle || this.unconscious || this.interior) return;
    const now = Date.now();
    if (now - (this._lastPassantLine || 0) < 12000) return; // pas plus d'une bribe toutes les 12 s
    const nearby = City.npcs.filter(n => !n.dead && !n.hostile && !n.menotte && !n.knockedOut && !n.handsUp && UTIL.dist(n, this) < 8);
    if (!nearby.length || !UTIL.chance(0.35)) return;
    this._lastPassantLine = now;
    const n = UTIL.pick(nearby);
    const slug = UTIL.pick(PASSANT_LINES);
    const key = `passant_${slug}_${n.gender === 'femme' ? 'f' : 'h'}`;
    const dist = UTIL.dist(n, this);
    const vol = UTIL.clamp(0.7 - dist / 12, 0.15, 0.7);
    AudioLib.playPositional(key, this.panForPoint(n.x, n.y), vol);
    // Les autres joueurs réels à proximité entendent aussi cette bribe de conversation.
    if (Net.connected) Net.emitSound(key, { vol: 0.5 });
  },
  // Random encounters
  randomEncounters() {
    if (UTIL.chance(0.02)) {
      const options = ['Un chien aboie à l\'est.','Un klaxon retentit au nord.','Des sirènes au loin.','Des enfants rient à proximité.','Un moteur de moto démarre.','Une porte claque.','Un véhicule passe non loin.'];
      const msg = UTIL.pick(options);
      log(msg, 'system');
      if (msg.includes('klaxon') && City.isRoad(this.x, this.y)) {
        AudioLib.playPositional(UTIL.pick(['npc_klaxon_1', 'npc_klaxon_2', 'npc_klaxon_3', 'npc_klaxon_4', 'npc_klaxon_5']), UTIL.randInt(-10, 10) / 10, 0.6);
      } else if (msg.includes('véhicule passe') && City.isRoad(this.x, this.y)) {
        AudioLib.playPositional(UTIL.pick(['npc_veh_passage_1', 'npc_veh_passage_20kmh', 'veh_passage_ext_50kmh']), UTIL.randInt(-10, 10) / 10, 0.4);
      }
    }
    // Le passage d'un avion dans le ciel ne s'entend qu'à l'aéroport : c'est
    // là, et seulement là, que ça a du sens.
    if (UTIL.dist(this, City.pois.find(p => p.type === 'aeroport') || { x: -999, y: -999 }) < 25 && UTIL.chance(0.015)) {
      log('Un avion tourne dans le ciel de l\'aéroport.', 'system');
      AudioLib.playOnce('passage_avion_ciel', { volume: 0.3 });
    }
  },

  // Health and survival
  // Chance qu'un tir touche la tête plutôt qu'ailleurs — rare, mais mortel
  // sans casque de protection (voir takeDamage/permanentDeath).
  rollHeadshot() {
    return Math.random() < 0.08;
  },
  takeDamage(amount, opts = {}) {
    // Être À L'INTÉRIEUR d'un véhicule protège des tirs, selon son blindage
    // (armor du catalogue) — un char ou un fourgon blindé absorbe l'essentiel
    // d'un tir, une voiture normale un peu (carrosserie de base), une moto
    // ou un véhicule sans portières (doors: 0) aucune protection. Avant,
    // rien ne différenciait être dans un véhicule blindé d'être à découvert
    // à pied : on se faisait tirer dessus pareil, sans même être sorti.
    if (this.inVehicle && this.vehicle && !opts.explosion) {
      const vcls = VEHICLE_CATALOG[this.vehicle.type];
      if (vcls && !vcls.human && vcls.doors > 0) {
        const reduction = Math.max(vcls.armor || 0, 0.2); // au moins une carrosserie de base
        amount = Math.round(amount * (1 - reduction));
      }
    }
    // Le gilet pare-balles réduit les dégâts d'un tir au corps (pas à la
    // tête — c'est le casque qui protège ça — ni d'une explosion).
    const vestAbsorbs = this.hasVest && !opts.headshot && !opts.explosion;
    if (vestAbsorbs) amount = Math.round(amount * 0.65);
    // Le casque réduisait déjà le RISQUE de mort immédiate lors d'un tir à la
    // tête (voir plus bas, fatalHeadshot), mais n'amortissait jamais le
    // moindre point de dégâts : on encaissait le même choc brutal qu'à nu,
    // casque ou pas — il ne « protégeait » donc pas vraiment. Il réduit
    // maintenant aussi les dégâts eux-mêmes, comme le gilet pour le corps.
    const helmetAbsorbs = this.hasHelmet && opts.headshot && !opts.explosion;
    if (helmetAbsorbs) amount = Math.round(amount * 0.5);
    this.health = Math.max(0, this.health - amount); updateHud();
    // Retour sonore de l'impact : on ignore l'usure passive (faim/soif, très
    // faibles montants) pour ne jouer un son que lors d'un vrai coup/explosion.
    // Casque/gilet qui absorbent le choc -> son étouffé plutôt qu'invisible.
    if (amount >= 1 && window.Audio && Audio.playerHit) {
      const protectedHit = (opts.headshot && this.hasHelmet) || vestAbsorbs;
      // Spatialisé vers le tireur quand sa position est connue (opts.attackerX/Y) :
      // avant, playerHit() était toujours appelé sans pan, donc toujours entendu
      // pile au centre, sans indication de la direction réelle du tir.
      const pan = (typeof opts.attackerX === 'number') ? this.panForPoint(opts.attackerX, opts.attackerY) : 0;
      Audio.playerHit(protectedHit, pan);
    }
    // Suivi des dégâts récents (15 dernières secondes) pour repérer une vraie
    // hémorragie massive : beaucoup trop d'impacts en peu de temps, pas juste
    // quelques balles.
    const now = Date.now();
    this._recentDamage = (this._recentDamage || []).filter(d => now - d.time < 15000);
    this._recentDamage.push({ time: now, amount });
    const recentTotal = this._recentDamage.reduce((s, d) => s + d.amount, 0);
    if (this.health <= 0) {
      const fatalHeadshot = opts.headshot && !this.hasHelmet;
      const fatalExplosion = !!opts.explosion;
      // Seuil relevé (200 -> 450) : dans une mission à plusieurs adversaires
      // armés (repaire de gang, convoi, planque gardée...), 200 dégâts en 15
      // secondes s'atteignaient très facilement avec des tirs au corps tout
      // à fait normaux — un simple échange de tirs se terminait en mort
      // DÉFINITIVE au lieu de juste tomber inconscient (voir die()), ce qui
      // n'a rien de réaliste façon GTA RP : on doit pouvoir survivre à une
      // vraie fusillade tant qu'on n'est pas achevé (tête sans casque,
      // explosion). Le seuil reste néanmoins réel, pour une hémorragie
      // vraiment massive et prolongée.
      const bledOut = recentTotal > 450;
      if (fatalHeadshot || fatalExplosion || bledOut) {
        this.permanentDeath({ headshot: fatalHeadshot, explosion: fatalExplosion, bledOut });
      } else {
        this.die();
      }
    }
  },
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount); updateHud();
  },
  survivalTick() {
    // Inconscient : on ne touche plus à la santé (ni dégâts de faim, ni soin) —
    // le réveil est géré par tickUnconscious. Éviter d'infliger des dégâts ici
    // empêche de rappeler die() en boucle tant que la santé est à zéro.
    if (this.unconscious) return;
    if (this.hunger > 90 || this.thirst > 90) this.takeDamage(0.05);
    if (this.health < 100 && this.hunger < 50 && this.thirst < 50) this.heal(0.02);
    this._survivalAlerts();
  },
  // Alertes vocales de survie : préviennent le joueur quand sa santé baisse
  // (paliers 75, 50, 25, 10 %) et l'invitent à manger / boire quand la faim ou
  // la soif montent. Chaque palier n'est annoncé qu'une fois (réarmé quand la
  // valeur revient à la normale), pour ne pas répéter en boucle.
  _survivalAlerts() {
    const hp = Math.round(this.health);
    const hpLevel = hp <= 10 ? 10 : hp <= 25 ? 25 : hp <= 50 ? 50 : hp <= 75 ? 75 : 0;
    if (hpLevel && hpLevel !== this._lastHealthAlert) {
      this._lastHealthAlert = hpLevel;
      if (hp <= 10) announce(`Danger vital : santé ${hp} pour cent. Mangez, buvez ou allez vite à l'hôpital, sinon vous allez perdre connaissance.`, 'assertive');
      else if (hp <= 25) announce(`Santé critique : ${hp} pour cent. Mangez et buvez sans tarder, ou passez à l'hôpital.`, 'assertive');
      else announce(`Attention, votre santé baisse : ${hp} pour cent. Pensez à manger et à boire.`, 'assertive');
    } else if (hp > 78) this._lastHealthAlert = 0;

    const hg = Math.round(this.hunger);
    const hungerLevel = hg >= 95 ? 95 : hg >= 80 ? 80 : hg >= 60 ? 60 : 0;
    if (hungerLevel && hungerLevel !== this._lastHungerAlert) {
      this._lastHungerAlert = hungerLevel;
      announce(hungerLevel >= 95 ? 'Vous êtes affamé : vous perdez de la vie. Mangez tout de suite (achetez à manger dans un magasin ou un restaurant).' : hungerLevel >= 80 ? 'Vous avez très faim. Mangez quelque chose.' : 'Vous commencez à avoir faim.', 'assertive');
    } else if (hg < 55) this._lastHungerAlert = 0;

    const th = Math.round(this.thirst);
    const thirstLevel = th >= 95 ? 95 : th >= 80 ? 80 : th >= 60 ? 60 : 0;
    if (thirstLevel && thirstLevel !== this._lastThirstAlert) {
      this._lastThirstAlert = thirstLevel;
      announce(thirstLevel >= 95 ? 'Vous êtes déshydraté : vous perdez de la vie. Buvez tout de suite.' : thirstLevel >= 80 ? 'Vous avez très soif. Buvez quelque chose.' : 'Vous commencez à avoir soif.', 'polite');
    } else if (th < 55) this._lastThirstAlert = 0;
  },

  // État « à l'intérieur d'un lieu » : tant qu'il est actif, l'ambiance de la
  // ville reste assourdie (voir updateRoadAmbience) et l'on reste dedans jusqu'à
  // ressortir volontairement (Ctrl+Alt+E). On ne commente PAS le bruit.
  indoors: null,
  // Son de porte SYNTHÉTIQUE (le fichier de porte fourni a été retiré à la
  // demande — on garde uniquement un son de synthèse) : un petit « toc » grave,
  // éventuellement panoramique.
  doorCue(pan = 0) {
    if (!window.Audio || !Audio.tone) return;
    Audio.tone({ freq: 150, type: 'sine', duration: 0.16, gain: 0.09, pan });
    setTimeout(() => { if (window.Audio && Audio.tone) Audio.tone({ freq: 105, type: 'sine', duration: 0.13, gain: 0.07, pan }); }, 85);
  },
  // Franchissement d'une porte : son de porte synthétique + on marque qu'on est
  // à l'intérieur du lieu (l'ambiance s'assourdit d'elle-même, sans l'annoncer).
  announceEnterBuilding(name, zone, ref) {
    this.doorCue();
    const lieu = zone === 'cour' ? `la cour de ${name}` : name;
    // On mémorise le lieu où l'on entre : tant qu'on est dedans, la touche E
    // rouvre CE lieu (son contenu interne), jamais l'extérieur.
    this.indoors = { name: lieu, ref: ref || null, kind: zone === 'cour' ? 'house' : 'poi' };
    announce(`Vous entrez dans ${lieu}. Touche E pour interagir avec ce qui s'y trouve, touche Q ou Ctrl+Alt+E pour ressortir.`, 'assertive');
  },
  // Entrer dans un bâtiment via sa porte (annonce + son), puis ouvrir le lieu.
  enterBuilding(poi) {
    const noDoor = ['station_essence', 'mine', 'aeroport', 'heliport', 'port', 'terrain_agricole'];
    if (!noDoor.includes(poi.type)) this.announceEnterBuilding(poi.name, 'porte', poi);
    this.enterPOI(poi);
  },
  // Ctrl+Alt+E : entrer dans le lieu le plus proche, ou en ressortir si on y est
  // déjà. Une fois dedans, on peut interagir librement avec E sans ressortir, et
  // continuer à se déplacer ; on ne ressort que par un nouveau Ctrl+Alt+E.
  toggleIndoor() {
    if (this.jailed) return announce('Vous êtes en cellule. Seul un policier peut vous libérer.', 'assertive');
    if (this.interior) return this.exitInterior();
    if (this.inVehicle) return announce('Descendez du véhicule pour entrer dans un lieu.', 'assertive');
    if (this.indoors) {
      // Si on s'est éloigné du lieu sans avoir formellement refait
      // Ctrl+Alt+E pour en sortir (parti à pied vers un autre lieu), on
      // considère qu'on est déjà dehors : sinon Ctrl+Alt+E annonçait
      // toujours « vous sortez de [l'ANCIEN lieu] » au lieu de faire entrer
      // dans le nouveau lieu où l'on se trouve réellement.
      if (this.indoors.ref && UTIL.dist(this.indoors.ref, this) > 4) {
        this.indoors = null;
      } else {
        const name = this.indoors.name;
        this.indoors = null;
        this.doorCue();
        announce(`Vous sortez de ${name}. Vous êtes de nouveau dehors.`, 'assertive');
        return;
      }
    }
    // Chercher un lieu (bâtiment ou maison) à portée pour y entrer.
    const poi = City.pois.map(p => ({ p, d: UTIL.dist(p, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    const house = City.houses.map(h => ({ h, d: UTIL.dist(h, this) })).filter(o => o.d < 4).sort((a, b) => a.d - b.d)[0];
    // Une maison à soi (ou dont on a les clés) : on entre DANS la maison, en
    // grille de pièces à parcourir. Une maison qu'on ne possède pas : proposition
    // d'achat (comportement existant).
    if (house && (!poi || house.d <= poi.d)) {
      const h = house.h;
      const owned = this.ownedHouses.includes(h.id) || (h.authorizedUsers || []).includes(Net.accountUsername);
      if (owned) return this.enterHouseInterior(h);
      return this.enterHouse(h);
    }
    if (poi) {
      // Lieux publics « bâtis » (boutiques, banque, commissariat, hôpital…) :
      // on entre dans un intérieur à parcourir. Les autres (station-service,
      // monuments…) gardent l'accès direct à leur service.
      if (this._poiHasInterior(poi.p.type)) return this.enterPOIInterior(poi.p);
      this.announceEnterBuilding(poi.p.name, 'porte', poi.p); this.enterPOI(poi.p); return;
    }
    announce('Aucun lieu où entrer ici. Approchez-vous d\'une porte, puis refaites Ctrl+Alt+E.', 'assertive');
  },
  // Types de POI dotés d'un intérieur à parcourir.
  _poiHasInterior(type) {
    return ['banque', 'police', 'prison', 'hopital', 'magasin', 'restaurant', 'pharmacie', 'armurerie', 'vetements', 'quincaillerie', 'electronique', 'magasin_general', 'bar', 'concessionnaire', 'marche_noir', 'marche_noir_lointain'].includes(type);
  },
  _poiInteriorKey(type) {
    if (type === 'banque') return 'banque';
    if (type === 'police' || type === 'prison') return 'commissariat';
    if (type === 'hopital') return 'hopital';
    if (['magasin', 'restaurant', 'pharmacie', 'armurerie', 'vetements', 'quincaillerie', 'electronique', 'magasin_general', 'bar', 'concessionnaire', 'marche_noir', 'marche_noir_lointain'].includes(type)) return 'commerce';
    return 'service';
  },
  enterPOIInterior(poi) {
    const tpl = (typeof POI_INTERIORS !== 'undefined' && POI_INTERIORS[this._poiInteriorKey(poi.type)]) || (POI_INTERIORS && POI_INTERIORS.service);
    const ent = tpl.entrance || { x: 0, y: 0 };
    this.interior = { ref: poi, poi, kind: 'poi', name: poi.name, rooms: tpl.rooms, service: tpl.service, ix: ent.x, iy: ent.y, room: null, returnX: this.x, returnY: this.y };
    this.indoors = { name: poi.name, ref: poi, kind: 'interior' };
    this.doorCue();
    const room = this._roomAt(ent.x, ent.y);
    this.interior.room = room ? room.name : null;
    announce(`Vous entrez dans ${poi.name}. Pièce : ${room ? room.name : 'entrée'}. Allez au ${tpl.service.label} et appuyez sur E pour être servi. Touche Q ou Ctrl+Alt+E pour sortir.`, 'assertive');
    updateHud();
  },
});
