(function(){
  "use strict";

  var STORAGE_KEY = "pantry-expiry-state";

  /* ---------------- categories ---------------- */
  var CATS = [
    { id:"veg", name:"채소·과일", loc:"fridge" },
    { id:"meat", name:"육류·해산물", loc:"fridge" },
    { id:"dairy", name:"유제품·계란", loc:"fridge" },
    { id:"seasoning", name:"조미료·양념", loc:"room" },
    { id:"sauce", name:"소스·장류", loc:"fridge" },
    { id:"processed", name:"가공·냉동식품", loc:"freezer" },
    { id:"drink", name:"음료", loc:"fridge" },
    { id:"etc", name:"기타", loc:"room" }
  ];
  var LOCS = [
    { id:"fridge", name:"냉장" },
    { id:"freezer", name:"냉동" },
    { id:"room", name:"실온" }
  ];
  var STATUSES = [
    { id:"expired", name:"유통기한 지남" },
    { id:"urgent", name:"3일 이내" },
    { id:"week", name:"7일 이내" },
    { id:"ok", name:"여유 있음" },
    { id:"none", name:"기한 없음" }
  ];
  var QUICK = [
    { label:"+3일", days:3 }, { label:"+1주", days:7 }, { label:"+2주", days:14 },
    { label:"+1개월", months:1 }, { label:"+3개월", months:3 }, { label:"+6개월", months:6 },
    { label:"+1년", months:12 }, { label:"기한 없음", none:true }
  ];
  function findById(list, id){
    for (var i=0;i<list.length;i++) if (list[i].id===id) return list[i];
    return list[list.length-1];
  }
  function catById(id){ return findById(CATS, id); }
  function locById(id){ return findById(LOCS, id); }

  /* ---------------- helpers ---------------- */
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function pad(n){ return String(n).padStart(2,"0"); }
  function fmtDate(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
  function parseDate(s){ var p = s.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function todayStr(){ return fmtDate(new Date()); }
  function addDays(s, n){ var d = parseDate(s); d.setDate(d.getDate()+n); return fmtDate(d); }
  function addMonthsToDate(s, n){
    var d = parseDate(s), day = d.getDate();
    var t = new Date(d.getFullYear(), d.getMonth()+n, 1);
    var dim = new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();
    t.setDate(Math.min(day, dim));
    return fmtDate(t);
  }
  function daysBetween(from, to){ return Math.round((parseDate(to) - parseDate(from)) / 86400000); }
  function shortDate(s){ return parseInt(s.slice(5,7),10) + "/" + parseInt(s.slice(8,10),10); }
  function longDate(s){
    var d = parseDate(s);
    return d.getFullYear() + "년 " + (d.getMonth()+1) + "월 " + d.getDate() + "일 (" + ["일","월","화","수","목","금","토"][d.getDay()] + ")";
  }
  function todayMonthKey(){ return todayStr().slice(0,7); }
  function addMonths(mk, delta){
    var p = mk.split("-").map(Number);
    var d = new Date(p[0], p[1]-1+delta, 1);
    return d.getFullYear() + "-" + pad(d.getMonth()+1);
  }
  function monthLabel(mk){ var p = mk.split("-").map(Number); return p[0] + "년 " + p[1] + "월"; }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------------- state ---------------- */
  var state = { v:1, items:[], log:[] };
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") state = parsed;
    }
  } catch(e) {}
  if (!Array.isArray(state.items)) state.items = [];
  if (!Array.isArray(state.log)) state.log = [];

  var ui = { tab:"pantry", loc:"all", status:"all", q:"", editingId:null, month:todayMonthKey(), selectedDay:todayStr() };
  try {
    var savedUi = sessionStorage.getItem("pantry-ui");
    if (savedUi) {
      var su = JSON.parse(savedUi);
      ["tab","loc","status","month","selectedDay"].forEach(function(k){ if (su[k]) ui[k] = su[k]; });
    }
  } catch(e) {}

  /* ---------------- data helpers ---------------- */
  function itemStatus(item, today){
    if (!item.expiry) return { id:"none", days:null, label:"기한 없음" };
    var d = daysBetween(today, item.expiry);
    if (d < 0) return { id:"expired", days:d, label:(-d) + "일 지남" };
    if (d === 0) return { id:"urgent", days:0, label:"D-DAY" };
    if (d <= 3) return { id:"urgent", days:d, label:"D-" + d };
    if (d <= 7) return { id:"week", days:d, label:"D-" + d };
    return { id:"ok", days:d, label:"D-" + d };
  }
  function sortByExpiry(a, b){
    if (!a.expiry && !b.expiry) return a.name.localeCompare(b.name, "ko");
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry < b.expiry ? -1 : (a.expiry > b.expiry ? 1 : a.name.localeCompare(b.name, "ko"));
  }
  function counts(today){
    var c = { expired:0, urgent:0, week:0, ok:0, none:0, total:state.items.length };
    state.items.forEach(function(it){ c[itemStatus(it, today).id]++; });
    return c;
  }
  function matchesQuery(it, q){
    if (!q) return true;
    q = q.toLowerCase();
    return (it.name + " " + (it.memo||"") + " " + catById(it.cat).name).toLowerCase().indexOf(q) !== -1;
  }
  function filteredItems(today){
    return state.items.filter(function(it){
      if (ui.loc !== "all" && it.loc !== ui.loc) return false;
      if (ui.status !== "all") {
        var s = itemStatus(it, today).id;
        // "7일 이내" card counts everything due within a week, including the 3-day ones
        if (ui.status === "week" ? (s !== "week" && s !== "urgent") : s !== ui.status) return false;
      }
      return matchesQuery(it, ui.q);
    }).sort(sortByExpiry);
  }

  /* ---------------- render ---------------- */
  function renderApp(){
    var today = todayStr();
    var html = renderHeader();
    html += '<div class="tabs" role="tablist">' +
      tabBtn("pantry","보관함") + tabBtn("calendar","유통기한 달력") + tabBtn("history","소비 기록") +
      '</div><div style="height:16px"></div>';
    if (ui.tab === "calendar") html += renderCalendarTab(today);
    else if (ui.tab === "history") html += renderHistoryTab();
    else html += renderPantryTab(today);
    html += renderFooter();
    return html;
  }

  function tabBtn(tab, label){
    return '<button type="button" data-action="set-tab" data-tab="'+tab+'" role="tab" aria-selected="'+(ui.tab===tab)+'">'+label+'</button>';
  }

  function renderHeader(){
    return '<header class="top">' +
      '<div class="brand"><p class="eyebrow">fridge &amp; pantry</p><h1>우리집 냉장고</h1></div>' +
      '<span class="save-chip"><span class="led"></span>이 브라우저에 저장 중</span>' +
      '</header>';
  }

  function renderStats(today){
    var c = counts(today);
    function card(id, cls, label, value){
      return '<button type="button" class="card stat '+cls+'" data-action="set-status" data-status="'+id+'" aria-pressed="'+(ui.status===id)+'">' +
        '<span class="k">'+(cls ? '<span class="dot '+cls+'"></span>' : '')+label+'</span>' +
        '<span class="v tabular">'+value+'<small>개</small></span></button>';
    }
    return '<div class="stat-grid">' +
      card("all","","전체 보관", c.total) +
      card("urgent","urgent","3일 이내", c.urgent) +
      card("week","week","7일 이내", c.urgent + c.week) +
      card("expired","expired","유통기한 지남", c.expired) +
      '</div>';
  }

  function renderPantryTab(today){
    return renderStats(today) +
      '<div class="layout">' +
        '<div class="col form-col">' + renderForm() + '</div>' +
        '<div class="col list-col">' + renderListCard(today) + '</div>' +
      '</div>';
  }

  function renderForm(){
    var it = ui.editingId ? state.items.find(function(x){ return x.id === ui.editingId; }) : null;
    if (ui.editingId && !it) ui.editingId = null;
    var v = it || { name:"", cat:"veg", loc:"fridge", expiry:"", qty:"", opened:"", memo:"" };
    var html = '<form class="card form-card" data-action-form="save-item" id="itemForm" autocomplete="off">' +
      '<div class="form-head"><h2>' + (it ? "식재료 수정" : "식재료 추가") + '</h2>' +
      (it ? '<button type="button" class="chip" data-action="cancel-edit">취소</button>' : '') + '</div>' +
      '<div class="field"><label for="fName">이름</label>' +
        '<input type="text" id="fName" maxlength="40" placeholder="예: 우유, 간장, 대파" value="'+esc(v.name)+'" required></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="fCat">분류</label><select id="fCat">' +
          CATS.map(function(c){ return '<option value="'+c.id+'"'+(c.id===v.cat?' selected':'')+'>'+c.name+'</option>'; }).join("") +
        '</select></div>' +
        '<div class="field"><label for="fQty">수량 <span class="hint">(선택)</span></label>' +
          '<input type="text" id="fQty" maxlength="20" placeholder="예: 2개, 500g" value="'+esc(v.qty)+'"></div>' +
      '</div>' +
      '<div class="field"><span class="label">보관 장소</span><div class="seg" id="fLocSeg">' +
        LOCS.map(function(l){ return '<button type="button" data-action="set-form-loc" data-loc="'+l.id+'" aria-pressed="'+(l.id===v.loc)+'">'+l.name+'</button>'; }).join("") +
      '</div><input type="hidden" id="fLoc" value="'+esc(v.loc)+'"></div>' +
      '<div class="field"><label for="fExpiry">유통기한 <span class="hint">(비워두면 기한 없음)</span></label>' +
        '<input type="date" id="fExpiry" value="'+esc(v.expiry||"")+'">' +
        '<div class="chips">' + QUICK.map(function(q, i){ return '<button type="button" class="chip" data-action="quick-exp" data-i="'+i+'">'+q.label+'</button>'; }).join("") + '</div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="fOpened">개봉일 <span class="hint">(선택)</span></label>' +
          '<input type="date" id="fOpened" value="'+esc(v.opened||"")+'"></div>' +
        '<div class="field"><label for="fMemo">메모 <span class="hint">(선택)</span></label>' +
          '<input type="text" id="fMemo" maxlength="60" placeholder="예: 반쯤 남음" value="'+esc(v.memo)+'"></div>' +
      '</div>' +
      '<div class="btn-row">' +
        (it ? '<button type="button" class="btn ghost" data-action="delete-item" data-id="'+it.id+'">잘못 등록 · 삭제</button>' : '') +
        '<button type="submit" class="btn accent">' + (it ? "수정 저장" : "추가하기") + '</button>' +
      '</div>' +
      '</form>';
    return html;
  }

  function renderListCard(today){
    var locCounts = { all: state.items.length };
    state.items.forEach(function(it){ locCounts[it.loc] = (locCounts[it.loc]||0) + 1; });
    var list = filteredItems(today);

    var html = '<div class="card list-pad" id="listCard">' +
      '<div class="list-head"><h2>보관 중인 식재료</h2>' +
        '<input type="search" class="search" id="searchInput" placeholder="이름·메모 검색" value="'+esc(ui.q)+'" aria-label="검색"></div>' +
      '<div class="filter-bar">' +
        '<button type="button" class="chip" data-action="set-loc" data-loc="all" aria-pressed="'+(ui.loc==="all")+'">전체 '+locCounts.all+'</button>' +
        LOCS.map(function(l){ return '<button type="button" class="chip" data-action="set-loc" data-loc="'+l.id+'" aria-pressed="'+(ui.loc===l.id)+'">'+l.name+' '+(locCounts[l.id]||0)+'</button>'; }).join("") +
        (ui.status !== "all" ? '<button type="button" class="chip" data-action="set-status" data-status="all" aria-pressed="true">'+ statusFilterName(ui.status) +' ✕</button>' : '') +
      '</div>';

    if (!state.items.length) {
      html += '<div class="empty-hint">아직 등록한 식재료가 없어요.<br>왼쪽에서 추가하거나, 예시로 둘러보세요.<div style="height:12px"></div>' +
        '<button type="button" class="btn ghost" data-action="load-sample">예시 데이터 넣기</button></div>';
    } else if (!list.length) {
      html += '<div class="empty-hint">조건에 맞는 식재료가 없어요.</div>';
    } else {
      var groups = {};
      list.forEach(function(it){ var s = itemStatus(it, today); (groups[s.id] = groups[s.id] || []).push(it); });
      STATUSES.forEach(function(s){
        if (!groups[s.id]) return;
        html += '<div class="group-label"><span class="dot '+s.id+'"></span>' + s.name + ' · ' + groups[s.id].length + '</div>';
        groups[s.id].forEach(function(it){ html += renderItemRow(it, today); });
      });
    }
    html += '</div>';
    return html;
  }

  function statusFilterName(id){ return id === "week" ? "7일 이내" : findById(STATUSES, id).name; }

  function renderItemRow(it, today){
    var s = itemStatus(it, today);
    var meta = [locById(it.loc).name, catById(it.cat).name];
    if (it.expiry) meta.push(shortDate(it.expiry) + "까지");
    if (it.opened) meta.push("개봉 " + (daysBetween(it.opened, today) + 1) + "일째");
    if (it.memo) meta.push(it.memo);
    return '<div class="item-row'+(ui.editingId===it.id?' editing':'')+'">' +
      '<span class="dday '+s.id+'">'+s.label+'</span>' +
      '<div class="item-main" data-action="edit-item" data-id="'+it.id+'" role="button" tabindex="0" title="눌러서 수정">' +
        '<div class="item-name">'+esc(it.name)+(it.qty ? '<span class="item-qty">'+esc(it.qty)+'</span>' : '')+'</div>' +
        '<div class="item-meta">'+esc(meta.join(" · "))+'</div>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button type="button" class="icon-btn used" data-action="consume" data-outcome="used" data-id="'+it.id+'">다 먹음</button>' +
        '<button type="button" class="icon-btn waste" data-action="consume" data-outcome="wasted" data-id="'+it.id+'">버림</button>' +
      '</div>' +
      '</div>';
  }

  /* calendar */
  function renderCalendarTab(today){
    var mk = ui.month;
    var p = mk.split("-").map(Number);
    var first = new Date(p[0], p[1]-1, 1).getDay();
    var dim = new Date(p[0], p[1], 0).getDate();
    var byDay = {};
    state.items.forEach(function(it){
      if (it.expiry && it.expiry.slice(0,7) === mk) (byDay[it.expiry] = byDay[it.expiry] || []).push(it);
    });
    var monthCount = Object.keys(byDay).reduce(function(n,k){ return n + byDay[k].length; }, 0);
    var noExpiry = state.items.filter(function(it){ return !it.expiry; }).length;

    var html = '<div class="card">' +
      '<div class="month-bar"><div class="month-nav">' +
        '<button type="button" data-action="nav-prev" aria-label="이전 달">‹</button>' +
        '<span class="month-label">'+monthLabel(mk)+'</span>' +
        '<button type="button" data-action="nav-next" aria-label="다음 달">›</button></div>' +
        (mk !== todayMonthKey() ? '<button type="button" class="today-btn" data-action="nav-today">오늘로</button>' : '') +
      '</div>' +
      '<div class="section-sub" style="padding-top:6px">이번 달에 기한이 끝나는 식재료 '+monthCount+'개' + (noExpiry ? ' · 기한 없음 '+noExpiry+'개는 표시되지 않아요' : '') + '</div>' +
      '<div class="cal-wrap"><div class="cal-grid">';
    ["일","월","화","수","목","금","토"].forEach(function(w, i){
      html += '<div class="cal-weekday'+(i===0?' sun':(i===6?' sat':''))+'">'+w+'</div>';
    });
    for (var i=0;i<first;i++) html += '<div class="cal-cell empty"></div>';
    for (var d=1; d<=dim; d++){
      var ds = mk + "-" + pad(d);
      var items = byDay[ds] || [];
      var dots = items.slice(0,4).map(function(it){ return '<span class="dot '+itemStatus(it, today).id+'"></span>'; }).join("");
      var cls = "cal-cell" + (ds===today?" today":"") + (ds===ui.selectedDay?" selected":"");
      html += '<button type="button" class="'+cls+'" data-action="select-day" data-date="'+ds+'" aria-label="'+d+'일, '+items.length+'개">' +
        '<span class="cal-daynum">'+d+'</span>' +
        (items.length ? '<span class="cal-dots">'+dots+'</span>' + (items.length > 4 ? '<span class="cal-count">+'+(items.length-4)+'</span>' : '') : '') +
        '</button>';
    }
    html += '</div>';

    if (ui.selectedDay && ui.selectedDay.slice(0,7) === mk) {
      var sel = (byDay[ui.selectedDay] || []).slice().sort(sortByExpiry);
      html += '<div class="day-detail"><div class="group-label">'+longDate(ui.selectedDay)+' 까지 · '+sel.length+'개</div>';
      if (!sel.length) html += '<div class="empty-hint" style="padding:12px 0">이 날 기한이 끝나는 식재료가 없어요.</div>';
      sel.forEach(function(it){ html += renderItemRow(it, today); });
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  /* history */
  function renderHistoryTab(){
    var mk = todayMonthKey();
    var monthLog = state.log.filter(function(l){ return l.date.slice(0,7) === mk; });
    var used = monthLog.filter(function(l){ return l.outcome === "used"; }).length;
    var wasted = monthLog.length - used;
    var ratio = monthLog.length ? Math.round(used / monthLog.length * 100) : 0;

    var html = '<div class="stack">' +
      '<div class="hist-grid">' +
        '<div class="card stat used"><span class="k">이번 달 다 먹음</span><span class="v tabular">'+used+'<small>개</small></span></div>' +
        '<div class="card stat wasted"><span class="k">이번 달 버림</span><span class="v tabular">'+wasted+'<small>개</small></span></div>' +
        '<div class="card stat"><span class="k">알뜰 소비율</span><span class="v tabular">'+(monthLog.length ? ratio+'<small>%</small>' : '—')+'</span></div>' +
      '</div>';

    if (monthLog.length) {
      html += '<div class="card"><h2 class="section-title">'+monthLabel(mk)+' 소비 현황</h2>' +
        '<div class="ratio-track" role="img" aria-label="다 먹음 '+used+'개, 버림 '+wasted+'개"><div class="ratio-fill" style="width:'+ratio+'%"></div></div>' +
        '<div class="ratio-legend"><span><span class="dot ok"></span> 다 먹음 '+used+'</span><span>버림 '+wasted+' <span class="dot expired"></span></span></div>';
      var wasteByCat = {};
      monthLog.forEach(function(l){ if (l.outcome === "wasted") wasteByCat[l.item.cat] = (wasteByCat[l.item.cat]||0) + 1; });
      var top = Object.keys(wasteByCat).sort(function(a,b){ return wasteByCat[b]-wasteByCat[a]; })[0];
      if (top) html += '<div class="section-sub" style="padding-bottom:16px;margin-top:-8px">가장 많이 버린 분류: <b>'+catById(top).name+'</b> ('+wasteByCat[top]+'개)</div>';
      html += '</div>';
    }

    var recent = state.log.slice().sort(function(a,b){ return a.at < b.at ? 1 : -1; }).slice(0, 40);
    html += '<div class="card list-pad"><h2 class="section-title">최근 기록</h2>' +
      '<div class="section-sub">잘못 누른 경우 되돌리면 보관함으로 돌아가요.</div><div style="height:10px"></div>';
    if (!recent.length) html += '<div class="empty-hint">보관함에서 “다 먹음”이나 “버림”을 누르면 여기에 기록돼요.</div>';
    recent.forEach(function(l){
      html += '<div class="log-row"><span class="log-date">'+shortDate(l.date)+'</span>' +
        '<span class="log-name">'+esc(l.item.name)+'</span>' +
        '<span class="log-tag '+l.outcome+'">'+(l.outcome==="used"?"다 먹음":"버림")+'</span>' +
        '<button type="button" class="log-undo" data-action="undo-log" data-id="'+l.id+'">되돌리기</button></div>';
    });
    html += '</div>';

    html += '<div class="card"><h2 class="section-title">백업</h2><div class="backup">' +
      '<p>데이터는 이 브라우저에만 저장돼요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 파일로 내보내 두세요.</p>' +
      '<div class="btn-row" style="justify-content:flex-start">' +
        '<button type="button" class="btn" data-action="export">파일로 내보내기</button>' +
        '<button type="button" class="btn ghost" data-action="import">파일에서 불러오기</button>' +
      '</div></div></div>';
    html += '</div>';
    return html;
  }

  function renderFooter(){
    return '<footer class="foot">D-day는 오늘 날짜 기준으로 계산돼요. 유통기한은 참고용이니, 개봉 후에는 제품 표기의 보관 방법과 상태를 꼭 함께 확인하세요.</footer>';
  }

  function render(){
    document.getElementById("app").innerHTML = renderApp();
  }
  function renderList(){
    var card = document.getElementById("listCard");
    if (!card) return render();
    card.outerHTML = renderListCard(todayStr());
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function showToast(msg){
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove("show"); }, 3200);
  }

  /* ---------------- persistence ---------------- */
  function stashUi(){
    try { sessionStorage.setItem("pantry-ui", JSON.stringify({ tab:ui.tab, loc:ui.loc, status:ui.status, month:ui.month, selectedDay:ui.selectedDay })); } catch(e) {}
  }
  function saveLocal(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e) { showToast("저장에 실패했어요. 브라우저 저장 공간을 확인해주세요."); }
  }
  function persistMutation(){ stashUi(); saveLocal(); render(); }

  /* ---------------- mutations ---------------- */
  function saveItem(data){
    if (ui.editingId) {
      var it = state.items.find(function(x){ return x.id === ui.editingId; });
      if (it) Object.assign(it, data);
      ui.editingId = null;
      showToast("“" + data.name + "” 수정했어요.");
    } else {
      data.id = uid();
      data.addedAt = todayStr();
      state.items.push(data);
      showToast("“" + data.name + "” 추가했어요.");
    }
    persistMutation();
  }
  function consumeItem(id, outcome){
    var it = state.items.find(function(x){ return x.id === id; });
    if (!it) return;
    state.items = state.items.filter(function(x){ return x.id !== id; });
    state.log.push({ id:uid(), date:todayStr(), at:Date.now(), outcome:outcome, item:it });
    if (state.log.length > 500) state.log = state.log.slice(-500);
    if (ui.editingId === id) ui.editingId = null;
    persistMutation();
    showToast(outcome === "used" ? "“" + it.name + "” 다 먹었어요." : "“" + it.name + "” 버림으로 기록했어요.");
  }
  function deleteItem(id){
    var it = state.items.find(function(x){ return x.id === id; });
    if (!it || !confirm("“" + it.name + "”을(를) 기록 없이 삭제할까요?")) return;
    state.items = state.items.filter(function(x){ return x.id !== id; });
    ui.editingId = null;
    persistMutation();
  }
  function undoLog(id){
    var l = state.log.find(function(x){ return x.id === id; });
    if (!l) return;
    state.log = state.log.filter(function(x){ return x.id !== id; });
    if (!state.items.some(function(x){ return x.id === l.item.id; })) state.items.push(l.item);
    persistMutation();
    showToast("“" + l.item.name + "” 보관함으로 되돌렸어요.");
  }
  function loadSample(){
    var t = todayStr();
    var sample = [
      { name:"우유", cat:"dairy", loc:"fridge", expiry:addDays(t, 2), qty:"1L", opened:addDays(t, -1), memo:"" },
      { name:"계란", cat:"dairy", loc:"fridge", expiry:addDays(t, 12), qty:"10구", opened:"", memo:"" },
      { name:"대파", cat:"veg", loc:"fridge", expiry:addDays(t, 5), qty:"1단", opened:"", memo:"" },
      { name:"두부", cat:"processed", loc:"fridge", expiry:addDays(t, -1), qty:"1모", opened:"", memo:"" },
      { name:"돼지고기 앞다리", cat:"meat", loc:"freezer", expiry:addMonthsToDate(t, 2), qty:"600g", opened:"", memo:"찌개용" },
      { name:"진간장", cat:"sauce", loc:"room", expiry:addMonthsToDate(t, 8), qty:"", opened:addDays(t, -40), memo:"" },
      { name:"고추장", cat:"sauce", loc:"fridge", expiry:addMonthsToDate(t, 5), qty:"", opened:addDays(t, -20), memo:"" },
      { name:"굵은소금", cat:"seasoning", loc:"room", expiry:"", qty:"", opened:"", memo:"" }
    ];
    sample.forEach(function(s){ s.id = uid(); s.addedAt = t; state.items.push(s); });
    persistMutation();
    showToast("예시 데이터를 넣었어요. 필요 없으면 “잘못 등록 · 삭제”로 지우세요.");
  }

  /* ---------------- backup ---------------- */
  function exportData(){
    var blob = new Blob([JSON.stringify(state, null, 2)], { type:"application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "냉장고-백업-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function importData(file){
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.items)) throw new Error("bad");
        var valid = data.items.every(function(it){ return it && typeof it.name === "string" && typeof it.id === "string"; });
        if (!valid) throw new Error("bad");
        if (!confirm("현재 데이터를 파일 내용(식재료 " + data.items.length + "개)으로 바꿀까요?")) return;
        state = { v:1, items:data.items, log:Array.isArray(data.log) ? data.log : [] };
        ui.editingId = null;
        persistMutation();
        showToast("백업을 불러왔어요.");
      } catch(e) { showToast("올바른 백업 파일이 아니에요."); }
    };
    reader.readAsText(file);
  }

  /* ---------------- events ---------------- */
  function setFormLoc(loc){
    var input = document.getElementById("fLoc");
    if (!input) return;
    input.value = loc;
    document.querySelectorAll("#fLocSeg button").forEach(function(b){
      b.setAttribute("aria-pressed", String(b.getAttribute("data-loc") === loc));
    });
  }

  function onClick(e){
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    var id = t.getAttribute("data-id");
    if (action === "set-tab") { ui.tab = t.getAttribute("data-tab"); ui.editingId = null; stashUi(); render(); }
    else if (action === "set-loc") { ui.loc = t.getAttribute("data-loc"); stashUi(); renderList(); }
    else if (action === "set-status") {
      var st = t.getAttribute("data-status");
      ui.status = (ui.status === st) ? "all" : st;
      stashUi(); render();
    }
    else if (action === "set-form-loc") { setFormLoc(t.getAttribute("data-loc")); }
    else if (action === "quick-exp") {
      var q = QUICK[parseInt(t.getAttribute("data-i"), 10)];
      var input = document.getElementById("fExpiry");
      input.value = q.none ? "" : (q.months ? addMonthsToDate(todayStr(), q.months) : addDays(todayStr(), q.days));
    }
    else if (action === "edit-item") {
      ui.editingId = id; ui.tab = "pantry"; stashUi(); render();
      var form = document.getElementById("itemForm");
      if (form) { form.scrollIntoView({ behavior:"smooth", block:"start" }); document.getElementById("fName").focus({ preventScroll:true }); }
    }
    else if (action === "cancel-edit") { ui.editingId = null; render(); }
    else if (action === "consume") { consumeItem(id, t.getAttribute("data-outcome")); }
    else if (action === "delete-item") { deleteItem(id); }
    else if (action === "undo-log") { undoLog(id); }
    else if (action === "load-sample") { loadSample(); }
    else if (action === "nav-prev") { ui.month = addMonths(ui.month, -1); stashUi(); render(); }
    else if (action === "nav-next") { ui.month = addMonths(ui.month, 1); stashUi(); render(); }
    else if (action === "nav-today") { ui.month = todayMonthKey(); ui.selectedDay = todayStr(); stashUi(); render(); }
    else if (action === "select-day") { ui.selectedDay = t.getAttribute("data-date"); stashUi(); render(); }
    else if (action === "export") { exportData(); }
    else if (action === "import") { document.getElementById("importFile").click(); }
  }

  function onKeydown(e){
    if ((e.key === "Enter" || e.key === " ") && e.target.matches('[data-action="edit-item"]')) {
      e.preventDefault();
      e.target.click();
    }
  }

  function onInput(e){
    if (e.target.id === "searchInput") {
      var pos = e.target.selectionStart;
      ui.q = e.target.value;
      renderList();
      var s = document.getElementById("searchInput");
      s.focus();
      try { s.setSelectionRange(pos, pos); } catch(e2) {}
    }
  }

  function onChange(e){
    if (e.target.id === "fCat" && !ui.editingId) {
      setFormLoc(catById(e.target.value).loc);
    } else if (e.target.id === "importFile" && e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = "";
    }
  }

  function onSubmit(e){
    var form = e.target.closest("[data-action-form]");
    if (!form) return;
    e.preventDefault();
    var name = document.getElementById("fName").value.trim();
    if (!name) { showToast("이름을 입력해주세요."); return; }
    var expiry = document.getElementById("fExpiry").value;
    var opened = document.getElementById("fOpened").value;
    if (opened && opened > todayStr()) { showToast("개봉일은 오늘 이전이어야 해요."); return; }
    saveItem({
      name: name,
      cat: document.getElementById("fCat").value,
      loc: document.getElementById("fLoc").value,
      expiry: expiry || "",
      qty: document.getElementById("fQty").value.trim(),
      opened: opened || "",
      memo: document.getElementById("fMemo").value.trim()
    });
    var n = document.getElementById("fName");
    if (n && !ui.editingId) n.focus({ preventScroll:true });
  }

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", onSubmit);

  // D-day depends on today's date, so refresh when the app comes back after midnight
  var renderedDay = todayStr();
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "visible" && todayStr() !== renderedDay) { renderedDay = todayStr(); render(); }
  });

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").catch(function(){});
    });
  }
})();
