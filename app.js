/* Voice Helper: everything you see, hear and tap.
   Plain JavaScript, no libraries, no build step.
   Text from people, microphones and the model is put on the page with textContent, never as HTML. */
(function () {
  'use strict';

  var C = window.VoiceCore;
  var CLAUDE = 'https://api.anthropic.com/v1';
  var HOME = location.pathname.replace(/[^/]*$/, '');   // so two copies at one address keep separate settings
  var KEY_SETTINGS = 'voice-helper:v1:' + HOME + ':settings';
  var KEY_KEY = 'voice-helper:v1:' + HOME + ':key';
  var VOICES = 'https://api.elevenlabs.io';   // only used if someone sets up their own voice
  var KEY_VOICE = 'voice-helper:v1:' + HOME + ':voicekey';

  /* The microphone stays on for the whole conversation. Hearing costs nothing. Asking for replies costs money,
     and speech can set that off with nobody tapping, so the asking is fenced in, not the listening. */
  var GAP_MS = 1000;        // never more than one request a second
  var QUIET_MS = 1200;      // after speech, wait for a pause before asking for replies
  var UNATTENDED = 8;       // after this many requests in a row with no tap (a television, say), keep listening but stop asking
  var PAUSE_EVERY = 100;    // and after this many in all, wait for a tap before making more

  function $(id) { return document.getElementById(id); }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text) { var b = make('button', className, text); b.type = 'button'; return b; }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function erase(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to erase */ } }
  function parse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

  /* A button that has to be tapped twice, for anything that cannot be undone. */
  function twoStep(node, action) {
    var label = '', armed = false, timer = null;
    function reset() { if (armed) node.textContent = label; armed = false; clearTimeout(timer); node.classList.remove('armed'); }
    node.addEventListener('click', function () {
      if (!armed) {
        armed = true; label = node.textContent; node.textContent = 'Tap again to confirm'; node.classList.add('armed');
        timer = setTimeout(reset, 4000);
        return;
      }
      reset(); action();
    });
    return reset;
  }

  /* ---------- what the page knows ---------- */
  var settings = C.validateSettings(parse(read(KEY_SETTINGS)));
  var apiKey = '';          // lives here, in memory. It is never shown again, logged, or put in an address.
  var keyChecked = false;   // true once the service has accepted it
  var connected = false;    // for Other, which may need no key at all
  var voiceKey = '';        // a separate key, for the voice service only. Same rules.
  var voiceChecked = false;
  var turns = [];           // the conversation, in memory only
  var steer = '';
  var demoStep = -1;        // which demo line was last played
  var requests = 0, allowance = PAUSE_EVERY, sinceTap = 0;

  function other() { return settings.provider === 'other'; }
  /* A key belongs to the place it was typed for, and is never sent anywhere else. */
  function target() { return other() ? settings.address : 'claude'; }
  function keyLooksRight(k) { return other() ? C.looksLikeOtherKey(k) : C.looksLikeKey(k); }
  function rememberKey() { if (apiKey) write(KEY_KEY, JSON.stringify({ to: target(), key: apiKey })); }
  function remembered() { return read(KEY_KEY) !== null; }

  (function () {
    var saved = parse(read(KEY_KEY));
    if (saved && typeof saved === 'object' && target() && saved.to === target() && keyLooksRight(saved.key)) apiKey = saved.key;
    else erase(KEY_KEY);
    connected = other() && Boolean(settings.address) && (Boolean(apiKey) || C.isThisComputer(settings.address));
    var voice = read(KEY_VOICE);
    if (C.looksLikeKey(voice)) voiceKey = voice; else erase(KEY_VOICE);
  })();

  function saveSettings() { write(KEY_SETTINGS, JSON.stringify(settings)); }
  function live() { return other() ? connected : Boolean(apiKey); }
  function status(text) { $('status').textContent = text || ''; }

  /* ---------- speaking ---------- */
  var canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  var speaking = false, speechRun = 0, utterance = null, speechTimer = null;
  var AudioMaker = window.AudioContext || window.webkitAudioContext;
  var audio = null, sound = null, fetchingVoice = null;

  function voices() { return canSpeak ? window.speechSynthesis.getVoices() : []; }
  function chosenVoice() {
    var list = voices();
    for (var i = 0; i < list.length; i++) if (list[i].voiceURI === settings.voice) return list[i];
    return null;
  }
  /* Each thing said gets a number. A late "finished" from an earlier one is ignored,
     so the microphone is never reopened while the device is still talking. */
  function hush() {
    speechRun += 1; clearTimeout(speechTimer); utterance = null;
    if (fetchingVoice) { var f = fetchingVoice; fetchingVoice = null; f.abort(); }
    if (sound) { var s = sound; sound = null; s.onended = null; try { s.stop(); } catch (e) { /* already stopped */ } }
    if (canSpeak) window.speechSynthesis.cancel();
    speaking = false;
  }
  function endSpeech(run) {
    if (run !== speechRun) return;
    clearTimeout(speechTimer); utterance = null; sound = null; speaking = false;
    showListening(); resumeListening();
  }
  function computerVoice(text, run) {
    if (!canSpeak) { endSpeech(run); return; }
    var u = new SpeechSynthesisUtterance(text);
    var v = chosenVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = settings.rate;
    u.onend = u.onerror = function () { endSpeech(run); };
    utterance = u;   // held on to, because some browsers drop it mid-sentence otherwise
    speechTimer = setTimeout(function () { endSpeech(run); }, 4000 + text.length * 150 / settings.rate);   // in case "finished" never comes
    window.speechSynthesis.speak(u);
  }
  /* ---------- the person's own voice, from the voice service, if they set it up ---------- */
  function ownVoiceOn() { return Boolean(voiceKey && settings.ownVoice && AudioMaker); }
  function voiceCall(pathname, options, signal) {
    options.headers = { 'xi-api-key': voiceKey };
    if (options.body) options.headers['content-type'] = 'application/json';
    options.credentials = 'omit'; options.referrerPolicy = 'no-referrer'; options.cache = 'no-store';
    options.redirect = 'error';
    options.signal = signal;
    return fetch(VOICES + pathname, options);
  }
  /* Only ever set off by a tap. The sound is played and let go: nothing is kept. */
  function ownVoice(text, run) {
    if (!audio) audio = new AudioMaker();
    if (audio.state === 'suspended') audio.resume().catch(function () { /* the stand-in will speak */ });   // browsers want this done during the tap
    var control = new AbortController(), timer = setTimeout(function () { control.abort(); }, 8000);
    fetchingVoice = control;
    voiceCall('/v1/text-to-speech/' + settings.ownVoice, { method: 'POST', body: JSON.stringify({ text: text }) }, control.signal).then(function (reply) {
      if (!reply.ok) throw new Error('refused');
      return reply.arrayBuffer();
    }).then(function (bytes) {
      return new Promise(function (resolve, reject) { audio.decodeAudioData(bytes, resolve, reject); });
    }).then(function (buffer) {
      clearTimeout(timer);
      if (run !== speechRun) return;
      fetchingVoice = null;
      sound = audio.createBufferSource();
      sound.buffer = buffer; sound.connect(audio.destination);
      sound.onended = function () { endSpeech(run); };
      speechTimer = setTimeout(function () { endSpeech(run); }, buffer.duration * 1000 + 1500);   // in case "finished" never comes
      sound.start();
    }).catch(function () {
      clearTimeout(timer);
      if (run !== speechRun) return;
      fetchingVoice = null;
      computerVoice(text, run);   // never leave the person silent
      var note = 'Your own voice could not be reached, so the device spoke.';
      if ($('voiceDialog').open) $('voiceStatus').textContent = note; else status(note);
    });
  }

  /* While the device is talking for the person, the microphone is covered, so it never hears itself. */
  function sayAloud(text) {
    hush();
    var run = speechRun;
    speaking = true; pauseListening(); showListening();
    if (ownVoiceOn()) ownVoice(text, run); else computerVoice(text, run);
  }

  /* ---------- the conversation ---------- */
  var interimNode = null;

  function turnNode(className, label, text) {
    var node = make('div', 'turn ' + className);
    node.appendChild(make('small', '', label));
    node.appendChild(document.createTextNode(text));
    return node;
  }
  function clearInterim() { if (interimNode) { interimNode.remove(); interimNode = null; } }
  function toBottom() { $('talk').scrollTop = $('talk').scrollHeight; }
  function showInterim(text) {
    clearInterim();
    if (!text) return;
    interimNode = turnNode('them interim', 'Hearing', text);
    interimNode.setAttribute('aria-hidden', 'true');   // half-heard words are not read out
    $('talk').appendChild(interimNode); toBottom();
  }
  function resetTalk() {
    turns = []; interimNode = null;
    $('talk').textContent = '';
    $('talk').appendChild(make('p', 'empty', 'The conversation will show here.'));
  }
  function addTurn(who, text) {
    var box = $('talk'), empty = box.querySelector('.empty');
    if (empty) empty.remove();
    clearInterim();
    turns.push({ who: who, text: text, at: Date.now() });
    box.appendChild(turnNode(who, who === 'me' ? 'Me' : 'Them', text));
    if (turns.length > 60) { turns.shift(); box.firstElementChild.remove(); }
    toBottom();
  }

  /* source: 'speech', 'typed' or 'demo' */
  function theySaid(raw, source) {
    var text = C.cleanText(raw, C.LIMITS.heard), last = turns[turns.length - 1];
    if (!text) return;
    if (source === 'speech' && last && last.who === 'them' && last.text === text && Date.now() - last.at < 3000) return;   // some phones report a line twice
    addTurn('them', text);
    setSteer('');
    $('hint').value = '';
    if (source !== 'speech') { suggest(false); return; }
    stopRequest();
    quiet = setTimeout(function () { quiet = null; suggest(true); }, QUIET_MS);   // let them finish the thought
  }

  function iSay(raw) {
    var text = C.cleanText(raw, C.LIMITS.reply);
    if (!text) return;
    var hadFocus = $('replies').contains(document.activeElement);
    stopRequest();
    addTurn('me', text);
    sayAloud(text);
    $('hint').value = '';
    setSteer('');
    showReplies([]);
    status(!live() ? 'Tap Next line to carry on.' : listening ? 'Listening for what they say next.' : 'Type what they say next, or tap Suggest for something else to say.');
    if (hadFocus) (live() ? $('suggest') : $('demoNext')).focus();   // keyboard and switch users keep their place
  }

  /* ---------- replies on screen ---------- */
  function replyButton(text) {
    var b = button('reply', text);
    b.addEventListener('click', function () { iSay(text); });
    return b;
  }
  /* The biggest text that fits the button, without cutting a word in two. */
  var SIZES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
  function fit(b) {
    for (var i = 0; i < SIZES.length; i++) {
      b.className = 'reply measuring ' + SIZES[i];
      if (b.scrollHeight <= b.clientHeight + 1 && b.scrollWidth <= b.clientWidth + 1) break;
    }
    b.classList.remove('measuring');
  }
  function fitAll() { each($('replies').querySelectorAll('button.reply'), fit); }
  /* Put a reply in its place, size it, and tell screen readers which key says it. */
  function settle(b) {
    fit(b);
    if (settings.numberKeys) b.setAttribute('aria-keyshortcuts', String(Array.prototype.indexOf.call($('replies').children, b) + 1));
  }
  function showReplies(list, waitingFor) {
    var box = $('replies');
    box.textContent = '';
    list.forEach(function (r) { settle(box.appendChild(replyButton(r))); });
    for (var i = list.length; i < (waitingFor || 0); i++) {
      var w = make('div', 'reply waiting', '...');
      w.setAttribute('aria-hidden', 'true');
      box.appendChild(w);
    }
  }
  /* Buttons already on screen are left alone as more arrive, so a slow press is never lost. */
  function fillNext(text) {
    var box = $('replies'), slot = box.querySelector('.waiting'), b = replyButton(text);
    if (slot) box.replaceChild(b, slot); else box.appendChild(b);
    settle(b);
  }
  function dropWaiting() { each($('replies').querySelectorAll('.waiting'), function (w) { w.remove(); }); }

  function setSteer(id) {
    steer = id;
    each($('steers').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.steer === id)); });
  }

  /* ---------- asking for replies ---------- */
  var inFlight = null, lastStart = 0, queued = null, quiet = null, extras = true;

  function stopRequest() {
    clearTimeout(queued); queued = null;
    clearTimeout(quiet); quiet = null;
    if (inFlight) { var c = inFlight; inFlight = null; c.abort(); }
  }

  function call(pathname, options, signal) {
    var headers = {};
    if (options.body) headers['content-type'] = 'application/json';
    if (other()) {
      if (apiKey) headers.authorization = 'Bearer ' + apiKey;
    } else {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';   // the service's switch for calls made straight from a web page
    }
    options.headers = headers;
    options.credentials = 'omit'; options.referrerPolicy = 'no-referrer'; options.cache = 'no-store';
    options.redirect = 'error';   // the key must never follow a redirect to another address
    options.signal = signal;
    return fetch((other() ? settings.address : CLAUDE) + pathname, options);
  }

  function standIn(note) { showReplies(C.FALLBACK); status(note); }

  /* `auto` is true when speech set this off, false when a person tapped or typed. */
  function suggest(auto) {
    stopRequest();
    if (!live()) {
      if (demoStep < 0) { status('Tap Next line to start the demo.'); return; }
      if ($('hint').value.trim()) { status('Turning a word or two into full replies only works once Settings is filled in. Say this works now.'); return; }
      showReplies(C.demoReplies(demoStep, steer));
      status(steer && ['yes', 'no', 'ask'].indexOf(steer) === -1 ? 'The demo only knows Yes, No and Ask a question. Once it is set up, every button works.' : 'Made-up replies. Tap one to hear it.');
      return;
    }
    if (!settings.model) { showReplies([]); status('Choose a model in Settings first.'); return; }
    if (auto && (sinceTap >= UNATTENDED || requests >= allowance)) {
      showReplies([]);
      status('Still listening. No one has tapped for a while, so replies are on hold. Tap Suggest when you want them.');
      return;
    }
    if (auto) sinceTap += 1;
    else if (requests >= allowance) allowance = requests + PAUSE_EVERY;
    showReplies([], C.LIMITS.replies);
    status('Thinking...');
    queued = setTimeout(function () { queued = null; send(false); }, Math.max(0, GAP_MS - (Date.now() - lastStart)));
  }

  function send(isRetry) {
    var control = new AbortController(), shown = 0, stopReason = '', failed = false, timedOut = false;
    var timer = setTimeout(function () { timedOut = true; control.abort(); }, 30000);
    inFlight = control; lastStart = Date.now(); requests += 1;

    function mine() { return inFlight === control; }   // false once a reply was tapped or a newer request took over
    function finish(note) {
      if (!mine()) return;
      inFlight = null; clearTimeout(timer); dropWaiting();
      if (shown) status('Tap a reply to say it. Requests this visit: ' + requests + '.');
      else standIn(note);
    }

    var collector = C.createReplyCollector(function (reply) {
      if (!mine()) return;
      fillNext(reply); shown += 1;
      if (shown >= C.LIMITS.replies) { finish(''); control.abort(); }   // got what we came for: stop paying for more
    });
    var elsewhere = other();
    var thoughts = C.createThoughtFilter(function (text) { collector.add(text); });
    var feed = C.createStreamReader(function (event) {
      if (elsewhere) {
        var choice = Array.isArray(event.choices) ? event.choices[0] : null;
        if (choice && choice.delta && typeof choice.delta.content === 'string') thoughts.add(choice.delta.content);
        if (choice && choice.finish_reason) stopReason = String(choice.finish_reason);
        if (event.error) failed = true;
        return;
      }
      if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') collector.add(event.delta.text);
      else if (event.type === 'content_block_stop') collector.breakLine();
      else if (event.type === 'message_delta' && event.delta) stopReason = String(event.delta.stop_reason || '');
      else if (event.type === 'error') failed = true;
    });
    var body = (elsewhere ? C.buildOtherRequest : C.buildRequest)({
      model: settings.model, turns: turns, steer: steer, hint: $('hint').value, about: settings.about, extras: extras
    });

    call(elsewhere ? '/chat/completions' : '/messages', { method: 'POST', body: JSON.stringify(body) }, control.signal).then(function (reply) {
      if (!mine()) return false;
      if (reply.status === 400 && extras && !isRetry) {   // perhaps a model that does not know the optional settings
        extras = false; clearTimeout(timer); send(true);
        return false;
      }
      if (reply.status === 400 && isRetry) extras = true;   // it was not the optional settings after all
      if (!reply.ok) { finish(C.messageForStatus(reply.status)); return false; }
      var reader = reply.body.getReader(), decoder = new TextDecoder();
      function pump() {
        return reader.read().then(function (part) {
          if (part.done) return true;
          if (!mine()) { reader.cancel().catch(function () { /* already closed */ }); return false; }
          feed(decoder.decode(part.value, { stream: true }));
          return pump();
        });
      }
      return pump();
    }).then(function (whole) {
      if (!whole || !mine()) return;
      thoughts.end();
      collector.end((elsewhere ? stopReason !== 'length' : stopReason === 'end_turn') && !failed);
      finish(failed ? 'The service is busy. Try again in a moment.' : 'No replies came back for that, so here are some stand-ins.');
    }).catch(function () {
      finish(timedOut ? 'That took too long. Try again, or pick a faster model in Settings.' : 'Could not reach the service. Check the internet connection.');
    }).then(function () { clearTimeout(timer); });
  }

  /* ---------- listening ----------
     Once started, the microphone stays on until someone turns it off. It is only covered for a moment:
     while the device is speaking, while a pop-up is open, and while the page is out of sight. */
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizer = null, listening = false, startedAt = 0, quickEnds = 0, restart = null;

  function popUpOpen() { return $('settingsDialog').open || $('voiceDialog').open; }
  function canHear() { return listening && !speaking && !document.hidden && !popUpOpen(); }

  function showListening() {
    $('listen').classList.toggle('on', listening);
    $('listen').textContent = !listening ? 'Start listening' : speaking ? 'Speaking...' : 'Listening. Tap to stop';
    $('listen').setAttribute('aria-pressed', String(listening));
    $('talk').classList.toggle('speaking', speaking);
  }
  function pauseListening() {
    clearTimeout(restart); restart = null;
    clearInterim();
    if (recognizer) { try { recognizer.abort(); } catch (e) { /* already stopped */ } }   // abort, not stop: nothing more is delivered
  }
  function resumeListening() {
    if (!recognizer || !canHear()) return;
    startedAt = Date.now();
    try { recognizer.start(); } catch (e) { /* already running */ }
  }
  function stopListening(note) {
    var was = listening;
    listening = false; pauseListening(); showListening();
    if (was || note) status(note || '');
  }

  function startListening() {
    if (!Recognition) return;
    if (!recognizer) {
      recognizer = new Recognition();
      recognizer.continuous = true; recognizer.interimResults = true;
      recognizer.lang = navigator.language || 'en-US';
      recognizer.onresult = function (e) {
        if (!canHear()) return;
        quickEnds = 0;
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var text = e.results[i][0].transcript;
          if (e.results[i].isFinal) theySaid(text, 'speech'); else interim += text;
        }
        showInterim(C.cleanText(interim, C.LIMITS.heard));
      };
      recognizer.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          stopListening('The microphone is blocked. Allow it in the browser, or type what they said.');
        }
      };
      /* Browsers stop listening after a pause, so it is started again. If it keeps stopping at once, something is wrong: give up. */
      recognizer.onend = function () {
        if (!canHear()) return;
        quickEnds = Date.now() - startedAt < 1500 ? quickEnds + 1 : 0;
        if (quickEnds >= 3) { stopListening('Listening keeps stopping on this browser. Type what they said.'); return; }
        clearTimeout(restart);
        restart = setTimeout(resumeListening, 250 + quickEnds * 750);
      };
    }
    listening = true; quickEnds = 0; sinceTap = 0;
    showListening(); resumeListening();
    status('Listening. Please tell the people around you.');
  }

  /* ---------- key and models ---------- */
  function showMode() {
    var on = live();
    $('mode').textContent = on ? 'Live' : 'Demo';
    $('mode').classList.toggle('live', on);
    $('demoNote').hidden = on;
    $('demoNext').hidden = on;
    /* The demo is a script. It cannot answer real speech, so it does not pretend to listen. */
    $('listen').hidden = !on || !Recognition;
    $('heard').hidden = !on; $('heardAdd').hidden = !on;
    $('keyStatus').textContent = !on ? (other() ? 'Not connected. Demo mode.' : 'No key. Demo mode.')
      : !apiKey ? 'Connected with no key.'
      : remembered() ? 'A key is set and remembered on this device.' : 'A key is set for this visit only.';
  }

  /* Always say where things are about to be sent, before anything is. */
  function showGoesTo() {
    var host = other() ? C.hostOf($('address').value) : C.hostOf(CLAUDE);
    $('goesTo').textContent = host ? 'The key, the conversation and About me are sent to: ' + host
      : 'The key, the conversation and About me are sent to the address above. It has to start with https://, or http://localhost for a program on this computer.';
  }
  function showProvider() {
    var o = other();
    $('provider').value = settings.provider;
    $('claudeHelp').hidden = o; $('otherHelp').hidden = !o;
    $('address').value = settings.address;
    $('keyLabel').textContent = o ? 'Key, if it needs one' : 'API key';
    resetForget();
    $('keyUse').textContent = o ? 'Connect' : 'Use this key';
    $('keyForget').textContent = o ? 'Disconnect' : 'Forget key';
    showGoesTo();
  }

  function fillModels(list) {
    var select = $('model');
    select.textContent = '';
    var first = make('option', '', list.length ? 'Choose a model' : live() ? 'No models listed' : other() ? 'Connect to see the list' : 'Add a key to see the list');
    first.value = ''; select.appendChild(first);
    list.forEach(function (m) { var o = make('option', '', m.name); o.value = m.id; select.appendChild(o); });
    select.disabled = !list.length;
    /* Nothing is picked for you: models differ a lot in speed and price. */
    var known = list.some(function (m) { return m.id === settings.model; });
    select.value = known ? settings.model : '';
    if (list.length && !known && settings.model) { settings.model = ''; saveSettings(); }
    /* Not every program lists its models. Then the name can be typed. */
    $('modelTypedRow').hidden = !(other() && live() && !list.length);
    $('modelTyped').value = list.length ? '' : settings.model;
  }

  function loadModels(remember) {
    keyChecked = false;
    if (!live()) { fillModels([]); return; }
    var control = new AbortController(), timer = setTimeout(function () { control.abort(); }, 15000), usedKey = apiKey;
    var usedTarget = target();
    function stale() { return usedKey !== apiKey || usedTarget !== target() || !live(); }
    $('keyStatus').textContent = other() ? 'Connecting...' : 'Checking the key...';
    call(other() ? '/models' : '/models?limit=100', { method: 'GET' }, control.signal).then(function (reply) {
      if (stale()) return null;
      if (!reply.ok) {
        fillModels([]);
        $('keyStatus').textContent = other() && (reply.status === 404 || reply.status === 405) ? 'It answered, but did not list its models. Type the model name.' : C.messageForStatus(reply.status);
        return null;
      }
      return reply.json().then(function (data) {
        if (stale()) return;
        keyChecked = true;
        if (remember) rememberKey();   // kept only once the service has accepted it
        fillModels(C.modelsFromReply(data)); showMode();
        if (!settings.model) $('keyStatus').textContent += ' Now choose a model.';
      });
    }).catch(function () {
      if (stale()) return;
      fillModels([]);
      $('keyStatus').textContent = other() ? 'Nothing answered at that address. If it is a program on this computer, check that it is running and that it allows this page.'
        : 'Could not reach the service to check the key.';
    }).then(function () { clearTimeout(timer); });
  }

  function freshStart() {
    stopRequest(); hush();
    demoStep = -1;
    $('hint').value = ''; $('heard').value = ''; setSteer(''); resetTalk(); showReplies([]); status('');
  }

  function useKey() {
    var typed = $('key').value.trim();
    $('key').value = '';   // never left sitting in the field
    var address = other() ? C.cleanAddress($('address').value) : '';
    if (other() && !address) { $('keyStatus').textContent = 'That address will not work.'; showGoesTo(); return; }
    if (other() ? (typed && !keyLooksRight(typed)) : !keyLooksRight(typed)) { $('keyStatus').textContent = 'That does not look like a key.'; return; }
    var wasDemo = !live();
    stopRequest(); erase(KEY_KEY);
    /* The key and the address are taken together, at one tap, so a key only ever goes where it was meant to. */
    apiKey = typed; extras = true;
    if (other()) { change({ address: address, model: address === settings.address ? settings.model : '' }); connected = true; $('address').value = address; showGoesTo(); }
    if (wasDemo) freshStart();   // the made-up conversation does not carry over
    showMode(); loadModels($('remember').checked);
  }

  function forgetKey() {
    stopListening(); freshStart();
    apiKey = ''; keyChecked = false; connected = false; erase(KEY_KEY);
    $('key').value = ''; $('remember').checked = false;
    fillModels([]); showMode();
  }
  var resetForget = twoStep($('keyForget'), forgetKey);

  /* Switching between Claude and Other drops the key first. */
  function switchProvider(next) {
    forgetKey();
    change({ provider: next, model: '' });
    showProvider(); fillModels([]); showMode();
  }

  /* ---------- setting up your own voice ---------- */
  function showVoice() {
    $('openVoice').textContent = ownVoiceOn() ? 'Own voice: on' : 'Use your own voice';
    $('voiceTry').disabled = !ownVoiceOn();
  }
  function fillOwnVoices(list) {
    var select = $('ownVoice');
    select.textContent = '';
    var first = make('option', '', list.length ? 'Choose a voice' : voiceKey ? 'No voices listed' : 'Connect to see your voices');
    first.value = ''; select.appendChild(first);
    list.forEach(function (v) { var o = make('option', '', v.name + (v.mine ? ' (yours)' : '')); o.value = v.id; select.appendChild(o); });
    select.disabled = !list.length;
    var known = list.some(function (v) { return v.id === settings.ownVoice; });
    select.value = known ? settings.ownVoice : '';
    if (list.length && !known && settings.ownVoice) change({ ownVoice: '' });
    showVoice();
  }
  function voiceNote() {
    return !AudioMaker ? 'This browser cannot play sound this way, so the device\'s voice is used.'
      : !voiceKey ? 'Not connected. The device\'s voice is used.'
      : read(KEY_VOICE) !== null ? 'Connected. The key is remembered on this device.' : 'Connected for this visit only.';
  }
  function loadOwnVoices(remember) {
    voiceChecked = false;
    if (!voiceKey) { fillOwnVoices([]); return; }
    var control = new AbortController(), timer = setTimeout(function () { control.abort(); }, 15000), usedKey = voiceKey;
    $('voiceStatus').textContent = 'Connecting...';
    voiceCall('/v2/voices?page_size=100', { method: 'GET' }, control.signal).then(function (reply) {
      if (usedKey !== voiceKey) return null;
      if (!reply.ok) {
        fillOwnVoices([]);
        $('voiceStatus').textContent = reply.status === 401 || reply.status === 403 ? 'That key was not accepted. It needs to be allowed to read voices and to turn text into speech.' : C.messageForStatus(reply.status);
        return null;
      }
      return reply.json().then(function (data) {
        if (usedKey !== voiceKey) return;
        voiceChecked = true;
        if (remember) write(KEY_VOICE, voiceKey);   // kept only once the service has accepted it
        fillOwnVoices(C.voicesFromReply(data));
        $('voiceStatus').textContent = voiceNote() + (settings.ownVoice ? '' : ' Now choose a voice.');
      });
    }).catch(function () {
      if (usedKey === voiceKey) { fillOwnVoices([]); $('voiceStatus').textContent = 'Could not reach the voice service.'; }
    }).then(function () { clearTimeout(timer); });
  }
  function useVoiceKey() {
    var typed = $('voiceKey').value.trim();
    $('voiceKey').value = '';   // never left sitting in the field
    if (!C.looksLikeKey(typed)) { $('voiceStatus').textContent = 'That does not look like a key.'; return; }
    hush(); erase(KEY_VOICE);
    voiceKey = typed;
    loadOwnVoices($('voiceRemember').checked);
  }
  function forgetVoiceKey() {
    hush(); endSpeech(speechRun);
    voiceKey = ''; voiceChecked = false; erase(KEY_VOICE);
    $('voiceKey').value = ''; $('voiceRemember').checked = false;
    change({ ownVoice: '' }); fillOwnVoices([]);
    $('voiceStatus').textContent = voiceNote();
  }
  var resetVoiceForget = twoStep($('voiceForget'), forgetVoiceKey);

  /* ---------- settings ---------- */
  function fillVoices() {
    var select = $('voice');
    select.textContent = '';
    var first = make('option', '', canSpeak ? "This device's usual voice" : 'This browser cannot speak');
    first.value = ''; select.appendChild(first);
    var mine = (navigator.language || 'en').slice(0, 2).toLowerCase();
    function rank(v) { return (v.lang.slice(0, 2).toLowerCase() === mine ? '0' : '1') + v.lang + v.name; }
    voices().slice().sort(function (a, b) { return rank(a).localeCompare(rank(b)); }).forEach(function (v) {
      var o = make('option', '', v.name + ' (' + v.lang + ')' + (v.localService === false ? ', needs internet' : ''));
      o.value = v.voiceURI; select.appendChild(o);
    });
    select.value = chosenVoice() ? settings.voice : '';
  }
  function change(next) {
    var merged = { voice: settings.voice, rate: settings.rate, model: settings.model, about: settings.about, ownVoice: settings.ownVoice, numberKeys: settings.numberKeys, provider: settings.provider, address: settings.address };
    Object.keys(next).forEach(function (k) { merged[k] = next[k]; });
    settings = C.validateSettings(merged);
    saveSettings();
  }

  /* ---------- show the page, then wire it up ---------- */
  C.STEERS.forEach(function (s) {
    var b = button('', s.label);
    b.dataset.steer = s.id;
    b.addEventListener('click', function () { setSteer(s.id); suggest(false); });
    $('steers').appendChild(b);
  });
  setSteer('');
  resetTalk();
  showReplies([]);
  showMode();
  $('remember').checked = remembered();
  showProvider();
  showVoice();
  if (!Recognition) $('heard').placeholder = 'Type what they said';
  showListening();
  if (live()) status(Recognition ? 'Tap Start listening to begin.' : 'Type what they said to begin.');

  function onEnter(node, action) {
    node.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (!e.repeat) action();   // a key held down counts once
    });
  }
  function addHeard() { var v = $('heard').value; $('heard').value = ''; theySaid(v, 'typed'); }
  function tapped() { sinceTap = 0; }
  document.addEventListener('pointerdown', tapped, true);
  document.addEventListener('keydown', tapped, true);
  /* 1 to 6 say the reply in that place. Not while typing, not in a pop-up, and not for a key held down. */
  function showNumbers(on) {
    if (document.body.classList.contains('keys') === on) return;
    document.body.classList.toggle('keys', on); fitAll();
  }
  document.addEventListener('keydown', function (e) {
    if (!settings.numberKeys || popUpOpen() || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) return;
    showNumbers(true);   // a key pressed outside a text box means a real keyboard or a switch
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-6]$/.test(e.key)) return;
    var b = $('replies').children[Number(e.key) - 1];
    if (b && b.tagName === 'BUTTON') { e.preventDefault(); b.click(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseListening(); else resumeListening(); });
  /* Forgetting the key in one tab forgets it in the others. */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY_KEY && !e.newValue && live()) forgetKey();
    if (e.key === KEY_VOICE && !e.newValue && voiceKey) forgetVoiceKey();
  });

  $('listen').addEventListener('click', function () { if (listening) stopListening(); else startListening(); });
  $('heardAdd').addEventListener('click', addHeard);
  onEnter($('heard'), addHeard);
  $('demoNext').addEventListener('click', function () { demoStep += 1; theySaid(C.DEMO[demoStep % C.DEMO.length].heard, 'demo'); });
  $('suggest').addEventListener('click', function () { suggest(false); });
  onEnter($('hint'), function () { suggest(false); });
  $('sayTyped').addEventListener('click', function () {
    if (!$('hint').value.trim()) { status('Type what you want to say first.'); $('hint').focus(); return; }
    iSay($('hint').value);
  });
  var refit = null;
  window.addEventListener('resize', function () { clearTimeout(refit); refit = setTimeout(fitAll, 150); });   // turning the tablet changes the buttons
  $('startOver').addEventListener('click', function () { freshStart(); showListening(); resumeListening(); if (listening) status('Listening.'); });

  $('openSettings').addEventListener('click', function () {
    fillVoices(); $('rate').value = String(settings.rate); $('about').value = settings.about; $('numberKeys').checked = settings.numberKeys;
    $('key').value = ''; $('remember').checked = remembered(); showProvider(); showMode();
    $('settingsDialog').showModal();
    pauseListening();   // nothing is overheard while a pop-up is open
  });
  $('settingsClose').addEventListener('click', function () { $('settingsDialog').close(); });
  $('settingsDialog').addEventListener('close', function () {
    $('key').value = '';
    /* Key and model are in: start listening, and stay listening. The tap that closed the pop-up is what lets the browser ask for the microphone. */
    if (live() && settings.model && Recognition && !listening && !turns.length) startListening(); else resumeListening();
  });
  $('keyUse').addEventListener('click', useKey);
  onEnter($('key'), useKey);
  $('remember').addEventListener('change', function () {
    if (!live()) return;
    if ($('remember').checked && keyChecked) rememberKey(); else erase(KEY_KEY);
    showMode();
  });
  $('provider').addEventListener('change', function () { switchProvider($('provider').value); });
  $('address').addEventListener('input', showGoesTo);
  onEnter($('address'), useKey);
  $('model').addEventListener('change', function () { change({ model: $('model').value }); extras = true; });
  $('modelTyped').addEventListener('input', function () { change({ model: $('modelTyped').value.trim() }); extras = true; });
  $('about').addEventListener('input', function () { change({ about: $('about').value }); });
  $('voice').addEventListener('change', function () { change({ voice: $('voice').value }); });
  $('rate').addEventListener('change', function () { change({ rate: Number($('rate').value) }); });
  $('numberKeys').addEventListener('change', function () { change({ numberKeys: $('numberKeys').checked }); if (!settings.numberKeys) showNumbers(false); });
  $('tryVoice').addEventListener('click', function () { sayAloud('This is how I sound.'); });

  $('openVoice').addEventListener('click', function () {
    $('voiceKey').value = ''; $('voiceRemember').checked = read(KEY_VOICE) !== null; resetVoiceForget();
    $('voiceStatus').textContent = voiceNote(); showVoice();
    $('voiceDialog').showModal();
    pauseListening();
  });
  $('voiceClose').addEventListener('click', function () { $('voiceDialog').close(); });
  $('voiceDialog').addEventListener('close', function () { $('voiceKey').value = ''; resumeListening(); });
  $('voiceUse').addEventListener('click', useVoiceKey);
  onEnter($('voiceKey'), useVoiceKey);
  $('voiceRemember').addEventListener('change', function () {
    if (!voiceKey) return;
    if ($('voiceRemember').checked && voiceChecked) write(KEY_VOICE, voiceKey); else erase(KEY_VOICE);
    $('voiceStatus').textContent = voiceNote();
  });
  $('ownVoice').addEventListener('change', function () { change({ ownVoice: $('ownVoice').value }); showVoice(); });
  $('voiceTry').addEventListener('click', function () { sayAloud('This is how I sound.'); });

  if (canSpeak) window.speechSynthesis.onvoiceschanged = function () { if ($('settingsDialog').open) fillVoices(); };

  loadModels(false);
  loadOwnVoices(false);
})();
