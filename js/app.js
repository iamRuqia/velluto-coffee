/*!
 * Velluto · interface
 * GSAP + ScrollTrigger for choreography, Lenis for smooth scroll, the 3D scene
 * from scene.js, and a melody you play by scrolling (Web Audio API). Every feature degrades: no GSAP → content is static and visible,
 * no WebGL → photographic fallbacks, reduced motion → no smoothing or parallax.
 */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement, win = window;
  var reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = win.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var gsap = win.gsap, ST = win.ScrollTrigger;
  var hasGSAP = !!(gsap && ST);
  if (hasGSAP) { gsap.registerPlugin(ST); ST.config({ ignoreMobileResize: true }); }

  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function store(k, v) {
    try { if (v === undefined) return win.localStorage.getItem(k); win.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ }
    return null;
  }

  var data = { products: [], currency: '$' };
  try { data = JSON.parse($('#products-data').textContent); } catch (e) { /* menu still works as static HTML */ }
  var products = data.products || [];
  function money(v) { return (data.currency || '$') + Number(v).toFixed(2); }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) win.scrollTo(0, 0);

  /* ------------------------------------------------------------------
   * split the hero lines into masked characters (visual copy is aria-hidden)
   * ------------------------------------------------------------------ */
  function splitChars(el) {
    var frag = doc.createDocumentFragment();
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        node.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
          var w = doc.createElement('span'); w.className = 'w';
          part.split('').forEach(function (ch) { var c = doc.createElement('span'); c.className = 'c'; c.textContent = ch; w.appendChild(c); });
          frag.appendChild(w);
        });
      } else if (node.nodeType === 1) {
        var w = doc.createElement('span'); w.className = 'w';
        node.classList.add('c'); w.appendChild(node); frag.appendChild(w);
      }
    });
    el.textContent = '';
    el.appendChild(frag);
  }
  if (hasGSAP && !reduced) $$('[data-split]').forEach(splitChars);

  /* ------------------------------------------------------------------
   * 3D scene
   * ------------------------------------------------------------------ */
  var Scene = win.VellutoScene;
  var lowPower = !fine || win.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 2;
  var sceneOn = false;
  if (Scene && Scene.init) {
    try { sceneOn = Scene.init($('#webgl'), { reducedMotion: reduced, lowPower: lowPower }); }
    catch (err) { sceneOn = false; if (win.console) console.warn('3D scene unavailable:', err); }
  }
  root.classList.add(sceneOn ? 'webgl-on' : 'no-webgl');
  if (sceneOn) {
    Scene.bind({ hero: $('.hero'), heroStage: $('#hero-stage'), beans: $('#beans'), journey: $('#journey'), finale: $('#visit'), finaleStage: $('#finale-stage') });
  }

  /* ------------------------------------------------------------------
   * smooth scroll + one shared ticker
   * ------------------------------------------------------------------ */
  var lenis = null;
  if (!reduced && win.Lenis) {
    try { lenis = new win.Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.95 }); } catch (e) { lenis = null; }
  }
  if (lenis && hasGSAP) lenis.on('scroll', ST.update);

  var frameHooks = [];
  function onFrame() {
    var now = performance.now();
    if (sceneOn) Scene.tick(now);
    for (var i = 0; i < frameHooks.length; i++) frameHooks[i](now);
  }
  if (hasGSAP) {
    gsap.ticker.add(function (t) { if (lenis) lenis.raf(t * 1000); onFrame(); });
    gsap.ticker.lagSmoothing(0);
  } else {
    (function loop(ms) { if (lenis) lenis.raf(ms); onFrame(); requestAnimationFrame(loop); })(performance.now());
  }

  function scrollToEl(el, after) {
    if (!el) return;
    var top = el.id === 'top';
    if (lenis) lenis.scrollTo(top ? 0 : el, { duration: 1.6, easing: function (t) { return 1 - Math.pow(1 - t, 4); }, onComplete: after });
    else { if (top) win.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); if (after) setTimeout(after, 600); }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
  }

  /* ------------------------------------------------------------------
   * music: a calm café melody that you play by scrolling, off by default
   *
   * Everything is synthesised live with the Web Audio API, no audio files:
   *  - a soft chord pad and a round bass note; every section of the page has
   *    its own chord (D major 9 → B minor 9 → G major 9 → E minor 9 → A → D),
   *  - a music-box / electric-piano voice: each step of scrolling plays the next
   *    note of a written melody, scrolling back plays it in reverse, and faster
   *    scrolling plays a little louder,
   *  - a warm room reverb and a soft echo tie it all together.
   * When nothing moves the pad settles down quietly; hidden tabs are silent.
   * ------------------------------------------------------------------ */
  var Sound = (function () {
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    // section → chord: pad notes and a bass note (MIDI numbers)
    var CHORDS = {
      top:       { pad: [50, 57, 61, 64, 66], bass: 38 }, // Dmaj9
      menu:      { pad: [54, 57, 61, 62, 66], bass: 47 }, // Bm9
      beans:     { pad: [55, 59, 62, 66, 69], bass: 43 }, // Gmaj9
      story:     { pad: [52, 55, 59, 62, 66], bass: 40 }, // Em9
      specialty: { pad: [57, 61, 64, 66, 69], bass: 45 }, // A6/9
      visit:     { pad: [54, 57, 61, 62, 69], bass: 38 }  // Dmaj7
    };
    // the melody, written in D major pentatonic (D E F# A B), so every note sits well on every chord
    var SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81];
    var TUNE = [3, 4, 5, 4, 3, 2, 3, 1,   2, 3, 5, 6, 5, 3, 4, 2,
                5, 6, 7, 6, 5, 4, 5, 3,   4, 3, 2, 1, 2, 3, 1, 0,
                3, 5, 4, 3, 5, 6, 8, 7,   6, 5, 4, 5, 3, 2, 1, 0];

    var S = { on: false, ctx: null, last: 0, step: 0, chordKey: '', pad: null, activity: 0, idleTimer: 0 };
    var master, bus, wet, delay;

    function build(ctx) {
      master = ctx.createGain(); master.gain.value = 0;
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
      master.connect(comp); comp.connect(ctx.destination);
      bus = ctx.createGain(); bus.connect(master);
      // room reverb from a generated impulse
      var len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var c = 0; c < 2; c++) { var d = ir.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      var verb = ctx.createConvolver(); verb.buffer = ir;
      wet = ctx.createGain(); wet.gain.value = 0.32; wet.connect(verb); verb.connect(master);
      // a soft dotted echo, darkened so it never gets busy
      delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
      var fb = ctx.createGain(); fb.gain.value = 0.26;
      var tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1800;
      var dOut = ctx.createGain(); dOut.gain.value = 0.22;
      delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(dOut); dOut.connect(master); dOut.connect(wet);
      bus.connect(wet);
    }

    function context() {
      if (!S.ctx) {
        var AC = win.AudioContext || win.webkitAudioContext; if (!AC) return null;
        try { S.ctx = new AC(); build(S.ctx); } catch (e) { S.ctx = null; return null; }
      }
      if (S.ctx.state === 'suspended' && S.on && !doc.hidden) S.ctx.resume();
      return S.ctx;
    }

    // the chord pad: detuned soft triangles under a low-pass, plus a round sine bass
    function padFor(key) {
      var ctx = S.ctx, ch = CHORDS[key] || CHORDS.top, t = ctx.currentTime;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      lp.connect(g); g.connect(bus);
      var oscs = [];
      ch.pad.forEach(function (m, i) {
        [-7, 7].forEach(function (cents) {
          var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = cents + (i - 2) * 1.5;
          var v = ctx.createGain(); v.gain.value = 0.016 / ch.pad.length;
          o.connect(v); v.connect(lp); o.start(t); oscs.push(o);
        });
      });
      var bass = ctx.createOscillator(); bass.type = 'sine'; bass.frequency.value = hz(ch.bass);
      var bg = ctx.createGain(); bg.gain.value = 0.022; bass.connect(bg); bg.connect(g); bass.start(t); oscs.push(bass);
      // a slow swell keeps the pad breathing
      var lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 260;
      lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(t); oscs.push(lfo);
      return { gain: g, oscs: oscs };
    }
    function setChord(key) {
      if (!S.ctx || key === S.chordKey || !CHORDS[key]) return;
      S.chordKey = key;
      var t = S.ctx.currentTime, old = S.pad;
      S.pad = padFor(key);
      S.pad.gain.gain.setTargetAtTime(padLevel(), t, 0.7);
      if (old) {
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setTargetAtTime(0.0001, t, 0.6);
        old.oscs.forEach(function (o) { try { o.stop(t + 4); } catch (e) { /* already stopped */ } });
      }
    }
    function padLevel() { return 0.45 + 0.55 * S.activity; }
    function setActivity(v) {
      S.activity = v;
      if (S.pad && S.ctx) S.pad.gain.gain.setTargetAtTime(padLevel(), S.ctx.currentTime, v > 0.5 ? 0.25 : 1.6);
    }

    // a music-box / electric-piano note
    function note(midi, vel, pan) {
      var ctx = S.ctx; if (!ctx || ctx.state !== 'running') return;
      var t = ctx.currentTime, f = hz(midi), out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(vel, t + 0.008);
      out.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.35);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
      out.connect(lp);
      var node = lp;
      if (ctx.createStereoPanner) { var pn = ctx.createStereoPanner(); pn.pan.value = pan || 0; lp.connect(pn); node = pn; }
      node.connect(bus); node.connect(delay);
      [[1, 1, 2.2], [2, 0.22, 0.9], [3.01, 0.07, 0.35], [0.5, 0.12, 1.6]].forEach(function (h) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * h[0];
        g.gain.setValueAtTime(h[1], t); g.gain.exponentialRampToValueAtTime(0.0001, t + h[2]);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + h[2] + 0.05);
      });
    }

    // which section sits in the middle of the screen
    var sections = $$('[data-section]');
    function currentSection() {
      var mid = win.innerHeight / 2, key = 'top';
      for (var i = 0; i < sections.length; i++) {
        var r = sections[i].getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) { key = sections[i].getAttribute('data-section'); break; }
      }
      return key;
    }

    // scroll → notes: every step of distance plays the next note of the tune
    var lastY = win.scrollY || 0, travel = 0, lastStep = 0;
    function onScroll() {
      var y = win.scrollY || 0, dy = y - lastY; lastY = y;
      if (!S.on || !S.ctx || S.ctx.state !== 'running') return;
      setChord(currentSection());
      travel += dy;
      var stepPx = Math.max(70, win.innerHeight * 0.11), now = performance.now();
      if (Math.abs(travel) < stepPx || now - lastStep < 120) return;
      var speed = Math.min(1, Math.abs(travel) / (stepPx * 3));
      var dir = travel > 0 ? 1 : -1;
      travel = 0; lastStep = now;
      S.step = (S.step + dir + TUNE.length) % TUNE.length;
      var midi = SCALE[TUNE[S.step]];
      note(midi, 0.12 + 0.08 * speed, ((S.step % 8) / 7 - 0.5) * 0.5);
      if (S.step % 8 === 0) note(midi - 12, 0.05, 0); // a soft low echo at the start of each phrase
      setActivity(1);
      clearTimeout(S.idleTimer);
      S.idleTimer = setTimeout(function () { setActivity(0); }, 2600);
    }
    win.addEventListener('scroll', onScroll, { passive: true });

    doc.addEventListener('visibilitychange', function () {
      if (!S.ctx) return;
      if (doc.hidden) S.ctx.suspend(); else if (S.on) S.ctx.resume();
    });

    return {
      get on() { return S.on; },
      context: context,
      // small interface accents (hover, choosing a size, opening a drink):
      // a quiet high note taken from the chord that is playing
      tink: function (pitch, gain) {
        if (!S.on) return;
        var now = performance.now(); if (now - S.last < 90) return; S.last = now;
        if (!context() || S.ctx.state !== 'running') return;
        var ch = CHORDS[S.chordKey] || CHORDS.top;
        var idx = Math.min(ch.pad.length - 1, Math.max(0, Math.round(((pitch || 1) - 0.8) * 8)));
        note(ch.pad[idx] + 24, (gain || 0.03) * 1.4, (Math.random() - 0.5) * 0.4);
      },
      set: function (v, silent) {
        S.on = v;
        $$('[data-sound]').forEach(function (b) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); });
        store('velluto-sound', v ? '1' : '0');
        var ctx = context();
        if (ctx) {
          var t = ctx.currentTime;
          master.gain.cancelScheduledValues(t);
          if (v) {
            var start = function () {
              S.chordKey = ''; setChord(currentSection()); setActivity(0.6);
              master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
              // a short welcome phrase so you know it's on
              if (!silent) [0, 1, 2].forEach(function (k) { setTimeout(function () { note(SCALE[[3, 5, 7][k]], 0.1, (k - 1) * 0.3); }, k * 180); });
            };
            if (ctx.state === 'running') start(); else ctx.resume().then(start, function () {});
          } else {
            master.gain.setTargetAtTime(0, t, 0.3);
            setTimeout(function () { if (!S.on && S.ctx) S.ctx.suspend(); }, 1500);
          }
        }
        if (!silent) toast(v ? 'Music on · scroll to play the melody' : 'Music off');
      }
    };
  })();
  $$('[data-sound]').forEach(function (b) { b.addEventListener('click', function () { Sound.set(!Sound.on); }); });
  // Browsers only allow sound after a tap or click, so a remembered "on" starts on the first interaction.
  if (store('velluto-sound') === '1') {
    var resumeMusic = function (e) {
      if (e && e.target && e.target.closest && e.target.closest('[data-sound]')) return; // the button handles itself
      doc.removeEventListener('pointerdown', resumeMusic); doc.removeEventListener('keydown', resumeMusic);
      if (!Sound.on) Sound.set(true, true);
    };
    $$('[data-sound]').forEach(function (b) { b.setAttribute('aria-pressed', 'true'); });
    doc.addEventListener('pointerdown', resumeMusic); doc.addEventListener('keydown', resumeMusic);
  }

  var toastEl = $('#toast'), toastTimer = 0;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  /* ------------------------------------------------------------------
   * custom cursor (fine pointers only)
   * ------------------------------------------------------------------ */
  var cursor = $('#cursor');
  var cur = { x: -200, y: -200, rx: -200, ry: -200, on: fine && !reduced && !!cursor };
  if (cur.on) {
    root.classList.add('has-cursor');
    var dot = $('.cursor__dot', cursor), ring = $('.cursor__ring', cursor);
    frameHooks.push(function () {
      cur.rx += (cur.x - cur.rx) * 0.18; cur.ry += (cur.y - cur.ry) * 0.18;
      dot.style.transform = 'translate3d(' + cur.x + 'px,' + cur.y + 'px,0)';
      ring.style.transform = 'translate3d(' + cur.rx.toFixed(1) + 'px,' + cur.ry.toFixed(1) + 'px,0)';
    });
    doc.addEventListener('pointerleave', function () { cursor.classList.add('is-off'); });
    doc.addEventListener('pointerenter', function () { cursor.classList.remove('is-off'); });
  }
  var lastHover = null;
  doc.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    cur.x = e.clientX; cur.y = e.clientY;
    if (cursor) cursor.classList.remove('is-off');
    if (sceneOn) Scene.pointer((e.clientX / win.innerWidth) * 2 - 1, -((e.clientY / win.innerHeight) * 2 - 1));
  }, { passive: true });
  doc.addEventListener('pointerover', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var view = t.closest('[data-cursor="view"]');
    var link = t.closest('a, button, label, input, [role="button"]');
    if (cur.on) {
      cursor.classList.toggle('is-view', !!view);
      cursor.classList.toggle('is-link', !view && !!link);
      cursor.classList.toggle('is-ink', !!t.closest('[data-light]') && !t.closest('.product__media'));
    }
    var hit = view || link;
    if (hit && hit !== lastHover) Sound.tink(view ? 0.82 : 1);
    lastHover = hit;
  });
  doc.addEventListener('pointerdown', function () { if (Sound.on) Sound.context(); });

  /* ------------------------------------------------------------------
   * loader: an espresso shot that fills while fonts and the scene warm up
   * ------------------------------------------------------------------ */
  var loader = $('#loader'), fillEl = $('#loader-fill'), timeEl = $('#loader-time');
  var load = { shown: 0, ready: false, start: performance.now(), last: performance.now(), done: false };
  root.classList.add('is-loading');
  if (lenis) lenis.stop();
  var fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 3500); })]).then(function () {
    load.ready = true;
    if (sceneOn) Scene.refresh();
    if (hasGSAP) ST.refresh();
  });
  function loaderFrame() {
    var now = performance.now(), elapsed = now - load.start, dt = Math.min(0.25, (now - load.last) / 1000);
    load.last = now;
    var target = load.ready ? 1 : Math.min(0.82, elapsed / 2400);
    load.shown += (target - load.shown) * (reduced ? 1 : 1 - Math.exp(-dt * 4.2));
    if (load.ready && (load.shown > 0.985 || elapsed > 3200)) load.shown = 1;
    if (fillEl) fillEl.style.transform = 'scaleY(' + Math.max(0.02, load.shown).toFixed(3) + ')';
    if (timeEl) timeEl.textContent = pad(Math.floor(load.shown * 28)) + '.' + Math.floor((load.shown * 280) % 10) + ' s';
    if (load.shown >= 1 && (elapsed > 1100 || reduced)) finishLoader();
    else requestAnimationFrame(loaderFrame);
  }
  requestAnimationFrame(loaderFrame);
  setTimeout(function () { load.ready = true; }, 5000);

  function finishLoader() {
    if (load.done) return;
    load.done = true;
    if (timeEl) timeEl.textContent = '28.0 s';
    var release = function () {
      root.classList.remove('is-loading');
      if (lenis) lenis.start();
      if (loader) loader.style.display = 'none';
      if (hasGSAP) ST.refresh();
    };
    if (hasGSAP && !reduced && loader) {
      gsap.timeline({ onComplete: release })
        .to('.loader__inner', { y: -24, opacity: 0, duration: 0.55, ease: 'power3.in' }, 0.15)
        .to(loader, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.05, ease: 'expo.inOut' }, 0.45)
        .add(introHero, 0.95);
    } else {
      release();
      introHero();
    }
  }

  function introHero() {
    if (sceneOn) Scene.intro();
    if (!hasGSAP || reduced) return;
    var tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.hero__line--1 .c', { yPercent: 118, rotate: 5, duration: 1.5, stagger: 0.026 }, 0)
      .from('.hero__line--2 .c', { yPercent: 118, rotate: 5, duration: 1.5, stagger: 0.04 }, 0.22)
      .fromTo('.hero__line em', { backgroundPosition: '100% 50%' }, { backgroundPosition: '0% 50%', duration: 2.6, ease: 'power2.out' }, 0.7)
      .from('.hero__intro > *', { y: 28, opacity: 0, duration: 1.2, stagger: 0.12 }, 0.75)
      .from('.hero__note > *', { y: 18, opacity: 0, duration: 1.1, stagger: 0.06 }, 0.85)
      .from('.hero__cue', { opacity: 0, duration: 1.4 }, 1.2)
      .from('.nav__inner', { y: -24, opacity: 0, duration: 1.3, clearProps: 'transform,opacity' }, 0.4);
  }

  /* ------------------------------------------------------------------
   * scroll choreography (transform-only; everything is readable at rest)
   * ------------------------------------------------------------------ */
  if (hasGSAP && !reduced) {
    var mm = gsap.matchMedia();

    // hero: type drifts apart while the cup lingers
    gsap.to('.hero__line--1', { yPercent: -45, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero__line--2', { yPercent: 55, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to(['.hero__intro', '.hero__note', '.hero__cue'], { y: -70, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '55% top', scrub: true } });

    // cream pours over the dark: the wave edge settles as the menu rises
    gsap.to('#pour-path', {
      attr: { d: 'M0,120 L0,58 C200,92 380,98 600,72 C820,46 980,14 1180,24 C1300,30 1380,48 1440,62 L1440,120 Z' },
      ease: 'none', scrollTrigger: { trigger: '.menu', start: 'top bottom', end: 'top 20%', scrub: true }
    });

    // a gold light passes across italic headline words
    $$('.display em').forEach(function (em) {
      gsap.fromTo(em, { backgroundPosition: '100% 50%' }, { backgroundPosition: '0% 50%', ease: 'none', scrollTrigger: { trigger: em, start: 'top 95%', end: 'top 35%', scrub: true } });
    });

    // menu columns drift at different speeds
    mm.add('(min-width: 1024px)', function () {
      $$('.menu__grid > li').forEach(function (li, i) {
        var amt = [36, -28, 18][i % 3];
        gsap.fromTo(li, { y: amt }, { y: -amt, ease: 'none', scrollTrigger: { trigger: li, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });

    // beans intro photo settles while its headline rises
    gsap.fromTo('.beans__photo', { scale: 1.22 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.beans__intro', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo('.beans__head', { y: 60 }, { y: -80, ease: 'none', scrollTrigger: { trigger: '.beans__intro', start: 'top bottom', end: 'bottom top', scrub: true } });

    // story: frames open from a slight crop, images move inside them
    $$('.story .frame').forEach(function (frame) {
      var radius = getComputedStyle(frame).borderTopLeftRadius || '0px';
      var r = frame.closest('.story__side') ? '999px 999px 18px 18px' : radius;
      gsap.fromTo(frame, { clipPath: 'inset(9% 7% 9% 7% round ' + r + ')' }, { clipPath: 'inset(0% 0% 0% 0% round ' + r + ')', ease: 'none', scrollTrigger: { trigger: frame, start: 'top 95%', end: 'top 35%', scrub: true } });
      var img = $('img', frame);
      if (img) gsap.fromTo(img, { yPercent: -10 }, { yPercent: 2, ease: 'none', scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    gsap.fromTo('.story__side', { y: 120 }, { y: -60, ease: 'none', scrollTrigger: { trigger: '.story__spread', start: 'top bottom', end: 'bottom top', scrub: true } });

    // signature pours: horizontal reel on desktop
    var pin = $('#specialty-pin'), track = $('#specialty-track');
    mm.add('(min-width: 1024px)', function () {
      pin.classList.add('is-horizontal');
      var dist = function () { return Math.max(0, track.scrollWidth - win.innerWidth); };
      var reel = gsap.to(track, {
        x: function () { return -dist(); }, ease: 'none',
        scrollTrigger: { trigger: pin, start: 'top top', end: function () { return '+=' + dist(); }, pin: true, scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1 }
      });
      $$('.pour').forEach(function (panel) {
        var opts = function () { return { trigger: panel, containerAnimation: reel, start: 'left right', end: 'right left', scrub: true }; };
        gsap.fromTo($('.pour__word', panel), { xPercent: 22 }, { xPercent: -22, ease: 'none', scrollTrigger: opts() });
        gsap.fromTo($('.pour__product', panel), { rotate: -7, xPercent: 14 }, { rotate: 5, xPercent: -10, ease: 'none', scrollTrigger: opts() });
        gsap.fromTo($('.pour__info', panel), { xPercent: 18 }, { xPercent: -6, ease: 'none', scrollTrigger: opts() });
      });
      return function () { pin.classList.remove('is-horizontal'); };
    });
    mm.add('(max-width: 1023px)', function () {
      $$('.pour').forEach(function (panel) {
        gsap.fromTo($('.pour__product', panel), { y: 50, rotate: -4 }, { y: -40, rotate: 3, ease: 'none', scrollTrigger: { trigger: panel, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });

    // footer wordmark rises into place
    gsap.fromTo('.footer__word', { yPercent: 35 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });

    // nav switches to a cream glass over light sections
    $$('[data-light]').forEach(function (sec) {
      ST.create({ trigger: sec, start: 'top top+=60', end: 'bottom top+=60', toggleClass: { targets: '#nav', className: 'is-light' } });
    });

    // scroll progress
    gsap.to('#progress-bar', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
    ST.addEventListener('refresh', function () { if (sceneOn) Scene.refresh(); });
  } else {
    var bar = $('#progress-bar');
    win.addEventListener('scroll', function () {
      var max = root.scrollHeight - win.innerHeight;
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? win.scrollY / max : 0) + ')';
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
   * nav: glass after the hero, hides on the way down, returns on the way up
   * ------------------------------------------------------------------ */
  var nav = $('#nav'), lastY = win.scrollY || 0;
  function navState() {
    var y = win.scrollY || 0;
    nav.classList.toggle('is-scrolled', y > 40);
    if (y > lastY + 6 && y > win.innerHeight * 0.85 && !doc.querySelector('dialog[open]')) nav.classList.add('is-hidden');
    else if (y < lastY - 6 || y < 80) nav.classList.remove('is-hidden');
    lastY = y;
  }
  win.addEventListener('scroll', navState, { passive: true });
  nav.addEventListener('focusin', function () { nav.classList.remove('is-hidden'); });
  navState();

  if ('IntersectionObserver' in win) {
    var navLinks = $$('[data-nav]');
    var sectionIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.getAttribute('data-section');
        navLinks.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-nav') === id); });
      });
    }, { rootMargin: '-50% 0px -50% 0px' });
    $$('[data-section]').forEach(function (s) { sectionIO.observe(s); });

    var railLinks = $$('[data-step-link]');
    var stepIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = en.target.getAttribute('data-step');
        railLinks.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-step-link') === i); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$('.step').forEach(function (s) { stepIO.observe(s); });
  }

  /* ------------------------------------------------------------------
   * in-page links, mobile menu
   * ------------------------------------------------------------------ */
  var menuDlg = $('#mobile-menu'), burger = $('#burger');
  function openMenu() {
    if (!menuDlg || menuDlg.open) return;
    menuDlg.showModal();
    burger.setAttribute('aria-expanded', 'true');
    if (lenis) lenis.stop();
    if (hasGSAP && !reduced) {
      gsap.fromTo(menuDlg, { clipPath: 'circle(0% at 92% 4%)' }, { clipPath: 'circle(150% at 92% 4%)', duration: 0.9, ease: 'expo.out' });
      gsap.from($$('.mobile-menu__links li', menuDlg), { y: 40, opacity: 0, duration: 0.9, stagger: 0.06, ease: 'expo.out', delay: 0.1 });
    }
  }
  function closeMenu() {
    if (!menuDlg || !menuDlg.open) return;
    menuDlg.close();
  }
  if (menuDlg) {
    menuDlg.addEventListener('close', function () { burger.setAttribute('aria-expanded', 'false'); if (lenis && !$('#product-modal').open) lenis.start(); });
    $$('button[data-close-menu]', menuDlg).forEach(function (b) { b.addEventListener('click', closeMenu); });
  }
  if (burger) { burger.setAttribute('aria-expanded', 'false'); burger.addEventListener('click', openMenu); }

  doc.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open]');
    if (opener) { e.preventDefault(); openModal(opener.getAttribute('data-open'), opener); return; }
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    var target = id ? doc.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    if (a.hasAttribute('data-modal-close')) { closeModal(function () { scrollToEl(target); }); return; }
    if (a.hasAttribute('data-close-menu')) closeMenu();
    if (a.closest('.journey__rail')) { scrollToEl(target); return; }
    scrollToEl(target);
  });

  /* ------------------------------------------------------------------
   * product cards: 3D tilt with a moving glare
   * ------------------------------------------------------------------ */
  if (fine && !reduced) {
    $$('[data-tilt]').forEach(function (card) {
      var raf = 0, ev = null;
      function apply() {
        raf = 0; if (!ev) return;
        var r = card.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        card.style.setProperty('--ry', ((x - 0.5) * 12).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg');
        card.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      }
      card.addEventListener('pointerenter', function () { card.classList.add('is-tilting'); });
      card.addEventListener('pointermove', function (e) { ev = e; if (!raf) raf = requestAnimationFrame(apply); });
      card.addEventListener('pointerleave', function () {
        ev = null; card.classList.remove('is-tilting');
        card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ------------------------------------------------------------------
   * product details dialog
   * ------------------------------------------------------------------ */
  var modal = $('#product-modal'), current = 0, closing = false;
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function setPrice(p, i) {
    var s = p.sizes[i] || p.sizes[0];
    var priceEl = $('#modal-price');
    priceEl.textContent = money(s.price);
    priceEl.appendChild(el('small', '', s.label + ' · ' + s.vol));
  }
  function fillModal(i) {
    var p = products[i]; if (!p) return;
    current = i;
    $('#modal-kicker').textContent = p.kicker;
    $('#modal-title').textContent = p.name;
    $('#modal-desc').textContent = p.desc;
    $('#modal-index').textContent = pad(i + 1) + ' / ' + pad(products.length);
    var media = $('#modal-media'), img = $('#modal-img');
    media.style.setProperty('--lqip', 'url(' + p.lqip + ')');
    img.classList.remove('is-loaded');
    img.onload = function () { img.classList.add('is-loaded'); };
    img.onerror = function () { media.classList.add('img-failed'); };
    media.classList.remove('img-failed');
    img.alt = p.alt; img.sizes = '(min-width: 800px) 46vw, 100vw'; img.srcset = p.srcset; img.src = p.img;
    var notes = $('#modal-notes'); notes.textContent = '';
    p.notes.forEach(function (n) { notes.appendChild(el('li', '', n)); });
    var brew = $('#modal-brew'); brew.textContent = '';
    p.brew.forEach(function (b) { var d = el('div'); d.appendChild(el('dt', '', b[0])); d.appendChild(el('dd', '', b[1])); brew.appendChild(d); });
    var sizes = $('#modal-sizes'); sizes.textContent = '';
    p.sizes.forEach(function (s, k) {
      var label = el('label'), input = el('input'), span = el('span', '', s.label + ' ');
      input.type = 'radio'; input.name = 'size'; input.value = String(k); input.id = 'size-' + p.id + '-' + k; if (k === 0) input.checked = true;
      span.appendChild(el('small', '', s.vol + ' · ' + money(s.price)));
      input.addEventListener('change', function () { setPrice(p, k); Sound.tink(1.25); });
      label.appendChild(input); label.appendChild(span); sizes.appendChild(label);
    });
    setPrice(p, 0);
  }
  function openModal(id, from) {
    if (!modal || typeof modal.showModal !== 'function') return;
    var i = products.findIndex(function (p) { return p.id === id; });
    if (i < 0) return;
    fillModal(i);
    if (modal.open) return;
    modal.showModal();
    if (lenis) lenis.stop();
    Sound.tink(0.9);
    if (hasGSAP && !reduced) {
      gsap.fromTo('.modal__panel', { y: 70, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.9, ease: 'expo.out' });
      gsap.fromTo('#modal-img', { scale: 1.18 }, { scale: 1, duration: 1.6, ease: 'expo.out' });
      gsap.from('.modal__body > *', { y: 24, opacity: 0, duration: 0.8, stagger: 0.05, ease: 'expo.out', delay: 0.1 });
    }
  }
  function closeModal(after) {
    if (!modal || !modal.open || closing) { if (after) after(); return; }
    var done = function () {
      closing = false; modal.close();
      if (lenis) lenis.start();
      if (typeof after === 'function') after();
    };
    if (hasGSAP && !reduced) { closing = true; gsap.to('.modal__panel', { y: 40, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: done }); }
    else done();
  }
  function stepModal(d) {
    var n = products.length, next = (current + d + n) % n;
    if (hasGSAP && !reduced) {
      gsap.to(['.modal__body', '#modal-img'], { opacity: 0, duration: 0.2, onComplete: function () {
        fillModal(next);
        gsap.to(['.modal__body', '#modal-img'], { opacity: 1, duration: 0.45 });
        gsap.fromTo('#modal-img', { scale: 1.1 }, { scale: 1, duration: 1.2, ease: 'expo.out' });
      } });
    } else fillModal(next);
  }
  if (modal) {
    modal.addEventListener('cancel', function (e) { e.preventDefault(); closeModal(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    $$('button[data-modal-close]', modal).forEach(function (b) { b.addEventListener('click', function () { closeModal(); }); });
    $$('[data-modal-step]', modal).forEach(function (b) { b.addEventListener('click', function () { stepModal(Number(b.getAttribute('data-modal-step'))); }); });
    modal.addEventListener('keydown', function (e) {
      if (e.target.matches('input')) return;
      if (e.key === 'ArrowRight') stepModal(1);
      if (e.key === 'ArrowLeft') stepModal(-1);
    });
  }

  /* ------------------------------------------------------------------
   * images: fade in when decoded; keep the blurred preview if one fails
   * ------------------------------------------------------------------ */
  $$('img').forEach(function (img) {
    if (img.id === 'modal-img') return;
    var mark = function () { img.classList.add('is-loaded'); };
    var fail = function () { var box = img.closest('.product__media, .frame'); if (box) box.classList.add('img-failed'); };
    if (img.complete && img.naturalWidth) mark();
    else if (img.complete && img.getAttribute('src') && img.getAttribute('loading') !== 'lazy') fail();
    else { img.addEventListener('load', mark, { once: true }); img.addEventListener('error', fail, { once: true }); }
  });

  /* ------------------------------------------------------------------
   * opening hours: today's row + an open/closed line (visitor's clock)
   * ------------------------------------------------------------------ */
  function toMin(s) { var p = s.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function updateStatus() {
    var rows = $$('#hours > div'); if (!rows.length) return;
    var now = new Date(), day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    function rowFor(d) { return rows.filter(function (r) { return r.getAttribute('data-days').split(',').indexOf(String(d)) > -1; })[0]; }
    var today = rowFor(day);
    rows.forEach(function (r) { r.classList.toggle('is-today', r === today); });
    var statusEl = $('#open-status'), text = '', open = false;
    if (today) {
      var o = today.getAttribute('data-open'), c = today.getAttribute('data-close');
      open = mins >= toMin(o) && mins < toMin(c);
      if (open) text = 'Open now · until ' + c;
      else if (mins < toMin(o)) text = 'Closed now · opens today at ' + o;
      else { var tm = rowFor((day + 1) % 7); text = 'Closed now · opens tomorrow at ' + (tm ? tm.getAttribute('data-open') : ''); }
      var th = $('.today-hours'); if (th) th.textContent = 'Today ' + o + '–' + c;
    }
    if (statusEl) { $('.status__text', statusEl).textContent = text; statusEl.classList.toggle('is-closed', !open); }
  }
  updateStatus();
  setInterval(updateStatus, 60000);

  /* ------------------------------------------------------------------
   * footer: copy buttons + newsletter
   * ------------------------------------------------------------------ */
  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var ok = function () { btn.classList.add('is-done'); toast('Copied ' + text); setTimeout(function () { btn.classList.remove('is-done'); }, 1800); };
      var fallback = function () {
        var target = btn.previousElementSibling; if (!target) return;
        var range = doc.createRange(); range.selectNodeContents(target);
        var sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        toast('Selected. Copy it with your keyboard.');
      };
      try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
    });
  });

  var form = $('#newsletter');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#newsletter-email'), msg = $('#newsletter-msg'), v = input.value.trim();
      if (!v || !input.checkValidity()) {
        msg.textContent = 'Enter a valid email address, like name@example.com.';
        msg.classList.add('is-error'); input.setAttribute('aria-invalid', 'true'); input.focus();
        return;
      }
      input.removeAttribute('aria-invalid'); msg.classList.remove('is-error');
      // Connect your email provider here (Mailchimp, Buttondown, ConvertKit…) and send `v`.
      msg.textContent = 'Thank you. ' + v + ' is on the list for the next roast.';
      Sound.tink(1.3, 0.05);
      form.reset();
    });
  }

  /* ------------------------------------------------------------------
   * resize + refresh
   * ------------------------------------------------------------------ */
  var rT = 0, lastW = win.innerWidth;
  win.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () {
      var w = win.innerWidth;
      if (!fine && w === lastW) return; // ignore mobile URL-bar height changes
      lastW = w;
      if (sceneOn) Scene.resize();
      if (hasGSAP) ST.refresh();
      if (sceneOn) Scene.refresh();
    }, 160);
  });
  win.addEventListener('load', function () { if (hasGSAP) ST.refresh(); if (sceneOn) Scene.refresh(); });
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden && sceneOn) Scene.refresh(); });

  if (!sceneOn && !hasGSAP) { /* static mode: nothing else to wire */ }
})();
