(function(){
  "use strict";

  var SIZE = 4;
  var SLIDE_MS = 110;
  var SAVE_KEY = "game2048-state";
  var BEST_KEY = "game2048-best";

  var $ = function(id){ return document.getElementById(id); };
  var boardEl = $("board"), tilesEl = $("tiles");
  var scoreEl = $("score"), bestEl = $("best");
  var btnUndo = $("btnUndo");
  var overlay = $("overlay"), overlayTitle = $("overlayTitle"), overlayText = $("overlayText"), btnKeep = $("btnKeep");

  var tiles = [];        // { id, v, r, c }
  var els = {};          // tile id -> element
  var nextId = 1;
  var score = 0, best = 0;
  var won = false, keepPlaying = false, over = false;
  var undoState = null;
  var pending = null;    // { timer, finish } while tiles are sliding

  // Storage can throw in private mode; the game just doesn't persist then
  function load(key){ try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function store(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function cellsOf(){
    var cells = new Array(SIZE * SIZE).fill(0);
    tiles.forEach(function(t){ cells[t.r * SIZE + t.c] = t.v; });
    return cells;
  }
  function snapshot(){ return { cells: cellsOf(), score: score, won: won, keep: keepPlaying }; }

  function save(){
    store(SAVE_KEY, over ? null : snapshot());
    store(BEST_KEY, best);
  }

  function setFromCells(cells){
    tiles = [];
    cells.forEach(function(v, i){
      if (v) tiles.push({ id: nextId++, v: v, r: Math.floor(i / SIZE), c: i % SIZE });
    });
  }

  function emptyCells(){
    var taken = {};
    tiles.forEach(function(t){ taken[t.r * SIZE + t.c] = true; });
    var out = [];
    for (var i = 0; i < SIZE * SIZE; i++) if (!taken[i]) out.push(i);
    return out;
  }

  function spawn(){
    var free = emptyCells();
    if (!free.length) return null;
    var i = free[Math.floor(Math.random() * free.length)];
    var t = { id: nextId++, v: Math.random() < 0.9 ? 2 : 4, r: Math.floor(i / SIZE), c: i % SIZE };
    tiles.push(t);
    return t;
  }

  function canMove(){
    if (emptyCells().length) return true;
    var cells = cellsOf();
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      var v = cells[r * SIZE + c];
      if (c + 1 < SIZE && cells[r * SIZE + c + 1] === v) return true;
      if (r + 1 < SIZE && cells[(r + 1) * SIZE + c] === v) return true;
    }
    return false;
  }

  // ---------- rendering ----------

  function tileEl(t, cls){
    var el = els[t.id];
    if (!el) {
      el = document.createElement("div");
      el.appendChild(document.createElement("b"));
      els[t.id] = el;
      tilesEl.appendChild(el);
    }
    var key = t.v > 2048 ? "big" : String(t.v);
    var digits = String(t.v).length;
    el.className = "tile" + (digits > 2 ? " d" + Math.min(digits, 5) : "") + (cls ? " " + cls : "");
    el.style.setProperty("--r", t.r);
    el.style.setProperty("--c", t.c);
    el.style.setProperty("--bg", "var(--t" + key + ")");
    el.style.setProperty("--fg", "var(--t" + key + "-ink)");
    el.firstChild.textContent = t.v;
    return el;
  }

  function removeEl(id){
    var el = els[id];
    if (el) { el.remove(); delete els[id]; }
  }

  function renderAll(){
    Object.keys(els).forEach(removeEl);
    tiles.forEach(function(t){ tileEl(t, "new"); });
    renderScore();
  }

  function renderScore(){
    scoreEl.textContent = score;
    bestEl.textContent = best;
    btnUndo.disabled = !undoState;
  }

  function showOverlay(title, text, canKeep){
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    btnKeep.hidden = !canKeep;
    overlay.hidden = false;
  }
  function hideOverlay(){ overlay.hidden = true; }

  // ---------- moves ----------

  // Positions of each line, ordered from the edge tiles slide toward
  function linesFor(dir){
    var lines = [];
    for (var i = 0; i < SIZE; i++) {
      var line = [];
      for (var j = 0; j < SIZE; j++) {
        if (dir === "left")  line.push([i, j]);
        if (dir === "right") line.push([i, SIZE - 1 - j]);
        if (dir === "up")    line.push([j, i]);
        if (dir === "down")  line.push([SIZE - 1 - j, i]);
      }
      lines.push(line);
    }
    return lines;
  }

  function flush(){
    if (!pending) return;
    clearTimeout(pending.timer);
    var finish = pending.finish;
    pending = null;
    finish();
  }

  function move(dir){
    flush();
    if (over || !overlay.hidden) return;

    var at = {};
    tiles.forEach(function(t){ at[t.r + "," + t.c] = t; });

    var before = snapshot();
    var moved = false, gained = 0;
    var survivors = [], dying = [], born = [];

    linesFor(dir).forEach(function(line){
      var out = [];   // { tile, merged }
      line.forEach(function(pos){
        var t = at[pos[0] + "," + pos[1]];
        if (!t) return;
        var last = out[out.length - 1];
        if (last && !last.merged && last.tile.v === t.v) {
          var target = line[out.length - 1];
          var made = { id: nextId++, v: t.v * 2, r: target[0], c: target[1] };
          [last.tile, t].forEach(function(d){ d.r = target[0]; d.c = target[1]; dying.push(d); });
          last.tile = made;
          last.merged = true;
          born.push(made);
          gained += made.v;
          moved = true;
        } else {
          out.push({ tile: t, merged: false });
        }
      });
      out.forEach(function(entry, i){
        if (entry.merged) return;
        var t = entry.tile;
        if (t.r !== line[i][0] || t.c !== line[i][1]) moved = true;
        t.r = line[i][0];
        t.c = line[i][1];
        survivors.push(t);
      });
    });

    if (!moved) return;

    undoState = before;
    score += gained;
    if (score > best) best = score;
    tiles = survivors.concat(born);

    survivors.concat(dying).forEach(function(t){ tileEl(t); });
    renderScore();

    pending = {
      finish: function(){
        dying.forEach(function(t){ removeEl(t.id); });
        born.forEach(function(t){ tileEl(t, "merged"); });
        var fresh = spawn();
        if (fresh) tileEl(fresh, "new");
        afterMove(born);
      }
    };
    pending.timer = setTimeout(flush, SLIDE_MS);
  }

  function afterMove(born){
    if (!won && born.some(function(t){ return t.v >= 2048; })) {
      won = true;
      showOverlay("2048 달성!", "축하해요! 계속해서 더 큰 수에 도전할 수 있어요.", true);
    } else if (!canMove()) {
      over = true;
      showOverlay("게임 오버", "점수 " + score + "점" + (score >= best && score > 0 ? " · 최고 기록!" : ""), false);
    }
    save();
  }

  function newGame(){
    flush();
    tiles = [];
    score = 0;
    won = false; keepPlaying = false; over = false;
    undoState = null;
    spawn(); spawn();
    hideOverlay();
    renderAll();
    save();
  }

  function undo(){
    flush();
    if (!undoState) return;
    var s = undoState;
    undoState = null;
    setFromCells(s.cells);
    score = s.score;
    won = s.won; keepPlaying = s.keep; over = false;
    hideOverlay();
    renderAll();
    save();
  }

  // ---------- input ----------

  var KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    a: "left", d: "right", w: "up", s: "down",
    A: "left", D: "right", W: "up", S: "down"
  };
  document.addEventListener("keydown", function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var dir = KEYS[e.key];
    if (dir) { e.preventDefault(); move(dir); }
  });

  var start = null;
  boardEl.addEventListener("pointerdown", function(e){
    if (!overlay.hidden) return;
    start = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", function(e){
    if (!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  window.addEventListener("pointercancel", function(){ start = null; });
  // iOS Safari still scrolls the page on a swipe unless touchmove is cancelled
  boardEl.addEventListener("touchmove", function(e){ e.preventDefault(); }, { passive: false });

  $("btnNew").addEventListener("click", newGame);
  $("btnRetry").addEventListener("click", newGame);
  btnUndo.addEventListener("click", undo);
  btnKeep.addEventListener("click", function(){
    keepPlaying = true;
    hideOverlay();
    save();
  });

  // ---------- boot ----------

  var cellsBg = boardEl.querySelector(".cells");
  for (var i = 0; i < SIZE * SIZE; i++) cellsBg.appendChild(document.createElement("i"));

  best = Number(load(BEST_KEY)) || 0;
  var saved = load(SAVE_KEY);
  if (saved && Array.isArray(saved.cells) && saved.cells.length === SIZE * SIZE) {
    setFromCells(saved.cells);
    score = saved.score || 0;
    won = !!saved.won; keepPlaying = !!saved.keep;
    renderAll();
    if (!canMove()) newGame();
  } else {
    newGame();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").catch(function(){});
    });
  }
})();
