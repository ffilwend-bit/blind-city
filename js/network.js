const Net = {
  ws: null, connected: false, id: null, wasBanned: false,
  remotePlayers: new Map(),
  accountUsername: null, pendingAccountCallback: null,
  register(payload, cb) {
    this.pendingAccountCallback = cb;
    this.send({ type: 'register', ...payload });
  },
  login(username, password, cb) {
    this.pendingAccountCallback = cb;
    this.send({ type: 'login', username, password });
  },
  getSecurityQuestion(username, cb) {
    this.pendingAccountCallback = cb;
    this.send({ type: 'get_security_question', username });
  },
  resetPassword(username, answer, newPassword, cb) {
    this.pendingAccountCallback = cb;
    this.send({ type: 'reset_password', username, answer, newPassword });
  },
  saveProgressToServer(data) {
    if (!this.connected || !this.accountUsername) return;
    this.send({ type: 'save_progress', username: this.accountUsername, data });
  },
  connect(url, onReady, onFail) {
    let settled = false;
    let socket;
    try { socket = new WebSocket(url); } catch (e) { onFail(); return; }
    this.ws = socket;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; try { socket.close(); } catch (e) {} onFail(); }
    }, 6000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', firstName: Game.player.firstName, lastName: Game.player.lastName, gender: Game.player.gender }));
    });
    socket.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'welcome' && !settled) {
        settled = true; clearTimeout(timeout);
        this.connected = true; this.id = msg.id; this.wasBanned = false;
        (msg.players || []).forEach(p => this.remotePlayers.set(p.id, p));
        this.pendingCityEdits = msg.cityEdits || [];
        this.pendingWorldEdits = msg.worldEdits || [];
        Game.newsArticles = msg.news || [];
        City.morgue = msg.morgue || [];
        City.graves = msg.graves || [];
        // Météo déjà en cours sur ce serveur : appliquée silencieusement (ce
        // n'est pas un "changement" pour ce joueur qui vient d'arriver, juste
        // l'état actuel qu'il découvre en rejoignant).
        if (msg.weather && typeof Weather !== 'undefined') Weather.applyState(msg.weather, false);
        // Cycle jour/nuit déjà en cours sur ce serveur : appliqué
        // silencieusement, comme la météo (ce n'est pas un "changement" pour
        // ce joueur qui vient d'arriver, juste l'état actuel du monde).
        if (msg.dayPhase && typeof DayNight !== 'undefined') DayNight.applyState(msg.dayPhase, msg.gameHour, false);
        const displayId = msg.id.replace(/^p/, '');
        setTimeout(() => announce(`Votre identifiant de connexion est le ${displayId}. Communiquez-le à votre équipe pour les missions à IDs. Il change à chaque reconnexion.`, 'polite'), 4000);
        onReady(msg.seed);
      }
      this.handleMessage(msg);
    });
    socket.addEventListener('close', () => {
      if (!settled) { settled = true; clearTimeout(timeout); onFail(); }
      else if (this.connected) {
        this.connected = false;
        if (!this.wasBanned) announce('Connexion au serveur perdue. Vous continuez en solo sur cet appareil.', 'assertive');
        ProxVoice.stopAll(); TalkieVoice.stopAll(); VoiceChat.stop();
      }
    });
    socket.addEventListener('error', () => {
      if (!settled) { settled = true; clearTimeout(timeout); onFail(); }
    });
  },
  send(msg) { if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify(msg)); } catch (e) {} } },
  handleMessage(msg) {
    if (msg.type === 'weather_change') {
      Weather.applyState(msg.state, true);
    } else if (msg.type === 'daynight_change') {
      DayNight.applyState(msg.phase, msg.hour, true);
    } else if (msg.type === 'dial_result') {
      if (this._pendingDialCallback) { const cb = this._pendingDialCallback; this._pendingDialCallback = null; cb(msg); }
      if (!msg.ok) announce(msg.reason || 'Numéro injoignable.', 'assertive');
    } else if (msg.type === 'sms_result') {
      if (this._pendingSmsCallback) { const cb = this._pendingSmsCallback; this._pendingSmsCallback = null; cb(msg); }
      if (!msg.ok) announce(msg.reason || 'Message non envoyé.', 'assertive');
    } else if (msg.type === 'sms_receive') {
      const d = new Date(); const time = d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
      Phone.messages.push({ from: msg.fromName, fromId: msg.fromId, text: msg.text, time });
      if (typeof Phone.renderMessages === 'function') Phone.renderMessages();
      AudioLib.playNotification();
      announce(`Nouveau message de ${msg.fromName} : ${msg.text}`, 'assertive');
    } else if (msg.type === 'police_promoted') {
      Game.policeRank = msg.rank;
      announce(`${msg.byName} vous nomme ${POLICE_RANKS[msg.rank]?.name || msg.rank}.`, 'assertive');
      updateHud();
    } else if (msg.type === 'recruiter_appointed') {
      Roles.recruiters[msg.role] = Roles.recruiters[msg.role] || [];
      const myName = `${Game.player.firstName} ${Game.player.lastName}`;
      if (!Roles.recruiters[msg.role].includes(myName)) Roles.recruiters[msg.role].push(myName);
      announce(`${msg.byName} vous nomme recruteur pour le métier « ${msg.roleName || msg.role} ». Vous pouvez désormais valider les candidatures de ce métier.`, 'assertive');
    } else if (msg.type === 'player_treated') {
      Game.heal(msg.healthGain);
      announce(`${msg.byName} vous a soigné(e). Santé +${msg.healthGain}%.`, 'assertive');
    } else if (msg.type === 'ammo_received') {
      Game.ammoReserve[msg.ammoType] = (Game.ammoReserve[msg.ammoType] || 0) + msg.qty;
      announce(`${msg.fromName} vous donne ${msg.qty} ${(AMMO_CATALOG[msg.ammoType]?.name || msg.ammoType).toLowerCase()} en réserve. Rechargez (R) pour les charger dans votre arme.`, 'assertive');
      updateHud();
    } else if (msg.type === 'you_are_cuffed') {
      Game.isCuffed = !!msg.cuffed;
      announce(msg.cuffed ? `${msg.byName} vous menotte. Vous ne pouvez plus vous déplacer ni agir.` : `${msg.byName} vous démenotte.`, 'assertive');
      updateHud();
    } else if (msg.type === 'you_are_jailed') {
      Game.jailed = !!msg.jailed;
      if (Game.jailed) {
        Game.jailedAt = Date.now();
      } else if (Game.jailedAt) {
        // Peine purgée : inscrite au casier avec sa vraie durée, pour "peines
        // purgées" — le niveau de recherche (wanted), lui, ne garde aucune trace.
        Game.criminalRecord.push({ kind: 'incarceration', detail: 'Peine purgée en cellule', time: Date.now(), durationMs: Date.now() - Game.jailedAt });
        Game.jailedAt = null;
      }
      announce(msg.jailed ? `${msg.byName} vous enferme en cellule. Vous ne pouvez plus sortir tant qu'un policier ne vous libère pas.` : `${msg.byName} vous libère de votre cellule.`, 'assertive');
      updateHud();
    } else if (msg.type === 'money_received') {
      Game.money += msg.amount;
      Audio.cash();
      announce(`${msg.fromName} vous donne ${UTIL.formatMoney(msg.amount)} en liquide.`, 'assertive');
      updateHud();
    } else if (msg.type === 'share_gps') {
      // Quelqu'un partage sa position GPS : on propose le guidage automatique
      // en direct jusqu'à lui.
      AudioLib.playNotification();
      AccessibleConfirm.open(`${msg.fromName} partage sa position GPS`, `Vous faire guider automatiquement, à la voix, jusqu'à ${msg.fromName} ?`, (acc) => {
        if (acc) Game.followPlayerGPS(msg.fromId, msg.fromName);
        else announce('Guidage refusé.', 'polite');
      });
    } else if (msg.type === 'mission_invite') {
      // Invitation à rejoindre une mission extrême jouable seul (voir
      // Game.inviteToMission) : simple toggle accepter/refuser, rien n'est
      // imposé. En acceptant, on est guidé jusqu'au point de rendez-vous ET
      // on renvoie sa propre position à l'inviteur (partage réciproque),
      // pour que chacun puisse suivre l'autre — utile en véhicules séparés.
      AudioLib.playNotification();
      AccessibleConfirm.open(`${msg.fromName} vous invite sur une mission`, `${msg.fromName} vous invite à rejoindre « ${msg.missionTitle} ». Vous faire guider automatiquement jusqu'au point de rendez-vous ? Votre position sera aussi envoyée à ${msg.fromName} pour qu'il ou elle puisse vous suivre.`, (acc) => {
        if (acc) {
          Game.setGuidance({ name: msg.missionTitle, x: msg.x, y: msg.y });
          announce(`Guidage activé vers ${msg.missionTitle}.`, 'assertive');
          if (msg.fromId) Net.send({ type: 'share_gps', targetId: msg.fromId });
        } else {
          announce('Invitation refusée.', 'polite');
        }
      });
    } else if (msg.type === 'crime_alert') {
      Game.onCrimeAlert(msg.kind, msg.detail, msg.x, msg.y);
    } else if (msg.type === 'criminal_record_request') {
      // Un policier demande à consulter mon casier : je réponds avec un
      // résumé (pas le détail brut, comme la fouille d'inventaire).
      Net.send({ type: 'criminal_record_data', targetId: msg.fromId, data: Game.summarizeCriminalRecord() });
    } else if (msg.type === 'criminal_record_data') {
      Game.showCriminalRecord(msg.fromId, msg.data);
    } else if (msg.type === 'death_state') {
      // Liste partagée des défunts : à la morgue (en attente) et enterrés.
      City.morgue = msg.morgue || [];
      City.graves = msg.graves || [];
    } else if (msg.type === 'ticket_received') {
      const ticketId = 'pv_' + Date.now();
      Game.tickets.push({ id: ticketId, amount: msg.amount, reason: msg.reason, time: Date.now(), from: msg.byName });
      Game.finesHistory.unshift({ type: 'pv', id: ticketId, amount: msg.amount, reason: msg.reason, from: msg.byName, time: Date.now(), paid: false, paidAt: null });
      announce(`${msg.byName} vous donne un PV pour ${msg.reason}. Montant : ${UTIL.formatMoney(msg.amount)}. Payez-le avec Ctrl+P.`, 'assertive');
      updateHud();
    } else if (msg.type === 'legal_negotiation') {
      // Pas de décision forcée ici : le policier va d'abord VRAIMENT parler
      // avec l'avocat via son micro de proximité, puis décidera quand il
      // sera prêt, depuis son menu police.
      Game.pendingNegotiations = Game.pendingNegotiations || [];
      Game.pendingNegotiations.push({ lawyerId: msg.fromId, lawyerName: msg.fromName, clientId: msg.clientId, clientName: msg.clientName });
      AudioLib.playNotification();
      if (!Game.voiceOpen) toggleProxVoice(); // active le micro du policier automatiquement
      announce(`${msg.fromName} (avocat) souhaite négocier pour ${msg.clientName}. Parlez-en avec votre micro (V), puis décidez depuis votre menu police quand vous êtes prêt.`, 'assertive');
    } else if (msg.type === 'legal_negotiation_result') {
      if (msg.isClient && msg.accepted && Game.tickets.length) {
        // Réduit le PV le plus récent — représente la faveur obtenue par l'avocat.
        Game.tickets.pop();
        announce(`${msg.byName} accepte la négociation : un de vos PV est annulé.`, 'assertive');
      } else {
        announce(`${msg.byName} ${msg.accepted ? 'accepte' : 'refuse'} la négociation${msg.isClient ? ' pour votre client' : ''}.`, 'assertive');
      }
      updateHud();
    } else if (msg.type === 'news_published') {
      Game.newsArticles = Game.newsArticles || [];
      Game.newsArticles.unshift(msg.article);
      AudioLib.playNotification();
      announce(`Nouvelle info publiée par ${msg.article.author} : ${msg.article.title}. Consultez l'application Actualités.`, 'polite');
    } else if (msg.type === 'house_sale_offer') {
      AudioLib.playNotification();
      AccessibleConfirm.open(`${msg.fromName} vous propose ${msg.houseName}`, `Prix : ${UTIL.formatMoney(msg.price)}. Acheter ?`, (accepted) => {
        if (accepted && Game.money < msg.price) { announce('Fonds insuffisants pour cet achat.', 'assertive'); accepted = false; }
        if (accepted) {
          Game.money -= msg.price;
          if (!Game.ownedHouses.includes(msg.houseId)) Game.ownedHouses.push(msg.houseId);
          const h = City.houses.find(h => h.id === msg.houseId);
          if (h) { h.owner = 'player'; Game.registerOwnedProperty('maison', h); }
          sendWorldEdit('house_owner', { id: msg.houseId, owner: 'player' });
          announce(`Vous achetez ${msg.houseName} pour ${UTIL.formatMoney(msg.price)}.`, 'assertive');
          updateHud();
        } else {
          announce('Offre refusée.', 'polite');
        }
        Net.send({ type: 'house_sale_response', targetId: msg.fromId, accepted, houseId: msg.houseId });
      });
    } else if (msg.type === 'house_sale_response' || msg.type === 'vehicle_sale_response') {
      announce(msg.accepted ? `${msg.byName} accepte votre offre de vente. La vente est conclue.` : `${msg.byName} refuse votre offre de vente.`, 'assertive');
    } else if (msg.type === 'vehicle_sale_offer') {
      AudioLib.playNotification();
      AccessibleConfirm.open(`${msg.fromName} vous propose ${msg.vehicleName}`, `Prix : ${UTIL.formatMoney(msg.price)}. Acheter ?`, (accepted) => {
        if (accepted && Game.money < msg.price) { announce('Fonds insuffisants pour cet achat.', 'assertive'); accepted = false; }
        if (accepted) {
          Game.money -= msg.price;
          const cls = VEHICLE_CATALOG[msg.vehicleType];
          const nv = { id: 'owned_' + Date.now(), type: msg.vehicleType, name: msg.vehicleName, x: Game.x + 1, y: Game.y + 1, fuel: 1, hp: 100, locked: false, owner: 'player', ownerName: `${Game.player.firstName} ${Game.player.lastName}`, inventory: [], auto: false, altitude: 0, speed: 0, heading: 0, autoDest: null, price: msg.price, trunk: cls?.trunk };
          City.vehicles.push(nv); Game.ownedVehicles.push(nv.id);
          sendWorldEdit('vehicle_create', nv);
          announce(`Vous achetez ${msg.vehicleName} pour ${UTIL.formatMoney(msg.price)}.`, 'assertive');
          updateHud();
        } else {
          announce('Offre refusée.', 'polite');
        }
        Net.send({ type: 'vehicle_sale_response', targetId: msg.fromId, accepted });
      });
    } else if (msg.type === 'taxi_request') {
      Game.pendingRides = Game.pendingRides || [];
      Game.pendingRides.push({ passengerId: msg.passengerId, passengerName: msg.passengerName, x: msg.x, y: msg.y });
      AudioLib.playNotification();
      announce(`${msg.passengerName} demande un taxi, à ${Math.round(UTIL.dist(msg, Game) * CONFIG.METERS_PER_TILE)} mètres. Consultez votre menu chauffeur pour accepter.`, 'assertive');
    } else if (msg.type === 'taxi_accept') {
      announce(`${msg.byName} accepte votre course et arrive.`, 'assertive');
    } else if (msg.type === 'mechanic_request') {
      Game.pendingCallouts = Game.pendingCallouts || [];
      Game.pendingCallouts.push({ clientId: msg.clientId, clientName: msg.clientName, x: msg.x, y: msg.y, vehicleName: msg.vehicleName });
      AudioLib.playNotification();
      announce(`${msg.clientName} demande un dépannage pour ${msg.vehicleName}, à ${Math.round(UTIL.dist(msg, Game) * CONFIG.METERS_PER_TILE)} mètres. Consultez votre menu garagiste pour accepter.`, 'assertive');
    } else if (msg.type === 'mechanic_accept') {
      announce(`${msg.byName} accepte votre dépannage et arrive.`, 'assertive');
    } else if (msg.type === 'invoice_received') {
      const billId = 'facture_' + Date.now();
      Game.pendingBills.push({ id: billId, from: msg.fromName, fromId: msg.fromId, amount: msg.amount, reason: msg.reason, time: Date.now() });
      Game.finesHistory.unshift({ type: 'facture', id: billId, amount: msg.amount, reason: msg.reason, from: msg.fromName, time: Date.now(), paid: false, paidAt: null });
      announce(`${msg.fromName} vous envoie une facture de ${UTIL.formatMoney(msg.amount)} pour ${msg.reason}. Consultez "Mes factures" dans le menu principal pour payer.`, 'assertive');
    } else if (msg.type === 'invoice_paid_notice') {
      Game.bank += msg.amount;
      Audio.cash();
      announce(`${msg.byName} vous a payé ${UTIL.formatMoney(msg.amount)} par virement bancaire.`, 'assertive');
      updateHud();
    } else if (msg.type === 'you_are_carried') {
      Game.carriedByRemote = { id: msg.byId, name: msg.byName };
      announce(`${msg.byName} vous porte. Vous ne pouvez plus agir tant que vous n'êtes pas relâché(e).`, 'assertive');
    } else if (msg.type === 'you_are_released') {
      Game.carriedByRemote = null;
      if (msg.atHospital) Game.wakeAtHospital(msg.byName);
      else announce(`${msg.byName} vous dépose ici. Vous restez inconscient(e).`, 'polite');
    } else if (msg.type === 'player_hit') {
      Game.takeDamage(msg.damage, { headshot: !!msg.headshot });
      announce(`${msg.fromName} vous touche ! ${msg.damage} dégâts.`, 'assertive');
    } else if (msg.type === 'player_punch') {
      Game.takeDamage(msg.damage, {});
      announce(`${msg.fromName} vous frappe ! ${msg.damage} dégâts.`, 'assertive');
    } else if (msg.type === 'assist_wake') {
      if (Game.unconscious) Game.wakeAtHospital(msg.fromName);
    } else if (msg.type === 'staff_pending_accounts') {
      if (this._pendingAccountsCallback) this._pendingAccountsCallback(msg.accounts || []);
    } else if (msg.type === 'staff_job_requests') {
      if (this._jobRequestsCallback) this._jobRequestsCallback(msg.requests || []);
    } else if (msg.type === 'staff_inspect_query') {
      // Un membre du staff demande à voir notre inventaire/véhicules/argent :
      // le serveur ne connaît pas ces données (gérées côté client), donc c'est
      // nous qui répondons directement avec notre propre état.
      this.send({
        type: 'staff_inspect_response', requesterId: msg.requesterId,
        data: {
          x: Game.x, y: Game.y,
          inventory: (Game.inventory || []).map(i => `${i.q || 1} ${i.name}`),
          money: Game.money, bank: Game.bank,
          ownedVehicles: (Game.ownedVehicles || []).map(id => { const v = City.vehicles.find(vv => vv.id === id); return v ? v.name : id; }),
          role: Game.role || 'aucun',
        },
      });
    } else if (msg.type === 'staff_inspect_result') {
      if (this._inspectCallback) this._inspectCallback(msg);
    } else if (msg.type === 'staff_job_request_alert') {
      // Sans ça, une candidature de métier n'apparaissait que dans le journal
      // staff silencieux (jamais annoncé) : un admin ne la découvrait que s'il
      // allait le consulter de lui-même — d'où les demandes qui semblaient
      // ne jamais arriver.
      announce(`${msg.name} demande le métier « ${msg.roleName} ». Menu staff pour approuver ou refuser.`, 'assertive');
    } else if (msg.type === 'staff_job_review_result') {
      announce(`${msg.name} : métier « ${msg.roleName} » ${msg.approved ? 'accordé' : 'refusé'}.`, 'assertive');
    } else if (msg.type === 'job_granted') {
      Roles.pending = null;
      Roles.set(msg.role);
      announce(`${msg.byName} vous accorde le métier ${msg.roleName || (Roles.list[msg.role] && Roles.list[msg.role].name) || msg.role}.`, 'assertive');
    } else if (msg.type === 'job_rejected') {
      Roles.pending = null;
      announce(`Votre demande de métier « ${msg.roleName} » a été refusée par ${msg.byName}.`, 'assertive');
    } else if (msg.type === 'staff_review_result') {
      announce(`Compte @${msg.username} : ${msg.status === 'approved' ? 'approuvé' : 'rejeté'}.`, 'assertive');
    } else if (msg.type === 'register_result' || msg.type === 'login_result' || msg.type === 'security_question_result' || msg.type === 'reset_password_result') {
      if (msg.ok && msg.username) this.accountUsername = msg.username;
      if (this.pendingAccountCallback) { const cb = this.pendingAccountCallback; this.pendingAccountCallback = null; cb(msg); }
    } else if (msg.type === 'world') {
      this.remotePlayers.clear();
      (msg.players || []).forEach(p => this.remotePlayers.set(p.id, p));
    } else if (msg.type === 'player_joined') {
      announce(`${msg.name} rejoint la ville.`, 'polite');
    } else if (msg.type === 'player_left') {
      announce(`${msg.name} a quitté la ville.`, 'polite');
      this.remotePlayers.delete(msg.id);
    } else if (msg.type === 'chat') {
      const from = this.remotePlayers.get(msg.fromId);
      const d = from ? Math.round(UTIL.dist(from, Game) * CONFIG.METERS_PER_TILE) : null;
      speak(`${msg.fromName}${d !== null ? ', ' + d + ' mètres' : ''} dit : ${msg.text}`, 'polite');
      log(`💬 ${msg.fromName} : ${msg.text}`, 'chat');
    } else if (msg.type === 'rp_action') {
      // RP libre ("/me") : une ACTION narrée, pas une réplique — pas de "dit :".
      const from = this.remotePlayers.get(msg.fromId);
      const d = from ? Math.round(UTIL.dist(from, Game) * CONFIG.METERS_PER_TILE) : null;
      speak(`${msg.fromName}${d !== null ? ', ' + d + ' mètres' : ''} ${msg.text}`, 'polite');
      log(`🎭 ${msg.fromName} ${msg.text}`, 'chat');
    } else if (msg.type === 'world_sound') {
      Game.playRemoteSound(msg);
    } else if (msg.type === 'talkie_message') {
      speak(`Sur ${Number(msg.frequency).toFixed(3)} mégahertz, ${msg.fromName} dit : ${msg.text}`, 'polite');
      log(`📻 ${msg.fromName} (${Number(msg.frequency).toFixed(3)} MHz) : ${msg.text}`, 'talkie');
    } else if (msg.type === 'talkie_offer') {
      AudioLib.playNotification();
      AccessibleConfirm.open(`${msg.fromName} vous propose son talkie-walkie`, 'Pour régler la fréquence. Accepter ?', (acc) => {
        Net.send({ type: 'offer_response', targetId: msg.fromId, accepted: acc, kind: 'talkie', payload: msg.payload });
        announce(acc ? `Vous avez le talkie de ${msg.fromName}. Ouvrez le menu Talkie pour régler la fréquence, puis rendez-le-lui.` : 'Talkie refusé.', 'assertive');
      });
    } else if (msg.type === 'item_offer') {
      AudioLib.playNotification();
      const nom = msg.payload?.name || 'un objet';
      AccessibleConfirm.open(`${msg.fromName} vous propose : ${nom}${msg.payload?.q > 1 ? ' ×' + msg.payload.q : ''}`, 'Accepter ?', (acc) => {
        Net.send({ type: 'offer_response', targetId: msg.fromId, accepted: acc, kind: 'item', payload: msg.payload });
        if (acc) { Game.addItem({ ...msg.payload }); announce(`Vous recevez ${nom} de ${msg.fromName}.`, 'assertive'); }
        else announce('Objet refusé.', 'polite');
      });
    } else if (msg.type === 'offer_response') {
      if (msg.kind === 'talkie') {
        if (msg.accepted) announce(`${msg.fromName} accepte votre talkie et va composer la fréquence.`, 'assertive');
        else { Game.talkie.owned = true; announce(`${msg.fromName} refuse le talkie. Il vous revient.`, 'assertive'); }
      } else {
        if (msg.accepted) announce(`${msg.fromName} accepte votre don.`, 'polite');
        else { if (msg.payload) Game.addItem({ ...msg.payload }); announce(`${msg.fromName} refuse. L'objet vous revient.`, 'polite'); }
      }
    } else if (msg.type === 'call_offer') {
      Phone.receiveCallOffer(msg.callId, msg.fromId, msg.fromName, !!msg.masked);
    } else if (msg.type === 'number_received') {
      // Quelqu'un vous a envoyé son numéro : on l'enregistre pour pouvoir le
      // rappeler, et on l'ajoute aux contacts du téléphone.
      const remote = Net.remotePlayers.get(msg.fromId);
      Game.myContacts = Game.myContacts || [];
      const entry = { number: msg.number || null, username: remote?.accountUsername || null, label: msg.label };
      // Ni numéro ni compte identifiable (l'expéditeur s'est déconnecté entre
      // l'envoi et la réception) : impossible de jamais rappeler cette entrée,
      // elle ne doit pas apparaître dans les contacts.
      if (entry.number || entry.username) {
        // Sans numéro (msg.number absent), on dédoublonne par nom de compte : sinon
        // chaque message d'un même contact sans numéro créait un nouveau doublon.
        const i = Game.myContacts.findIndex(c => (msg.number && c.number === msg.number) || (!msg.number && entry.username && c.username === entry.username));
        if (i !== -1) Game.myContacts[i] = entry; else Game.myContacts.push(entry);
      }
      Phone.contacts = Phone.contacts || [];
      if (msg.number && !Phone.contacts.some(c => c.number === msg.number)) Phone.contacts.push({ id: 'recv_' + msg.number, name: msg.label, number: msg.number, role: 'citoyen' });
      AudioLib.playNotification();
      announce(`${msg.label} vous envoie son numéro : ${msg.number}. Enregistré dans vos contacts, vous pouvez le rappeler.`, 'assertive');
    } else if (msg.type === 'send_number_result') {
      if (msg.ok) announce(`Votre numéro a été envoyé à ${msg.targetName}.`, 'assertive');
      else announce('Numéro non envoyé : la cible n\'est plus joignable.', 'assertive');
    } else if (msg.type === 'find_number_result') {
      if (this._pendingFindNumberCallback) { const cb = this._pendingFindNumberCallback; this._pendingFindNumberCallback = null; cb(msg.results || [], msg.query); }
    } else if (msg.type === 'call_ringing') {
      Phone.onCallRinging(msg.callId, msg.targetName);
    } else if (msg.type === 'call_unavailable') {
      Phone.onCallUnavailable();
    } else if (msg.type === 'call_answered') {
      Phone.onCallAnswered(msg.callId, msg.byName);
    } else if (msg.type === 'call_declined') {
      Phone.onCallDeclined(msg.callId);
    } else if (msg.type === 'call_timeout') {
      Phone.onCallTimeout(msg.callId);
    } else if (msg.type === 'call_ended') {
      Phone.onCallEnded(msg.callId);
    } else if (msg.type === 'call_message') {
      Phone.onCallMessage(msg.callId, msg.fromName, msg.text);
    } else if (msg.type === 'rtc_offer') {
      VoiceChat.handleOffer(msg.callId, msg.data);
    } else if (msg.type === 'rtc_answer') {
      VoiceChat.handleAnswer(msg.callId, msg.data);
    } else if (msg.type === 'rtc_ice') {
      VoiceChat.handleIce(msg.callId, msg.data);
    } else if (msg.type === 'voice_toggle') {
      Phone.onPeerVoiceToggle(msg.callId, !!msg.on);
    // Bug corrigé : le ternaire précédent (talkie ? TalkieVoice : ProxVoice)
    // envoyait TOUT canal différent de 'talkie' à ProxVoice — y compris
    // 'music' (voir MusicVoice plus bas), dont les offres/réponses/ICE
    // atterrissaient donc sur le mauvais maillage. Au mieux la musique ne se
    // connectait jamais réellement (silencieuse chez les autres), au pire une
    // offre 'music' pouvait renégocier par erreur une connexion 'prox' déjà
    // établie avec ce même joueur (même peerId dans les deux maillages),
    // cassant potentiellement une voix de proximité qui fonctionnait. Table
    // de correspondance explicite pour que chaque canal aille au bon endroit,
    // et pour qu'un futur canal mal orthographié n'atterrisse plus nulle part
    // par erreur au lieu d'échouer silencieusement vers prox.
    } else if (msg.type === 'mesh_offer') {
      const mesh = { prox: ProxVoice, talkie: TalkieVoice, music: MusicVoice }[msg.channel];
      if (mesh) mesh.handleOffer(msg.fromId, msg.data);
    } else if (msg.type === 'mesh_answer') {
      const mesh = { prox: ProxVoice, talkie: TalkieVoice, music: MusicVoice }[msg.channel];
      if (mesh) mesh.handleAnswer(msg.fromId, msg.data);
    } else if (msg.type === 'mesh_ice') {
      const mesh = { prox: ProxVoice, talkie: TalkieVoice, music: MusicVoice }[msg.channel];
      if (mesh) mesh.handleIce(msg.fromId, msg.data);
    } else if (msg.type === 'staff_auth_result') {
      StaffMode.onAuthResult(!!msg.ok, msg.staffRole, !!msg.auto);
    } else if (msg.type === 'staff_log') {
      StaffMode.onLog(msg.text);
    } else if (msg.type === 'staff_error') {
      announce(msg.text || 'Action staff refusée.', 'assertive');
    } else if (msg.type === 'staff_code_changed') {
      announce(`Code administrateur "${msg.which}" changé avec succès.`, 'assertive');
    } else if (msg.type === 'staff_bans_list') {
      StaffMode.bansList = msg.bans || [];
      announce(`${StaffMode.bansList.length} bannissement(s) enregistré(s).`, 'polite');
    } else if (msg.type === 'search_request') {
      onSearchRequest(msg.fromId);
    } else if (msg.type === 'search_data') {
      onSearchData(msg.fromId, msg.data);
    } else if (msg.type === 'loot_take') {
      onLootTake(msg.data);
    } else if (msg.type === 'search_denied') {
      announce('Cette personne n\'a plus les mains levées.', 'assertive');
    } else if (msg.type === 'freed_from_vehicle') {
      onFreedFromVehicle(msg.fromName);
    } else if (msg.type === 'you_are_targeted') {
      onPlayerTargetedMe(msg.fromName);
    } else if (msg.type === 'city_edit') {
      applyCityEdit(msg.op, msg.payload);
    } else if (msg.type === 'world_edit') {
      applyWorldEdit(msg.op, msg.payload);
    } else if (msg.type === 'banned') {
      this.wasBanned = true;
      announce(`Vous avez été banni de ce serveur. Raison : ${msg.reason || 'non précisée'}.`, 'assertive');
    }
  },
  sendState() {
    if (!this.connected) return;
    // Portage physique réel : tant qu'on est porté par un autre joueur, notre
    // position suit la sienne (ou celle de son véhicule) au lieu d'être
    // contrôlée normalement — chaque client reste seul autorité sur sa propre
    // position, donc c'est ici, côté joueur porté, que ça doit se faire.
    if (Game.carriedByRemote) {
      const carrier = this.remotePlayers.get(Game.carriedByRemote.id);
      if (carrier) {
        if (carrier.inVehicle && carrier.vehicleName) {
          const v = City.vehicles.find(veh => veh.name === carrier.vehicleName && UTIL.dist(veh, carrier) < 3);
          if (v) { Game.x = v.x; Game.y = v.y; }
          else { Game.x = carrier.x; Game.y = carrier.y; }
        } else {
          Game.x = carrier.x; Game.y = carrier.y;
        }
      }
    }
    // Passager d'un autre joueur (taxi, covoiturage) : notre position suit celle
    // du chauffeur. S'il se déconnecte ou descend de son véhicule, on descend.
    if (Game.ridingWith && Game.ridingWith.id) {
      const driver = this.remotePlayers.get(Game.ridingWith.id);
      if (!driver || !driver.inVehicle) {
        const name = Game.ridingWith.name;
        Game.ridingWith = null;
        announce(`${name} n'est plus au volant. Vous descendez du véhicule.`, 'assertive');
      } else {
        Game.x = driver.x; Game.y = driver.y;
      }
    }
    this.send({
      type: 'state', x: Game.x, y: Game.y, heading: Game.heading, health: Game.health, hunger: Game.hunger, thirst: Game.thirst,
      role: Roles.current, policeRank: Game.policeRank, outfit: Game.outfit, inVehicle: Game.inVehicle, vehicleName: Game.vehicle?.name || null,
      // Type et vitesse du véhicule : permet à un PASSAGER (ridingWith, voir
      // plus haut) d'entendre le moteur de CE véhicule chez lui, en le
      // synthétisant localement d'après ces données (voir tickPassengerAudio).
      vehicleType: Game.vehicle?.type || null,
      vehicleSpeedRatio: (Game.vehicle && VEHICLE_CATALOG[Game.vehicle.type]) ? Math.abs(Game.vehicle.speed || 0) / VEHICLE_CATALOG[Game.vehicle.type].maxSpeed : 0,
      // Sirène allumée : permet aux autres clients de jouer le VRAI fichier
      // audio de sirène en boucle continue (voir Game.tickAmbientVehicles),
      // au lieu de le ré-émettre en son de synthèse court à intervalle
      // régulier (haché/coupé chez qui l'écoutait sans l'avoir activée).
      siren: !!(Game.vehicle && Game.vehicle.siren),
      talkieOn: Game.talkie.on, talkieFrequency: Game.talkie.frequency,
      convoy: (typeof Convoy !== 'undefined' ? Convoy.code : null),
      airplane: !!(typeof Phone !== 'undefined' && Phone.airplane),
      voiceOpen: !!Game.voiceOpen, handsUp: !!Game.handsUp, unconscious: !!Game.unconscious, isCuffed: !!Game.isCuffed, jailed: !!Game.jailed,
      stuckInVehicle: !!Game.stuckInVehicle,
    });
  },
  // Émet un son du monde (audible par les joueurs proches). Ponctuel et léger :
  // key = son à jouer ; opts.tone = son de synthèse (freq/dur) plutôt qu'un
  // fichier ; opts.vol = volume de base à la source (0..1).
  emitSound(key, opts = {}) {
    if (!this.connected) return;
    this.send({ type: 'world_sound', key, vol: opts.vol });
  },
  chat(text) { this.send({ type: 'chat', text }); },
  rpAction(text) { this.send({ type: 'rp_action', text }); },
  talkiePTT(text) { this.send({ type: 'talkie_ptt', text, frequency: Game.talkie.frequency }); },
  giveTalkieTo(targetId) { this.send({ type: 'talkie_give', targetId, payload: { frequency: Game.talkie.frequency } }); },
  giveItemTo(targetId, item) { this.send({ type: 'item_give', targetId, payload: item }); },
  callOffer(targetId, masked) { this.send({ type: 'call_offer', targetId, fromLabel: Game.activeCallerName(), masked: !!masked }); },
  sendNumber(targetId, number, label) { this.send({ type: 'send_number', targetId, number, label }); },
  findNumber(query, cb) { this._pendingFindNumberCallback = cb; this.send({ type: 'find_number', query }); },
  registerNumbers() {
    if (!this.connected || !Array.isArray(Game.phones)) return;
    this.send({ type: 'register_numbers', numbers: Game.phones });
  },
  dialNumber(number, cb, masked) {
    if (!this.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    this._pendingDialCallback = cb;
    this.send({ type: 'dial_number', number, fromLabel: Game.activeCallerName(), masked: !!masked });
  },
  smsSend(targetId, text, cb) {
    if (!this.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    this._pendingSmsCallback = cb;
    this.send({ type: 'sms_send', targetId, text, fromLabel: Game.activeCallerName() });
  },
  smsDial(number, text, cb) {
    if (!this.connected) return announce('Nécessite une connexion au serveur.', 'assertive');
    this._pendingSmsCallback = cb;
    this.send({ type: 'sms_dial', number, text, fromLabel: Game.activeCallerName() });
  },
  callAnswer(callId) { this.send({ type: 'call_answer', callId }); },
  callDecline(callId) { this.send({ type: 'call_decline', callId }); },
  callEnd(callId) { this.send({ type: 'call_end', callId }); },
  callMessage(callId, text) { this.send({ type: 'call_message', callId, text, fromLabel: Game.activeCallerName() }); },
};
window.Net = Net;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.ctx.resume();
    if ('speechSynthesis' in window && window.speechSynthesis.paused) window.speechSynthesis.resume();
  }
});

/* ============================================================
   DÉTECTION D'UN CLAVIER PHYSIQUE SUR MOBILE
   Si l'utilisateur tape sur une vraie touche (et pas seulement un tap
   tactile), on considère qu'un clavier Bluetooth/externe est branché :
   toutes les commandes Windows deviennent disponibles telles quelles.
============================================================ */
let physicalKeyboardDetected = false;
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
document.addEventListener('keydown', (e) => {
  if (physicalKeyboardDetected || !isTouchDevice) return; // sur un vrai ordinateur, inutile de "détecter" un clavier qu'on sait déjà présent
  // On ignore Tab/Entrée/Espace qui peuvent provenir d'un clavier virtuel de lecteur d'écran
  if (['Tab', 'Enter', ' '].includes(e.key)) return;
  // Taper une lettre au clavier virtuel d'un téléphone (avec VoiceOver/TalkBack
  // actif) déclenche aussi de vrais événements keydown — typiquement en
  // écrivant son identifiant de connexion. Sans cette vérification, l'annonce
  // ci-dessous se déclenchait à la première lettre tapée et parlait par-dessus
  // le retour vocal du lecteur d'écran pendant la saisie.
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  physicalKeyboardDetected = true;
  announce('Clavier détecté. Toutes les commandes Windows sont disponibles.', 'polite');
}, { once: false });

/* ============================================================
   BOUTONS TACTILES ACCESSIBLES SANS LECTEUR D'ÉCRAN SYSTÈME
   Le jeu a sa propre voix (speak()) : chaque bouton tactile annonce son
   nom au doigt posé, même si VoiceOver/TalkBack est désactivé.
============================================================ */
function announceTouchLabels() {
  document.querySelectorAll('.touch-btn, .app-icon, .menu-card').forEach(node => {
    if (node.dataset.voiceLabeled) return;
    node.dataset.voiceLabeled = '1';
    const label = node.getAttribute('aria-label') || node.querySelector('span, h4')?.textContent || node.textContent;
    node.addEventListener('touchstart', () => { if (label) speak(label.trim(), 'polite'); }, { passive: true });
  });
}

// Découpe un texte long en morceaux d'au plus `max` caractères, en coupant sur
// les fins de phrase — sur mobile, une seule longue utterance est souvent
// tronquée par le moteur vocal. Les morceaux sont ensuite enchaînés.
function _splitSpeech(text, max) {
  text = String(text == null ? '' : text);
  if (text.length <= max) return [text];
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const chunks = []; let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > max) { chunks.push(cur.trim()); cur = p; }
    else cur += p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}
// Lit une suite de morceaux : le suivant ne part qu'à la fin (onend) du
// précédent, pour une parole continue et fiable, sans troncature.
// `onAllDone` est appelé une fois TOUS les morceaux lus (sert à enchaîner sur
// la file d'annonces urgentes en attente, voir speak()).
function _speakChunks(chunks, onAllDone) {
  if (!('speechSynthesis' in window)) { if (onAllDone) onAllDone(); return; }
  const synth = window.speechSynthesis;
  let i = 0;
  const next = () => {
    if (i >= chunks.length) { if (onAllDone) onAllDone(); return; }
    const u = new SpeechSynthesisUtterance(chunks[i]);
    u.lang = 'fr-FR'; u.rate = CONFIG.SPEECH_RATE; u.pitch = CONFIG.SPEECH_PITCH;
    u.onend = () => { i++; next(); };
    u.onerror = () => { i++; next(); };
    synth.speak(u);
  };
  next();
}
// File d'attente des annonces URGENTES ('assertive') encore à lire, et
// priorité de ce qui est en train d'être parlé actuellement. Avant, une
// nouvelle annonce assertive coupait TOUJOURS celle en cours — en combat,
// où les événements s'enchaînent vite (dégâts, arme enrayée, alertes...),
// chaque annonce coupait la précédente au milieu d'un mot : on ne comprenait
// plus rien, et on n'entendait jamais une phrase entière. Désormais, une
// annonce assertive n'interrompt que du contenu 'polite' (routine) ; si une
// autre annonce importante est déjà en cours, elle attend son tour (limitée
// à 3 en attente, pour ne pas prendre un retard interminable en rafale).
let _assertiveQueue = []; // éléments : { chunks, tag }
let _currentSpeakPriority = null;
// Catégorie (tag) de l'annonce en train d'être lue actuellement (ex :
// 'guidance', 'obstacle') — voir _enqueueUrgent/speak plus bas : sert à
// remplacer une annonce devenue obsolète de la MÊME catégorie plutôt que de
// s'empiler derrière elle.
let _currentSpeakTag = null;
function _playNextAssertive() {
  if (!_assertiveQueue.length) { _currentSpeakPriority = null; _currentSpeakTag = null; return; }
  const entry = _assertiveQueue.shift();
  _currentSpeakPriority = 'assertive';
  _currentSpeakTag = entry.tag || null;
  _speakChunks(entry.chunks, _playNextAssertive);
}
// Une annonce 'combat' (on vous tire dessus, on vous vise, cible verrouillée)
// passe devant toute annonce 'assertive' déjà en file (santé/faim, etc.) sans
// jamais couper une annonce déjà en train d'être lue — sinon, en plein
// échange de tirs, l'info vitale ("on vous vise !") pouvait rester coincée
// derrière des annonces bien moins urgentes déjà en attente.
function _enqueueUrgent(chunks, isCombat, tag) {
  // Une nouvelle annonce d'une catégorie (tag) donnée remplace toute annonce
  // de cette même catégorie déjà en attente : sinon, quand la situation
  // change vite et souvent (ex : instruction de conduite qui change sans
  // arrêt, avertissement d'obstacle répété), la file s'engorge d'annonces
  // devenues périmées qui continuent à être lues bien après coup ("mur, mur,
  // mur" répété alors qu'on ne cogne plus le mur).
  if (tag) _assertiveQueue = _assertiveQueue.filter(e => e.tag !== tag);
  const entry = { chunks, tag: tag || null };
  if (isCombat) {
    if (_assertiveQueue.length >= 3) _assertiveQueue.pop(); // retire la moins prioritaire en fin de file
    _assertiveQueue.unshift(entry);
  } else {
    if (_assertiveQueue.length >= 3) _assertiveQueue.shift(); // garde les annonces 'assertive' les plus récentes
    _assertiveQueue.push(entry);
  }
}
function speak(text, priority = 'polite', opts = {}) {
  const tag = opts && opts.tag ? opts.tag : null;
  if ('speechSynthesis' in window) {
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    // Quatre niveaux de priorité :
    // - 'interrupt' : navigation dans les menus. Coupe TOUT immédiatement (y
    //   compris la file d'annonces urgentes en attente) et parle sans le
    //   moindre délai, pour que chaque flèche lise l'élément suivant
    //   instantanément.
    // - 'combat' : danger IMMÉDIAT et déterminant pour la survie (on vous
    //   vise, on vous tire dessus, cible verrouillée). Comme 'assertive',
    //   n'interrompt jamais une autre annonce urgente déjà en train d'être
    //   lue — mais passe DEVANT toute annonce 'assertive' moins critique déjà
    //   en attente (santé/faim...), pour ne jamais rester coincée derrière
    //   pendant un échange de tirs.
    // - 'assertive' : information urgente (danger, alerte). Coupe une
    //   annonce 'polite' (routine) en cours, mais n'interrompt PLUS une
    //   autre annonce urgente déjà en train d'être lue — elle attend son
    //   tour (file plafonnée à 3), pour qu'une rafale d'événements en combat
    //   ne rende plus chaque phrase incompréhensible en la coupant au milieu.
    // - 'polite' : routine (déplacement...). Ne coupe rien, pour ne pas
    //   hacher la parole quand les annonces s'enchaînent vite.
    if (priority === 'polite' && busy) {
      const a = el('announcerPolite'); if (a) { a.textContent = ''; a.textContent = text; }
      return;
    }
    // Textes longs découpés en phrases enchaînées (fiabilité mobile).
    const chunks = _splitSpeech(text, 180);
    if (priority === 'interrupt') {
      // Instantané, sans setTimeout : indispensable pour une navigation fluide.
      try { synth.cancel(); } catch (e) { /* ignore */ }
      _assertiveQueue = [];
      _currentSpeakPriority = 'interrupt';
      _currentSpeakTag = null;
      _speakChunks(chunks, () => { _currentSpeakPriority = null; _currentSpeakTag = null; _playNextAssertive(); });
    } else if (priority === 'assertive' || priority === 'combat') {
      // Une annonce porteuse d'un tag (catégorie) qui correspond à celle
      // actuellement en train d'être lue est devenue OBSOLÈTE par
      // définition (ex : nouvelle instruction de virage qui remplace la
      // précédente, nouvel avertissement d'obstacle) : on la coupe pour
      // parler la nouvelle tout de suite, plutôt que d'attendre la fin
      // d'une phrase déjà périmée — "il faut que les actions puissent
      // s'interrompre".
      if (tag && busy && _currentSpeakTag === tag) {
        try { synth.cancel(); } catch (e) { /* ignore */ }
        _assertiveQueue = _assertiveQueue.filter(e => e.tag !== tag);
        _currentSpeakPriority = priority;
        _currentSpeakTag = tag;
        _speakChunks(chunks, _playNextAssertive);
      } else if (busy && (_currentSpeakPriority === 'assertive' || _currentSpeakPriority === 'interrupt' || _currentSpeakPriority === 'combat')) {
        _enqueueUrgent(chunks, priority === 'combat', tag);
      } else {
        try { synth.cancel(); } catch (e) { /* ignore */ } // coupe une annonce 'polite' en cours, elle
        _currentSpeakPriority = priority;
        _currentSpeakTag = tag;
        _speakChunks(chunks, _playNextAssertive);
      }
    } else {
      _speakChunks(chunks);
    }
  }
  const a = priority === 'polite' ? el('announcerPolite') : el('announcer');
  if (a) { a.textContent = ''; a.textContent = text; }
}
function announce(text, priority, opts) { log(text, 'system'); speak(text, priority, opts); }
function alertUser(text) { log(text, 'damage'); speak(text, 'assertive'); }
function updateHud() {
  // Purement de l'affichage : un seul élément HUD manquant (contexte
  // dégradé, test isolé...) ne doit jamais faire planter la logique de jeu
  // qui appelle updateHud() partout.
  try { _updateHudInner(); } catch (e) { console.error('updateHud a échoué :', e); }
}
function _updateHudInner() {
  el('hudMoney').textContent = UTIL.formatMoney(Game.money);
  el('hudBank').textContent = UTIL.formatMoney(Game.bank);
  el('hudDirty').textContent = UTIL.formatMoney(Game.dirtyMoney);
  el('hudInv').textContent = Game.inventory.length ? `${Game.inventory.reduce((a, b) => a + (b.q || 1), 0)} objets` : 'vide';
  el('hudPos').textContent = Game.getDistrictName();
  el('hudHealth').textContent = Math.round(Game.health) + '%';
  el('hudHealth').className = Game.health < 30 ? 'alert' : '';
  el('hudMission').textContent = Game.activeMission ? Game.activeMission.title : 'aucune';
  el('modeStatus').textContent = Game.inVehicle ? Game.vehicle?.label || 'véhicule' : 'à pied';
  el('vehStatus').textContent = Game.vehicle ? Game.vehicle.name + (Game.vehicle.auto ? ' (auto)' : ' (manuel)') : 'aucun';
  { const hd = Game.headingToDelta(Game.heading); el('compassStatus').textContent = UTIL.bearing(hd.dx, hd.dy); }
  el('altStatus').textContent = Math.round(Game.altitude) + ' m';
  el('weaponStatus').textContent = Game.weaponOut ? (Game.weapon?.label || 'aucune') : 'rangée';
  el('targetStatus').textContent = Game.lockedTarget ? Game.lockedTarget.name : 'aucune';
  el('aimStatus').textContent = Game.aimPart;
  el('driveStatus').textContent = Game.vehicle ? (Game.vehicle.auto ? 'automatique' : 'manuelle') : '—';
  el('freqStatus').textContent = Game.talkie.frequency.toFixed(3);
}

/* ============================================================
   CATALOGUES — véhicules, armes, articles, vêtements, nourriture
============================================================ */
