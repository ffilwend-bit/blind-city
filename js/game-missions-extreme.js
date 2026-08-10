/* ============================================================
   GAME-MISSIONS-EXTREME.JS — suite de l'objet Game (voir js/game.js
   pour l'explication du découpage en plusieurs fichiers).
   Contenu : missions extrêmes (défense de territoire, casse à deux
   rôles, convoi blindé, dépôt d'armes de gang, extraction VIP),
   équipe d'intervention, course-poursuite, convoyage de véhicule.
============================================================ */
Object.assign(Game, {
  // Statut d'équipe (qui couvre quel poste) pour les 3 missions collectives,
  // utilisé UNIQUEMENT sur demande par F8 (announceActiveMissionId, voir
  // game.js) — règle commune des fiches collectives ("bouton statut équipe"),
  // implémentée en réutilisant l'état déjà présent plutôt qu'en ajoutant une
  // annonce automatique de plus. Retourne null pour tout autre type de mission.
  collectiveTeamStatus(m) {
    const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
    if (m.type === 'defense_territoire' && m.entrances) {
      const parts = m.entrances.map((e, i) => {
        const covered = UTIL.dist(this, e) < 6 || others.some(p => UTIL.dist(p, e) < 6);
        return `${e.name || `entrée ${i + 1}`} ${covered ? 'couverte' : 'libre'}`;
      });
      return `statut équipe : ${parts.join(', ')}`;
    }
    if (m.type === 'casse_extreme' && m.serverPoint && m.vaultPoint) {
      const serverCovered = UTIL.dist(this, m.serverPoint) < 3 || others.some(p => UTIL.dist(p, m.serverPoint) < 3);
      const vaultCovered = UTIL.dist(this, m.vaultPoint) < 3 || others.some(p => UTIL.dist(p, m.vaultPoint) < 3);
      return `statut équipe : serveur ${serverCovered ? 'couvert' : 'libre'}, coffre ${vaultCovered ? 'couvert' : 'libre'}`;
    }
    if (m.type === 'convoi_blinde' && m.frontPoint && m.rearPoint) {
      const frontEngaged = UTIL.dist(this, m.frontPoint) < 6 || others.some(p => UTIL.dist(p, m.frontPoint) < 6);
      const rearEngaged = UTIL.dist(this, m.rearPoint) < 6 || others.some(p => UTIL.dist(p, m.rearPoint) < 6);
      return `statut équipe : avant ${frontEngaged ? 'engagé' : 'libre'}, arrière ${rearEngaged ? 'engagé' : 'libre'}`;
    }
    return null;
  },
  /* ==========================================================
     MISSION EXTRÊME — DÉFENSE DE TERRITOIRE (multijoueur obligatoire)
     3 entrées distinctes à couvrir en même temps par de vrais joueurs
     réels : impossible de la déclencher seul.
     ========================================================== */
  defenseState: null,
  tickDefenseTerritoire(m) {
    if (!this.defenseState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 5) {
        const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
        const coverage = m.entrances.map(e => (UTIL.dist(this, e) < 6 ? 1 : 0) + others.filter(p => UTIL.dist(p, e) < 6).length);
        const coveredCount = coverage.filter(c => c > 0).length;
        if (coveredCount < 3) {
          // Checklist nommée, throttlée à ~5s (audit accessibilité missions) :
          // avant, ce message tournait à ~60 appels/seconde (checkMission()
          // tourne à chaque frame) sans jamais nommer les entrées, noyant la
          // synthèse vocale sous des annonces identiques et illisibles.
          const now = Date.now();
          if (now - (this._defenseCoverageMsgAt || 0) > 5000) {
            this._defenseCoverageMsgAt = now;
            const checklist = m.entrances.map((e, i) => `${e.name || `entrée ${i + 1}`} : ${coverage[i] > 0 ? 'couverte' : 'libre'}`).join(', ');
            announce(`Mission extrême "Défense de territoire" — ${checklist}. ${coveredCount} sur 3 couvertes. Coordonnez-vous.`, 'assertive', { tag: 'defense-checklist' });
          }
          return;
        }
        this.defenseState = { missionId: m.id, wave: 1, npcIds: [] };
        this.reportCrimeToPolice('coups_de_feu', `Fusillade au repaire des ${m.gangName}`);
        // Suggestion de partage GPS, une seule fois au démarrage (audit
        // accessibilité missions, fiche défense de territoire P1).
        announce(`Les 3 entrées sont couvertes ! La défense du repaire des ${m.gangName} commence. Partagez votre position GPS entre vous si besoin de vous retrouver.`, 'assertive');
        this.spawnDefenseWave(m);
      }
      return;
    }
    const ds = this.defenseState;
    const squad = ds.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    // Portée alignée sur les vraies portées d'armes des gardes (voir
    // tickPlanqueGardee) : 12 coupait tout tir à distance réaliste.
    if (this.missionCombatTick('defense')) squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 22) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      // Chance de tir remontée (voir missionCombatTick, game-missions-story.js) : trop rare avant.
      if (weapon && UTIL.chance(Math.max(0.1, 0.4 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 22);
    });
    if (!squad.length) {
      if (ds.wave >= 3) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        this.reportMissionReward(m.type, amount, true);
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.defenseState = null;
        RPJournal.log('Mission', `Défense de territoire réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Les trois vagues sont repoussées ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      } else {
        ds.wave++;
        announce(`Vague ${ds.wave} sur 3 !`, 'assertive');
        this.spawnDefenseWave(m);
      }
    }
  },
  spawnDefenseWave(m) {
    const ds = this.defenseState; if (!ds) return;
    const count = UTIL.randInt(2, 3) * ds.wave;
    const perEntrance = new Map(); // audit accessibilité missions : compte par entrée pour un seul récap, pas une annonce par assaillant
    for (let i = 0; i < count; i++) {
      const entrance = UTIL.pick(m.entrances);
      perEntrance.set(entrance, (perEntrance.get(entrance) || 0) + 1);
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'defwave_' + Date.now() + '_' + i, name: `Assaillant ${i + 1}`, job: 'ganger', gender,
        x: UTIL.clamp(entrance.x + UTIL.randInt(-1, 1), 0, City.W - 1), y: UTIL.clamp(entrance.y + UTIL.randInt(-1, 1), 0, City.H - 1),
        health: 100, relation: -100, money: 0, inCar: false, dialogue: [], home: entrance, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'uzi', 'ak47']), outfit: generateNPCAppearance('ganger'),
      };
      City.npcs.push(npc); ds.npcIds.push(npc.id);
    }
    // Direction d'arrivée des ennemis, en un seul récap par vague (audit
    // accessibilité missions, fiche défense de territoire P1) : chaque
    // joueur entend d'où les assaillants arrivent PAR RAPPORT À LUI, pas
    // seulement leur nombre.
    const arrival = Array.from(perEntrance.entries())
      .map(([e, n]) => `${n} vers le ${UTIL.bearing(e.x - this.x, e.y - this.y)}`)
      .join(', ');
    announce(`Assaillants en approche : ${arrival}.`, 'assertive');
    // Réplique hostile AVANT le premier tir (pas seulement pendant
    // l'échange, voir resolveNpcShotAtPlayer).
    this.npcVoiceReaction(this.x, this.y, { group: 'enerve', count: Math.min(2, count), radius: 20 });
  },

  /* ==========================================================
     MISSION EXTRÊME — CASSE À DEUX RÔLES (multijoueur obligatoire)
     Un poste électronique et un poste mécanique, à deux endroits
     séparés de la banque : il faut un joueur réel à chacun, en même
     temps, sinon le piratage/perçage se réinitialise entièrement.
     ========================================================== */
  extremeHeistState: null,
  tickCasseExtreme(m) {
    const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
    const meAtServer = UTIL.dist(this, m.serverPoint) < 3, meAtVault = UTIL.dist(this, m.vaultPoint) < 3;
    const serverCovered = meAtServer || others.some(p => UTIL.dist(p, m.serverPoint) < 3);
    const vaultCovered = meAtVault || others.some(p => UTIL.dist(p, m.vaultPoint) < 3);
    if (!this.extremeHeistState) {
      if (meAtServer || meAtVault) {
        // Rôle du joueur local annoncé (audit accessibilité missions, fiche
        // casse à deux rôles P1) : avant, rien ne disait explicitement à
        // quel poste on se trouvait soi-même, seulement l'état des deux.
        const myRole = meAtServer ? 'la salle des serveurs' : 'la chambre forte';
        if (serverCovered && vaultCovered) {
          this.extremeHeistState = { missionId: m.id, startedAt: Date.now(), crackTime: 25000, lastProgressMsg: Date.now() };
          announce(`Les deux postes sont occupés à la fois ! Vous êtes à ${myRole}. Piratage et perçage démarrent en parallèle — restez à votre poste.`, 'assertive');
          if (UTIL.chance(0.3)) this.extremeHeistState.alarmTimer = setTimeout(() => this.reportCrimeToPolice('braquage_banque', 'Casse à deux rôles en cours'), UTIL.randInt(5000, 15000));
        } else {
          // Throttlé à ~5s (audit accessibilité missions) : sans ça, ce
          // message tournait à ~60 appels/seconde (checkMission() tourne à
          // chaque frame), noyant la synthèse vocale.
          const now = Date.now();
          if (now - (this._casseCoverageMsgAt || 0) > 5000) {
            this._casseCoverageMsgAt = now;
            announce(`Vous êtes à ${myRole}. Casse à deux rôles : il faut un joueur réel à la salle des serveurs ET un autre à la chambre forte, en même temps. Serveur ${serverCovered ? 'couvert' : 'non couvert'}, coffre ${vaultCovered ? 'couvert' : 'non couvert'}.`, 'assertive', { tag: 'casse-checklist' });
          }
        }
      }
      return;
    }
    if (!(serverCovered && vaultCovered)) {
      clearTimeout(this.extremeHeistState.alarmTimer);
      this.extremeHeistState = null;
      // Nomme le poste perdu (audit accessibilité missions) : avant, le
      // message générique ne disait jamais LEQUEL des deux postes avait été
      // abandonné.
      announce(`Le poste ${!serverCovered ? 'de la salle des serveurs' : 'de la chambre forte'} a été abandonné : le piratage et le perçage se réinitialisent !`, 'assertive');
      return;
    }
    // Progression orale toutes les ~5s pendant le piratage/perçage (audit
    // accessibilité missions) : avant, seuls le début et la fin étaient
    // annoncés, laissant les 25 secondes d'action partagée totalement muettes.
    const nowProgress = Date.now();
    if (nowProgress - this.extremeHeistState.lastProgressMsg > 5000) {
      this.extremeHeistState.lastProgressMsg = nowProgress;
      const remaining = Math.max(0, Math.round((this.extremeHeistState.crackTime - (nowProgress - this.extremeHeistState.startedAt)) / 1000));
      if (remaining > 0) announce(`Piratage et perçage en cours : encore ${remaining} secondes. Restez à votre poste.`, 'polite');
    }
    if (Date.now() - this.extremeHeistState.startedAt > this.extremeHeistState.crackTime) {
      const amount = m.reward + UTIL.randInt(-50000, 150000);
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.extremeHeistState = null;
      RPJournal.log('Mission', `Casse à deux rôles réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Coffre ouvert des deux côtés à la fois ! Butin : ${UTIL.formatMoney(amount)}, à partager entre complices.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     MISSION EXTRÊME — ATTAQUE DE CONVOI BLINDÉ (multijoueur obligatoire)
     Garde avant et garde arrière, à deux extrémités séparées : le camp
     laissé sans adversaire en face reçoit du renfort, punissant les
     tentatives en solo.
     ========================================================== */
  convoyState: null,
  tickConvoiBlinde(m) {
    const others = Net.connected ? Array.from(Net.remotePlayers.values()) : [];
    const frontEngaged = UTIL.dist(this, m.frontPoint) < 6 || others.some(p => UTIL.dist(p, m.frontPoint) < 6);
    const rearEngaged = UTIL.dist(this, m.rearPoint) < 6 || others.some(p => UTIL.dist(p, m.rearPoint) < 6);
    if (!this.convoyState) {
      const meNear = UTIL.dist(this, m.frontPoint) < 6 || UTIL.dist(this, m.rearPoint) < 6;
      if (meNear && !(frontEngaged && rearEngaged)) {
        // Throttlé à ~5s (audit accessibilité missions) : sans ça, ce message
        // tournait à ~60 appels/seconde (checkMission() tourne à chaque frame).
        const now = Date.now();
        if (now - (this._convoyCoverageMsgAt || 0) > 5000) {
          this._convoyCoverageMsgAt = now;
          announce(`Attaque de convoi : il faut engager l'avant ET l'arrière en même temps, avec un joueur réel à chaque extrémité. Avant ${frontEngaged ? 'engagé' : 'libre'}, arrière ${rearEngaged ? 'engagé' : 'libre'}.`, 'assertive', { tag: 'convoy-checklist' });
        }
      }
      if (frontEngaged && rearEngaged) {
        this.convoyState = { missionId: m.id };
        this.reportCrimeToPolice('coups_de_feu', 'Fusillade lors d\'une attaque de convoi');
        // Assignation claire (audit accessibilité missions, fiche convoi
        // blindé P1) : avant, rien ne disait explicitement à quelle
        // extrémité on se trouvait soi-même.
        const mySide = UTIL.dist(this, m.frontPoint) < 6 ? "l'avant" : "l'arrière";
        announce(`Les deux extrémités du convoi sont engagées à la fois ! Vous engagez ${mySide}. Neutralisez les gardes avant qu'un camp ne reçoive du renfort.`, 'assertive');
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(m.frontPoint.x, m.frontPoint.y, { group: 'enerve', count: 1, radius: 20 });
      }
      return;
    }
    const frontSquad = (m.frontIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    const rearSquad = (m.rearIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    // Portée alignée sur les vraies portées d'armes des gardes (voir
    // tickPlanqueGardee) : 10 coupait tout tir à distance réaliste.
    if (this.missionCombatTick('convoi')) [...frontSquad, ...rearSquad].forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 22) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      // Chance de tir remontée (voir missionCombatTick, game-missions-story.js) : trop rare avant.
      if (weapon && UTIL.chance(Math.max(0.1, 0.43 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 22);
    });
    // Pré-avertissement 5s avant le renfort (audit accessibilité missions,
    // fiche convoi blindé P1) : avant, le renfort tombait sans prévenir,
    // annoncé seulement après coup. Chaque camp vide sans adversaire en face
    // a son propre chrono (déclenché dès qu'il se vide) : avertissement à
    // 10s, renfort effectif à 15s — direction donnée pour se repositionner.
    const now = Date.now();
    const cs = this.convoyState;
    if (frontSquad.length === 0 && rearSquad.length > 0 && !rearEngaged) {
      if (!cs.rearEmptyAt) cs.rearEmptyAt = now;
      const elapsed = now - cs.rearEmptyAt;
      if (elapsed > 10000 && !cs.rearWarned) {
        cs.rearWarned = true;
        const dir = UTIL.bearing(m.rearPoint.x - this.x, m.rearPoint.y - this.y);
        announce(`Attention : l'arrière du convoi, vers le ${dir}, va recevoir du renfort dans 5 secondes si personne ne s'y engage !`, 'assertive');
      }
      if (elapsed > 15000) {
        cs.rearEmptyAt = null; cs.rearWarned = false;
        const dir = UTIL.bearing(m.rearPoint.x - this.x, m.rearPoint.y - this.y);
        this.reinforceConvoySide(m, 'rear');
        announce(`L'arrière du convoi, laissé sans adversaire, reçoit du renfort, vers le ${dir} !`, 'assertive');
      }
    } else { cs.rearEmptyAt = null; cs.rearWarned = false; }
    if (rearSquad.length === 0 && frontSquad.length > 0 && !frontEngaged) {
      if (!cs.frontEmptyAt) cs.frontEmptyAt = now;
      const elapsed = now - cs.frontEmptyAt;
      if (elapsed > 10000 && !cs.frontWarned) {
        cs.frontWarned = true;
        const dir = UTIL.bearing(m.frontPoint.x - this.x, m.frontPoint.y - this.y);
        announce(`Attention : l'avant du convoi, vers le ${dir}, va recevoir du renfort dans 5 secondes si personne ne s'y engage !`, 'assertive');
      }
      if (elapsed > 15000) {
        cs.frontEmptyAt = null; cs.frontWarned = false;
        const dir = UTIL.bearing(m.frontPoint.x - this.x, m.frontPoint.y - this.y);
        this.reinforceConvoySide(m, 'front');
        announce(`L'avant du convoi, laissé sans adversaire, reçoit du renfort, vers le ${dir} !`, 'assertive');
      }
    } else { cs.frontEmptyAt = null; cs.frontWarned = false; }
    if (frontSquad.length === 0 && rearSquad.length === 0) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.convoyState = null;
      RPJournal.log('Mission', `Convoi blindé neutralisé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Convoi neutralisé aux deux extrémités ! Butin : ${UTIL.formatMoney(amount)}, à partager entre complices.`, 'assertive');
      updateHud();
    }
  },
  reinforceConvoySide(m, side) {
    const point = side === 'front' ? m.frontPoint : m.rearPoint;
    const idsArr = side === 'front' ? m.frontIds : m.rearIds;
    for (let g = 0; g < 2; g++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: `convoy_reinf_${side}_${Date.now()}_${g}`, name: `Renfort ${side === 'front' ? 'avant' : 'arrière'}`, job: 'garde', gender,
        x: UTIL.clamp(point.x + UTIL.randInt(-1, 1), 0, City.W - 1), y: UTIL.clamp(point.y + UTIL.randInt(-1, 1), 0, City.H - 1),
        health: 100, relation: -80, money: 0, inCar: false, dialogue: [], home: point, hostile: true,
        weapon: UTIL.pick(['uzi', 'ak47']), outfit: generateNPCAppearance('garde'),
      };
      City.npcs.push(npc); idsArr.push(npc.id);
    }
  },

  /* ==========================================================
     DEUX MISSIONS EXTRÊMES SUPPLÉMENTAIRES — toutes jouables seul, mais
     avec un vrai risque accru ; la présence de vrais joueurs proches
     (voir countNearbyRealPlayers) réduit ce risque sans jamais bloquer
     la tentative solo.
     ========================================================== */

  // 1. Dépôt d'armes de gang : trois systèmes à gérer, jonglage nécessaire seul.
  depotState: null,
  tickDepotArmesGang(m) {
    const nearAny = UTIL.dist(this, m.camPoint) < 4 || UTIL.dist(this, m.patrolPoint) < 4 || UTIL.dist(this, m.vaultPoint) < 4;
    if (!this.depotState) {
      if (!nearAny) return;
      this.depotState = { missionId: m.id, cam: 0, patrol: 0, vault: 0, lastTick: Date.now() };
      announce('Vous entrez sur le site : caméras, patrouille et coffre à gérer en même temps, sans rien laisser stagner trop longtemps.', 'assertive');
    }
    const ds = this.depotState;
    const now = Date.now();
    const dt = Math.min(2000, now - ds.lastTick); ds.lastTick = now;
    const clamp01 = (v) => Math.max(0, Math.min(100, v));
    ds.cam = clamp01(ds.cam + (this.countNearbyRealPlayers(m.camPoint, 3) > 0 ? dt / 1000 * 8 : -dt / 1000 * 3));
    ds.patrol = clamp01(ds.patrol + (this.countNearbyRealPlayers(m.patrolPoint, 3) > 0 ? dt / 1000 * 8 : -dt / 1000 * 3));
    ds.vault = clamp01(ds.vault + (this.countNearbyRealPlayers(m.vaultPoint, 3) > 0 ? dt / 1000 * 6 : -dt / 1000 * 3));
    const guard = City.npcs.find(n => n.id === m.guardId);
    if (guard && !guard.dead) {
      const d = UTIL.dist(guard, this);
      // Détection élargie (8 -> 14) : coupait toute réaction à distance
      // réaliste (voir tickPlanqueGardee pour le même correctif).
      if (d < 14) {
        // Réplique hostile AVANT le premier tir (une seule fois, à la
        // première détection) — avant, ce garde ouvrait le feu en silence,
        // sans le moindre avertissement.
        if (!ds.spotted) { ds.spotted = true; announce(`${guard.name} vous repère !`, 'assertive'); this.npcVoiceReaction(guard.x, guard.y, { group: 'enerve', count: 1, radius: 14 }); }
        const weapon = WEAPON_CATALOG[guard.weapon];
        // Chance de tir remontée (voir missionCombatTick, game-missions-story.js) : trop rare avant.
        if (weapon && this.missionCombatTick('depot') && UTIL.chance(Math.max(0.1, 0.35 - d * 0.015))) this.resolveNpcShotAtPlayer(guard, weapon, d, 14);
        guard.x += Math.sign(this.x - guard.x); guard.y += Math.sign(this.y - guard.y);
      }
    }
    if (ds.cam >= 100 && ds.patrol >= 100 && ds.vault >= 100) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.depotState = null;
      RPJournal.log('Mission', `Dépôt d'armes du gang neutralisé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Les trois systèmes sont neutralisés ! Butin : ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Extraction VIP : escorte à travers un territoire hostile.
  vipState: null,
  tickExtractionVip(m) {
    const vip = City.npcs.find(n => n.id === m.vipId);
    if (!vip || vip.dead) { this.activeMission = null; this.vipState = null; return; }
    if (!this.vipState) {
      if (UTIL.dist(this, vip) < 3) {
        this.vipState = { missionId: m.id, lastAmbush: 0, lastAttackerId: null };
        vip.follow = true;
        announce(`${vip.name} vous suit. Direction ${m.extractName}, à travers un territoire hostile.`, 'assertive');
      }
      return;
    }
    vip.x = this.x; vip.y = this.y;
    const now = Date.now();
    const allies = this.countNearbyRealPlayers(this, 10);
    if (now - this.vipState.lastAmbush > (allies > 1 ? 20000 : 12000) && UTIL.chance(0.15)) {
      this.vipState.lastAmbush = now;
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = { id: 'vipambush_' + now, name: 'Assaillant', job: 'ganger', gender, x: UTIL.clamp(this.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.y + UTIL.randInt(-3, 3), 0, City.H - 1), health: 90, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.x, y: this.y }, hostile: true, weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('ganger') };
      City.npcs.push(npc);
      this.vipState.lastAttackerId = npc.id;
      announce('Une embuscade vous prend pour cible pendant l\'extraction !', 'assertive');
      // Réplique hostile AVANT le premier tir (pas seulement pendant
      // l'échange, voir resolveNpcShotAtPlayer).
      this.npcVoiceReaction(npc.x, npc.y, { group: 'enerve', count: 1, radius: 14 });
    }
    if (this.vipState.lastAttackerId) {
      const attacker = City.npcs.find(n => n.id === this.vipState.lastAttackerId);
      if (attacker && !attacker.dead) {
        const d = UTIL.dist(attacker, this);
        // Chance de tir + portée remontées (voir tickPlanqueGardee) : trop rare/rapproché avant.
        if (d < 14 && this.missionCombatTick('vip') && UTIL.chance(0.45)) {
          const weapon = WEAPON_CATALOG[attacker.weapon];
          if (UTIL.chance(0.3)) { vip.health -= UTIL.randInt(10, 25); announce(`${vip.name} est touché ! Santé : ${Math.round(vip.health)}%.`, 'assertive'); }
          else this.resolveNpcShotAtPlayer(attacker, weapon, d, 14);
        }
      } else { this.vipState.lastAttackerId = null; }
    }
    if (vip.health <= 0) {
      announce(`${vip.name} n'a pas survécu à l'extraction. Mission échouée.`, 'assertive');
      vip.dead = true; this.activeMission = null; this.vipState = null;
      return;
    }
    if (UTIL.dist(this, { x: m.extractX, y: m.extractY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      vip.follow = false; vip.dead = true; vip.x = -999;
      this.vipState = null;
      RPJournal.log('Mission', `Extraction VIP réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${vip.name} est en sécurité ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Braquage de supérette/station-service : rapide, classique, à haut risque de témoin.
  superetteState: null,
  tickBraquageSuperette(m) {
    if (!this.superetteState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        this.superetteState = { missionId: m.id, startedAt: Date.now(), crackTime: 9000 };
        announce(`Vous menacez la caisse de ${m.shopName} ! Vidage en cours, restez sur place...`, 'assertive');
        if (UTIL.chance(0.45)) this.superetteState.alarmTimer = setTimeout(() => this.reportCrimeToPolice('vol_main_armee', `Braquage signalé à ${m.shopName}`), UTIL.randInt(2000, 7000));
      }
      return;
    }
    if (UTIL.dist({ x: this.x, y: this.y }, m) > 4) {
      clearTimeout(this.superetteState.alarmTimer);
      this.superetteState = null;
      announce('Vous êtes parti trop vite : le braquage échoue.', 'assertive');
      return;
    }
    if (Date.now() - this.superetteState.startedAt > this.superetteState.crackTime) {
      const amount = Math.max(20000, m.reward + UTIL.randInt(-10000, 20000));
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.superetteState = null;
      RPJournal.log('Mission', `Braquage de supérette réussi : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Caisse vidée ! Vous embarquez ${UTIL.formatMoney(amount)}. Fuyez avant que ça ne remonte.`, 'assertive');
      updateHud();
    }
  },

  // 4. Go-fast : livraison de stupéfiants chronométrée, plusieurs points, risque de contrôle.
  gofastState: null,
  tickGofast(m) {
    if (!this.gofastState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const totalDist = m.drops.reduce((acc, d, idx) => acc + UTIL.dist(idx === 0 ? m : m.drops[idx - 1], d), 0) * CONFIG.METERS_PER_TILE;
        const timeLimit = Math.round(totalDist / 10) * 1000 + 30000;
        this.gofastState = { missionId: m.id, dropIdx: 0, deadline: Date.now() + timeLimit };
        announce(`Cargaison récupérée. ${m.drops.length} points de dépose, environ ${Math.round(timeLimit / 1000)} secondes au total. Évitez les contrôles.`, 'assertive');
        this.setGuidance({ name: m.drops[0].name || 'la première dépose', x: m.drops[0].x, y: m.drops[0].y });
      }
      return;
    }
    const gs = this.gofastState;
    if (Date.now() > gs.deadline) {
      announce('Trop de temps écoulé, les acheteurs se sont désistés. Mission échouée.', 'assertive');
      this.gofastState = null; this.activeMission = null;
      return;
    }
    if (Math.random() < 0.0025) {
      if (UTIL.chance(0.4)) {
        announce('Contrôle de police ! Cargaison saisie.', 'assertive');
        this.wanted = Math.min(100, this.wanted + 25);
        this.gofastState = null; this.activeMission = null;
        return;
      } else {
        announce('Un contrôle en vue... évité de justesse.', 'polite');
      }
    }
    const drop = m.drops[gs.dropIdx];
    if (UTIL.dist({ x: this.x, y: this.y }, drop) < 3) {
      gs.dropIdx++;
      if (gs.dropIdx >= m.drops.length) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        this.reportMissionReward(m.type, amount, true);
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.gofastState = null;
        if (this.guidanceTarget) this.stopGuidance();
        RPJournal.log('Mission', `Go-fast terminé : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Toutes les livraisons faites ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
      } else {
        announce(`Livraison ${gs.dropIdx} sur ${m.drops.length} faite. Direction ${m.drops[gs.dropIdx].name}.`, 'assertive');
        this.setGuidance({ name: m.drops[gs.dropIdx].name || 'la dépose suivante', x: m.drops[gs.dropIdx].x, y: m.drops[gs.dropIdx].y });
      }
    }
  },

  // 5. Planque gardée : un point précis avec du butin, gardé par des vigiles
  // armés. Repéré, ils attaquent ; tous éliminés, le butin devient accessible.
  stashState: null,
  tickPlanqueGardee(m) {
    const squad = (m.guardIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const amount = m.reward;
        this.dirtyMoney += amount;
        this.reportMissionReward(m.type, amount, true);
        const pool = ['pistolet_9', 'uzi', 'ak47'];
        const weaponId = UTIL.pick(pool); const weapon = WEAPON_CATALOG[weaponId];
        const ammoQty = UTIL.randInt(30, 80);
        this.addItem({ ...weapon, id: weaponId, category: 'arme', q: 1 });
        if (!this.weapons.includes(weaponId)) this.weapons.push(weaponId);
        this.addItem({ ...AMMO_CATALOG[weapon.ammoType], id: 'ammo_' + weapon.ammoType, category: 'munition', q: ammoQty });
        Audio.cash();
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        RPJournal.log('Mission', `Planque gardée pillée : ${UTIL.formatMoney(amount)} + ${weapon.name}.`, 'alert');
        announce(`Vigiles éliminés, butin récupéré : ${UTIL.formatMoney(amount)}, un ${weapon.name} et ${ammoQty} munitions.`, 'assertive');
        updateHud();
      } else {
        // Ancien bug : ce message réutilisait le même stashState que le
        // déclenchement du combat ('engaged'), donc n'était plus jamais
        // annoncé une fois la fusillade commencée — le joueur, tous les
        // gardes abattus, n'était jamais informé qu'il fallait s'approcher
        // du point d'origine pour récupérer le butin. Flag dédié + rappel
        // espacé (pas juste une fois, au cas où le message se perde parmi
        // d'autres annonces de fin de combat).
        // Deuxième bug, resté même après ce correctif : le rappel ne disait
        // JAMAIS où se trouvait ce point. Les vigiles ne se déplacent pas
        // (ils tirent sur place), mais le combat pouvait très bien se
        // dérouler à distance de tir (jusqu'à une douzaine de cases) — une
        // fois tous morts, plus aucun repère sonore pour retrouver le point
        // exact. Comme pour la chasse aux primes (tickChassePrimes) et le
        // rappel d'ID de mission (announceActiveMissionId), distance ET
        // direction réelles vers m (le point de la planque, fixe depuis sa
        // création — voir City.generateExtremeMissions).
        const now = Date.now();
        if (now - (this._stashLootHintAt || 0) > 8000) {
          this._stashLootHintAt = now;
          const d = Math.round(UTIL.dist(m, this) * CONFIG.METERS_PER_TILE);
          const dir = UTIL.bearing(m.x - this.x, m.y - this.y);
          announce(`Vigiles neutralisés. Butin au sol à ${d} mètres, vers le ${dir}.`, 'assertive', { tag: 'stash-loot' });
        }
      }
      return;
    }
    // Portées de tir/détection alignées sur les VRAIES portées d'armes des
    // vigiles (pistolet 25, uzi 20, AK-47 45 — voir catalogs.js) : les
    // anciens plafonds (12/8) coupaient tout tir dès qu'on engageait à
    // distance réaliste (snipe, recul tactique...) — un joueur qui
    // n'allait jamais au contact rapproché ne se faisait quasiment jamais
    // tirer dessus, malgré des chances de tir déjà remontées.
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 22) return;
      if (d < 14 && !this.stashState) {
        this.stashState = 'engaged'; this.reportCrimeToPolice('coups_de_feu', 'Fusillade sur une planque gardée');
        announce('Les vigiles vous repèrent et ouvrent le feu !', 'assertive');
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(n.x, n.y, { group: 'enerve', count: 1, radius: 14 });
      }
    });
    if (this.missionCombatTick('planque')) squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 22) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      // Chance de tir remontée (voir missionCombatTick, game-missions-story.js) : trop rare avant.
      if (weapon && UTIL.chance(Math.max(0.1, 0.43 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 22);
    });
  },

  // 6. Recel de véhicule : voler le véhicule précis demandé et le livrer intact.
  chopState: null,
  tickRecelVehicule(m) {
    const vehicle = City.vehicles.find(v => v.id === m.vehicleId);
    if (!vehicle) { this.activeMission = null; return; }
    if (!this.inVehicle || this.vehicle?.id !== vehicle.id) {
      if (UTIL.dist({ x: this.x, y: this.y }, vehicle) < 3 && !vehicle.locked) {
        announce(`Montez dans ${vehicle.name} pour le livrer à ${m.dropName}.`, 'polite');
      }
      return;
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 4) {
      const conditionFactor = Math.max(0.4, this.vehicle.hp / 100);
      const amount = Math.round(m.reward * conditionFactor);
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      const vId = this.vehicle.id;
      this.interactVehicle();
      City.vehicles = City.vehicles.filter(v => v.id !== vId);
      RPJournal.log('Mission', `Véhicule recelé : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${m.vehicleTypeName} livré au garage clandestin, à ${Math.round(conditionFactor * 100)}% d'état. Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     ÉQUIPE D'INTERVENTION (niveau de recherche élevé, sans PNJ patrouille) —
     déclenchée par Police.tick() après un délai si le niveau de recherche
     reste trop haut. Pas de policier PNJ visible qui vous suit partout :
     juste un rattrapage abstrait, avec un vrai choix à ce moment-là.
     ========================================================== */
  wantedResponseState: null,
  triggerPoliceResponse() {
    if (this.wantedResponseState) return;
    this.wantedResponseState = { stage: 'menu' };
    announce('Une équipe d\'intervention vous a localisé !', 'assertive');
    el('menuTitle').textContent = 'Intervention policière';
    const items = [
      { id: 'render', title: '🙌 Se rendre', desc: 'Amende proportionnelle à votre niveau de recherche, qui retombe ensuite à zéro.' },
      { id: 'resister', title: '🔫 Résister', desc: 'Combat contre l\'équipe d\'intervention. Risqué, mais vous gardez tout si vous l\'emportez.' },
      { id: 'fuir', title: '🏃 Tenter de fuir', desc: this.inVehicle ? 'Meilleures chances en véhicule rapide.' : 'À pied, les chances sont faibles.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'render') this.surrenderToPolice();
      else if (sel.id === 'resister') this.resistPoliceResponse();
      else this.fleePoliceResponse();
    });
  },
  surrenderToPolice() {
    const fine = Math.min(this.money, Math.round(this.wanted * 800));
    this.money -= fine;
    this.wanted = 0;
    this.wantedResponseState = null;
    RPJournal.log('Police', `Reddition : amende de ${UTIL.formatMoney(fine)}.`, 'info');
    announce(`Vous vous rendez. Amende de ${UTIL.formatMoney(fine)}, niveau de recherche remis à zéro.`, 'assertive');
    updateHud();
  },
  resistPoliceResponse() {
    const firstNames = ['Agent Somé', 'Agent Kientega', 'Agent Zerbo'];
    const count = UTIL.randInt(1, 3);
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'wantedresp_' + Date.now() + '_' + i, name: UTIL.pick(firstNames), job: 'policier', gender,
        x: UTIL.clamp(this.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 100, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.x, y: this.y }, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('policier'), // pas de fusil à pompe : plafond volontaire pour tout PNJ
      };
      City.npcs.push(npc); npcIds.push(npc.id);
    }
    this.wantedResponseState = { stage: 'combat', npcIds };
    announce(`${count} agent${count > 1 ? 's' : ''} vous encerclent !`, 'assertive');
  },
  fleePoliceResponse() {
    // Vraie course-poursuite : au lieu d'un simple lancer de dé, des unités de
    // police vous prennent en chasse. On leur échappe en creusant l'écart
    // (bien plus facile en véhicule rapide) — voir startPoliceChase/updateWantedChase.
    this.startPoliceChase();
  },
  // Appelé en continu tant que l'équipe d'intervention est en combat.
  updateWantedResponseCombat() {
    const ws = this.wantedResponseState; if (!ws || ws.stage !== 'combat') return;
    if (this.health <= 0) { this.wantedResponseState = null; return; } // die() gère déjà l'hôpital
    const squad = ws.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) {
      this.wanted = Math.max(0, this.wanted - 30);
      this.wantedResponseState = null;
      announce('Vous avez neutralisé l\'équipe d\'intervention. Niveau de recherche réduit.', 'assertive');
      return;
    }
    // Portée alignée sur les vraies portées d'armes des agents (voir tickPlanqueGardee).
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 22) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      // Chance de tir remontée (voir missionCombatTick, game-missions-story.js) : trop rare avant.
      if (weapon && UTIL.chance(Math.max(0.1, 0.45 - d * 0.015))) this.resolveNpcShotAtPlayer(n, weapon, d, 22);
    });
  },

  /* ==========================================================
     COURSE-POURSUITE. Dans ce jeu, la police est composée de VRAIS
     JOUEURS humains : une poursuite se joue donc d'abord contre eux.
     Côté fuyard, on fournit le retour audio (sirène plus forte quand
     ils se rapprochent, distance et cap annoncés) à partir de la
     position réelle des policiers connectés ; on s'échappe en creusant
     l'écart, et on est interpellé quand un policier réel vous menotte
     (mécanique existante). Les PNJ ne servent QUE de filet en solo,
     quand aucun policier humain n'est connecté à proximité.
     ========================================================== */
  // Policiers RÉELS (joueurs humains) connectés à portée.
  _nearbyRealPolice(radius = 60) {
    if (!Net.connected) return [];
    return Array.from(Net.remotePlayers.values()).filter(p => p && p.role === 'police' && !p.unconscious && UTIL.dist(p, this) < radius);
  },
  startPoliceChase() {
    this._chaseSirenOn = true;
    const cops = this._nearbyRealPolice(60);
    if (cops.length) {
      // Poursuite entre joueurs réels : on prévient la police (mécanique de
      // signalement existante) et on laisse le retour audio suivre leurs
      // positions réelles. Aucun PNJ n'est créé.
      this.wantedResponseState = { stage: 'chase', real: true, farTicks: 0, lastDistMsg: 0 };
      AudioLib.playLoop('sirene_vehicule_police', 0.4);
      this.reportCrimeToPolice('fuite', 'Refus d\'obtempérer : le suspect prend la fuite');
      announce(`Vous prenez la fuite ! ${cops.length} policier${cops.length > 1 ? 's réels sont' : ' réel est'} à vos trousses. Semez-${cops.length > 1 ? 'les' : 'le'} en creusant l'écart.`, 'assertive');
      return;
    }
    // FILET SOLO — aucun policier humain à proximité : une patrouille automatique
    // prend le relais pour que « être recherché » ait un effet même hors ligne.
    const count = UTIL.randInt(2, 3);
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      let px = this.x, py = this.y, tries = 0;
      do {
        const ang = Math.random() * Math.PI * 2, r = UTIL.randInt(6, 9);
        px = UTIL.clamp(Math.round(this.x + Math.cos(ang) * r), 0, City.W - 1);
        py = UTIL.clamp(Math.round(this.y + Math.sin(ang) * r), 0, City.H - 1);
      } while (City.isSolid(px, py) && ++tries < 8);
      const npc = {
        id: 'chase_' + Date.now() + '_' + i, name: UTIL.pick(['Agent Somé', 'Agent Kientega', 'Agent Zerbo', 'Agent Ilboudo']),
        job: 'policier', gender: UTIL.pick(['homme', 'femme']), x: px, y: py,
        health: 100, relation: -100, money: 0, inCar: true, dialogue: [], home: { x: this.x, y: this.y },
        hostile: true, weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('policier'), // pas de fusil à pompe : plafond volontaire pour tout PNJ
      };
      City.npcs.push(npc); npcIds.push(npc.id);
    }
    this.wantedResponseState = { stage: 'chase', real: false, npcIds, farTicks: 0, lastDistMsg: 0 };
    AudioLib.playLoop('sirene_vehicule_police', 0.5);
    announce(`Aucun policier réel dans les parages : une patrouille automatique vous prend en chasse. Semez-la en creusant l'écart ${this.inVehicle ? 'au volant' : 'à pied'}.`, 'assertive');
  },
  // Fait avancer un poursuivant PNJ de `speed` cases vers le joueur, en
  // contournant sommairement les obstacles (filet solo uniquement).
  _stepChaserToward(n, speed) {
    for (let s = 0; s < speed; s++) {
      const dx = this.x - n.x, dy = this.y - n.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
      const sy = sx === 0 ? Math.sign(dy) : 0;
      if (!City.isSolid(n.x + sx, n.y + sy)) { n.x += sx; n.y += sy; }
      else { // bloqué : essayer l'autre axe pour contourner
        const ax = Math.sign(dx), ay = Math.sign(dy);
        if (sx === 0 && ax && !City.isSolid(n.x + ax, n.y)) n.x += ax;
        else if (sy === 0 && ay && !City.isSolid(n.x, n.y + ay)) n.y += ay;
      }
    }
  },
  updateWantedChase() {
    const ws = this.wantedResponseState; if (!ws || ws.stage !== 'chase') return;
    if (this.health <= 0) { this.endPoliceChase(false); return; }
    if (ws.real) return this._updateRealChase(ws);
    return this._updatePnjChase(ws);
  },
  // Poursuite contre de VRAIS policiers : on suit leurs positions réseau, sans
  // les déplacer nous-mêmes. L'interpellation se fait quand un policier réel
  // vous menotte (isCuffed) — on ne « capture » jamais de force côté fuyard.
  _updateRealChase(ws) {
    if (this.isCuffed) { this.endPoliceChase(false, 'La police vous a interpellé.'); return; }
    const cops = this._nearbyRealPolice(80);
    if (!cops.length) { // plus aucun policier réel à portée : on les a semés / ils ont abandonné
      if ((ws.farTicks = (ws.farTicks || 0) + 1) >= 3) { this.wanted = Math.max(0, this.wanted - 20); this.endPoliceChase(true, 'Vous avez semé la police. Niveau de recherche réduit.'); }
      return;
    }
    let nearest = Infinity, closest = cops[0];
    cops.forEach(p => { const d = UTIL.dist(p, this); if (d < nearest) { nearest = d; closest = p; } });
    AudioLib.playLoop('sirene_vehicule_police', UTIL.clamp(0.72 - nearest * 0.02, 0.1, 0.72));
    // Planqué (Alt+H) ET hors de vue directe de TOUS les policiers proches :
    // on sème beaucoup plus vite, même à faible distance — jusque-là, seule
    // la distance comptait, sans aucune notion de dissimulation réelle.
    const wellHidden = this.hidden && !cops.some(p => this.hasLineOfSight(p.x, p.y, this.x, this.y));
    if (nearest > 24 || wellHidden) {
      if ((ws.farTicks = (ws.farTicks || 0) + (wellHidden ? 2 : 1)) >= 3) {
        this.wanted = Math.max(0, this.wanted - 20);
        this.endPoliceChase(true, wellHidden ? 'Bien planqué(e), vous avez semé la police.' : 'Vous avez semé la police. Niveau de recherche réduit.');
        return;
      }
    } else ws.farTicks = 0;
    const now = Date.now();
    if (now - (ws.lastDistMsg || 0) > 3000) {
      ws.lastDistMsg = now;
      const m = Math.round(nearest * CONFIG.METERS_PER_TILE);
      if (wellHidden) announce(`Planqué(e) : la police est à ${m} mètres mais ne vous voit pas. Restez immobile.`, 'polite');
      else announce(nearest > 12 ? `Vous creusez l'écart : police à ${m} mètres.` : `La police est à ${m} mètres, vers le ${UTIL.bearing(closest.x - this.x, closest.y - this.y)}.`, nearest <= 6 ? 'assertive' : 'polite');
    }
  },
  // Filet SOLO : poursuivants PNJ qui se déplacent vraiment vers vous.
  _updatePnjChase(ws) {
    const squad = ws.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) { this.wanted = Math.max(0, this.wanted - 30); this.endPoliceChase(true, 'Vous avez neutralisé la patrouille. Niveau de recherche réduit.'); return; }
    const speed = (this.inVehicle && this.vehicle) ? 2 : 1;
    // Planqué ET hors de vue directe de TOUTE la patrouille : elle ne fonce
    // plus droit sur vous (elle n'a plus votre position), sans quoi se
    // cacher n'aurait aucun effet une fois repéré une première fois.
    const wellHidden = this.hidden && !squad.some(n => this.hasLineOfSight(n.x, n.y, this.x, this.y));
    if (!wellHidden) squad.forEach(n => this._stepChaserToward(n, speed));
    let nearest = Infinity, closest = squad[0];
    squad.forEach(n => { const d = UTIL.dist(n, this); if (d < nearest) { nearest = d; closest = n; } });
    AudioLib.playLoop('sirene_vehicule_police', UTIL.clamp(0.72 - nearest * 0.035, 0.12, 0.72));
    if (!wellHidden && nearest <= 1.6) { announce('La patrouille vous rattrape et vous bloque la route !', 'assertive'); this.endPoliceChase(false, null, true); return; }
    if (nearest > 14 || wellHidden) {
      ws.farTicks = (ws.farTicks || 0) + (wellHidden ? 2 : 1);
      if (ws.farTicks >= 3) {
        this.wanted = Math.max(0, this.wanted - 25);
        this.endPoliceChase(true, wellHidden ? 'Bien planqué(e), vous avez semé la patrouille.' : 'Vous l\'avez semée ! Niveau de recherche réduit.');
        return;
      }
    } else ws.farTicks = 0;
    const now = Date.now();
    if (now - (ws.lastDistMsg || 0) > 3000) {
      ws.lastDistMsg = now;
      if (wellHidden) { announce('Planqué(e) : la patrouille cherche sans vous voir. Restez immobile.', 'polite'); return; }
      const m = Math.round(nearest * CONFIG.METERS_PER_TILE);
      announce(nearest > 10 ? `Vous creusez l'écart : patrouille à ${m} mètres.` : `La patrouille est à ${m} mètres, vers le ${UTIL.bearing(closest.x - this.x, closest.y - this.y)}.`, nearest <= 5 ? 'assertive' : 'polite');
    }
  },
  endPoliceChase(escaped, msg, toCombat) {
    // Couper la sirène de poursuite — sauf si c'est celle du véhicule du joueur (policier).
    if (this._chaseSirenOn && !(this.vehicle && this.vehicle.siren)) AudioLib.stopLoop('sirene_vehicule_police');
    this._chaseSirenOn = false;
    const ws = this.wantedResponseState;
    if (toCombat) { this.wantedResponseState = { stage: 'combat', npcIds: (ws && ws.npcIds) || [] }; return; }
    if (ws && ws.npcIds) City.npcs = City.npcs.filter(n => !ws.npcIds.includes(n.id)); // les poursuivants abandonnent
    this.wantedResponseState = null;
    if (msg) announce(msg, 'assertive');
    updateHud();
  },

  grantGangLoot(gang, multiplier) {
    // Même plafond que launchGangCombat : un gang ne détient (et ne laisse
    // donc tomber) ni sniper ni fusil à pompe.
    const pool = gang.power > 60 ? ['ak47', 'm4'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
    const weaponId = UTIL.pick(pool);
    const weapon = WEAPON_CATALOG[weaponId];
    const ammoQty = Math.max(10, Math.round(UTIL.randInt(20, 60) * multiplier));
    // category: 'arme'/'munition' explicites : indispensable pour qu'addItem()
    // mette aussi à jour this.weapons et this.ammo (pas seulement l'inventaire
    // visible), sans quoi l'arme récupérée ne serait pas réellement équipable.
    this.addItem({ ...weapon, id: weaponId, category: 'arme', q: 1 });
    if (!this.weapons.includes(weaponId)) this.weapons.push(weaponId);
    this.addItem({ ...AMMO_CATALOG[weapon.ammoType], id: 'ammo_' + weapon.ammoType, category: 'munition', q: ammoQty });
    const m = this.activeMission;
    if (m) { m.completed = true; this.activeMission = null; this.completedMissions.push(m.id); }
    RPJournal.log('Mission', `Raid de gang réussi : ${weapon.name} + ${ammoQty} munitions récupérées.`, 'alert');
    announce(`Butin récupéré : un ${weapon.name}, prêt à équiper (touche G), et ${ammoQty} munitions correspondantes.`, 'assertive');
    updateHud();
  },

  /* ==========================================================
     CONVOYAGE DE VÉHICULE — mission avec choix d'itinéraire, minuterie
     et risque réel d'embuscade ; la récompense dépend de l'état du
     véhicule à l'arrivée (pas de "marche jusqu'au point" simpliste).
     ========================================================== */
  deliveryState: null,
  startVehicleDelivery(m) {
    const distMeters = UTIL.dist({ x: m.x, y: m.y }, { x: m.dropX, y: m.dropY }) * CONFIG.METERS_PER_TILE;
    el('menuTitle').textContent = 'Convoyage : choisir l\'itinéraire';
    const items = [
      { id: 'rapide', title: '⚡ Route rapide (centre-ville)', desc: 'Plus court, mais très surveillé : bien plus de risques de vous faire repérer ou intercepter.' },
      { id: 'sur', title: '🛣️ Route détournée (périphérie)', desc: 'Plus long, mais bien plus discret.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      const risky = sel.id === 'rapide';
      const timeLimit = Math.round(distMeters / (risky ? 14 : 9)) * 1000 + 15000;
      this.deliveryState = { missionId: m.id, vehicleId: m.vehicleId, risky, deadline: Date.now() + timeLimit, ambushDone: false };
      announce(`Livraison lancée, ${risky ? 'route rapide' : 'route détournée'}. Environ ${Math.round(timeLimit / 1000)} secondes pour livrer le véhicule à ${m.dropName}, à ${Math.round(distMeters)} mètres. Le véhicule doit arriver en bon état pour la prime complète.`, 'assertive');
      // Guidage vocal jusqu'au point de livraison (fonctionne en conduisant).
      this.setGuidance({ name: m.dropName || 'le point de livraison', x: m.dropX, y: m.dropY });
    });
  },
  // Appelé en continu depuis gameLoop tant qu'une livraison est en cours.
  updateVehicleDelivery() {
    const ds = this.deliveryState; if (!ds) return;
    const m = this.activeMission;
    if (!m || m.id !== ds.missionId) { this.deliveryState = null; return; }
    if (!this.inVehicle || !this.vehicle || this.vehicle.id !== ds.vehicleId) return; // en pause, pas annulé
    if (Date.now() > ds.deadline) {
      announce('Trop de temps écoulé : le client s\'est désisté, la livraison est un échec.', 'assertive');
      this.deliveryState = null; this.activeMission = null;
      return;
    }
    if (!ds.ambushDone && Math.random() < (ds.risky ? 0.006 : 0.002)) {
      ds.ambushDone = true;
      return this.deliveryAmbush();
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 5) this.completeVehicleDelivery();
  },
  deliveryAmbush() {
    if (!this.deliveryState || !this.vehicle) return;
    announce('Une bande rivale vous bloque la route et veut le véhicule !', 'assertive');
    el('menuTitle').textContent = 'Embuscade';
    const items = [
      { id: 'fight', title: '🔫 Résister', desc: 'Combat pour garder le véhicule : risque de dégâts pour vous et pour le véhicule.' },
      { id: 'flee', title: '🏎️ Forcer le passage', desc: 'Tenter de foncer : le véhicule risque d\'être abîmé, mais rien d\'autre.' },
      { id: 'abandon', title: '🏳️ Abandonner le véhicule', desc: 'Ils repartent avec. La livraison échoue.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (!this.deliveryState || !this.vehicle) return;
      if (sel.id === 'fight') {
        const dmg = UTIL.randInt(10, 25); this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        this.vehicle.hp = Math.max(0, this.vehicle.hp - UTIL.randInt(10, 30));
        announce(`Vous repoussez l'attaque, mais vous encaissez ${dmg} dégâts et le véhicule est abîmé.`, 'assertive');
      } else if (sel.id === 'flee') {
        this.vehicle.hp = Math.max(0, this.vehicle.hp - UTIL.randInt(15, 35));
        announce('Vous forcez le passage : le véhicule encaisse des dégâts au passage.', 'assertive');
      } else {
        announce('Vous abandonnez le véhicule aux mains de la bande. La livraison échoue.', 'assertive');
        const vId = this.vehicle.id;
        this.activeMission = null; this.deliveryState = null;
        if (this.inVehicle) this.interactVehicle();
        City.vehicles = City.vehicles.filter(v => v.id !== vId);
      }
    });
  },
  completeVehicleDelivery() {
    const m = this.activeMission;
    if (!m || !this.vehicle) { this.deliveryState = null; return; }
    const conditionPct = Math.round(this.vehicle.hp);
    const conditionFactor = Math.max(0.4, this.vehicle.hp / 100);
    const amount = Math.round(m.reward * conditionFactor);
    const vId = this.vehicle.id;
    this.dirtyMoney += amount;
    this.reportMissionReward(m.type, amount, true);
    m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
    this.deliveryState = null;
    if (this.guidanceTarget) this.stopGuidance();
    this.interactVehicle(); // descend automatiquement, la livraison est remise sur place
    City.vehicles = City.vehicles.filter(v => v.id !== vId);
    RPJournal.log('Mission', `Convoyage livré à ${conditionPct}% d'état : ${UTIL.formatMoney(amount)}.`, 'alert');
    announce(`Livraison réussie, véhicule remis à ${conditionPct}% d'état. Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
    updateHud();
  },


  // Voice navigation guide
  guide() {
    const around = [];
    const poi = City.pois.filter(p => UTIL.dist(p, this) < 40).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
    if (poi) around.push(`${poi.name} à ${Math.round(UTIL.dist(poi, this) * CONFIG.METERS_PER_TILE)} m, ${UTIL.bearing(poi.x - this.x, poi.y - this.y)}`);
    const road = this.nearestRoadInfo();
    if (road) around.push(`Route la plus proche : ${road.dist} m, ${road.bearing}`);
    const house = City.houses.find(h => UTIL.dist(h, this) < 25);
    if (house) around.push(`Logement ${house.name} à ${Math.round(UTIL.dist(house, this) * CONFIG.METERS_PER_TILE)} m`);
    const msg = around.length ? 'Autour de vous : ' + around.join('. ') : 'Aucun repère notable à proximité.';
    announce(msg, 'polite');
  },
  nearestRoadInfo() {
    let best = null;
    for (let ax of City.roadAxes) {
      const dist = ax.axis === 'x' ? Math.abs(this.y - ax.pos) : Math.abs(this.x - ax.pos);
      const bearing = ax.axis === 'x' ? UTIL.bearing(0, ax.pos - this.y) : UTIL.bearing(ax.pos - this.x, 0);
      if (!best || dist < best.dist) best = { dist: Math.round(dist * CONFIG.METERS_PER_TILE), bearing };
    }
    return best;
  },
  compass() { announce(`Cap actuel : ${UTIL.cardinals[this.heading]}.`, 'polite'); },

  // Avant, ce menu se contentait d'ANNONCER "dites un lieu" sans jamais rien
  // capter en retour : aucune destination n'était réellement sélectionnable,
  // ce qui rendait la conduite automatique inaccessible depuis ce menu (le
  // même problème touchait le taxi : "monter, mais aucun menu de destination").
  autoDriveMenu() {
    if (!this.inVehicle || !this.vehicle) return announce('Montez d\'abord dans un véhicule.', 'assertive');
    const dests = [
      { type: 'hopital', label: 'Hôpital' }, { type: 'police', label: 'Police' }, { type: 'banque', label: 'Banque' },
      { type: 'magasin', label: 'Magasin' }, { type: 'armurerie', label: 'Armurerie' }, { type: 'concessionnaire', label: 'Concessionnaire' },
      { type: 'aeroport', label: 'Aéroport' }, { type: 'heliport', label: 'Héliport' }, { type: 'port', label: 'Port' }, { type: 'mine', label: 'Mine' },
    ];
    el('menuTitle').textContent = 'Conduite automatique : destination';
    const items = dests.map(d => {
      const nearest = City.pois.filter(p => p.type === d.type).map(p => ({ ...p, dist: UTIL.dist(p, this) })).sort((a, b) => a.dist - b.dist)[0];
      return { id: d.type, title: nearest ? `${d.label} — ${nearest.name}` : d.label, desc: nearest ? `${Math.round(nearest.dist * CONFIG.METERS_PER_TILE)} m.` : 'Aucun trouvé dans la ville.' };
    });
    if (this.ownedHouses.length) items.push({ id: 'maison', title: '🏠 Ma maison', desc: 'Direction votre maison possédée la plus proche.' });
    items.push({ id: 'custom', title: '🔍 Autre lieu (rechercher par nom)', desc: 'Saisir le nom d\'un lieu, d\'une boutique ou d\'un quartier.' });
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'custom') {
        AccessibleTextPrompt.open('Destination', 'Nom du lieu, de la boutique ou du quartier.', '', (name) => { if (name) this.setAutoDrive(null, name); });
      } else if (sel.id === 'maison') {
        const h = this.ownedHouses.map(hid => City.houses.find(hh => hh.id === hid)).filter(Boolean).sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
        if (!h) return announce('Aucune maison possédée trouvée.', 'assertive');
        this.vehicle.auto = true; this.vehicle.autoDest = { x: h.x, y: h.y, name: h.name };
        announce(`Conduite automatique vers ${h.name}.`, 'polite');
      } else this.setAutoDrive(sel.id, null);
    });
  },
  help() {
    announce('Commandes : flèches pour se déplacer, E interagir, T tirer, R recharger, A arme, P téléphone, K ordinateur, B lecture rapide de l\'inventaire, N ouvrir le menu d\'inventaire (utiliser, porter, donner, vendre, déposer), L position, C boussole, F radar de balayage, D balise sonore de la porte la plus proche, Maj+E monter d\'un étage, Alt+E descendre d\'un étage, V micro de proximité, S maintenue pour parler au talkie, Maj+C visite guidée, Maj+B balises sonores, Maj+F retrouver mon véhicule (guidage GPS vers sa dernière position connue), Maj+V faire sonner mon véhicule pour le repérer à l\'oreille (utile si deux véhicules identiques sont côte à côte), Alt+H se planquer ou sortir de la planque près d\'une couverture (rend bien plus difficile à repérer et permet de semer une poursuite), Maj+G arrêter le guidage, Maj+M guidage pas à pas vers le point pertinent de la mission active (butin après des gardes, point de livraison une fois au volant du véhicule visé...), Maj+D plonger ou remonter dans n\'importe quelle eau libre, boîte manuelle des motos et voitures sport : les deux touches à droite du clavier juste avant Entrée (crochet fermant pour monter d\'un rapport, celle juste avant pour redescendre), Maj+N basculer le guidage GPS entre voix et bips sonores directionnels, Maj+P fouiller sa poche, Maj+U faire suivre une cible menottée, X coup de poing, Y porter, Shift+Z installer dans véhicule, Shift+T testament au commissariat, Ctrl+J menu véhicule, Ctrl+F fouille cible, Alt+F fouille soi, Ctrl+L verrouiller son véhicule, Ctrl+S sirène, Ctrl+M acheter une machine d\'extraction minière, Ctrl+O ma tenue, Ctrl+Z marcher vers la cible verrouillée, Ctrl+A mode staff, F6 bilan santé/faim/soif/énergie/argent/essence, F7 joueurs connectés et type de connexion (Wi-Fi ou données mobiles), F8 mission active et son identifiant, Alt+V infos du véhicule, F9-F12 raccourcis, Ctrl+1-9 ciblage rapide. Chien guide (Maj+Alt+chiffre) : 0 prendre ou lâcher la laisse, 1 menu du chien, 2 guider vers la destination, 3 nourrir, 4 abreuver, 5 état, 6 rappeler, 7 rester sur place, 8 envoyer au véhicule, 9 désactiver ou réactiver, Maj+Alt+F7 repos. Achat du chien et de sa nourriture à l\'animalerie, soins chez le vétérinaire. Dans les menus et pour choisir une quantité à donner ou déposer : flèches Haut/Bas pour ±1 ou se déplacer, Gauche/Droite pour ±5, Entrée pour valider, Échap pour annuler. Sur mobile, le même geste de glissement sert à naviguer et à ajuster une quantité, et le double-tap valide.', 'polite');
  },

  // Save / load
  // silent=true pour les sauvegardes automatiques en arrière-plan (toutes les
  // 60 s, et à la fermeture de l'onglet) : avant, l'annonce vocale « Partie
  // sauvegardée » se répétait sans arrêt même sans action du joueur, ce qui
  // devenait vite pénible. Une sauvegarde manuelle (menu) reste annoncée.
  save(silent) {
    // Personnage mort définitivement (permanentDeath) : ne JAMAIS réécrire la
    // sauvegarde locale. Sans ce garde-fou, l'autosave périodique ou celui
    // déclenché par 'beforeunload' juste avant le location.reload() de
    // permanentDeath() ressuscitait le personnage mort dans le localStorage,
    // et la création d'un nouveau compte juste après retombait dessus.
    if (this._permanentlyDead) return;
    const payload = {
      x: this.x, y: this.y, altitude: this.altitude, heading: this.heading, health: this.health, money: this.money,
      bank: this.bank, dirtyMoney: this.dirtyMoney, hunger: this.hunger, thirst: this.thirst, energy: this.energy,
      inventory: this.inventory, weapons: this.weapons, ammo: this.ammo, ammoReserve: this.ammoReserve, ownedVehicles: this.ownedVehicles,
      // Les véhicules achetés sont créés dynamiquement (pas générés par la
      // ville) : il faut sauvegarder leurs données complètes, sinon ils
      // n'existeraient simplement plus après un rechargement.
      ownedVehicleData: this.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean),
      ownedHouses: this.ownedHouses, ownedWarehouses: this.ownedWarehouses, wanted: this.wanted,
      // Terrain agricole : basé sur de vraies dates (plantedAt), donc la
      // pousse continue même hors ligne — doit impérativement survivre à la
      // déconnexion, d'où la présence ici comme le reste des biens possédés.
      plantations: this.plantations,
      completedMissions: this.completedMissions, activeMissionId: this.activeMission?.id || null,
      role: this.role, policeRank: this.policeRank, licenses: this.licenses, skills: this.skills,
      will: this.will, tickets: this.tickets, invoices: this.invoices, finesHistory: this.finesHistory,
      criminalRecord: this.criminalRecord, jailedAt: this.jailedAt,
      player: this.player, outfit: this.outfit, miningMachine: this.miningMachine, talkie: this.talkie, portableRadio: this.portableRadio,
      rolesCurrent: Roles.current, rolesRecruiters: Roles.recruiters, savedPlaces: this.savedPlaces, ownsTablet: this.ownsTablet,
      phones: this.phones, activePhoneIndex: this.activePhoneIndex, lastParkedVehicle: this.lastParkedVehicle, theoryPassed: this.theoryPassed, flightTheoryPassed: this.flightTheoryPassed, myContacts: this.myContacts,
      hasHelmet: this.hasHelmet, hasVest: this.hasVest, pendingBills: this.pendingBills,
      guideDog: this.guideDog, // chien guide (position, état, équipement) — coûteux, doit persister
      guideDogEverOwned: this.guideDogEverOwned, // empêche d'en redonner un gratuit après la mort du premier
      // Mobilier acheté et placé dans les maisons (personnalisation) : la ville
      // est régénérée à chaque session, il faut donc le sauvegarder à part.
      houseFurniture: Object.fromEntries((City.houses || []).filter(h => h.furniture && h.furniture.length).map(h => [h.id, h.furniture])),
      // Rangement de base de chaque maison (le "coffre-fort" accessible via
      // Rangement de la maison) : même raison, sans quoi tout ce qu'on y range
      // disparaît à la reconnexion puisque la ville régénérée repart à vide.
      houseStorage: Object.fromEntries((City.houses || []).filter(h => h.storage && h.storage.length).map(h => [h.id, h.storage])),
      unconscious: this.unconscious, unconsciousSince: this.unconsciousSince, // pour reprendre le décompte de réveil au bon endroit
    };
    localStorage.setItem('blind_city_v18', JSON.stringify(payload));
    // Si un compte joueur est connecté, pousse aussi la sauvegarde côté
    // serveur : c'est ce qui permet de la retrouver depuis un autre appareil.
    if (Net.connected && Net.accountUsername) Net.saveProgressToServer(payload);
    if (!silent) announce('Partie sauvegardée.', 'polite');
  },
  load() {
    const s = localStorage.getItem('blind_city_v18') || localStorage.getItem('blind_city_v17') || localStorage.getItem('city_blind_v16') || localStorage.getItem('city_blind_v15') || localStorage.getItem('city_blind_v12') || localStorage.getItem('city_blind_v10'); if (!s) return;
    try { this.applySaveData(JSON.parse(s)); } catch(e) { console.error(e); }
  },
  // Applique un objet de sauvegarde (venant du stockage local OU d'un compte
  // serveur) — doit être appelé APRÈS City.generate(), puisque la
  // resynchronisation des missions/véhicules a besoin que la ville existe déjà.
  // fromAccount=true : la sauvegarde vient d'une RECONNEXION à un compte
  // serveur, dont la ville est régénérée avec une graine différente à chaque
  // redémarrage du serveur (voir WORLD_SEED côté server.js) — contrairement
  // au solo, où la graine est mémorisée sur l'appareil et la ville reste
  // identique d'une session à l'autre.
  applySaveData(d, fromAccount) {
    try {
      Object.assign(this, d);
      // Une sauvegarde (locale ou de compte) vient d'être restaurée : ce joueur
      // n'est pas un nouveau venu, on garde sa position enregistrée plutôt que
      // de le faire réapparaître à l'aéroport.
      this._loadedFromSave = true;
      // Anti-blocage : à l'ouverture d'un compte / au chargement d'une
      // sauvegarde, on ne reste JAMAIS inconscient. On repart conscient (santé
      // minimale s'il le fallait) — ça débloque immédiatement tout joueur resté
      // coincé, et supprime toute annonce « vous perdez connaissance » en boucle.
      if (this.unconscious) {
        this.unconscious = false; this.unconsciousSince = null;
        if (!(this.health > 0)) this.health = 30;
        // On laisse une marge pour aller manger/boire sans retomber aussitôt.
        this.hunger = Math.min(this.hunger || 0, 70);
        this.thirst = Math.min(this.thirst || 0, 70);
      }
      if (!this.player) this.player = { firstName: 'Joueur', lastName: 'Anonyme', gender: 'homme', registered: false };
      if (!this.outfit) this.outfit = { haut: null, bas: null, chaussures: null, couleurHaut: null, couleurBas: null, couleurChaussures: null, coiffure: null, lunettes: null, accessoires: [] };
      else for (const k of ['couleurHaut', 'couleurBas', 'couleurChaussures', 'coiffure', 'lunettes']) if (!(k in this.outfit)) this.outfit[k] = null;
      if (!('isPolice' in this.outfit)) this.outfit.isPolice = false;
      if (!('masque' in this.outfit)) this.outfit.masque = false;
      if (!Array.isArray(this.outfit.accessoires)) this.outfit.accessoires = [];
      if (!this.talkie) this.talkie = { owned: false, battery: 1, on: false, frequency: 151.5 };
      if (!this.portableRadio) this.portableRadio = { owned: false };
      // Chien guide : resynchronise le module GuideDog avec l'état restauré.
      if (typeof GuideDog !== 'undefined') GuideDog.data = (this.guideDog && this.guideDog.alive) ? this.guideDog : null;
      if (!Array.isArray(this.savedPlaces)) this.savedPlaces = [];
      if (!Array.isArray(this.myContacts)) this.myContacts = [];
      if (!Array.isArray(this.pendingBills)) this.pendingBills = [];
      if (!Array.isArray(this.finesHistory)) this.finesHistory = [];
      if (!Array.isArray(this.criminalRecord)) this.criminalRecord = [];
      if (!this.ammoReserve || typeof this.ammoReserve !== 'object') this.ammoReserve = {};
      if (!Array.isArray(this.completedMissions)) this.completedMissions = [];
      // Réinjecte les véhicules possédés (créés dynamiquement, donc absents
      // de la ville fraîchement régénérée) sans dupliquer s'ils y sont déjà.
      (d.ownedVehicleData || []).forEach(v => {
        // openDoors est un Set : non sérialisable en JSON (devient {} après
        // sauvegarde/rechargement), donc v.openDoors.add(...) plantait ensuite.
        // On repart portes fermées, ce qui est de toute façon cohérent après un rechargement.
        v.openDoors = new Set();
        if (!City.vehicles.some(existing => existing.id === v.id)) City.vehicles.push(v);
      });
      // Réattache le mobilier des maisons à la ville régénérée.
      if (d.houseFurniture) (City.houses || []).forEach(h => { if (d.houseFurniture[h.id]) h.furniture = d.houseFurniture[h.id]; });
      if (d.houseStorage) (City.houses || []).forEach(h => { if (d.houseStorage[h.id]) h.storage = d.houseStorage[h.id]; });
      if (d.rolesCurrent) Roles.current = d.rolesCurrent;
      if (d.rolesRecruiters) Roles.recruiters = d.rolesRecruiters;
      // Resynchronise les missions déjà accomplies lors d'une session
      // précédente : sans ça, elles réapparaissaient comme disponibles après
      // un rechargement, puisque la ville est régénérée à chaque démarrage.
      this.completedMissions.forEach(id => {
        const m = City.missions.find(mm => mm.id === id);
        if (m) m.completed = true;
      });
      // Restaure la mission active (juste son assignation ; l'état de combat
      // éphémère d'une action en cours — braquage, assaut, etc. — n'est
      // volontairement pas conservé, il faudrait recommencer cette tentative).
      // Reconnexion à un compte serveur : la ville a pu être régénérée entre
      // temps (redémarrage du serveur = nouvelle graine), donc la mission
      // active pointerait peut-être vers un lieu qui n'a plus rien à voir
      // (un site minier ailleurs, une banque devenue une maison...). On
      // l'annule proprement plutôt que de risquer d'envoyer le joueur vers un
      // lieu fictif. En solo, la graine est stable sur l'appareil : la ville
      // est identique d'une session à l'autre, la mission reste donc valable.
      if (d.activeMissionId && fromAccount) {
        this.activeMission = null;
        announce('La mission que vous aviez en cours a été annulée suite à votre reconnexion (la ville a pu changer entre-temps). Vous pouvez en reprendre une nouvelle.', 'polite');
      } else if (d.activeMissionId) {
        const m = City.missions.find(mm => mm.id === d.activeMissionId && !mm.completed);
        this.activeMission = m || null;
        if (m) announce(`Mission en cours retrouvée : ${m.title}.`, 'polite');
      }
      announce('Partie chargée.', 'polite');
    } catch(e) { console.error(e); }
  },


  // Talkie-walkie
  buyTalkie() {
    if (this.talkie.owned) return announce('Vous possédez déjà un talkie-walkie.', 'polite');
    const price = 45000;
    if (this.money < price) return announce(`Talkie-walkie : ${UTIL.formatMoney(price)}.`, 'assertive');
    this.money -= price; this.talkie.owned = true; this.talkie.battery = 1;
    Audio.cash();
    announce('Talkie-walkie acheté, batterie pleine.', 'assertive');
    updateHud();
  },
  // Petite radio portable : débloque Ctrl+R pour lire/mettre en pause la
  // musique perso à tout instant, sans ouvrir le téléphone.
  buyPortableRadio() {
    if (this.portableRadio.owned) return announce('Vous possédez déjà une radio portable.', 'polite');
    const price = 20000;
    if (this.money < price) return announce(`Radio portable : ${UTIL.formatMoney(price)}.`, 'assertive');
    this.money -= price; this.portableRadio.owned = true;
    Audio.cash();
    announce('Radio portable achetée. Ctrl+R pour lire ou mettre en pause votre musique, à tout instant.', 'assertive');
    updateHud();
  },
  // Tablette : appareil séparé du téléphone, exigé pour consulter et accepter
  // les missions (combats de gangs, livraisons, braquages...).
  buyTablet() {
    if (this.ownsTablet) return announce('Vous possédez déjà une tablette.', 'polite');
    const price = 60000;
    if (this.money < price) return announce(`Tablette : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.ownsTablet = true;
    Audio.cash();
    announce('Tablette achetée. Vous l\'avez maintenant sur vous, avec le téléphone : fouillez votre poche (Maj+P) pour choisir lequel ouvrir.', 'assertive');
    updateHud();
  },
  // Casque de protection : seule protection contre un tir ou un coup de
  // couteau à la tête, qui serait autrement mortel de façon définitive.
  hasHelmet: false,
  buyHelmet() {
    if (this.hasHelmet) return announce('Vous portez déjà un casque de protection.', 'polite');
    const gangSurcharge = City.getGangMarketSurcharge('protection');
    const holder = gangSurcharge ? City.getMarketHolder('protection') : null;
    const price = Math.round(120000 * (1 + gangSurcharge));
    if (this.money < price) return announce(`Casque de protection : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasHelmet = true;
    Audio.cash();
    announce(`Casque de protection porté${holder ? ` (marché tenu par ${holder.leaderName || 'quelqu\'un'}, président des ${holder.name})` : ''}. Il vous protège d'un tir ou d'un coup à la tête qui serait autrement mortel.`, 'assertive');
    updateHud();
  },
  hasVest: false,
  buyVest() {
    if (this.hasVest) return announce('Vous portez déjà un gilet pare-balles.', 'polite');
    const gangSurcharge = City.getGangMarketSurcharge('protection');
    const holder = gangSurcharge ? City.getMarketHolder('protection') : null;
    const price = Math.round(150000 * (1 + gangSurcharge));
    if (this.money < price) return announce(`Gilet pare-balles : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price; this.hasVest = true;
    Audio.cash();
    announce(`Gilet pare-balles porté${holder ? ` (marché tenu par ${holder.leaderName || 'quelqu\'un'}, président des ${holder.name})` : ''}. Il réduit les dégâts d'un tir au corps.`, 'assertive');
    updateHud();
  },
  // Numéros de téléphone : chaque téléphone a le sien, purement pour
  // l'affichage — on peut renommer le nom qui s'affiche chez les autres
  // (façon téléphone prépayé/professionnel), indépendamment de son vrai nom.
  buyBurnerPhone() {
    const price = 25000;
    if (this.money < price) return announce(`Téléphone prépayé : ${UTIL.formatMoney(price)}. Fonds insuffisants.`, 'assertive');
    this.money -= price;
    this.phones.push({ number: UTIL.generatePhoneNumber(), label: '' });
    Net.registerNumbers();
    Audio.cash();
    announce(`Nouveau téléphone acheté, numéro ${this.phones[this.phones.length - 1].number}. Renommez-le pour lui donner un nom affiché aux autres.`, 'assertive');
    updateHud();
  },
  renamePhoneLabel(index) {
    const phone = this.phones[index]; if (!phone) return;
    AccessibleTextPrompt.open('Renommer ce numéro', `Nom affiché aux autres quand vous appelez ou écrivez depuis le ${phone.number}. Actuellement : ${phone.label || 'aucun nom, votre vrai nom sera visible'}.`, phone.label || '', (name) => {
      phone.label = (name || '').trim();
      Net.registerNumbers();
      announce(`Numéro ${phone.number} : ${phone.label || 'aucun nom, votre vrai nom sera visible'}.`, 'assertive');
    });
  },
  setActivePhone(index) {
    if (!this.phones[index]) return;
    this.activePhoneIndex = index;
    const p = this.phones[index];
    announce(`Numéro actif : ${p.number}${p.label ? ', affiché comme ' + p.label : ''}.`, 'assertive');
  },
  // Envoyer l'un de ses numéros à la cible verrouillée (un joueur réel) : elle le
  // reçoit, l'enregistre et peut rappeler. Sans index, envoie le numéro actif.
  sendMyNumberToTarget(index) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    const target = this.getLiveTarget();
    if (!target || !target.isPlayer) return announce('Verrouillez d\'abord un joueur réel comme cible (scan avec W, puis un chiffre) pour lui envoyer votre numéro.', 'assertive');
    const phone = this.phones[index != null ? index : this.activePhoneIndex];
    if (!phone) return announce('Vous n\'avez aucun numéro. Achetez un téléphone prépayé.', 'assertive');
    Net.sendNumber(target.id, phone.number, phone.label || `${this.player.firstName} ${this.player.lastName}`);
    announce(`Envoi de votre numéro ${phone.number} à ${target.name}...`, 'polite');
  },
  // Nom affiché aux autres pour l'appel/message en cours : le nom personnalisé
  // du numéro actif, sinon le vrai nom du personnage par défaut.
  activeCallerName() {
    const p = this.phones[this.activePhoneIndex];
    return (p && p.label) ? p.label : `${this.player.firstName} ${this.player.lastName}`;
  },
  openMyPhoneNumbers() {
    el('menuTitle').textContent = 'Mes numéros';
    const items = this.phones.map((p, i) => ({
      id: String(i),
      title: `${i === this.activePhoneIndex ? '✅ ' : ''}${p.number}${p.label ? ' — ' + p.label : ''}`,
      desc: i === this.activePhoneIndex ? 'Numéro actif pour vos appels et messages.' : 'Sélectionnez pour l\'activer, ou renommez-le.',
    }));
    if (typeof Phone !== 'undefined' && Phone.open) Phone.closePhone();
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      const idx = parseInt(sel.id, 10);
      el('menuTitle').textContent = this.phones[idx].number;
      const subItems = [
        { id: 'activate', title: '✅ Activer ce numéro', desc: 'Utilisé pour vos prochains appels/messages.' },
        { id: 'rename', title: '✏️ Renommer', desc: 'Changer le nom affiché aux autres.' },
        { id: 'send', title: '📤 Envoyer à ma cible verrouillée', desc: 'Donner ce numéro au joueur réel que vous avez verrouillé comme cible, pour qu\'il puisse vous rappeler.' },
        { id: 'back', title: '↩️ Retour', desc: '' },
      ];
      renderMenu(subItems, (sub) => {
        if (sub.id === 'activate') { closeMenu(); this.setActivePhone(idx); }
        else if (sub.id === 'rename') { closeMenu(); this.renamePhoneLabel(idx); }
        else if (sub.id === 'send') { closeMenu(); this.sendMyNumberToTarget(idx); }
        else this.openMyPhoneNumbers();
      });
    });
  },
  // "Fouiller sa poche" façon GTA : téléphone et tablette peuvent être
  // possédés en même temps, on choisit ici lequel ouvrir (plus l'ordinateur/
  // outil de piratage, qui est un appareil à part entière).
  openPocketDevices() {
    el('menuTitle').textContent = 'Votre poche';
    const items = [
      { id: 'phone', title: '📱 Téléphone', desc: 'Contacts, messages, appels, garage, carte, réglages.' },
      { id: 'tablet', title: '📲 Tablette', desc: this.ownsTablet ? 'Tout ce qu\'a le téléphone, plus les missions extrêmes.' : 'Non possédée — 60 000 FCFA.' },
      { id: 'computer', title: '💻 Ordinateur (outil de piratage)', desc: 'Terminal de piratage : banque, coffres, systèmes.' },
      { id: 'market', title: '🛒 Market (livraison par drone)', desc: 'Achetez un article, un drone vous le livre où que vous soyez.' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'phone') Phone.openAs('phone');
      else if (sel.id === 'tablet') {
        if (!this.ownsTablet) {
          AccessibleConfirm.open('Vous ne possédez pas de tablette', 'L\'acheter maintenant pour 60 000 FCFA ?', (bought) => {
            if (bought) { this.buyTablet(); if (this.ownsTablet) Phone.openAs('tablet'); }
            else announce('Achetez une tablette pour l\'avoir sur vous.', 'assertive');
          });
        } else Phone.openAs('tablet');
      }
      else if (sel.id === 'computer') Computer.boot();
      else if (sel.id === 'market') this.openMarket();
    });
  },
  toggleTalkiePower() {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie. Achetez-en un dans le menu Talkie.', 'assertive');
    if (!this.talkie.on && this.talkie.battery <= 0.02) return announce('Batterie du talkie déchargée. Rechargez-le.', 'assertive');
    this.talkie.on = !this.talkie.on;
    announce(this.talkie.on ? `Talkie allumé, fréquence ${this.talkie.frequency.toFixed(3)} mégahertz.` : 'Talkie éteint.', 'assertive');
  },
  setTalkieFrequency(freq) {
    this.talkie.frequency = freq;
    announce(`Talkie réglé sur ${freq.toFixed(3)} mégahertz.`, 'polite');
  },
  chargeTalkie() {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie.', 'assertive');
    const near = City.pois.find(p => (p.type === 'magasin' || p.type === 'station_essence') && UTIL.dist(p, this) < 4);
    if (!near) return announce('Rendez-vous dans un magasin ou une station-service pour recharger le talkie.', 'assertive');
    const missing = 1 - this.talkie.battery;
    if (missing <= 0.01) return announce('Batterie déjà pleine.', 'polite');
    const cost = Math.floor(missing * 8000);
    if (this.money < cost) return announce(`Recharge du talkie : ${UTIL.formatMoney(cost)}.`, 'assertive');
    this.money -= cost; this.talkie.battery = 1; Audio.cash();
    announce(`Talkie rechargé chez ${near.name} pour ${UTIL.formatMoney(cost)}. Batterie à 100%.`, 'assertive');
    updateHud();
  },
  talkieTick() {
    // Autonomie augmentée une première fois (8 min -> ~83 min, 0.01 -> 0.001
    // toutes les 5 s), encore insuffisant en usage réel : un vrai
    // talkie-walkie tient des heures. Décharge à nouveau divisée, pour une
    // pleine charge allumée en continu autour de 4h30 (au lieu de ~83 min).
    if (this.talkie.owned && this.talkie.on) {
      this.talkie.battery = Math.max(0, this.talkie.battery - 0.0003);
      if (this.talkie.battery <= 0) { this.talkie.on = false; announce('Batterie du talkie-walkie épuisée. Il s\'éteint.', 'assertive'); }
    }
  },
  talkiePTT(message) {
    if (!this.talkie.owned || !this.talkie.on) return announce('Allumez d\'abord votre talkie-walkie.', 'assertive');
    if (this.talkie.battery <= 0.02) return announce('Batterie trop faible pour émettre.', 'assertive');
    // Coût d'émission réduit dans la même proportion que la décharge
    // ambiante ci-dessus : sinon, une utilisation fréquente du talkie
    // (émissions répétées) restait disproportionnellement coûteuse en
    // batterie malgré l'autonomie ambiante déjà allongée.
    this.talkie.battery = Math.max(0, this.talkie.battery - 0.0005);
    AudioLib.playOnce('son_talkie_bip', { volume: 0.6 });
    const txt = message || 'Message reçu, à vous.';
    announce(`Vous émettez sur ${this.talkie.frequency.toFixed(3)} mégahertz : « ${txt} »`, 'polite');
    Net.talkiePTT(txt);
    RPJournal.log('Talkie', `Émission sur ${this.talkie.frequency.toFixed(3)} MHz : ${txt}`, 'info');
  },
  giveTalkie(targetName) {
    if (!this.talkie.owned) return announce('Vous n\'avez pas de talkie-walkie à donner.', 'assertive');
    const target = targetName ? City.npcs.find(n => n.name.toLowerCase().includes(targetName.toLowerCase())) : this.lockedTarget;
    if (!target) return announce('Aucun destinataire. Verrouillez une cible avant de donner le talkie.', 'assertive');
    if (target.isPlayer) {
      Net.giveTalkieTo(target.id);
      this.talkie.owned = false;
      announce(`Vous tendez votre talkie-walkie à ${target.name} (joueur réel). En attente de sa réponse.`, 'assertive');
      return;
    }
    target.heldTalkie = { ...this.talkie };
    this.talkie.owned = false;
    announce(`Vous donnez votre talkie-walkie à ${target.name} pour qu'il ou elle règle la fréquence.`, 'assertive');
  },
});
