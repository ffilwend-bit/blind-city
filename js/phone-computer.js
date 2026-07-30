const Phone = {
  open: false, airplane: false, signal: 4, voiceChat: false, isCaller: false, peerVoiceOn: false,
  deviceMode: 'phone', // 'phone' ou 'tablet' — détermine quelles icônes s'affichent
  contacts: [
    { id: 'police', name: 'Police', number: '17', role: 'police' },
    { id: 'samu', name: 'SAMU', number: '15', role: 'medecin' },
    { id: 'pompier', name: 'Pompiers', number: '18', role: 'secours' },
    { id: 'depannage', name: 'Dépannage', number: '800', role: 'meca' },
  ],
  messages: [],
  currentCall: null,
  incomingCall: null, activeCallId: null, callState: null, ringtoneKey: null, callLocalTimeout: null,
  openPhone() { this.openAs('phone'); },
  // Ouvre la même interface, mais en mode téléphone ou tablette : seules les
  // icônes propres à l'appareil choisi s'affichent (voir renderHome).
  openAs(mode) {
    if (Game.isCuffed) return announce('Vous êtes menotté(e), impossible d\'utiliser vos mains pour ça.', 'polite');
    this.deviceMode = mode;
    Audio.ensure(); Audio.click();
    this.open = true; el('phoneOverlay').style.display = 'flex';
    this.updateClock(); this.renderHome();
    const firstIcon = el('phoneOverlay').querySelector('.app-icon:not([style*="display: none"]), button');
    if (firstIcon) firstIcon.focus();
    announce(mode === 'tablet'
      ? 'Tablette ouverte. Applications : missions extrêmes, et toutes celles du téléphone. Utilisez les flèches pour naviguer.'
      : 'Téléphone ouvert. Applications : contacts, messages, appeler, parking, carte, réglages. Utilisez les flèches pour naviguer.', 'polite');
  },
  closePhone() { this.open = false; el('phoneOverlay').style.display = 'none'; this.hangup(); document.activeElement?.blur(); },
  updateClock() { const d = new Date(); el('phoneTime').textContent = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); },
  renderHome() {
    el('phoneHome').style.display = 'block'; el('phoneApp').style.display = 'none'; el('phoneApp').innerHTML = '';
    el('phoneSignal').textContent = this.airplane ? '✈️ Avion' : '📶 4G';
    el('phoneAirplane').style.visibility = this.airplane ? 'visible' : 'hidden';
    // N'affiche que les icônes propres à l'appareil ouvert : la tablette a
    // tout ce qu'a le téléphone, plus les missions extrêmes ; le téléphone
    // n'a pas les missions extrêmes.
    document.querySelectorAll('#phoneHome .app-icon').forEach(icon => {
      const dev = icon.dataset.device || 'both';
      icon.style.display = (dev === 'both' || dev === this.deviceMode) ? '' : 'none';
    });
  },
  toggleAirplane() {
    this.airplane = !this.airplane;
    el('phoneSignal').textContent = this.airplane ? '✈️ Avion' : '📶 4G';
    el('phoneAirplane').style.visibility = this.airplane ? 'visible' : 'hidden';
    announce(this.airplane ? 'Mode avion activé. Pas de réseau.' : 'Mode avion désactivé. Réseau restauré.', 'polite');
  },
  // Rend une liste d'actions du téléphone (lieux utiles, carte de la ville,
  // carte, mes lieux...) réellement navigable au doigt SANS lecteur d'écran :
  // balayage gauche/droite pour parcourir chaque bouton en l'énonçant en entier
  // (nom, distance, direction, action), double tape pour l'activer — le même
  // système éprouvé que les cartes du menu principal. Le clavier reste géré par
  // les flèches et l'annonce au focus.
  _makeListAccessible(ul, introText) {
    if (!ul) return;
    if (window.AccessibleCardMenu) AccessibleCardMenu.attach(ul, '.phone-btn');
    const mobile = (typeof Platform !== 'undefined') && Platform.isMobile;
    if (mobile) {
      // Tactile : on ne met pas le focus automatiquement (le balayage part de la
      // première carte au premier geste) et on énonce comment naviguer.
      this._skipAutoFocus = true;
      if (introText) announce(introText, 'assertive');
    }
    // Ordinateur : on garde le focus clavier automatique sur le premier bouton
    // (sinon le focus retombe sur le body, hors du conteneur, et les flèches ne
    // naviguent plus la liste) ; son libellé complet est lu à la prise de focus.
  },
  renderApp(name) {
    this._appRenderedAt = Date.now(); // horodatage anti-appel fantôme (voir call())
    this._skipAutoFocus = false;
    // Les cartes / listes de lieux du téléphone réutilisent désormais le système
    // de menus à cartes, pleinement accessible au clavier ET au doigt (le même
    // que « Carte » dans le menu principal). On ferme le téléphone et on ouvre
    // le menu correspondant, au lieu d'une liste à part moins accessible.
    if (name === 'map' || name === 'citymap') { this.closePhone(); if (typeof openMapMenu === 'function') openMapMenu(); return; }
    if (name === 'places') { this.closePhone(); if (typeof openNearestMenu === 'function') openNearestMenu(); return; }
    if (name === 'casier') { this.closePhone(); Game.openCriminalRecord(); return; }
    if (name === 'houses') { this.closePhone(); Game.openHouseDirectory(); return; }
    if (name === 'fines') { this.closePhone(); Game.openFinesHistoryMenu(); return; }
    if (name === 'bank') { this.closePhone(); Game.openBankMenu(); return; }
    if (name === 'jobs') { this.closePhone(); if (typeof openRoleMenu === 'function') openRoleMenu(); return; }
    el('phoneHome').style.display = 'none'; el('phoneApp').style.display = 'block'; const a = el('phoneApp'); a.innerHTML = '';
    if (name === 'contacts') {
      a.innerHTML = '<h3>👥 Contacts</h3><ul class="contact-list" id="phoneContactList"></ul><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      const ul = el('phoneContactList');
      // Vrais joueurs connectés en premier (les seuls à vraiment décrocher ou non)
      Array.from(Net.remotePlayers.values()).forEach(p => {
        const li = document.createElement('li'); li.innerHTML = `<span>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} <span class="badge badge-citoyen">joueur réel</span></span><button class="phone-btn">📞</button>`;
        li.querySelector('button').addEventListener('click', () => this.call({ name: `${p.firstName} ${p.lastName}`, isPlayer: true, id: p.id })); ul.appendChild(li);
      });
      this.contacts.forEach(c => {
        const li = document.createElement('li'); li.innerHTML = `<span>${escapeHtml(c.name)} <span class="badge badge-${c.role === 'police' ? 'police' : c.role === 'medecin' ? 'medecin' : c.role === 'meca' ? 'meca' : 'citoyen'}">${escapeHtml(c.role)}</span></span><button class="phone-btn">📞</button>`;
        li.querySelector('button').addEventListener('click', () => this.call(c)); ul.appendChild(li);
      });
      // Contacts ENREGISTRÉS par le joueur (le prénom/nom qu'il a donné à chaque
      // personne). Ils n'apparaissaient pas dans la liste — c'était le bug.
      (Game.myContacts || []).forEach(c => {
        const online = c.username ? Array.from(Net.remotePlayers.values()).find(p => p.accountUsername === c.username) : null;
        const statut = online ? 'en ligne' : (c.number ? c.number : 'contact');
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(c.label)} <span class="badge badge-citoyen">${escapeHtml(statut)}</span></span><button class="phone-btn" aria-label="Appeler ${escapeHtml(c.label)}">📞</button>`;
        li.querySelector('button').addEventListener('click', () => this.callSavedContact(c));
        ul.appendChild(li);
      });
      // Add nearby NPCs as contacts
      City.npcs.filter(n => !n.dead && UTIL.dist(n, Game) < 50).forEach(n => {
        const li = document.createElement('li'); li.innerHTML = `<span>${n.name} (${n.job})</span><button class="phone-btn">📞</button>`;
        li.querySelector('button').addEventListener('click', () => this.call({ name: n.name, number: 'npc', role: 'citoyen' })); ul.appendChild(li);
      });
    }
    if (name === 'messages') {
      const targetLine = this.currentMsgTarget ? `<p style="color:var(--accent-2);font-size:0.8rem;">À : ${this.currentMsgTarget.name}</p>` : '<p style="color:var(--muted);font-size:0.8rem;">Aucun destinataire choisi.</p>';
      a.innerHTML = '<h3>💬 Messages</h3>' + targetLine + '<button class="phone-btn" id="phoneNewMsgBtn">✉️ Nouveau message</button><div id="phoneMsgList" class="msg-list"></div><div style="display:flex;gap:6px;margin-top:8px;"><input id="phoneMsgInput" placeholder="Message..." aria-label="Écrire un message" style="flex:1;background:#11161e;border:1px solid var(--border);color:#fff;border-radius:8px;padding:8px;"><button class="phone-btn" id="phoneMsgSend">Envoyer</button></div><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      this.renderMessages();
      makeInputSpeakable(el('phoneMsgInput'), 'Écrire un message');
      el('phoneNewMsgBtn').addEventListener('click', () => this.startNewMessage());
      el('phoneMsgSend').addEventListener('click', () => this.sendMessage());
    }
    if (name === 'incoming_call') {
      const c = this.incomingCall;
      a.innerHTML = `<h3>📞 Appel entrant</h3><div class="phone-call"><div class="caller">${c ? c.fromName : 'Numéro inconnu'}</div><div class="status">Ça sonne... répondez dans les 30 secondes.</div>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
          <button class="call-btn" id="callAcceptBtn" style="background:#1f8a3f;">✅ Décrocher</button>
          <button class="call-btn hangup" id="callDeclineBtn">❌ Refuser</button>
        </div></div>`;
      el('callAcceptBtn').addEventListener('click', () => Phone.answerCall());
      el('callDeclineBtn').addEventListener('click', () => Phone.declineCall());
    }
    if (name === 'call') {
      a.innerHTML = '<h3>📞 Appeler</h3><p style="color:var(--muted);font-size:0.85rem;">Choisissez un contact ci-dessous, ou composez un numéro.</p><button class="phone-btn" id="dialNumberBtn">🔢 Composer un numéro</button><button class="phone-btn" id="findNumberBtn">📇 Trouver un numéro par nom</button><button class="phone-btn" id="maskedDialBtn">🕵️ Appel masqué</button><div class="phone-call"><div class="caller" id="callName">Numéro inconnu</div><div class="status" id="callStatus">Prêt</div><button class="phone-btn" id="callSaveContactBtn" style="margin-top:6px;">💾 Enregistrer ce contact</button><div id="callMsgArea" style="display:none; margin-top:10px;"><input id="callMsgInput" placeholder="Message à dire..." aria-label="Message à dire au correspondant" style="width:100%;background:#11161e;border:1px solid var(--border);color:#fff;border-radius:8px;padding:8px;margin-bottom:6px;"><button class="phone-btn" id="callMsgSend">Dire</button></div><button class="call-btn hangup" onclick="Phone.hangup()">📞</button></div><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      const msgBtn = el('callMsgSend');
      if (msgBtn) msgBtn.addEventListener('click', () => {
        const input = el('callMsgInput'); if (!input.value.trim()) return;
        Phone.sayInCall(input.value.trim()); input.value = '';
      });
      el('dialNumberBtn').addEventListener('click', () => {
        AccessibleTextPrompt.open('Composer un numéro', 'Tapez le numéro à joindre.', '', (number) => {
          if (!number) return;
          this._lastDialedNumber = number;
          announce(`Composition du ${number}...`, 'polite');
          Net.dialNumber(number, (res) => { if (res.ok) el('callStatus').textContent = 'Ça sonne...'; });
        });
      });
      el('findNumberBtn').addEventListener('click', () => this.findNumberByName());
      el('maskedDialBtn').addEventListener('click', () => this.maskedDial());
      el('callSaveContactBtn').addEventListener('click', () => {
        if (!this.currentCall) return announce('Aucun appel en cours pour enregistrer un contact.', 'assertive');
        Game.saveContact(this.currentCall.id, this.currentCall.name, this._lastDialedNumber || null);
      });
    }
    if (name === 'garage') {
      a.innerHTML = '<h3>🅿️ Parking</h3><div id="garageAppList"></div><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      this.renderGarageApp();
    }
    if (name === 'missions') {
      Game.openMissions();
      Phone.renderHome();
    }
    if (name === 'mynumbers') {
      Game.openMyPhoneNumbers();
    }
    if (name === 'news') {
      const articles = Game.newsArticles || [];
      let html = '<h3>📰 Actualités</h3>';
      if (!articles.length) html += '<p style="color:var(--muted);font-size:0.85rem;">Aucune info publiée pour l\'instant.</p>';
      else html += articles.slice(0, 20).map(a => {
        const d = new Date(a.time); const time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        return `<div style="background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;"><h4 style="font-size:0.9rem;margin-bottom:4px;">${a.title}</h4><p style="font-size:0.8rem;">${a.content}</p><p style="font-size:0.7rem;color:var(--muted);margin-top:4px;">Par ${a.author}, ${time}</p></div>`;
      }).join('');
      html += '<button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      a.innerHTML = html;
      announce(articles.length ? `${articles.length} info(s) publiée(s). La plus récente : ${articles[0].title}, par ${articles[0].author}.` : 'Aucune info publiée pour l\'instant.', 'polite');
    }
    if (name === 'places') {
      a.innerHTML = '<h3>📍 Lieux utiles</h3><p style="color:var(--muted);font-size:0.75rem;">🚶 = me guider à pied, 🧭 = conduite auto.</p><ul class="contact-list" id="phonePlacesList"></ul><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      const ul = el('phonePlacesList');
      const types = [
        { type: 'station_essence', label: '⛽ Station-service' },
        { type: 'vetements', label: '👕 Boutique de vêtements' },
        { type: 'restaurant', label: '🍽️ Restaurant' },
        { type: 'magasin', label: '🏪 Boutique' },
        { type: 'banque', label: '🏦 Banque' },
        { type: 'hopital', label: '🏥 Hôpital' },
        { type: 'police', label: '👮 Commissariat' },
        { type: 'garage', label: '🅿️ Parking public' },
        { type: 'atelier', label: '🔧 Atelier de réparation' },
      ];
      types.forEach(t => {
        const list = City.pois.filter(p => p.type === t.type).map(p => ({ ...p, dist: UTIL.dist(p, Game) })).sort((a, b) => a.dist - b.dist);
        const nearest = list[0];
        const li = document.createElement('li');
        if (nearest) {
          const dist = Math.round(nearest.dist * CONFIG.METERS_PER_TILE);
          const dir = UTIL.bearing(nearest.x - Game.x, nearest.y - Game.y);
          const plain = t.label.replace(/^[^\p{L}]*/u, ''); // libellé sans l'emoji, pour la voix
          li.innerHTML = `<span>${t.label} : ${nearest.name} (${dist} m, ${dir})</span><button class="phone-btn" data-walk aria-label="Me guider à pied vers ${plain} : ${nearest.name}, ${dist} mètres, direction ${dir}">🚶</button><button class="phone-btn" data-drive aria-label="Conduite automatique vers ${plain} : ${nearest.name}, ${dist} mètres">🧭</button>`;
          li.querySelector('[data-walk]').addEventListener('click', () => { Game.setGuidance(nearest); Phone.closePhone(); });
          li.querySelector('[data-drive]').addEventListener('click', () => { Game.setAutoDrive(nearest.type, nearest.name); Phone.closePhone(); });
        } else {
          li.innerHTML = `<span>${t.label} : aucun</span>`;
        }
        ul.appendChild(li);
      });
      this._makeListAccessible(ul, 'Lieux utiles. Balayez d\'un doigt vers la gauche ou la droite pour parcourir les lieux et leurs boutons ; double tapez pour lancer le guidage à pied ou la conduite automatique.');
    }
    if (name === 'myplaces') {
      a.innerHTML = '<h3>📌 Mes lieux</h3><div style="display:flex;gap:6px;margin-bottom:8px;"><input id="myPlaceNameInput" placeholder="Nom du lieu..." aria-label="Nom du lieu à enregistrer ici" style="flex:1;background:#11161e;border:1px solid var(--border);color:#fff;border-radius:8px;padding:8px;"><button class="phone-btn" id="myPlaceSaveBtn">Enregistrer ici</button></div><ul class="contact-list" id="phoneMyPlacesList"></ul><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
      makeInputSpeakable(el('myPlaceNameInput'), 'Nom du lieu à enregistrer ici');
      el('myPlaceSaveBtn').addEventListener('click', () => {
        const input = el('myPlaceNameInput');
        Game.savePlaceHere(input.value); input.value = '';
        Phone.renderApp('myplaces');
      });
      const ul = el('phoneMyPlacesList');
      const places = Game.savedPlaces || [];
      if (!places.length) ul.innerHTML = '<p style="color:var(--muted);font-size:0.8rem;">Aucun lieu enregistré. Rendez-vous quelque part puis tapez un nom ci-dessus.</p>';
      places.forEach((p, i) => {
        const dist = Math.round(UTIL.dist(p, Game) * CONFIG.METERS_PER_TILE);
        const dir = UTIL.bearing(p.x - Game.x, p.y - Game.y);
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.name} (${dist} m, ${dir})</span><button class="phone-btn" data-walk aria-label="Me guider à pied vers ${p.name}, ${dist} mètres, direction ${dir}">🚶</button><button class="phone-btn" data-rename aria-label="Renommer le lieu ${p.name}">✏️</button><button class="phone-btn" data-del aria-label="Supprimer le lieu ${p.name}">🗑️</button>`;
        li.querySelector('[data-walk]').addEventListener('click', () => { Game.setGuidance(p); Phone.closePhone(); });
        li.querySelector('[data-rename]').addEventListener('click', () => {
          AccessibleTextPrompt.open('Renommer le lieu', `Nouveau nom pour « ${p.name} ».`, p.name, (n) => {
            if (n) { Game.renameSavedPlace(i, n); Phone.renderApp('myplaces'); }
          });
        });
        li.querySelector('[data-del]').addEventListener('click', () => { Game.removeSavedPlace(i); Phone.renderApp('myplaces'); });
        ul.appendChild(li);
      });
      if (places.length) this._makeListAccessible(ul, `Mes lieux : ${places.length} enregistré${places.length > 1 ? 's' : ''}. Balayez d'un doigt pour parcourir, double tapez pour vous faire guider ou supprimer.`);
    }
    if (name === 'music') {
      a.innerHTML = `<h3>🎵 Musique</h3>
        <p id="musicNowPlaying" style="color:var(--muted);font-size:0.85rem;"></p>
        <button class="phone-btn" id="musicPick">📂 Choisir un fichier audio</button>
        <button class="phone-btn" id="musicResume" style="display:none;"></button>
        <button class="phone-btn" id="musicToggle" style="display:none;"></button>
        <button class="phone-btn" id="musicStop" style="display:none;">⏹️ Arrêter</button>
        <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
          <button class="phone-btn" id="musicVolDown" aria-label="Baisser le volume">🔉</button>
          <span id="musicVolLabel" style="min-width:48px;text-align:center;"></span>
          <button class="phone-btn" id="musicVolUp" aria-label="Monter le volume">🔊</button>
        </div>
        <button class="phone-btn" id="musicBuyRadio" style="display:${Game.portableRadio.owned ? 'none' : ''};">🛒 Radio portable (20 000 FCFA — Ctrl+R partout)</button>
        <p style="color:var(--muted);font-size:0.75rem;margin-top:8px;">${Game.portableRadio.owned ? '📻 Radio portable possédée : Ctrl+R pour lire/pause à tout instant, sans ouvrir le téléphone.' : ''}</p>
        <button class="phone-btn" onclick="Phone.renderHome()">Retour</button>`;
      const refresh = () => {
        el('musicNowPlaying').textContent = MusicPlayer.fileName ? `Fichier : ${MusicPlayer.fileName} (${MusicPlayer.playing ? 'lecture' : 'pause'}).` : 'Aucun fichier chargé.';
        el('musicToggle').textContent = MusicPlayer.playing ? '⏸️ Pause' : '▶️ Lire';
        el('musicToggle').style.display = MusicPlayer.fileName ? '' : 'none';
        el('musicStop').style.display = MusicPlayer.fileName ? '' : 'none';
        el('musicVolLabel').textContent = Math.round(MusicPlayer.volume * 100) + '%';
        const lastName = MusicPlayer.lastKnownName();
        const resumeBtn = el('musicResume');
        if (!MusicPlayer.fileName && lastName) { resumeBtn.style.display = ''; resumeBtn.textContent = `🔄 Reprendre « ${lastName} »`; }
        else resumeBtn.style.display = 'none';
      };
      refresh();
      el('musicPick').addEventListener('click', () => {
        MusicPlayer.pickFile().then((ok) => { if (ok) { MusicPlayer.play(); refresh(); announce(`${MusicPlayer.fileName} chargé.`, 'assertive'); } });
      });
      el('musicResume').addEventListener('click', () => {
        MusicPlayer.resumeLastFile().then((ok) => {
          if (ok) { MusicPlayer.play(); refresh(); announce(`${MusicPlayer.fileName} repris.`, 'assertive'); }
          else announce('Impossible de reprendre ce fichier. Choisissez-le à nouveau.', 'assertive');
        });
      });
      el('musicToggle').addEventListener('click', () => { const playing = MusicPlayer.toggle(); refresh(); announce(playing ? 'Lecture.' : 'Pause.', 'polite'); });
      el('musicStop').addEventListener('click', () => { MusicPlayer.stop(); refresh(); announce('Musique arrêtée.', 'polite'); });
      el('musicVolUp').addEventListener('click', () => { MusicPlayer.setVolume(MusicPlayer.volume + 0.1); refresh(); });
      el('musicVolDown').addEventListener('click', () => { MusicPlayer.setVolume(MusicPlayer.volume - 0.1); refresh(); });
      const buyBtn = el('musicBuyRadio');
      if (buyBtn) buyBtn.addEventListener('click', () => { Game.buyPortableRadio(); this.renderApp('music'); });
    }
    if (name === 'talkie') {
      const t = Game.talkie;
      if (!t.owned) {
        a.innerHTML = '<h3>📻 Talkie-walkie</h3><p style="color:var(--muted);font-size:0.85rem;">Vous n\'en possédez pas encore.</p><button class="phone-btn" id="phoneTalkieBuy">🛒 Acheter (45 000 FCFA)</button><button class="phone-btn" onclick="Phone.renderHome()">Retour</button>';
        el('phoneTalkieBuy').addEventListener('click', () => { Game.buyTalkie(); Phone.renderApp('talkie'); });
      } else {
        a.innerHTML = `<h3>📻 Talkie-walkie</h3>
          <p style="color:var(--muted);font-size:0.85rem;">Batterie : ${Math.round(t.battery * 100)}% — Fréquence : ${t.frequency.toFixed(3)} MHz — ${t.on ? 'Allumé' : 'Éteint'}</p>
          <button class="phone-btn" id="phoneTalkiePower">${t.on ? '🔴 Éteindre' : '🟢 Allumer'}</button>
          <button class="phone-btn" id="phoneTalkieFreq">🔢 Régler la fréquence</button>
          <button class="phone-btn" id="phoneTalkiePTT">🎙️ Parler (PTT)</button>
          <button class="phone-btn" id="phoneTalkieCharge">🔋 Recharger</button>
          <button class="phone-btn" id="phoneTalkieGive">🤝 Donner à la cible</button>
          <button class="phone-btn" onclick="Phone.renderHome()">Retour</button>`;
        el('phoneTalkiePower').addEventListener('click', () => { Game.toggleTalkiePower(); Phone.renderApp('talkie'); });
        el('phoneTalkieFreq').addEventListener('click', () => { Phone.closePhone(); FreqPicker.open(Game.talkie.frequency, (f) => Game.setTalkieFrequency(f)); });
        el('phoneTalkiePTT').addEventListener('click', () => { AccessibleTextPrompt.open('Message talkie-walkie', 'Message à transmettre, facultatif.', '', (msg) => Game.talkiePTT(msg)); });
        el('phoneTalkieCharge').addEventListener('click', () => { Game.chargeTalkie(); Phone.renderApp('talkie'); });
        el('phoneTalkieGive').addEventListener('click', () => { Game.giveTalkie(); Phone.renderApp('talkie'); });
      }
    }
    if (name === 'settings') {
      const NOTIF_CHOICES = [
        { key: 'sfx_notification', label: 'Sonnerie par défaut' },
        { key: 'notif_1', label: 'Sonnerie 1' },
        { key: 'notif_2', label: 'Sonnerie 2' },
        { key: 'notif_3', label: 'Sonnerie 3' },
        { key: 'notif_4', label: 'Sonnerie 4' },
      ];
      const current = CONFIG.NOTIFICATION_SOUND || 'sfx_notification';
      const radios = NOTIF_CHOICES.map((c, i) => `
        <div style="margin:0.4rem 0;">
          <label style="display:flex;align-items:center;gap:0.5rem;">
            <input type="radio" name="notifSoundChoice" value="${c.key}" id="notifSound_${i}" ${c.key === current ? 'checked' : ''}>
            ${c.label}
          </label>
          <button type="button" class="phone-btn" data-preview="${c.key}" aria-label="Écouter ${c.label}">🔊 Écouter</button>
        </div>`).join('');
      a.innerHTML = `
        <h3>⚙️ Réglages</h3>
        <p style="color:var(--muted);font-size:0.85rem;">Vitesse voix : <span id="rateVal">${CONFIG.SPEECH_RATE}</span></p>
        <input type="range" min="0.5" max="5" step="0.1" value="${CONFIG.SPEECH_RATE}" id="rateRange" aria-label="Vitesse de la voix, de 0,5 lent à 5 très rapide" style="width:100%;">
        <fieldset style="margin-top:1rem;border:1px solid var(--muted, #888);border-radius:6px;padding:0.6rem;">
          <legend style="padding:0 0.4rem;">Son de notification</legend>
          ${radios}
        </fieldset>
        <button class="phone-btn" onclick="Phone.renderHome()">Retour</button>`;
      el('rateRange').addEventListener('focus', () => {
        speak(`Vitesse de la voix. Actuellement ${CONFIG.SPEECH_RATE}. Flèche haut ou droite pour accélérer, flèche bas ou gauche pour ralentir.`, 'interrupt');
      });
      el('rateRange').addEventListener('input', (e) => {
        CONFIG.SPEECH_RATE = parseFloat(e.target.value);
        el('rateVal').textContent = CONFIG.SPEECH_RATE;
        UserSettings.save();
        // Confirmation parlée immédiate, à la nouvelle vitesse : sans lecteur
        // d'écran externe, c'est la seule façon d'entendre l'effet du réglage.
        speak(`Vitesse ${CONFIG.SPEECH_RATE}.`, 'interrupt');
      });
      document.querySelectorAll('input[name="notifSoundChoice"]').forEach((r, i) => {
        r.addEventListener('focus', () => speak(`${NOTIF_CHOICES[i].label}${r.checked ? ', sélectionné' : ''}`, 'interrupt'));
        r.addEventListener('change', (e) => {
          if (!e.target.checked) return;
          CONFIG.NOTIFICATION_SOUND = e.target.value;
          UserSettings.save();
          AudioLib.playNotification();
          announce('Son de notification enregistré.', 'polite');
        });
      });
      document.querySelectorAll('[data-preview]').forEach(btn => {
        btn.addEventListener('click', () => AudioLib.playOnce(btn.dataset.preview));
      });
    }
    const firstFocusable = a.querySelector('button, input, select, textarea, [tabindex]');
    if (firstFocusable && !this._skipAutoFocus) {
      const isTextLikeInput = firstFocusable.tagName === 'TEXTAREA' || (firstFocusable.tagName === 'INPUT' && !['range', 'radio', 'checkbox', 'button', 'submit'].includes(firstFocusable.type));
      if (isTextLikeInput) focusTextInput(firstFocusable);
      else firstFocusable.focus();
    }
  },
  currentMsgTarget: null,
  // Choisir à qui envoyer : soit un vrai joueur connecté dans les contacts,
  // soit en composant son numéro — exactement comme pour un appel.
  startNewMessage() {
    el('menuTitle').textContent = 'Nouveau message';
    const items = [
      { id: 'contact', title: '👤 Choisir un contact', desc: 'Parmi les joueurs réels connectés.' },
      { id: 'dial', title: '🔢 Composer un numéro', desc: 'Saisir directement le numéro du destinataire.' },
    ];
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      if (sel.id === 'contact') this.pickMessageContact();
      else this.dialForMessage();
    });
  },
  pickMessageContact() {
    const realPlayers = Array.from(Net.remotePlayers.values());
    if (!realPlayers.length) return announce('Aucun joueur réel connecté pour l\'instant.', 'assertive');
    el('menuTitle').textContent = 'Choisir un contact';
    const items = realPlayers.map(p => ({ id: p.id, title: `${p.firstName} ${p.lastName}`, desc: 'Joueur réel connecté.' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const p = realPlayers.find(pp => pp.id === sel.id);
      if (p) { this.currentMsgTarget = { id: p.id, name: `${p.firstName} ${p.lastName}` }; this.renderApp('messages'); announce(`Destinataire : ${this.currentMsgTarget.name}. Écrivez votre message puis Envoyer.`, 'assertive'); }
    });
  },
  dialForMessage() {
    AccessibleTextPrompt.open('Composer un numéro', 'Numéro du destinataire du message.', '', (number) => {
      if (!number) return;
      this.currentMsgTarget = { dialNumber: number, name: `numéro ${number}` };
      this.renderApp('messages');
      announce(`Destinataire : ${this.currentMsgTarget.name}. Écrivez votre message puis Envoyer.`, 'assertive');
    });
  },
  renderMessages() {
    const div = el('phoneMsgList'); if (!div) return; div.innerHTML = '';
    if (!this.messages.length) div.innerHTML = '<p style="color:var(--muted);font-size:0.8rem;">Aucun message.</p>';
    // Les messages reçus (fromId présent) ont un bouton pour les transférer à
    // un autre joueur — avant, impossible de faire suivre un message reçu.
    this.messages.slice(-20).forEach(m => {
      const p = document.createElement('div'); p.style.cssText = 'background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:8px;margin-bottom:6px;font-size:0.8rem;';
      p.innerHTML = `<strong>${m.from}</strong> <span style="color:var(--muted);font-size:0.7rem;">${m.time}</span><br>${m.text}` + (m.fromId ? '<br><button class="phone-btn" data-fwd aria-label="Transférer le message de ' + m.from + '" style="margin-top:4px;">↪️ Transférer</button>' : '');
      if (m.fromId) p.querySelector('[data-fwd]').addEventListener('click', () => this.pickForwardTarget(m));
      div.appendChild(p);
    });
  },
  // Sens inverse : le destinataire est déjà connu (ex. le chauffeur de taxi),
  // on choisit plutôt PARMI les messages reçus récemment lequel transférer.
  pickReceivedMessage(targetId, targetName) {
    const received = this.messages.filter(m => m.fromId).slice(-15).reverse();
    if (!received.length) return announce('Aucun message reçu récemment à transférer.', 'assertive');
    el('menuTitle').textContent = 'Transférer un message';
    const items = received.map((m, i) => ({ id: String(i), title: `De ${m.from} : ${m.text}`, desc: m.time || '' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const m = received[parseInt(sel.id, 10)];
      if (!m) return;
      Net.smsSend(targetId, `[Transféré de ${m.from}] ${m.text}`, (res) => {
        if (!res.ok) announce(res.reason || 'Message non transféré.', 'assertive');
        else announce(`Message de ${m.from} transféré à ${targetName}.`, 'polite');
      });
    });
  },
  pickForwardTarget(m) {
    const realPlayers = Array.from(Net.remotePlayers.values());
    if (!realPlayers.length) return announce('Aucun joueur réel connecté pour transférer.', 'assertive');
    el('menuTitle').textContent = 'Transférer à qui ?';
    const items = realPlayers.map(p => ({ id: p.id, title: `${p.firstName} ${p.lastName}`, desc: 'Joueur réel connecté.' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      closeMenu();
      const p = realPlayers.find(pp => pp.id === sel.id);
      if (!p) return;
      Net.smsSend(p.id, `[Transféré de ${m.from}] ${m.text}`, (res) => {
        if (!res.ok) announce(res.reason || 'Message non transféré.', 'assertive');
        else announce(`Message transféré à ${p.firstName} ${p.lastName}.`, 'polite');
      });
    });
  },
  sendMessage() {
    const input = el('phoneMsgInput'); if (!input.value.trim()) return;
    if (!this.currentMsgTarget) return announce('Choisissez d\'abord un destinataire avec "Nouveau message".', 'assertive');
    const text = input.value.trim();
    const d = new Date(); const time = d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
    const onResult = (res) => {
      if (res.ok) {
        this.messages.push({ from: 'Moi', text, time });
        this.renderMessages(); AudioLib.playOnce('sfx_message_envoye');
      } else {
        announce(res.reason || 'Message non envoyé.', 'assertive');
      }
    };
    if (this.currentMsgTarget.id) Net.smsSend(this.currentMsgTarget.id, text, onResult);
    else Net.smsDial(this.currentMsgTarget.dialNumber, text, onResult);
    input.value = '';
  },
  // Appeler un contact ENREGISTRÉ : s'il correspond à un joueur réel connecté,
  // vrai appel ; sinon on compose son numéro (s'il en a un et qu'on est en
  // ligne) ; sinon on prévient qu'il n'est pas joignable.
  callSavedContact(c) {
    const online = c.username ? Array.from(Net.remotePlayers.values()).find(p => p.accountUsername === c.username) : null;
    if (online) return this.call({ name: c.label, isPlayer: true, id: online.id });
    if (c.number && Net.connected) {
      this.currentCall = { name: c.label, number: c.number }; this.renderApp('call');
      if (el('callName')) el('callName').textContent = c.label;
      this._lastDialedNumber = c.number;
      announce(`Vous appelez ${c.label}.`, 'polite');
      Net.dialNumber(c.number, (res) => { if (res && res.ok && el('callStatus')) el('callStatus').textContent = 'Ça sonne...'; });
      return;
    }
    if (c.number) return this.call({ name: c.label, number: c.number }); // hors ligne : appel simulé
    announce(`${c.label} n'est pas joignable pour le moment.`, 'assertive');
  },
  call(contact) {
    // Anti-appel fantôme : ouvrir l'app Contacts affichait une liste dont le
    // premier bouton « appeler » pouvait recevoir le clic résiduel du tap qui
    // venait d'ouvrir l'app (re-rendu sous le doigt), et « ça sonnait » tout
    // seul. On ignore donc tout appel déclenché juste après l'affichage d'une
    // app : il faut un geste délibéré, une fois la liste entendue.
    if (Date.now() - (this._appRenderedAt || 0) < 600) {
      announce('Choisissez d\'abord un contact, puis lancez l\'appel.', 'polite');
      return;
    }
    if (this.airplane) return announce('Mode avion actif. Impossible d\'appeler.', 'assertive');
    if (contact.isPlayer) {
      if (!Net.connected) return announce('Vous n\'êtes pas connecté à un serveur multijoueur.', 'assertive');
      this.currentCall = contact; this.callState = 'ringing_out'; this.activeCallId = null;
      this.isCaller = true; this.peerVoiceOn = false;
      this.renderApp('call');
      el('callName').textContent = contact.name; el('callStatus').textContent = 'Appel en cours, ça sonne...';
      AudioLib.playLoop('sfx_attente_appel');
      Net.callOffer(contact.id);
      announce(`Vous appelez ${contact.name}. Ça sonne.`, 'polite');
      // Filet de sécurité local si jamais le serveur ne répond pas du tout
      this.callLocalTimeout = setTimeout(() => { if (this.callState === 'ringing_out') this.onCallTimeout(this.activeCallId); }, 32000);
      return;
    }
    // Appels simulés (numéros d'urgence, PNJ) — comportement existant, inchangé
    this.currentCall = contact; this.renderApp('call');
    el('callName').textContent = contact.name; el('callStatus').textContent = 'Appel en cours...';
    Audio.beep(0, 440); setTimeout(() => Audio.beep(0, 440), 400);
    announce(`Appel à ${contact.name}.`, 'polite');
    setTimeout(() => {
      if (contact.number === '17') { Game.wanted = Math.max(0, Game.wanted - 15); el('callStatus').textContent = 'Police informée.'; }
      else if (contact.number === '15') { Game.heal(50); el('callStatus').textContent = 'Secours envoyés.'; }
      else if (contact.number === '18') { el('callStatus').textContent = 'Pompiers alertés.'; }
      else if (contact.number === '800') { Game.repairVehicle(); el('callStatus').textContent = 'Dépannage appelé.'; }
      else el('callStatus').textContent = 'Appel en cours...';
    }, 1500);
  },
  onCallRinging(callId, targetName) {
    this.activeCallId = callId;
    if (el('callStatus')) el('callStatus').textContent = `Ça sonne chez ${targetName}...`;
  },
  onCallUnavailable() {
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    AudioLib.playOnce('sfx_correspondant_indisponible');
    if (el('callStatus')) el('callStatus').textContent = 'Correspondant indisponible.';
    announce('Votre correspondant n\'est pas disponible. Veuillez rappeler ultérieurement.', 'assertive');
    this.hangup(true);
  },
  receiveCallOffer(callId, fromId, fromName, masked) {
    this.incomingCall = { callId, fromId, fromName, masked: !!masked };
    this.ringtoneKey = AudioLib.randomRingtone();
    AudioLib.playLoop(this.ringtoneKey);
    // Appel masqué : on n'essaie pas d'identifier l'appelant (ni par ses
    // contacts) — on annonce "Numéro masqué", comme un vrai appel anonyme.
    let announcedName = fromName;
    if (!masked) {
      const remote = Net.remotePlayers.get(fromId);
      const contactMatch = remote ? Game.resolveContactName({ isPlayer: true, accountUsername: remote.accountUsername }) : null;
      if (contactMatch) announcedName = contactMatch.label;
    }
    announce(`${announcedName} vous appelle. Décrochez ou refusez dans les 30 secondes.`, 'assertive');
    this.renderApp('incoming_call');
    if (!this.open) { this.open = true; el('phoneOverlay').style.display = 'flex'; }
  },
  // Compose un numéro et lance l'appel via l'écran d'appel (masqué ou non).
  callNumber(number, name, masked) {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    if (this.airplane) return announce('Mode avion actif. Impossible d\'appeler.', 'assertive');
    if (!this.open) this.openPhone();
    this.renderApp('call');
    this._lastDialedNumber = number;
    this.currentCall = { name: name || number, isPlayer: true };
    if (el('callName')) el('callName').textContent = name || number;
    if (el('callStatus')) el('callStatus').textContent = 'Composition...';
    announce(`Appel ${masked ? 'masqué ' : ''}du ${number}${name ? ', ' + name : ''}...`, 'polite');
    Net.dialNumber(number, (res) => { if (res.ok && el('callStatus')) el('callStatus').textContent = 'Ça sonne...'; }, masked);
  },
  // Appel masqué : composer un numéro sans révéler son identité à l'appelé.
  maskedDial() {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    AccessibleTextPrompt.open('Appel masqué', 'Tapez le numéro à joindre. Votre identité ne sera pas révélée : la personne verra "Numéro masqué".', '', (number) => {
      if (!number) return;
      this.callNumber(number.trim(), null, true);
    });
  },
  // Retrouver le numéro d'un utilisateur d'après son nom (nom affiché ou vrai
  // nom), puis proposer de l'appeler ou de l'enregistrer.
  findNumberByName() {
    if (!Net.connected) return announce('Nécessite une connexion au serveur multijoueur.', 'assertive');
    AccessibleTextPrompt.open('Trouver un numéro par nom', 'Tapez le nom, ou une partie du nom, de la personne recherchée.', '', (name) => {
      if (!name || !name.trim()) return;
      announce(`Recherche de "${name.trim()}"...`, 'polite');
      Net.findNumber(name.trim(), (results, query) => {
        if (!results.length) return announce(`Aucun numéro trouvé pour "${query}".`, 'assertive');
        // Le menu à cartes est sous le téléphone (z-index) : on ferme le
        // téléphone pour afficher les résultats dans le menu accessible.
        if (this.open) this.closePhone();
        this.findNumberByNameResults(results, query);
      });
    });
  },
  // Affiche la liste de résultats de recherche de numéro dans le menu accessible.
  findNumberByNameResults(results, query) {
    el('menuTitle').textContent = `Numéros trouvés pour "${query}"`;
    const items = results.map((r, i) => ({ id: String(i), title: `${r.name} — ${r.number}`, desc: 'Appeler cette personne, ou enregistrer son numéro dans vos contacts.' }));
    el('menuOverlay').style.display = 'flex';
    renderMenu(items, (sel) => {
      const r = results[parseInt(sel.id, 10)];
      if (!r) { closeMenu(); return; }
      el('menuTitle').textContent = `${r.name} — ${r.number}`;
      renderMenu([
        { id: 'call', title: '📞 Appeler', desc: `Composer le ${r.number}.` },
        { id: 'masked', title: '🕵️ Appeler en masqué', desc: 'Sans révéler votre identité.' },
        { id: 'save', title: '💾 Enregistrer le contact', desc: 'Garder ce numéro sous un nom à vous.' },
        { id: 'back', title: '↩️ Retour', desc: 'Revenir à la liste des résultats.' },
      ], (act) => {
        if (act.id === 'back') { this.findNumberByNameResults(results, query); return; }
        closeMenu();
        if (act.id === 'call') this.callNumber(r.number, r.name, false);
        else if (act.id === 'masked') this.callNumber(r.number, r.name, true);
        else if (act.id === 'save') Game.saveContact(null, r.name, r.number);
      });
    });
  },
  answerCall() {
    if (!this.incomingCall) return;
    AudioLib.stopLoop(this.ringtoneKey);
    Net.callAnswer(this.incomingCall.callId);
    this.currentCall = { name: this.incomingCall.fromName, isPlayer: true, id: this.incomingCall.fromId };
    this.activeCallId = this.incomingCall.callId; this.callState = 'active';
    this.isCaller = false; this.peerVoiceOn = false;
    this.incomingCall = null;
    this.renderApp('call');
    el('callName').textContent = this.currentCall.name; el('callStatus').textContent = 'En communication.';
    const area = el('callMsgArea'); if (area) { area.style.display = 'block'; focusTextInput(el('callMsgInput')); }
    announce(`Appel avec ${this.currentCall.name} en cours.`, 'assertive');
    Net.send({ type: 'voice_toggle', callId: this.activeCallId, on: this.voiceChat });
    this.maybeStartVoice();
  },
  declineCall() {
    if (!this.incomingCall) return;
    AudioLib.stopLoop(this.ringtoneKey);
    Net.callDecline(this.incomingCall.callId);
    announce(`Appel de ${this.incomingCall.fromName} refusé.`, 'polite');
    this.incomingCall = null;
    this.renderHome();
  },
  onCallAnswered(callId, byName) {
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    this.callState = 'active'; this.activeCallId = callId;
    if (el('callStatus')) el('callStatus').textContent = 'En communication.';
    const area = el('callMsgArea'); if (area) { area.style.display = 'block'; focusTextInput(el('callMsgInput')); }
    announce(`${byName || this.currentCall?.name || 'La personne'} décroche. Vous êtes en communication.`, 'assertive');
    Net.send({ type: 'voice_toggle', callId: this.activeCallId, on: this.voiceChat });
    this.maybeStartVoice();
  },
  onCallDeclined(callId) {
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    announce(`${this.currentCall?.name || 'La personne'} refuse votre appel.`, 'assertive');
    this.hangup(true);
  },
  onCallTimeout(callId) {
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    if (this.callState === 'ringing_out') {
      // Nous étions l'appelant : personne n'a décroché en 30 secondes → répondeur
      AudioLib.playOnce('sfx_repondeur');
      if (el('callStatus')) el('callStatus').textContent = 'Pas de réponse. Répondeur.';
      announce('Votre correspondant ne répond pas, veuillez réessayer à nouveau.', 'assertive');
    } else if (this.incomingCall) {
      // Nous étions l'appelé et n'avons pas décroché à temps
      announce('Appel manqué.', 'polite');
    }
    this.incomingCall = null;
    this.hangup(true);
  },
  onCallEnded(callId) {
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    announce('L\'autre personne a raccroché.', 'polite');
    this.hangup(true);
  },
  onCallMessage(callId, fromName, text) {
    speak(`${fromName} dit : ${text}`, 'polite');
    log(`📞 ${fromName} : ${text}`, 'chat');
  },
  sayInCall(text) {
    if (!this.activeCallId) return;
    Net.callMessage(this.activeCallId, text);
    announce(`Vous dites : ${text}`, 'polite');
    log(`📞 Vous : ${text}`, 'chat');
  },
  hangup(silent) {
    if (this.activeCallId && !silent) Net.callEnd(this.activeCallId);
    AudioLib.stopAllRingtones();
    clearTimeout(this.callLocalTimeout);
    VoiceChat.stop();
    this.currentCall = null; this.activeCallId = null; this.callState = null; this.incomingCall = null;
    this.isCaller = false; this.peerVoiceOn = false; this._lastDialedNumber = null;
    if (el('callStatus')) el('callStatus').textContent = 'Raccroché';
    const area = el('callMsgArea'); if (area) area.style.display = 'none';
  },
  onPeerVoiceToggle(callId, on) {
    if (callId !== this.activeCallId) return;
    this.peerVoiceOn = on;
    if (on) { announce('L\'autre personne a activé la voix directe.', 'polite'); this.maybeStartVoice(); }
    else { announce('L\'autre personne a coupé la voix directe.', 'polite'); VoiceChat.stop(); }
  },
  // Le joueur qui a lancé l'appel fait toujours l'offre WebRTC (l'autre attend
  // et répond) : ça évite tout conflit si les deux activent la voix en même temps.
  maybeStartVoice() {
    if (this.voiceChat && this.peerVoiceOn && this.callState === 'active' && this.isCaller) {
      VoiceChat.start(this.activeCallId, true);
    }
  },
  toggleVoiceChat() {
    this.voiceChat = !this.voiceChat;
    el('phoneVoiceBtn').textContent = this.voiceChat ? '🔴 Voix directe ON' : '🎙️ Voix directe';
    el('phoneVoiceBtn').className = this.voiceChat ? 'phone-btn active' : 'phone-btn';
    announce('Chat vocal direct ' + (this.voiceChat ? 'activé' : 'désactivé') + '.', 'polite');
    if (this.activeCallId && this.callState === 'active') {
      Net.send({ type: 'voice_toggle', callId: this.activeCallId, on: this.voiceChat });
      if (this.voiceChat) this.maybeStartVoice();
      else VoiceChat.stop();
    }
  },
  // Garage : montre où se trouve RÉELLEMENT chaque véhicule possédé (garage
  // principal, garage personnel, aéroport, ou ailleurs) et propose seulement
  // les actions cohérentes avec cet emplacement — un véhicule chez soi ne
  // s'appelle pas par livraison, un aéronef ne se livre jamais (voir
  // Game.getVehicleLocationInfo / requestVehicleDelivery / openVehicleTransferMenu).
  renderGarageApp() {
    const div = el('garageAppList'); div.innerHTML = '';
    const owned = Game.ownedVehicles.map(id => City.vehicles.find(v => v.id === id)).filter(Boolean);
    if (!owned.length) div.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">Aucun véhicule possédé.</p>';
    owned.forEach(v => {
      const cls = VEHICLE_CATALOG[v.type];
      const loc = Game.getVehicleLocationInfo(v);
      const locLabel = loc.kind === 'garage_principal' ? `📍 ${loc.poi.name}` : loc.kind === 'garage_maison' ? `📍 Parking personnel (${loc.house.name || 'maison'})` : loc.kind === 'aeroport' ? `📍 ${loc.poi.name}` : '📍 Ailleurs en ville';
      const serviceLabel = v.pendingService ? ` — ${v.pendingService === 'livraison' ? 'livraison en cours' : 'transfert en cours'}` : '';
      const p = document.createElement('div'); p.style.cssText = 'background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;';
      let buttons = `<button class="phone-btn" data-act="locate" data-id="${v.id}">📍 Localiser</button>`;
      if (!v.pendingService) {
        if (!cls?.flies && loc.kind === 'garage_principal') buttons += ` <button class="phone-btn" data-act="call" data-id="${v.id}">🚗 Appeler (livraison)</button>`;
        if (!cls?.flies && loc.kind === 'garage_maison') buttons += ` <button class="phone-btn" data-act="transfer" data-id="${v.id}">🚚 Transférer vers un parking principal</button>`;
      }
      p.innerHTML = `<strong>${v.name}</strong><br><span style="color:var(--muted);font-size:0.75rem;">Essence ${Math.round(v.fuel * 100)}%, État ${Math.round(v.hp)}%. ${locLabel}${serviceLabel}</span><br>${buttons}`;
      p.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const vv = City.vehicles.find(x => x.id === b.dataset.id);
        if (!vv) return;
        if (b.dataset.act === 'locate') announce(`${vv.name} : ${Game.describeVehicleLocationFull(vv)}.`, 'assertive');
        else if (b.dataset.act === 'call') Game.requestVehicleDelivery(vv);
        else if (b.dataset.act === 'transfer') Game.openVehicleTransferMenu(vv);
      }));
      div.appendChild(p);
    });
  },
};

/* ============================================================
   COMPUTER SYSTEM — CITY_OS, files, network, hacking, bank
============================================================ */
const Computer = {
  open: false, files: [], hacked: new Set(), logs: [], bankAccounts: [],
  boot() {
    if (!Game.inventory.some(i => i.category === 'ordinateur' || i.id === 'ordinateur')) return announce('Vous avez besoin d\'un ordinateur. Achetez-le en magasin.', 'assertive');
    Audio.ensure(); Audio.click(); this.open = true; el('computerOverlay').style.display = 'flex';
    this.files = [
      { name: 'readme.txt', content: 'CITY_OS v2.1 - Système d\'exploitation local.' },
      { name: 'contacts.csv', content: 'Police,17\nSAMU,15\nDépannage,800' },
      { name: 'carte_ville.dat', content: 'Carte 240x240. Districts : Centre, Nord, Sud, Industriel, Port, Mine, Gang.' },
    ];
    this.bankAccounts = [{ iban: 'CI-12345', balance: Game.bank, owner: 'Joueur' }];
    this.log('Système démarré. CITY_OS v2.1');
    announce('Ordinateur allumé, CITY_OS. Tapez une commande puis Entrée ou Exécuter. Tapez help pour la liste des commandes.', 'assertive');
    const input = el('computerInput'); if (input) focusTextInput(input);
  },
  close() { this.open = false; el('computerOverlay').style.display = 'none'; document.activeElement?.blur(); announce('Ordinateur éteint.', 'polite'); },
  log(msg) { this.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`); if (this.logs.length > 30) this.logs.pop(); },
  runCommand(cmd) {
    const term = el('computerTerminal');
    // Le terminal n'est qu'un texte affiché : sans annonce vocale, un joueur
    // non-voyant tape une commande, valide, et n'a AUCUN retour perceptible
    // (« j'appuie sur valider, rien ne se passe »). On annonce donc chaque
    // résultat en plus de l'afficher.
    const out = (t) => { term.textContent += '\n' + t; announce(t, 'assertive'); };
    if (!cmd.trim()) return;
    this.log('> ' + cmd);
    const c = cmd.toLowerCase().trim();
    if (c.startsWith('help')) {
      out('Commandes : help, files, read <fichier>, hack <cible>, network, bank, transfer <montant>, scan, clear, exit');
    } else if (c === 'files') {
      out('Fichiers : ' + this.files.map(f => f.name).join(', '));
    } else if (c.startsWith('read ')) {
      const name = cmd.slice(5).trim(); const f = this.files.find(x => x.name === name);
      out(f ? f.content : 'Fichier non trouvé.');
    } else if (c.startsWith('hack ')) {
      const target = cmd.slice(5).trim();
      if (target === 'banque') this.hackBank();
      else if (target === 'coffre') this.hackSafe();
      else out('Cibles : banque, coffre');
    } else if (c === 'network') {
      out('Réseaux détectés : Police_Secure, BankNet, Gang_Link, Hôpital_Santé, Caméra_Ville.');
    } else if (c === 'bank') {
      this.bankAccounts[0].balance = Game.bank;
      out('Compte : ' + this.bankAccounts[0].iban + ' | Solde : ' + UTIL.formatMoney(this.bankAccounts[0].balance));
    } else if (c.startsWith('transfer ')) {
      const amt = parseInt(cmd.slice(9).replace(/\D/g, ''), 10);
      if (amt > 0 && Game.money >= amt) { Game.money -= amt; Game.bank += amt; this.bankAccounts[0].balance = Game.bank; out('Dépôt de ' + UTIL.formatMoney(amt) + ' effectué.'); this.log('Dépôt ' + amt); }
      else out('Fonds insuffisants ou montant invalide.');
    } else if (c === 'scan') {
      out('Scan réseau... ' + (UTIL.chance(0.4) ? 'Vulnérabilité trouvée !' : 'Aucune vulnérabilité.'));
    } else if (c === 'clear') {
      term.textContent = 'CITY_OS v2.1';
      announce('Terminal effacé.', 'polite');
    } else if (c === 'exit') {
      this.close();
    } else {
      out('Commande inconnue. Tapez help.');
    }
    updateHud();
  },
  hackBank() {
    const term = el('computerTerminal');
    if (Game.wanted > 60) { term.textContent += '\nAlerte police : trop recherché.'; announce('Alerte police : trop recherché pour pirater la banque.', 'assertive'); return; }
    if (this.hacked.has('banque')) { term.textContent += '\nBanque déjà piratée.'; announce('Banque déjà piratée.', 'polite'); return; }
    const amount = UTIL.randInt(50000, 200000);
    Game.money += amount; this.hacked.add('banque'); this.log('Banque piratée : +' + amount);
    term.textContent += '\nPiratage en cours...\n' + 'Succès ! Vous transférez ' + UTIL.formatMoney(amount) + ' FCFA.';
    announce(`Piratage réussi ! Vous transférez ${UTIL.formatMoney(amount)}.`, 'assertive');
    Game.wanted += 30; Audio.cash(); alertUser('Piratage détecté. Niveau de recherche augmenté.');
    Game.reportCrimeToPolice('braquage_banque', 'Banque centrale');
    updateHud();
  },
  hackSafe() {
    const term = el('computerTerminal');
    const safe = Game.ownedHouses.map(id => City.houses.find(h => h.id === id)).find(h => h && h.safe && !h.safe.opened);
    if (!safe) { term.textContent += '\nAucun coffre-fort piratable.'; announce('Aucun coffre-fort piratable.', 'assertive'); return; }
    const amount = UTIL.randInt(10000, 80000);
    Game.money += amount; safe.safe.opened = true; this.log('Coffre piraté : +' + amount);
    term.textContent += '\nCoffre ouvert ! ' + UTIL.formatMoney(amount) + ' récupérés.'; Audio.cash();
    announce(`Coffre-fort ouvert ! ${UTIL.formatMoney(amount)} récupérés.`, 'assertive');
    updateHud();
  },
  renderMenu(cmd) {
    if (cmd === 'files') this.runCommand('files');
    if (cmd === 'network') this.runCommand('network');
    if (cmd === 'hack') this.runCommand('hack banque');
    if (cmd === 'bank') this.runCommand('bank');
    if (cmd === 'logs') {
      const txt = this.logs.length ? this.logs.slice(0, 15).join('. ') : 'Aucun log.';
      el('computerTerminal').textContent = 'Logs système :\n' + this.logs.slice(0, 15).join('\n');
      announce('Logs système : ' + txt, 'assertive');
    }
    if (cmd === 'help') this.runCommand('help');
    el('computerInput').focus();
  },
};

/* ============================================================
   SURVIVAL KITS, REPAIR KITS, PHARMACY, DOCTORS, SAFE BOXES
============================================================ */
