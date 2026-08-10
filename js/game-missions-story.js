/* ============================================================
   GAME-MISSIONS-STORY.JS — suite de l'objet Game (voir js/game.js
   pour l'explication du découpage en plusieurs fichiers).
   Contenu : braquage de banque, raid de repaire de gang, missions
   faciles/moyennes/solo supplémentaires.
============================================================ */
Object.assign(Game, {
  // Rapport de récompense de mission au serveur (voir server.js,
  // mission_reward_claim) : le serveur ne suit PAS l'état des missions
  // (chantier bien plus vaste, hors scope ici — les missions restent
  // entièrement calculées et créditées ICI, en local, exactement comme
  // avant). Mais il compare désormais chaque récompense réclamée à un
  // plafond plausible dérivé du catalogue (js/city.js JOBS) et journalise
  // (visible au staff) tout écart flagrant — mieux qu'une confiance
  // aveugle totale, sans risquer de casser une seule mission en tentant de
  // revalider leur logique complète côté serveur. Purement informatif :
  // n'affecte jamais le crédit local, ne bloque jamais la mission, ne fait
  // rien en solo hors ligne (Net.connected faux).
  reportMissionReward(missionType, amount, dirty) {
    if (!Net.connected) return;
    Net.send({ type: 'mission_reward_claim', missionType, amount: Math.round(amount) || 0, dirty: !!dirty });
  },

  // Annonce de choc unifiée (audit accessibilité missions) : avant, un choc
  // pendant colis fragile ou course VIP soignée dégradait bien la
  // condition/satisfaction en silence, SANS jamais le dire — un joueur
  // non-voyant n'avait aucun moyen de savoir où il en était avant l'échec.
  // Point d'entrée unique, réutilisé par colis fragile, course VIP, urgence
  // médicale (déjà annoncé mais réunifié ici) et n'importe quelle autre
  // mission sensible aux chocs à l'avenir : son distinct + annonce avec le
  // pourcentage restant, systématiquement.
  announceShock(label, percent) {
    Audio.impact();
    announce(`Choc ! ${label} : ${Math.max(0, Math.round(percent))}%.`, 'assertive');
  },

  /* ==========================================================
     BRAQUAGE DE BANQUE — mission complète, jamais la même routine :
     chaque banque a un profil de sécurité propre (révélé au repérage),
     qui impose une méthode différente, avec gardes et otages possibles.
     ========================================================== */
  heistState: null,
  beginBankHeist() {
    const bank = City.pois.find(p => p.type === 'banque' && UTIL.dist(p, this) < 4);
    if (!bank) return announce('Approchez-vous de l\'entrée de la banque.', 'assertive');
    if (this.heistState) return announce('Le braquage est déjà en cours.', 'assertive');
    if (this.activeMission && !this.isMissionAuthorized(this.activeMission)) return announce(`Cette mission a été lancée avec d'autres identifiants (${this.activeMission.authorizedIds.join(', ')}).`, 'assertive');
    if (bank.vaultType === undefined) { bank.vaultType = UTIL.pick(['mecanique', 'electronique', 'renforce']); bank.guards = UTIL.randInt(0, 3); bank.cameras = Math.random() < 0.6; }

    const vaultLabel = { mecanique: 'un coffre mécanique classique', electronique: 'un coffre à verrouillage électronique', renforce: 'un coffre blindé renforcé' }[bank.vaultType];
    announce(`Repérage : ${vaultLabel}. ${bank.guards} garde${bank.guards > 1 ? 's' : ''} en poste. ${bank.cameras ? 'Caméras actives : plus grand risque d\'être identifié.' : 'Pas de caméra visible.'}`, 'assertive');

    const grenade = (this.inventory || []).find(i => i.category === 'explosif');
    el('menuTitle').textContent = 'Braquage de banque';
    const items = [];
    if (bank.vaultType === 'mecanique') {
      items.push({ id: 'discret', title: '🤫 Percer discrètement', desc: 'Environ 16 secondes, faible risque d\'alarme.' });
      items.push({ id: 'rapide', title: '💥 Forcer le coffre', desc: 'Environ 6 secondes, alarme presque certaine.' });
    } else if (bank.vaultType === 'electronique') {
      items.push({ id: 'discret', title: '🤫 Pirater discrètement', desc: 'Environ 18 secondes, faible risque d\'alarme.' });
    } else { // renforce
      items.push({ id: 'renforce_info', title: 'ℹ️ Coffre blindé', desc: 'Trop solide pour du perçage ou de la force : seuls des explosifs peuvent l\'ouvrir.' });
    }
    items.push({
      id: 'explosif',
      title: grenade ? '🧨 Faire sauter le coffre' : '🧨 Faire sauter le coffre (nécessite une grenade)',
      desc: bank.vaultType === 'renforce'
        ? 'Seule option contre un coffre blindé. Quasi instantané, mais très bruyant, et risque de blesser quelqu\'un aux alentours.'
        : 'Quasi instantané, mais très bruyant, alarme immédiate et une partie du butin peut être endommagée.',
    });
    items.push({ id: 'annuler', title: '↩️ Annuler', desc: 'Ne pas tenter le braquage maintenant.' });
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'annuler' || sel.id === 'renforce_info') return;
      if (sel.id === 'explosif') {
        if (!grenade) return announce('Il vous faut une grenade pour faire sauter ce coffre. Le marché noir en vend.', 'assertive');
        return this.executeExplosiveHeist(bank);
      }
      this.executeBankHeist(sel.id === 'rapide', bank);
    });
  },
  executeBankHeist(forced, bank) {
    const alarmChance = forced ? 0.9 : 0.25;
    const crackTime = forced ? 6000 : (bank.vaultType === 'electronique' ? 18000 : 16000);
    this.heistState = { forced, alarmed: false, hostage: false, bank };
    announce(forced
      ? 'Vous forcez le coffre. C\'est rapide, mais bruyant. Restez à proximité de la banque.'
      : 'Vous travaillez discrètement. Ça va prendre un moment. Restez à proximité de la banque.', 'assertive');
    if (Math.random() < alarmChance) {
      const delay = forced ? UTIL.randInt(800, 2000) : UTIL.randInt(4000, 12000);
      this.heistState.alarmTimer = setTimeout(() => this.triggerHeistAlarm(), delay);
    }
    // Un garde présent peut vous surprendre pendant l'opération — jamais garanti,
    // jamais au même moment : c'est ça qui évite la routine identique à chaque fois.
    if (bank.guards > 0) {
      const encounterChance = Math.min(0.75, bank.guards * 0.22 + (forced ? 0.15 : 0));
      if (Math.random() < encounterChance) {
        const delay = UTIL.randInt(1500, Math.max(2000, crackTime - 1500));
        this.heistState.guardTimer = setTimeout(() => this.heistGuardEncounter(), delay);
      }
    }
    this.heistState.crackTimer = setTimeout(() => this.finishVaultBreach(1), crackTime);
  },
  executeExplosiveHeist(bank) {
    const grenade = this.inventory.find(i => i.category === 'explosif');
    if (!grenade) return announce('Il vous faut une grenade pour faire sauter ce coffre. Le marché noir en vend.', 'assertive');
    this.removeItem(grenade.id, 1);
    this.heistState = { forced: true, alarmed: false, hostage: false, bank, explosive: true };
    announce('Vous placez la charge et reculez...', 'assertive');
    setTimeout(() => {
      if (!this.heistState) return; // braquage déjà annulé entre-temps
      [0, 1].forEach(i => setTimeout(() => Audio.tone({ freq: 90, type: 'square', duration: 0.35, gain: 0.2, pan: 0 }), i * 120));
      announce('BOUM ! Le coffre a sauté.', 'assertive');
      this.triggerHeistAlarm();
      // Risque réel de blesser quelqu'un à proximité — change la gravité du délit.
      const bystander = City.npcs.find(n => !n.dead && UTIL.dist(n, this) < 6);
      if (bystander && UTIL.chance(0.35)) {
        bystander.health -= UTIL.randInt(10, 30);
        if (bystander.health <= 0) this.knockOut(bystander);
        announce(`${bystander.name} est blessé${bystander.gender === 'femme' ? 'e' : ''} par le souffle de l'explosion !`, 'assertive');
        this.wanted = Math.min(100, this.wanted + 25);
        this.reportCrimeToPolice('braquage_banque', 'Braquage violent avec explosifs, blessé signalé');
      }
      // Le butin est un peu endommagé par le souffle (multiplicateur 0.8).
      this.finishVaultBreach(0.8);
    }, 2200);
  },
  triggerHeistAlarm() {
    if (!this.heistState || this.heistState.alarmed) return;
    this.heistState.alarmed = true;
    // Alarme synthétisée localement : le fichier antivol reste réservé au vol de véhicule.
    [0, 1, 2, 3, 4].forEach(i => setTimeout(() => {
      if (this.heistState) Audio.tone({ freq: 1400, type: 'square', duration: 0.18, gain: 0.12, pan: 0 });
    }, i * 320));
    announce('L\'alarme se déclenche ! La police a été alertée, dépêchez-vous.', 'assertive');
    this.reportCrimeToPolice('braquage_banque', 'Braquage en cours');
    this.wanted = Math.min(100, this.wanted + 40);
  },
  // Un garde vous surprend : un vrai choix, pas juste "combat ou fuite".
  heistGuardEncounter() {
    if (!this.heistState) return;
    announce('Un garde vous surprend !', 'assertive');
    el('menuTitle').textContent = 'Un garde vous a repéré';
    const items = [
      { id: 'fight', title: '👊 Le neutraliser', desc: 'Risque de dégâts, et l\'alarme se déclenche presque à coup sûr.' },
      { id: 'hostage', title: '🔫 Le prendre en otage', desc: 'Il ne peut plus donner l\'alarme, mais une prise d\'otage est prise très au sérieux si elle est découverte.' },
      { id: 'flee', title: '🏃 Abandonner le braquage', desc: 'Vous partez immédiatement, sans le butin.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (!this.heistState) return; // le temps du menu, le perçage a pu se terminer
      if (sel.id === 'fight') {
        const dmg = UTIL.randInt(5, 20); this.takeDamage(dmg, { headshot: this.rollHeadshot() });
        announce(`Vous neutralisez le garde, mais vous encaissez ${dmg} dégâts dans la bagarre.`, 'assertive');
        this.triggerHeistAlarm();
      } else if (sel.id === 'hostage') {
        this.takeHostage();
      } else {
        this.abortBankHeist();
      }
    });
  },
  takeHostage() {
    if (!this.heistState) return;
    const npc = City.npcs.find(n => !n.dead && UTIL.dist(n, this) < 6);
    this.heistState.hostage = true;
    this.hostageNPC = npc || null;
    announce(`Vous prenez ${npc ? npc.name : 'un employé'} en otage. Il ne donnera plus l'alarme pour l'instant, mais si la police l'apprend, c'est bien plus grave pour vous.`, 'assertive');
  },
  finishVaultBreach(lootMultiplier) {
    if (!this.heistState) return;
    if (this.heistState.hostage) {
      el('menuTitle').textContent = 'Que faire de l\'otage ?';
      const items = [
        { id: 'liberer', title: '🕊️ Libérer sans lui faire de mal', desc: 'Conséquences moins graves pour vous à l\'avenir.' },
        { id: 'assommer', title: '👊 L\'assommer avant de partir', desc: 'Retarde son témoignage, mais plus grave si vous êtes identifié.' },
      ];
      renderMenu(items, (sel) => {
        closeMenu();
        if (sel.id === 'assommer' && this.hostageNPC) this.knockOut(this.hostageNPC);
        this.hostageNPC = null;
        this.reportCrimeToPolice('prise_otage', 'Prise d\'otage lors d\'un braquage');
        this.wanted = Math.min(100, this.wanted + (sel.id === 'assommer' ? 35 : 15));
        this.finalizeBankHeistLoot(lootMultiplier);
      });
    } else {
      this.finalizeBankHeistLoot(lootMultiplier);
    }
  },
  finalizeBankHeistLoot(lootMultiplier) {
    const m = this.activeMission;
    if (!m) { this.heistState = null; return; }
    const amount = Math.max(30000, Math.round((m.reward + UTIL.randInt(-20000, 60000)) * lootMultiplier));
    this.dirtyMoney += amount;
    this.reportMissionReward(m.type, amount, true);
    m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
    RPJournal.log('Mission', `Braquage réussi : ${UTIL.formatMoney(amount)} d'argent sale.`, 'alert');
    const alarmed = this.heistState.alarmed;
    this.heistState = null;
    announce(`Coffre percé ! Vous embarquez ${UTIL.formatMoney(amount)}. ${alarmed ? 'Fuyez avant que la police n\'arrive !' : 'Personne n\'a rien remarqué.'}`, 'assertive');
    updateHud();
  },
  abortBankHeist() {
    if (!this.heistState) return;
    clearTimeout(this.heistState.alarmTimer); clearTimeout(this.heistState.crackTimer); clearTimeout(this.heistState.guardTimer);
    if (this.heistState.hostage && this.hostageNPC) this.hostageNPC = null;
    this.heistState = null;
    announce('Le braquage est interrompu, le coffre reste intact.', 'assertive');
  },

  /* ==========================================================
     RAID DE REPAIRE DE GANG — mission de combat dont la récompense
     est du VRAI butin (armes + munitions), pas de l'argent.
     ========================================================== */
  beginGangRaid(gang) {
    if (!this.activeMission || (this.activeMission.type !== 'combat' && this.activeMission.type !== 'hunt')) {
      return announce(`Repaire des ${gang.name} repéré. Activez une mission de combat depuis la tablette pour tenter un assaut ici.`, 'polite');
    }
    if (this.gangRaidState) return announce('L\'assaut est déjà en cours.', 'assertive');
    if (!this.isMissionAuthorized(this.activeMission)) return announce(`Cette mission a été lancée avec d'autres identifiants (${this.activeMission.authorizedIds.join(', ')}).`, 'assertive');
    announce(`Repérage : repaire des ${gang.name}. Environ ${gang.members} membre(s) armé(s), niveau de puissance ${gang.power}.`, 'assertive');
    el('menuTitle').textContent = `Assaut : ${gang.name}`;
    const items = [
      { id: 'frontal', title: '🔫 Assaut frontal', desc: 'Combat direct : les membres du gang apparaissent réellement, armés, et ripostent. Butin complet si vous survivez, mais très risqué et bruyant.' },
      { id: 'infiltration', title: '🥷 Infiltration discrète', desc: 'Tenter de voler l\'arsenal sans déclencher le combat. Moins de butin, moins de risque, mais chance réelle d\'être repéré et de devoir combattre quand même.' },
      { id: 'annuler', title: '↩️ Annuler', desc: 'Ne pas tenter l\'assaut maintenant.' },
    ];
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'annuler') return;
      if (sel.id === 'frontal') this.launchGangCombat(gang, false);
      else this.attemptGangInfiltration(gang);
    });
  },
  attemptGangInfiltration(gang) {
    const caught = UTIL.chance(0.35 + gang.power / 300);
    if (caught) {
      announce('Vous êtes repéré en pleine infiltration ! Ils prennent les armes.', 'assertive');
      return this.launchGangCombat(gang, true);
    }
    announce('Vous filez discrètement avec une partie de l\'arsenal, sans un coup de feu.', 'assertive');
    gang.relation = Math.max(-100, gang.relation - 10);
    this.grantGangLoot(gang, 0.5);
  },
  // Fait apparaître de vrais PNJ du gang (position, arme, santé propres),
  // ciblables et combattables avec le système existant (scan, verrouillage,
  // tir, coup de poing) — plus un calcul abstrait de probabilité.
  launchGangCombat(gang, surprised) {
    const firstNames = ['Boukary', 'Idrissa', 'Salif', 'Mamadou', 'Aboubacar', 'Yacouba', 'Adama', 'Ousmane'];
    const lastNames = ['Sana', 'Zongo', 'Compaoré', 'Kaboré', 'Ilboudo', 'Ouédraogo', 'Nikiema'];
    const count = Math.max(1, Math.min(gang.members, 5));
    // Plafond volontaire : ni sniper ni fusil à pompe pour un PNJ, quel qu'il
    // soit (gang, garde, police) — trop lourd/puissant pour un adversaire
    // que le combat peut faire apparaître en nombre. AK-47 reste le haut du
    // barème.
    const pool = gang.power > 60 ? ['ak47', 'm4'] : gang.power > 30 ? ['pistolet_9', 'uzi'] : ['pistolet_9', 'revolver_38'];
    const npcIds = [];
    for (let i = 0; i < count; i++) {
      const job = 'ganger';
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: `gangnpc_${gang.id}_${Date.now()}_${i}`,
        name: `${UTIL.pick(firstNames)} ${UTIL.pick(lastNames)}`, job, gender,
        x: UTIL.clamp(gang.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(gang.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 100, relation: -100, money: UTIL.randInt(2000, 15000), inCar: false,
        dialogue: ['Dégage de mon territoire !', 'Vous n\'auriez pas dû venir ici.', 'On va vous faire regretter ça !'],
        home: { x: gang.x, y: gang.y }, hostile: true,
        weapon: UTIL.pick(pool), outfit: generateNPCAppearance(job),
      };
      City.npcs.push(npc);
      npcIds.push(npc.id);
    }
    this.gangRaidState = { gang, npcIds };
    this.reportCrimeToPolice('coups_de_feu', `Fusillade au repaire des ${gang.name}`);
    announce(`${count} membre${count > 1 ? 's' : ''} du gang ${gang.name} vous font face${surprised ? ', surpris par votre présence' : ''} ! Faites un scan pour les localiser et les verrouiller comme cible.`, 'assertive');
    if (surprised) {
      const dmg = UTIL.randInt(5, 15);
      this.takeDamage(dmg, { headshot: this.rollHeadshot() });
      announce(`Ils ouvrent le feu en premier : ${dmg} dégâts avant que vous ne puissiez réagir.`, 'assertive');
    }
  },
  // Appelé en continu depuis gameLoop tant qu'un assaut de gang est en cours :
  // fait riposter les membres encore vivants, détecte victoire/défaite/fuite.
  updateGangCombat() {
    const rs = this.gangRaidState; if (!rs) return;
    if (this.health <= 0) { this.gangRaidState = null; return; } // die() gère déjà l'hôpital
    // Des gardes au sol, armés d'armes de poing/fusils, ne peuvent pas
    // toucher efficacement quelqu'un en plein vol (aéronef en altitude) —
    // avant, ils vous tiraient dessus même en hélicoptère, avant même d'avoir
    // atterri, ce qui n'a aucun sens.
    const myVcls = this.inVehicle && this.vehicle ? VEHICLE_CATALOG[this.vehicle.type] : null;
    if (myVcls && myVcls.flies && this.altitude > 5) return;
    const squad = rs.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    if (!squad.length) return this.finishGangCombat(rs.gang, true);
    if (UTIL.dist(rs.gang, this) > 20) {
      this.gangRaidState = null;
      announce('Vous vous êtes trop éloigné : le repaire reste sous le contrôle du gang.', 'polite');
      return;
    }
    // Portée élargie (14 -> 18, sous le seuil de 20 qui annule le raid si on
    // s'éloigne trop) : coupait tout tir à distance réaliste (voir tickPlanqueGardee).
    squad.forEach(n => {
      const d = UTIL.dist(n, this);
      if (d > 18) return;
      const weapon = WEAPON_CATALOG[n.weapon];
      const fireChance = Math.max(0.1, 0.4 - d * 0.015); // plancher/base remontés, cohérent avec le reste (voir missionCombatTick)
      if (weapon && UTIL.chance(fireChance)) {
        this.resolveNpcShotAtPlayer(n, weapon, d, 18);
        // Chaque tir essuyé (touché ou raté) augmente la chance de le repérer précisément.
        n._shotsAtPlayer = (n._shotsAtPlayer || 0) + 1;
        if (UTIL.chance(Math.min(0.9, 0.25 + n._shotsAtPlayer * 0.15))) this.revealShooter(n);
      }
    });
  },
  finishGangCombat(gang, victory) {
    this.gangRaidState = null;
    if (!victory) return;
    gang.relation = Math.max(-100, gang.relation - 40);
    gang.power = Math.max(0, gang.power - 20);
    announce(`Repaire des ${gang.name} neutralisé !`, 'assertive');
    this.grantGangLoot(gang, 1);
  },
  // Throttle partagé pour la résolution de tir des PNJ dans les tick* de
  // mission (tickSabotage, tickEscorte, tickConvoiBlinde, tickDepotArmesGang,
  // tickExtractionVip, tickPlanqueGardee, tickDefenseTerritoire), tous
  // appelés depuis checkMission() — lui-même exécuté à CHAQUE frame
  // (~60 fois/seconde, via requestAnimationFrame dans la boucle de jeu), et
  // non toutes les ~1,5 s comme updateGangCombat()/updateWantedResponseCombat()
  // (throttlés en setInterval). Sans ce throttle, un garde avec ne serait-ce
  // que 20-30% de "chance de tir" par appel tirait en réalité des dizaines de
  // fois par seconde : aucun gilet, casque ou blindage ne pouvait absorber un
  // tel volume de tirs, et la synthèse vocale, submergée d'annonces de tir en
  // boucle, ne pouvait plus rien annoncer d'autre (verrouillage de cible,
  // etc.). Même cadence que les combats déjà throttlés ailleurs.
  // Résout un tir d'un PNJ hostile sur le joueur — point d'entrée unique
  // réutilisé par updateGangCombat() ET tous les tick* de mission en combat
  // (au lieu de dupliquer la même logique 8 fois, divergente à chaque site) :
  // - Comme pour le joueur (voir shoot()), TIRER ne veut pas dire TOUCHER —
  //   avant, dès qu'un PNJ "tentait" un tir, il touchait systématiquement,
  //   sans le moindre jet de précision. Un vrai jet, dégressif avec la
  //   distance, décide maintenant si le tir part dans le vide ou touche.
  // - Le bruit réel de l'arme (dédié au catalogue si fourni, sinon
  //   synthétisé) est joué, spatialisé selon la position du tireur par
  //   rapport au joueur, et diffusé aux autres joueurs proches — avant, ces
  //   combats ne jouaient AUCUN son de tir, uniquement du texte.
  // - Une réplique hostile du groupe "énervé" (déjà fournie pour les gangs,
  //   étendue aux gardes) est jouée de temps en temps pendant l'échange, pas
  //   à chaque tir pour ne pas noyer les annonces de combat.
  // Renvoie true si le tir touche (dégâts appliqués), false s'il rate.
  resolveNpcShotAtPlayer(npc, weapon, d, maxRange) {
    const pan = this.panForPoint(npc.x, npc.y);
    if (weapon.shotSound) AudioLib.playPositional(weapon.shotSound, pan, 0.7);
    else Audio.gunshot(weapon.name, pan);
    if (Net.connected) Net.emitSound(weapon.shotSound || 'synth:gunshot', { vol: 0.6 });
    if (UTIL.chance(0.22)) this.npcVoiceReaction(npc.x, npc.y, { group: 'enerve', count: 1, radius: 14 });
    const acc = Math.max(0.3, (weapon.accuracy || 0.6) - UTIL.clamp(d / maxRange, 0, 1) * 0.4);
    if (!UTIL.chance(acc)) {
      announce(`${npc.name} tire mais rate sa cible.`, 'polite');
      return false;
    }
    const dmg = Math.round(weapon.dmg * (0.4 + Math.random() * 0.6) * (1 - UTIL.clamp(d / maxRange, 0, 1) * 0.35));
    this.takeDamage(dmg, { headshot: this.rollHeadshot(), attackerX: npc.x, attackerY: npc.y });
    announce(`${npc.name} vous touche avec son ${weapon.name} ! ${dmg} dégâts.`, 'combat');
    return true;
  },
  missionCombatTick(key) {
    this._missionCombatCooldowns = this._missionCombatCooldowns || {};
    const now = Date.now();
    // Correctif #133 (60 tirs/seconde -> rythme "réaliste") avait resserré ce
    // throttle à 1500 ms, combiné à des chances de tir déjà prudentes : le
    // résultat cumulé rendait les gardes quasi passifs (un tir toutes les
    // 6 à 30 secondes par garde selon la distance). Resserré à 1000 ms —
    // toujours très loin de l'ancien excès, mais un vrai échange de tirs.
    if (now - (this._missionCombatCooldowns[key] || 0) < 1000) return false;
    this._missionCombatCooldowns[key] = now;
    return true;
  },

  /* ==========================================================
     TROIS MISSIONS FACILES — légales, sans combat, pour découvrir les
     outils de navigation en douceur.
     ========================================================== */

  // 1. Colis fragile : chronométré, à pied ou en véhicule léger ; chaque
  // collision (voir driveVehicle) abîme un peu plus le colis.
  fragileState: null,
  tickFragileDelivery(m) {
    if (!this.fragileState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        const distMeters = UTIL.dist({ x: m.x, y: m.y }, { x: m.dropX, y: m.dropY }) * CONFIG.METERS_PER_TILE;
        const timeLimit = Math.round(distMeters / 3) * 1000 + 25000;
        this.fragileState = { missionId: m.id, condition: 100, deadline: Date.now() + timeLimit };
        announce(`Colis récupéré ! Livrez-le à ${m.dropName} avant environ ${Math.round(timeLimit / 1000)} secondes. Évitez les chocs.`, 'assertive');
      }
      return;
    }
    if (Date.now() > this.fragileState.deadline) {
      announce('Trop de temps écoulé : le client renonce à la livraison.', 'assertive');
      this.fragileState = null; this.activeMission = null;
      return;
    }
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.dropX, y: m.dropY }) < 3) {
      const cond = Math.round(this.fragileState.condition);
      const amount = Math.round(m.reward * Math.max(0.3, cond / 100));
      this.money += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, false);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.fragileState = null;
      RPJournal.log('Mission', `Colis livré à ${cond}% d'état : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`Colis livré à ${cond}% d'état ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Taxi soigné : monter le client, le conduire sans le secouer.
  taxiState: null,
  boardTaxiClient(npc, m) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule avant de faire monter le client.', 'assertive');
    this.vehicle.passengers = this.vehicle.passengers || [];
    this.vehicle.passengers.push({ id: npc.id, name: npc.name, health: npc.health });
    npc.dead = true; npc.x = -999; // le PNJ "monte" : on le retire du monde pendant la course
    this.taxiState = { missionId: m.id, satisfaction: 100, lastSpeed: 0, wasBraking: false };
    announce(`${npc.name} monte à bord. Conduisez-le à ${m.dropName} en douceur.`, 'assertive');
  },
  // Menu d'embarquement, ouvert une seule fois sur demande (touche E) — pas
  // à chaque image, ce qui rendait le menu inutilisable auparavant.
  openTaxiBoardMenu(client, m) {
    el('menuTitle').textContent = 'Course VIP';
    const items = [
      { id: 'board', title: `🚕 Faire monter ${client.name}`, desc: this.inVehicle ? `Direction : ${m.dropName}.` : 'Montez d\'abord dans un véhicule.' },
      { id: 'annuler', title: '↩️ Pas maintenant', desc: '' },
    ];
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'board') this.boardTaxiClient(client, m); });
  },
  // Appelé à chaque collision/freinage brutal pendant une course (voir driveVehicle).
  taxiRoughEvent(severity) {
    if (!this.taxiState) return;
    this.taxiState.satisfaction = Math.max(0, this.taxiState.satisfaction - severity);
    // Avant : phrase de circonstance SANS le pourcentage (« Aïe ! Doucement ! »)
    // — impossible de savoir où en était vraiment la satisfaction avant la fin
    // de la course. Le pourcentage réel prime sur la fioriture ; pas de double
    // annonce pour rester concis (le véhicule "parle" déjà beaucoup par ailleurs).
    if (severity > 5) this.announceShock('Satisfaction client', this.taxiState.satisfaction);
  },
  tickTaxiSoigne(m) {
    if (!this.taxiState) return; // en attente d'embarquement, voir interact() / boardTaxiClient
    if (!this.inVehicle || !this.vehicle) return; // client à bord, en pause tant qu'on n'est pas au volant
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 4) {
      const sat = Math.round(this.taxiState.satisfaction);
      const amount = Math.round(m.reward * Math.max(0.2, sat / 100));
      this.money += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, false);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== m.clientId);
      this.taxiState = null;
      RPJournal.log('Mission', `Course VIP terminée, satisfaction ${sat}% : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${sat >= 80 ? 'Client ravi' : sat >= 40 ? 'Client satisfait' : 'Client agacé'} ! Pourboire : ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Objet perdu : repérage sonore progressif (radar/balises), pas de risque.
  tickObjetPerdu(m) {
    const d = UTIL.dist({ x: this.x, y: this.y }, m);
    if (d < 2) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, false);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      RPJournal.log('Mission', `Objet retrouvé : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`Objet retrouvé ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    const now = Date.now();
    if (now - (this._lastObjetBeep || 0) > Math.max(150, d * 40)) {
      this._lastObjetBeep = now;
      Audio.tone({ freq: 900, type: 'sine', duration: 0.08, gain: 0.08, pan: this.panForPoint(m.x, m.y) });
    }
  },

  /* ==========================================================
     QUATRE MISSIONS DE DIFFICULTÉ MOYENNE
     ========================================================== */

  // 1. Filature discrète : rester dans la bonne fourchette de distance.
  filatureState: null,
  tickFilature(m) {
    const suspect = City.npcs.find(n => n.id === m.suspectId && !n.dead);
    if (!suspect) { this.activeMission = null; this.filatureState = null; return; }
    if (!this.filatureState) this.filatureState = { goodMs: 0, lastTick: Date.now(), lastWander: 0, suspicion: 0, lastStatusMsg: 0, wasHighSuspicion: false };
    const fs = this.filatureState;
    const now = Date.now();
    const dt = Math.min(2000, now - fs.lastTick); fs.lastTick = now;
    if (now - fs.lastWander > 2000) {
      fs.lastWander = now;
      const nx = suspect.x + UTIL.randInt(-2, 2), ny = suspect.y + UTIL.randInt(-2, 2);
      if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { suspect.x = nx; suspect.y = ny; }
    }
    const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
    const d = UTIL.dist(suspect, myPos);
    if (d < 3) {
      fs.suspicion += dt / 1000 * 15;
      if (fs.suspicion > 100) {
        announce(`${suspect.name} vous a repéré et s'enfuit ! Filature ratée.`, 'assertive');
        this.filatureState = null; this.activeMission = null;
        return;
      }
    } else if (d <= 12) {
      fs.suspicion = Math.max(0, fs.suspicion - dt / 1000 * 5);
      fs.goodMs += dt;
      if (fs.goodMs > 40000) {
        const amount = m.reward;
        this.dirtyMoney += amount; Audio.cash();
        this.reportMissionReward(m.type, amount, true);
        m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
        this.filatureState = null;
        RPJournal.log('Mission', `Filature réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
        announce(`Vous découvrez la destination du suspect ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
        updateHud();
        return;
      }
    } else {
      fs.goodMs = Math.max(0, fs.goodMs - dt * 2);
      if (d > 20) {
        announce('Vous avez perdu le suspect de vue. Filature ratée.', 'assertive');
        this.filatureState = null; this.activeMission = null;
        return;
      }
    }
    // Retour vocal périodique manquant jusque-là : rien n'était annoncé entre
    // le début de la filature et son échec/réussite — impossible pour un
    // joueur non-voyant de savoir s'il tenait la bonne distance ou s'il
    // dérivait vers l'échec. Toutes les ~3,5 s : distance réelle + zone
    // (trop près / bonne distance / trop loin) + niveau de suspicion.
    if (now - fs.lastStatusMsg > 3500) {
      fs.lastStatusMsg = now;
      const meters = Math.round(d * CONFIG.METERS_PER_TILE);
      const zone = d < 3 ? 'trop près' : d <= 12 ? 'bonne distance' : 'trop loin';
      const suspicionLevel = fs.suspicion > 66 ? 'élevée' : fs.suspicion > 33 ? 'moyenne' : 'faible';
      announce(`${suspect.name} à ${meters} mètres — ${zone}. Suspicion : ${suspicionLevel}.`, 'polite');
    }
    // Son d'alerte distinct dès le franchissement du seuil (pas à chaque
    // tick tant qu'on reste au-dessus, sinon le son deviendrait continu et
    // masquerait le reste de l'ambiance) : prévient qu'il faut reculer AVANT
    // l'échec à 100.
    if (fs.suspicion > 60 && !fs.wasHighSuspicion) { fs.wasHighSuspicion = true; Audio.suspicionAlert(); }
    else if (fs.suspicion <= 60) fs.wasHighSuspicion = false;
  },

  // 2. Escorte sous menace : client réel à bord, embuscade possible avec de
  // vrais assaillants (mêmes principes que le raid de gang).
  escorteState: null,
  openEscorteBoardMenu(client, m) {
    el('menuTitle').textContent = 'Escorte';
    const items = [
      { id: 'board', title: `🛡️ Faire monter ${client.name}`, desc: `Direction : ${m.dropName}. Restez vigilant, une embuscade est possible.` },
      { id: 'annuler', title: '↩️ Pas maintenant', desc: '' },
    ];
    renderMenu(items, (sel) => { closeMenu(); if (sel.id === 'board') this.boardEscorteClient(client, m); });
  },
  boardEscorteClient(npc, m) {
    if (!this.inVehicle || !this.vehicle) return announce('Montez dans un véhicule avant de faire monter le client.', 'assertive');
    this.vehicle.passengers = this.vehicle.passengers || [];
    this.vehicle.passengers.push({ id: npc.id, name: npc.name, health: npc.health });
    this.escorteState = { missionId: m.id, clientId: npc.id, ambushDone: false, npcIds: [] };
    announce(`${npc.name} monte, nerveux. Direction ${m.dropName}. Restez sur vos gardes.`, 'assertive');
  },
  triggerEscorteAmbush() {
    const es = this.escorteState; if (!es || !this.vehicle) return;
    announce('Une embuscade armée vous prend pour cible !', 'assertive');
    this.reportCrimeToPolice('coups_de_feu', 'Fusillade lors d\'une escorte');
    const firstNames = ['Rachid', 'Sidiki', 'Tahirou', 'Abdoul'];
    const lastNames = ['Barry', 'Cissé', 'Diakité'];
    const count = UTIL.randInt(1, 2);
    for (let i = 0; i < count; i++) {
      const gender = UTIL.pick(['homme', 'femme']);
      const npc = {
        id: 'ambushnpc_' + Date.now() + '_' + i, name: `${UTIL.pick(firstNames)} ${UTIL.pick(lastNames)}`, job: 'ganger', gender,
        x: UTIL.clamp(this.vehicle.x + UTIL.randInt(-3, 3), 0, City.W - 1), y: UTIL.clamp(this.vehicle.y + UTIL.randInt(-3, 3), 0, City.H - 1),
        health: 80, relation: -100, money: 0, inCar: false, dialogue: [], home: { x: this.vehicle.x, y: this.vehicle.y }, hostile: true,
        weapon: UTIL.pick(['pistolet_9', 'uzi']), outfit: generateNPCAppearance('ganger'),
      };
      City.npcs.push(npc); es.npcIds.push(npc.id);
    }
    // Réplique hostile AVANT le premier tir (pas seulement pendant l'échange,
    // voir resolveNpcShotAtPlayer) : le joueur entend l'embuscade réagir dès
    // qu'elle se déclenche, avant de commencer à essuyer des tirs.
    this.npcVoiceReaction(this.vehicle.x, this.vehicle.y, { group: 'enerve', count: 1, radius: 14 });
  },
  tickEscorte(m) {
    if (!this.escorteState) return; // le menu s'ouvre via interact(), voir openEscorteBoardMenu
    const es = this.escorteState;
    const client = City.npcs.find(n => n.id === es.clientId);
    if (!client || client.health <= 0) {
      announce('Votre client n\'a pas survécu. Escorte ratée.', 'assertive');
      this.escorteState = null; this.activeMission = null;
      return;
    }
    // Arrivée au point d'exfiltration : vérifiée AVANT le "return" qui exige
    // d'être en véhicule, et sur la position du JOUEUR (proche du véhicule
    // qu'on vient de quitter) autant que sur celle du véhicule — avant,
    // cette vérification était coincée après le "return si pas en véhicule",
    // donc descendre à l'arrivée (comme demandé par le message d'arrivée du
    // guidage, "appuyez sur E") rendait la mission bloquée pour toujours :
    // plus aucun code de fin n'était jamais exécuté.
    const dropPos = (this.inVehicle && this.vehicle) ? this.vehicle : this;
    if (UTIL.dist(dropPos, { x: m.dropX, y: m.dropY }) < 5) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      if (this.vehicle) this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== es.clientId);
      this.escorteState = null;
      RPJournal.log('Mission', `Escorte réussie : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`${client.name} arrive sain et sauf ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    if (!es.ambushDone && Math.random() < 0.008) { es.ambushDone = true; this.triggerEscorteAmbush(); }
    if (es.npcIds.length) {
      const squad = es.npcIds.map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
      if (!squad.length) { es.npcIds = []; announce('Les assaillants sont neutralisés. La route est libre.', 'assertive'); }
      else if (this.missionCombatTick('escorte')) {
        // Portée élargie (12 -> 20) : coupait tout tir à distance réaliste (voir tickPlanqueGardee).
        squad.forEach(n => {
          const d = UTIL.dist(n, this.vehicle);
          if (d > 20) return;
          const weapon = WEAPON_CATALOG[n.weapon];
          // Chance de tir remontée (voir missionCombatTick) : trop rare avant.
          if (weapon && UTIL.chance(Math.max(0.1, 0.45 - d * 0.02))) {
            if (UTIL.chance(0.4)) {
              const dmg = Math.round(weapon.dmg * 0.6);
              client.health = Math.max(0, client.health - dmg);
              announce(`${client.name} est touché ! Santé : ${Math.round(client.health)}%.`, 'assertive');
            } else {
              this.resolveNpcShotAtPlayer(n, weapon, d, 12);
            }
          }
        });
      }
    }
  },

  // 3. Contrebande : choix d'itinéraire, risque de contrôle policier.
  contrebandeState: null,
  tickContrebande(m) {
    if (!this.contrebandeState) {
      if (UTIL.dist({ x: this.x, y: this.y }, m) < 3) {
        el('menuTitle').textContent = 'Contrebande — choisir l\'itinéraire';
        const items = [
          { id: 'centre', title: '🏙️ Passer par le centre-ville', desc: 'Plus court, mais bien plus de contrôles policiers.' },
          { id: 'peripherie', title: '🌾 Contourner par la périphérie', desc: 'Plus long, mais bien moins surveillé.' },
        ];
        renderMenu(items, (sel) => {
          closeMenu();
          const risky = sel.id === 'centre';
          this.contrebandeState = { missionId: m.id, risky };
          announce(`Cargaison de ${m.cargo} récupérée, itinéraire ${risky ? 'par le centre-ville' : 'par la périphérie'}.`, 'assertive');
        });
      }
      return;
    }
    const cs = this.contrebandeState;
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.dropX, y: m.dropY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.contrebandeState = null;
      RPJournal.log('Mission', `Contrebande livrée : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Cargaison livrée sans encombre ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    const chance = cs.risky ? 0.003 : 0.001;
    if (Math.random() < chance) {
      const caught = UTIL.chance(cs.risky ? 0.7 : 0.35);
      if (caught) {
        announce('Contrôle de police ! Vous êtes fouillé et la cargaison est saisie.', 'assertive');
        this.wanted = Math.min(100, this.wanted + 30);
        this.money = Math.max(0, this.money - 20000);
        this.activeMission = null; this.contrebandeState = null;
      } else {
        announce('Un contrôle de police est en vue... vous parvenez à l\'éviter de justesse.', 'polite');
      }
    }
  },

  // 4. Urgence médicale : repérage sonore, transport, dégradation dans le temps.
  medicalState: null,
  tickUrgenceMedicale(m) {
    if (!this.medicalState) {
      const victim = City.npcs.find(n => n.id === m.victimId && !n.dead);
      if (!victim) { this.activeMission = null; return; }
      const myPos = this.inVehicle && this.vehicle ? this.vehicle : this;
      const d = UTIL.dist(victim, myPos);
      if (d < 2) {
        if (!this.inVehicle || !this.vehicle) return announce('Trouvez un véhicule pour transporter le blessé.', 'assertive');
        this.vehicle.passengers = this.vehicle.passengers || [];
        this.vehicle.passengers.push({ id: victim.id, name: victim.name, health: victim.health });
        this.medicalState = { missionId: m.id, victimId: victim.id, lastTick: Date.now() };
        announce(`${victim.name} est installé(e) dans le véhicule. Direction l'hôpital, vite !`, 'assertive');
        return;
      }
      const now = Date.now();
      if (now - (this._lastMedBeep || 0) > Math.max(150, d * 40)) {
        this._lastMedBeep = now;
        Audio.tone({ freq: 500, type: 'sine', duration: 0.1, gain: 0.09, pan: this.panForPoint(victim.x, victim.y) });
      }
      return;
    }
    const ms = this.medicalState;
    const victim = City.npcs.find(n => n.id === ms.victimId);
    if (!victim) { this.medicalState = null; this.activeMission = null; return; }
    const now = Date.now();
    const dt = Math.min(2000, now - ms.lastTick); ms.lastTick = now;
    victim.health = Math.max(0, victim.health - dt / 1000 * 0.6);
    if (victim.health <= 0) {
      announce(`${victim.name} n'a pas survécu. Mission échouée.`, 'assertive');
      this.medicalState = null; this.activeMission = null;
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    const hopital = City.pois.find(p => p.type === 'hopital');
    if (hopital && UTIL.dist(this.vehicle, hopital) < 4) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, false);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.vehicle.passengers = (this.vehicle.passengers || []).filter(p => p.id !== ms.victimId);
      victim.dead = true; victim.x = -999;
      this.medicalState = null;
      RPJournal.log('Mission', `Urgence médicale réussie : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${victim.name} est sauvé(e) ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  /* ==========================================================
     TROIS MISSIONS SOLO SUPPLÉMENTAIRES
     ========================================================== */

  // 1. Course clandestine : un vrai rival avance en temps réel sur la carte.
  courseState: null,
  tickCourseClandestine(m) {
    if (!this.courseState) {
      if (!this.inVehicle || !this.vehicle) return;
      if (UTIL.dist(this.vehicle, m) < 3) {
        this.courseState = { missionId: m.id, rival: { x: m.x, y: m.y, speed: UTIL.rand(0.55, 0.85) } };
        announce(`Course lancée contre ${m.rivalName} ! Premier arrivé à ${m.dropName} gagne.`, 'assertive');
      }
      return;
    }
    const cs = this.courseState;
    const dx = m.dropX - cs.rival.x, dy = m.dropY - cs.rival.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = cs.rival.x + (dx / len) * cs.rival.speed, ny = cs.rival.y + (dy / len) * cs.rival.speed;
    if (City.isSolid(Math.round(nx), Math.round(ny))) { nx = cs.rival.x + UTIL.randInt(-1, 1); ny = cs.rival.y + UTIL.randInt(-1, 1); }
    cs.rival.x = UTIL.clamp(nx, 0, City.W - 1); cs.rival.y = UTIL.clamp(ny, 0, City.H - 1);
    if (UTIL.dist(cs.rival, { x: m.dropX, y: m.dropY }) < 3) {
      announce(`${m.rivalName} franchit la ligne d'arrivée avant vous. Course perdue.`, 'assertive');
      this.courseState = null; this.activeMission = null;
      return;
    }
    if (!this.inVehicle || !this.vehicle) return;
    const cls = VEHICLE_CATALOG[this.vehicle.type];
    if (Math.abs(this.vehicle.speed) > cls.maxSpeed * 0.7 && City.npcs.some(n => !n.dead && UTIL.dist(n, this.vehicle) < 3) && UTIL.chance(0.05)) {
      this.reportCrimeToPolice('conduite_dangereuse', 'Course-poursuite dangereuse près de piétons');
      this.wanted = Math.min(100, this.wanted + 8);
    }
    if (UTIL.dist(this.vehicle, { x: m.dropX, y: m.dropY }) < 3) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.courseState = null;
      RPJournal.log('Mission', `Course clandestine gagnée : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Vous franchissez la ligne en premier ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 2. Sabotage industriel : gardes patrouillant réellement, détection progressive.
  sabotageState: null,
  tickSabotage(m) {
    const guards = (m.guardIds || []).map(id => City.npcs.find(n => n.id === id)).filter(n => n && !n.dead);
    // Patrouille : chaque garde va-et-vient entre ses deux points de passage.
    guards.forEach(g => {
      if (!g.patrol) return;
      const target = g.patrol[g.patrolIdx || 0];
      if (UTIL.dist(g, target) < 1) { g.patrolIdx = ((g.patrolIdx || 0) + 1) % g.patrol.length; }
      else {
        const dx = Math.sign(target.x - g.x), dy = Math.sign(target.y - g.y);
        const nx = g.x + dx, ny = g.y + dy;
        if (nx >= 0 && ny >= 0 && nx < City.W && ny < City.H && !City.isSolid(nx, ny)) { g.x = nx; g.y = ny; }
      }
    });
    if (this.sabotageState?.combat) {
      const squad = guards.filter(g => UTIL.dist(g, this) < 14);
      if (!squad.length || !guards.length) { this.sabotageState.combat = false; announce('Les gardes ne vous poursuivent plus.', 'polite'); return; }
      if (!this.missionCombatTick('sabotage')) return;
      squad.forEach(g => {
        const d = UTIL.dist(g, this);
        const weapon = WEAPON_CATALOG[g.weapon];
        // Chance de tir remontée (voir missionCombatTick) : trop rare avant.
        if (weapon && UTIL.chance(Math.max(0.1, 0.45 - d * 0.015))) this.resolveNpcShotAtPlayer(g, weapon, d, 14);
      });
      return;
    }
    // Détection : chance croissante à mesure qu'un garde s'approche.
    guards.forEach(g => {
      const d = UTIL.dist(g, this);
      if (d < 6 && UTIL.chance(Math.max(0, (6 - d) * 0.03))) {
        announce(`${g.name} vous repère ! L'alarme se déclenche.`, 'assertive');
        this.reportCrimeToPolice('intrusion', 'Intrusion détectée sur un site industriel');
        this.sabotageState = { missionId: m.id, combat: true };
        // Réplique hostile AVANT le premier tir (pas seulement pendant
        // l'échange, voir resolveNpcShotAtPlayer).
        this.npcVoiceReaction(g.x, g.y, { group: 'enerve', count: 1, radius: 14 });
      }
    });
    if (UTIL.dist({ x: this.x, y: this.y }, { x: m.objectiveX, y: m.objectiveY }) < 2 && !this.sabotageState?.combat) {
      const amount = m.reward;
      this.dirtyMoney += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, true);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      this.sabotageState = null;
      RPJournal.log('Mission', `Sabotage réussi sans être repéré : ${UTIL.formatMoney(amount)}.`, 'alert');
      announce(`Objectif atteint sans être repéré ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
    }
  },

  // 3. Chasse aux primes : capturer vivant, menotter, transporter (réutilise
  // le système existant : verrouillage, U pour menotter, P pour faire suivre).
  bountyState: null,
  tickChassePrimes(m) {
    const fugitive = City.npcs.find(n => n.id === m.fugitiveId);
    if (!fugitive) { this.activeMission = null; this.bountyState = null; return; }
    if (fugitive.dead && !fugitive.subdued) {
      announce(`${fugitive.name} est mort : la prime exige une capture vivante. Mission échouée.`, 'assertive');
      this.activeMission = null; this.bountyState = null;
      return;
    }
    if (!this.bountyState) {
      if (fugitive.menotte && fugitive.follow) {
        const station = City.pois.filter(p => p.type === 'police').sort((a, b) => UTIL.dist(a, this) - UTIL.dist(b, this))[0];
        this.bountyState = { missionId: m.id, fugitiveId: fugitive.id, stationX: station?.x, stationY: station?.y, stationName: station?.name || 'un commissariat' };
        const dir = station ? UTIL.bearing(station.x - this.x, station.y - this.y) : '';
        const dist = station ? Math.round(UTIL.dist(station, this) * CONFIG.METERS_PER_TILE) : 0;
        announce(`${fugitive.name} est maîtrisé et vous suit. Emmenez-le vivant à ${this.bountyState.stationName}, vers le ${dir}, à ${dist} mètres.`, 'assertive');
      }
      return;
    }
    if (UTIL.dist(this, { x: this.bountyState.stationX, y: this.bountyState.stationY }) < 3 && fugitive.menotte) {
      const amount = m.reward;
      this.money += amount; Audio.cash();
      this.reportMissionReward(m.type, amount, false);
      m.completed = true; this.activeMission = null; this.completedMissions.push(m.id);
      fugitive.dead = true; fugitive.x = -999; fugitive.follow = false;
      this.bountyState = null;
      RPJournal.log('Mission', `Prime capturée vivante : ${UTIL.formatMoney(amount)}.`, 'info');
      announce(`${fugitive.name} est remis vivant à la police ! Vous touchez ${UTIL.formatMoney(amount)}.`, 'assertive');
      updateHud();
      return;
    }
    if (Math.random() < 0.004) {
      if (UTIL.chance(0.4)) {
        fugitive.menotte = false; fugitive.follow = false;
        this.bountyState = null;
        announce(`${fugitive.name} profite d'un instant d'inattention et s'échappe !`, 'assertive');
      } else {
        announce(`${fugitive.name} tente de s'échapper, mais vous le rattrapez.`, 'polite');
      }
    }
  },

});
