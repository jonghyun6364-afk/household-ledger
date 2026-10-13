(function(){
  "use strict";

  // Player 0 sits at the bottom of the phone (blue), player 1 at the top (red, UI rotated 180°)
  var $ = function(id){ return document.getElementById(id); };
  var homeEl = $("home"), playEl = $("play"), stage = $("stage");
  var current = null, currentName = null;

  function el(tag, cls, html){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function buzz(ms){ if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  // ---------- routing ----------

  var GAMES = { hockey: Hockey, omok: Omok, reflex: Reflex };

  function stopCurrent(){
    if (current) current.stop();
    current = null;
    stage.innerHTML = "";
  }
  function start(name){
    stopCurrent();
    currentName = name;
    current = GAMES[name](stage);
  }
  function route(){
    var name = location.hash.slice(1);
    if (GAMES[name]) {
      homeEl.hidden = true;
      playEl.hidden = false;
      start(name);
    } else {
      stopCurrent();
      playEl.hidden = true;
      homeEl.hidden = false;
    }
  }
  function toMenu(){ location.hash = ""; }
  window.addEventListener("hashchange", route);
  $("btnClose").addEventListener("click", toMenu);

  // winner: 0, 1 or null for a draw. Both players see their own result facing them.
  function showResult(winner, detail){
    function line(p){
      var cls = winner === p ? " win" : "";
      var title = winner == null ? "무승부" : winner === p ? "승리!" : "패배";
      return '<div class="res' + cls + (p === 1 ? " flip" : "") + '"><strong>' + title + '</strong><span>' + (detail || "") + '</span></div>';
    }
    var ov = el("div", "result",
      line(1) +
      '<div class="actions"><button class="btn" data-a="again">다시 하기</button><button class="btn ghost" data-a="menu">메뉴</button></div>' +
      line(0));
    ov.addEventListener("click", function(e){
      var a = e.target.getAttribute("data-a");
      if (a === "again") start(currentName);
      if (a === "menu") toMenu();
    });
    stage.appendChild(ov);
  }

  // ---------- 에어하키 ----------

  function Hockey(root){
    var WIN = 7;
    var canvas = el("canvas", "hockey-canvas");
    root.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var colors = { table: cssVar("--table"), line: cssVar("--table-line"), p: [cssVar("--p1"), cssVar("--p2")], puck: "#1d2433" };

    var W = 0, H = 0, r = 0, R = 0, goalW = 0;
    var score = [0, 0];
    var puck = { x: 0, y: 0, vx: 0, vy: 0 };
    var mallets = [{ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 }, { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 }];
    var pointers = {};   // pointerId -> player
    var pauseUntil = 0, flash = null, over = false, raf = 0, last = 0;

    function resize(){
      var oldW = W || 1, oldH = H || 1;
      W = root.clientWidth; H = root.clientHeight;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var u = Math.min(W, H * 0.6);
      r = u * 0.05;
      R = u * 0.085;
      goalW = Math.max(W * 0.4, r * 5);
      [puck].concat(mallets).forEach(function(o){
        o.x *= W / oldW; o.y *= H / oldH;
        if (o.tx != null) { o.tx *= W / oldW; o.ty *= H / oldH; }
      });
    }

    function resetPositions(serveTo){
      mallets[0].x = mallets[0].tx = W / 2; mallets[0].y = mallets[0].ty = H * 0.86;
      mallets[1].x = mallets[1].tx = W / 2; mallets[1].y = mallets[1].ty = H * 0.14;
      puck.x = W / 2;
      puck.y = serveTo == null ? H / 2 : serveTo === 0 ? H * 0.66 : H * 0.34;
      puck.vx = puck.vy = 0;
    }

    function clampMallet(m, p, x, y){
      x = Math.max(R, Math.min(W - R, x));
      y = p === 0 ? Math.max(H / 2 + R, Math.min(H - R, y)) : Math.max(R, Math.min(H / 2 - R, y));
      m.tx = x; m.ty = y;
    }

    function onDown(e){
      var p = e.clientY > H / 2 ? 0 : 1;
      // A new finger on a side takes over that side's mallet
      Object.keys(pointers).forEach(function(id){ if (pointers[id] === p) delete pointers[id]; });
      pointers[e.pointerId] = p;
      clampMallet(mallets[p], p, e.clientX, e.clientY);
    }
    function onMove(e){
      var p = pointers[e.pointerId];
      if (p == null) return;
      clampMallet(mallets[p], p, e.clientX, e.clientY);
    }
    function onUp(e){ delete pointers[e.pointerId]; }

    function goal(scorer){
      score[scorer]++;
      buzz(scorer === 0 ? [60] : [60, 60, 60]);
      if (score[scorer] >= WIN) {
        over = true;
        draw();
        showResult(scorer, score[0] + " : " + score[1]);
        return;
      }
      flash = { who: scorer, until: performance.now() + 900 };
      pauseUntil = performance.now() + 900;
      resetPositions(1 - scorer);   // the player who conceded gets the puck
    }

    function collide(m){
      var dx = puck.x - m.x, dy = puck.y - m.y;
      var d = Math.hypot(dx, dy), min = r + R;
      if (d >= min) return;
      var nx = d ? dx / d : 0, ny = d ? dy / d : 1;
      puck.x = m.x + nx * min;
      puck.y = m.y + ny * min;
      var vn = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;
      if (vn < 0) {
        puck.vx -= 1.9 * vn * nx;
        puck.vy -= 1.9 * vn * ny;
      }
    }

    function step(dt){
      var steps = 6, h = dt / steps, maxV = H * 3;
      var from = mallets.map(function(m){ return { x: m.x, y: m.y }; });
      mallets.forEach(function(m){ m.vx = (m.tx - m.x) / dt; m.vy = (m.ty - m.y) / dt; });

      for (var s = 1; s <= steps && !over; s++) {
        mallets.forEach(function(m, i){
          m.x = from[i].x + (m.tx - from[i].x) * s / steps;
          m.y = from[i].y + (m.ty - from[i].y) * s / steps;
        });
        if (performance.now() < pauseUntil) continue;

        puck.x += puck.vx * h;
        puck.y += puck.vy * h;

        if (puck.x < r) { puck.x = r; puck.vx = Math.abs(puck.vx) * 0.9; }
        if (puck.x > W - r) { puck.x = W - r; puck.vx = -Math.abs(puck.vx) * 0.9; }
        var inMouth = Math.abs(puck.x - W / 2) < goalW / 2 - r * 0.3;
        if (puck.y < r && !inMouth) { puck.y = r; puck.vy = Math.abs(puck.vy) * 0.9; }
        if (puck.y > H - r && !inMouth) { puck.y = H - r; puck.vy = -Math.abs(puck.vy) * 0.9; }
        if (puck.y < -r) { goal(0); return; }
        if (puck.y > H + r) { goal(1); return; }

        collide(mallets[0]);
        collide(mallets[1]);

        var v = Math.hypot(puck.vx, puck.vy);
        if (v > maxV) { puck.vx *= maxV / v; puck.vy *= maxV / v; }
      }
      var f = Math.pow(0.8, dt);
      puck.vx *= f; puck.vy *= f;
    }

    function circle(x, y, rad, fill){
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    }
    function textAt(txt, x, y, size, color, flipped){
      ctx.save();
      ctx.translate(x, y);
      if (flipped) ctx.rotate(Math.PI);
      ctx.font = "800 " + size + "px " + cssVar("--font");
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }

    function draw(){
      ctx.fillStyle = colors.table;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, W * 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, 0, goalW / 2, 0, Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H, goalW / 2, Math.PI, Math.PI * 2); ctx.stroke();

      // Each side defends the goal in its own color
      ctx.fillStyle = colors.p[1]; ctx.fillRect(W / 2 - goalW / 2, 0, goalW, 6);
      ctx.fillStyle = colors.p[0]; ctx.fillRect(W / 2 - goalW / 2, H - 6, goalW, 6);

      ctx.globalAlpha = 0.18;
      textAt(score[0], W / 2, H * 0.72, Math.min(W, H) * 0.32, colors.p[0], false);
      textAt(score[1], W / 2, H * 0.28, Math.min(W, H) * 0.32, colors.p[1], true);
      ctx.globalAlpha = 1;

      circle(puck.x, puck.y, r, colors.puck);
      mallets.forEach(function(m, i){
        circle(m.x, m.y, R, colors.p[i]);
        circle(m.x, m.y, R * 0.55, "rgba(255,255,255,0.35)");
        circle(m.x, m.y, R * 0.32, colors.p[i]);
      });

      if (flash && performance.now() < flash.until) {
        textAt("골!", W / 2, H * 0.6, W * 0.16, colors.p[flash.who], false);
        textAt("골!", W / 2, H * 0.4, W * 0.16, colors.p[flash.who], true);
      }
    }

    function frame(t){
      var dt = Math.min(0.033, (t - last) / 1000) || 0.016;
      last = t;
      if (!over) { step(dt); draw(); }
      if (!over) raf = requestAnimationFrame(frame);
    }

    resize();
    resetPositions(null);
    pauseUntil = performance.now() + 500;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", resize);
    last = performance.now();
    raf = requestAnimationFrame(frame);

    return {
      stop: function(){
        over = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
      }
    };
  }

  // ---------- 오목 ----------

  function Omok(root){
    var N = 15;
    var board = new Array(N * N).fill(-1);   // -1 empty, 0 black (bottom player), 1 white (top player)
    var moves = [], turn = 0, ghost = -1, winLine = null, over = false, timer = 0;

    var wrap = el("div", "omok",
      '<div class="bar flip" data-p="1"></div>' +
      '<div class="board-wrap"><canvas></canvas></div>' +
      '<div class="bar" data-p="0"></div>');
    root.appendChild(wrap);
    var bars = [wrap.querySelector('[data-p="0"]'), wrap.querySelector('[data-p="1"]')];
    var boxEl = wrap.querySelector(".board-wrap");
    var canvas = wrap.querySelector("canvas");
    var ctx = canvas.getContext("2d");
    var size = 0, cell = 0, margin = 0;
    var wood = cssVar("--wood"), woodLine = cssVar("--wood-line"), mark = cssVar("--p2");

    function renderBars(){
      bars.forEach(function(bar, p){
        var mine = turn === p && !over;
        bar.className = "bar" + (p === 1 ? " flip" : "") + (mine ? " active" : "");
        bar.innerHTML =
          '<div class="who"><span class="stone ' + (p === 0 ? "b" : "w") + '"></span><div>' +
          (p === 0 ? "흑" : "백") + (mine ? " · 내 차례" : "") +
          '<small>' + (mine ? "같은 자리를 두 번 탭하면 놓여요" : "상대가 두는 중") + '</small></div></div>' +
          '<button class="btn ghost" data-undo' + (moves.length && !over ? "" : " disabled") + '>무르기</button>';
      });
    }

    function resize(){
      var w = boxEl.clientWidth - 16, h = boxEl.clientHeight - 8;
      size = Math.max(150, Math.floor(Math.min(w, h)));
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = canvas.style.height = size + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = size / N;
      margin = cell / 2;
      draw();
    }

    function pt(i){ return margin + i * cell; }

    function stone(idx, alpha){
      var x = pt(idx % N), y = pt(Math.floor(idx / N)), rad = cell * 0.44;
      var black = board[idx] === 0 || (board[idx] === -1 && turn === 0);
      ctx.globalAlpha = alpha;
      var g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.1, x, y, rad);
      if (black) { g.addColorStop(0, "#5a5f6b"); g.addColorStop(1, "#111216"); }
      else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#d8d8d2"); }
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = 1;
    }

    function draw(){
      ctx.fillStyle = wood;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = woodLine;
      ctx.lineWidth = 1;
      for (var i = 0; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(pt(0), pt(i)); ctx.lineTo(pt(N - 1), pt(i)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pt(i), pt(0)); ctx.lineTo(pt(i), pt(N - 1)); ctx.stroke();
      }
      [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]].forEach(function(s){
        ctx.beginPath(); ctx.arc(pt(s[0]), pt(s[1]), Math.max(2, cell * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = woodLine; ctx.fill();
      });
      board.forEach(function(v, idx){ if (v !== -1) stone(idx, 1); });
      if (ghost !== -1) stone(ghost, 0.45);

      var lastIdx = moves[moves.length - 1];
      if (lastIdx != null && !winLine) {
        ctx.beginPath(); ctx.arc(pt(lastIdx % N), pt(Math.floor(lastIdx / N)), cell * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = mark; ctx.fill();
      }
      if (winLine) {
        ctx.strokeStyle = mark;
        ctx.lineWidth = Math.max(3, cell * 0.16);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pt(winLine[0] % N), pt(Math.floor(winLine[0] / N)));
        ctx.lineTo(pt(winLine[1] % N), pt(Math.floor(winLine[1] / N)));
        ctx.stroke();
      }
    }

    // Returns the two ends of a run of five or more through idx, or null
    function findWin(idx){
      var c = board[idx], x0 = idx % N, y0 = Math.floor(idx / N);
      var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var dx = dirs[d][0], dy = dirs[d][1], ends = [];
        [1, -1].forEach(function(sgn){
          var x = x0, y = y0;
          while (true) {
            var nx = x + dx * sgn, ny = y + dy * sgn;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N || board[ny * N + nx] !== c) break;
            x = nx; y = ny;
          }
          ends.push(y * N + x);
        });
        var len = Math.max(Math.abs(ends[0] % N - ends[1] % N), Math.abs(Math.floor(ends[0] / N) - Math.floor(ends[1] / N))) + 1;
        if (len >= 5) return ends;
      }
      return null;
    }

    function place(idx){
      board[idx] = turn;
      moves.push(idx);
      ghost = -1;
      buzz(15);
      winLine = findWin(idx);
      if (winLine) {
        over = true;
        var w = turn;
        timer = setTimeout(function(){ showResult(w, (w === 0 ? "흑" : "백") + " 다섯 개 완성"); }, 900);
      } else if (moves.length === N * N) {
        over = true;
        timer = setTimeout(function(){ showResult(null, "판이 가득 찼어요"); }, 600);
      } else {
        turn = 1 - turn;
      }
      renderBars();
      draw();
    }

    function onTap(e){
      if (over) return;
      var rect = canvas.getBoundingClientRect();
      var i = Math.round((e.clientX - rect.left - margin) / cell);
      var j = Math.round((e.clientY - rect.top - margin) / cell);
      if (i < 0 || j < 0 || i >= N || j >= N) return;
      var idx = j * N + i;
      if (board[idx] !== -1) return;
      if (ghost === idx) place(idx);
      else { ghost = idx; draw(); }
    }

    function undo(){
      if (over || !moves.length) return;
      var idx = moves.pop();
      turn = board[idx];
      board[idx] = -1;
      ghost = -1;
      renderBars();
      draw();
    }

    canvas.addEventListener("pointerup", onTap);
    wrap.addEventListener("click", function(e){ if (e.target.hasAttribute("data-undo")) undo(); });
    window.addEventListener("resize", resize);
    renderBars();
    resize();

    return {
      stop: function(){
        clearTimeout(timer);
        window.removeEventListener("resize", resize);
      }
    };
  }

  // ---------- 반응속도 대결 ----------

  function Reflex(root){
    var WIN = 5;
    var wrap = el("div", "reflex",
      '<div class="pad p2 flip" data-p="1"><span class="pts"></span><b class="msg"></b><span class="sub"></span></div>' +
      '<div class="divider"></div>' +
      '<div class="pad p1" data-p="0"><span class="pts"></span><b class="msg"></b><span class="sub"></span></div>');
    root.appendChild(wrap);
    var pads = [wrap.querySelector('[data-p="0"]'), wrap.querySelector('[data-p="1"]')];

    var state = "ready", ready = [false, false], score = [0, 0], goAt = 0, timer = 0;

    function setPad(p, mode, msg, sub){
      var pad = pads[p];
      pad.className = "pad " + (p === 0 ? "p1" : "p2 flip") + (mode ? " " + mode : "");
      pad.querySelector(".msg").textContent = msg;
      pad.querySelector(".sub").textContent = sub || "";
      var dots = "";
      for (var i = 0; i < WIN; i++) dots += '<i class="' + (i < score[p] ? "on" : "") + '"></i>';
      pad.querySelector(".pts").innerHTML = dots;
    }

    function showReady(){
      state = "ready";
      [0, 1].forEach(function(p){
        setPad(p, "", ready[p] ? "준비 완료!" : "여기를 탭해서 준비", ready[p] ? "상대를 기다리는 중…" : "초록색이 되면 먼저 탭!");
      });
    }

    function startRound(){
      state = "wait";
      [0, 1].forEach(function(p){ setPad(p, "wait", "기다리세요…", "아직 누르지 마세요"); });
      timer = setTimeout(function(){
        state = "go";
        goAt = performance.now();
        buzz(30);
        [0, 1].forEach(function(p){ setPad(p, "go", "지금 탭!", ""); });
      }, 1500 + Math.random() * 3000);
    }

    function endRound(){
      state = "between";
      if (score[0] >= WIN || score[1] >= WIN) {
        var w = score[0] >= WIN ? 0 : 1;
        timer = setTimeout(function(){ showResult(w, score[0] + " : " + score[1]); }, 900);
      } else {
        timer = setTimeout(startRound, 1600);
      }
    }

    function onDown(p){
      if (state === "ready") {
        ready[p] = true;
        showReady();
        if (ready[0] && ready[1]) timer = setTimeout(startRound, 500);
      } else if (state === "wait") {
        clearTimeout(timer);
        score[1 - p]++;
        buzz(120);
        setPad(p, "foul", "너무 빨라요!", "상대에게 1점");
        setPad(1 - p, "won", "+1점", "상대가 먼저 눌렀어요");
        endRound();
      } else if (state === "go") {
        var ms = Math.round(performance.now() - goAt);
        score[p]++;
        setPad(p, "won", "+1점", ms + "ms");
        setPad(1 - p, "", "아깝다!", "상대 " + ms + "ms");
        endRound();
      }
    }

    pads.forEach(function(pad, p){
      pad.addEventListener("pointerdown", function(e){ e.preventDefault(); onDown(p); });
    });
    showReady();

    return { stop: function(){ clearTimeout(timer); state = "stopped"; } };
  }

  // ---------- boot ----------

  // Stop iOS from scrolling or zooming the page while people are playing
  stage.addEventListener("touchmove", function(e){ e.preventDefault(); }, { passive: false });
  document.addEventListener("dblclick", function(e){ e.preventDefault(); });

  route();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").catch(function(){});
    });
  }
})();
