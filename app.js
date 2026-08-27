(function(){
  "use strict";

  var STORAGE_KEY = "household-ledger-state";

  /* ---------------- categories ---------------- */
  var EXPENSE_CATS = [
    { id:"food", name:"식비", slot:"2" },
    { id:"transport", name:"교통", slot:"1" },
    { id:"housing", name:"주거/공과금", slot:"7" },
    { id:"leisure", name:"문화/여가", slot:"5" },
    { id:"shopping", name:"쇼핑/생활", slot:"4" },
    { id:"health", name:"건강/의료", slot:"3" },
    { id:"education", name:"교육", slot:"6" },
    { id:"etc", name:"기타", slot:"other" }
  ];
  var INCOME_CATS = [
    { id:"salary", name:"급여" },
    { id:"side", name:"부수입" },
    { id:"allowance", name:"용돈" },
    { id:"etcIncome", name:"기타수입" }
  ];
  function catById(id){
    for (var i=0;i<EXPENSE_CATS.length;i++) if (EXPENSE_CATS[i].id===id) return EXPENSE_CATS[i];
    return EXPENSE_CATS[EXPENSE_CATS.length-1];
  }
  function incomeCatById(id){
    for (var i=0;i<INCOME_CATS.length;i++) if (INCOME_CATS[i].id===id) return INCOME_CATS[i];
    return INCOME_CATS[INCOME_CATS.length-1];
  }

  /* ---------------- helpers ---------------- */
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function fmtWon(n){ return Math.round(n).toLocaleString("ko-KR") + "원"; }
  function fmtBig(n){
    n = Math.round(n);
    var neg = n < 0; n = Math.abs(n);
    var out;
    if (n < 10000) out = n.toLocaleString("ko-KR") + "원";
    else {
      var eok = Math.floor(n/1e8), man = Math.floor((n%1e8)/1e4);
      if (eok > 0 && man === 0) out = eok.toLocaleString("ko-KR") + "억원";
      else if (eok > 0) out = eok.toLocaleString("ko-KR") + "억 " + man.toLocaleString("ko-KR") + "만원";
      else out = man.toLocaleString("ko-KR") + "만원";
    }
    return (neg ? "-" : "") + out;
  }
  function fmtCompact(n){
    n = Math.round(n);
    if (n >= 1e8) return (n/1e8).toFixed(1).replace(/\.0$/,"") + "억";
    if (n >= 1e4) return Math.round(n/1e4) + "만";
    return n.toLocaleString("ko-KR");
  }
  function parseAmount(str){
    var n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? 0 : Math.max(0, n);
  }
  function fmtAmountInput(n){ return n ? Math.round(n).toLocaleString("ko-KR") : ""; }

  function todayStr(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function todayMonthKey(){ return todayStr().slice(0,7); }
  function parseMK(mk){ var p = mk.split("-").map(Number); return { y:p[0], m:p[1] }; }
  function addMonths(mk, delta){
    var p = parseMK(mk);
    var d = new Date(p.y, p.m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
  }
  function monthLabel(mk){ var p = parseMK(mk); return p.y + "년 " + p.m + "월"; }
  function daysInMonth(mk){ var p = parseMK(mk); return new Date(p.y, p.m, 0).getDate(); }
  function dayLabel(dateStr){
    var d = new Date(dateStr + "T00:00:00");
    var wk = ["일","월","화","수","목","금","토"][d.getDay()];
    return parseInt(dateStr.slice(8,10),10) + "일 (" + wk + ")";
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------------- state ---------------- */
  var DEFAULT_STATE = { v:1, transactions:[], recurring:[], budgets:{ total:null, byCategory:{} } };
  var state = DEFAULT_STATE;
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") state = parsed;
    }
  } catch(e) {}
  if (!state.budgets) state.budgets = { total:null, byCategory:{} };
  if (!state.transactions) state.transactions = [];
  if (!state.recurring) state.recurring = [];

  var ui = { month: todayMonthKey(), tab: "overview", txnType: "expense", view: "calendar", selectedDay: todayStr() };
  try {
    var savedUi = sessionStorage.getItem("ledger-ui");
    if (savedUi) {
      var su = JSON.parse(savedUi);
      if (su.month) ui.month = su.month;
      if (su.tab) ui.tab = su.tab;
      if (su.view) ui.view = su.view;
      if (su.selectedDay !== undefined) ui.selectedDay = su.selectedDay;
    }
  } catch(e) {}

  function shiftSelectedDayToMonth(selectedDay, newMonth){
    if (!selectedDay) return null;
    var day = parseInt(selectedDay.slice(8,10), 10);
    var dim = daysInMonth(newMonth);
    day = Math.min(day, dim);
    return newMonth + "-" + String(day).padStart(2,"0");
  }

  /* ---------------- data helpers ---------------- */
  function monthTransactions(mk){
    var real = state.transactions.filter(function(t){ return t.date.slice(0,7) === mk; })
      .map(function(t){ return { id:t.id, date:t.date, type:t.type, categoryId:t.categoryId, amount:t.amount, memo:t.memo, virtual:false }; });
    var dim = daysInMonth(mk);
    var virt = state.recurring.filter(function(r){
      return r.active && (!r.startMonth || mk >= r.startMonth);
    }).map(function(r){
      var day = Math.min(r.day, dim);
      var dateStr = mk + "-" + String(day).padStart(2,"0");
      return { id:"rec-"+r.id, date:dateStr, type:r.type, categoryId:r.categoryId, amount:r.amount, memo:r.name, virtual:true, recurringId:r.id };
    });
    return real.concat(virt).sort(function(a,b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  }
  function summarize(list){
    var income=0, expense=0, byCat={};
    list.forEach(function(t){
      if (t.type === "income") income += t.amount;
      else { expense += t.amount; byCat[t.categoryId] = (byCat[t.categoryId]||0) + t.amount; }
    });
    return { income:income, expense:expense, net:income-expense, byCat:byCat };
  }
  function dailyAggregates(list){
    var byDay = {};
    list.forEach(function(t){
      if (!byDay[t.date]) byDay[t.date] = { income:0, expense:0 };
      if (t.type === "income") byDay[t.date].income += t.amount;
      else byDay[t.date].expense += t.amount;
    });
    return byDay;
  }
  function budgetStatus(spent, budget){
    if (budget == null || budget <= 0) return null;
    var ratio = spent / budget;
    if (ratio >= 1) return "critical";
    if (ratio >= 0.9) return "warning";
    return "good";
  }

  /* ---------------- render ---------------- */
  function renderApp(){
    var list = monthTransactions(ui.month);
    var sum = summarize(list);

    var html = "";
    html += renderHeader();
    html += renderMonthBar();
    html += '<div class="tabs" role="tablist">' +
      tabBtn("overview","이번 달") + tabBtn("recurring","고정 지출·수입") + tabBtn("budget","예산 설정") +
      "</div>";
    html += '<div style="height:16px"></div>';

    if (ui.tab === "overview") html += renderOverview(list, sum);
    else if (ui.tab === "recurring") html += renderRecurring();
    else html += renderBudgetTab();

    html += renderFooter();
    return html;
  }

  function tabBtn(tab, label){
    return '<button type="button" data-action="set-tab" data-tab="'+tab+'" role="tab" aria-selected="'+(ui.tab===tab)+'">'+label+'</button>';
  }

  function renderHeader(){
    return '<header class="top">' +
      '<div class="brand"><p class="eyebrow">household ledger</p><h1>우리집 가계부</h1></div>' +
      '<span class="save-chip local" id="saveChip"><span class="led"></span>이 브라우저에 저장 중</span>' +
      '</header>';
  }

  function renderMonthBar(){
    return '<div class="month-bar">' +
      '<div class="month-nav">' +
        '<button type="button" data-action="nav-prev" aria-label="이전 달">‹</button>' +
        '<span class="month-label">' + monthLabel(ui.month) + '</span>' +
        '<button type="button" data-action="nav-next" aria-label="다음 달">›</button>' +
      '</div>' +
      (ui.month !== todayMonthKey() ? '<button type="button" class="today-btn" data-action="nav-today">이번 달로</button>' : '') +
      '</div>';
  }

  function renderOverview(list, sum){
    var out = '<div class="stack">';
    out += renderTxnCard(list);
    out += renderAddTxnForm();
    out += renderBudgetCard(sum);
    out += renderCategoryCard(sum);
    out += renderStatGrid(sum);
    out += '</div>';
    return out;
  }

  function renderStatGrid(sum){
    var netClass = sum.net >= 0 ? "pos" : "neg";
    return '<div class="stat-grid">' +
      '<div class="card stat income"><span class="k">이번 달 수입</span><span class="v tabular">'+fmtBig(sum.income)+'</span></div>' +
      '<div class="card stat expense"><span class="k">이번 달 지출</span><span class="v tabular">'+fmtBig(sum.expense)+'</span></div>' +
      '<div class="card stat net"><span class="k">순잔액</span><span class="v tabular '+netClass+'">'+fmtBig(sum.net)+'</span></div>' +
      '</div>';
  }

  function renderTxnCard(list){
    var html = '<div class="card">' +
      '<div class="txn-card-head"><h2 class="section-title" style="padding:0">거래 내역</h2>' +
      '<div class="view-toggle">' +
        '<button type="button" data-action="set-view" data-view="calendar" aria-pressed="' + (ui.view==="calendar") + '">달력</button>' +
        '<button type="button" data-action="set-view" data-view="list" aria-pressed="' + (ui.view==="list") + '">목록</button>' +
      '</div></div>';
    if (ui.view === "calendar") {
      var byDay = dailyAggregates(list);
      html += '<div class="cal-wrap">' + renderCalendarGrid(ui.month, byDay) + renderDayDetail(list) + '</div>';
    } else {
      html += renderTxnListBody(list);
    }
    html += '</div>';
    return html;
  }

  function renderCalendarGrid(mk, byDay){
    var p = parseMK(mk);
    var firstDate = new Date(p.y, p.m - 1, 1);
    var startWeekday = firstDate.getDay();
    var dim = daysInMonth(mk);
    var todayS = todayStr();
    var weekdayNames = ["일","월","화","수","목","금","토"];
    var header = weekdayNames.map(function(w, idx){
      return '<div class="cal-weekday' + (idx===0?" sun":"") + (idx===6?" sat":"") + '">' + w + '</div>';
    }).join("");

    var cells = "";
    for (var i=0; i<startWeekday; i++) cells += '<div class="cal-cell empty"></div>';
    for (var day=1; day<=dim; day++) {
      var dateStr = mk + "-" + String(day).padStart(2,"0");
      var agg = byDay[dateStr];
      var isToday = dateStr === todayS;
      var isSelected = dateStr === ui.selectedDay;
      var cls = "cal-cell" + (isToday?" today":"") + (isSelected?" selected":"");
      cells += '<button type="button" class="' + cls + '" data-action="select-day" data-date="' + dateStr + '">' +
        '<span class="cal-daynum">' + day + '</span>' +
        (agg && agg.expense > 0 ? '<span class="cal-amt expense tabular">-' + fmtCompact(agg.expense) + '</span>' : "") +
        (agg && agg.income > 0 ? '<span class="cal-amt income tabular">+' + fmtCompact(agg.income) + '</span>' : "") +
        '</button>';
    }
    var totalCells = startWeekday + dim;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var j=0; j<trailing; j++) cells += '<div class="cal-cell empty"></div>';

    return '<div class="cal-grid">' + header + cells + '</div>';
  }

  function renderDayDetail(list){
    var html = '<div class="day-detail">';
    if (!ui.selectedDay) {
      html += '<p class="empty-hint">날짜를 눌러보면 그날의 기록을 볼 수 있어요.</p></div>';
      return html;
    }
    var dayList = list.filter(function(t){ return t.date === ui.selectedDay; });
    var sum = summarize(dayList);
    html += '<div class="day-detail-head"><span>' + dayLabel(ui.selectedDay) + '</span>' +
      '<span class="day-detail-sum tabular">' +
      (sum.income > 0 ? '<span style="color:var(--income)">+' + fmtWon(sum.income) + '</span> ' : "") +
      (sum.expense > 0 ? '<span style="color:var(--expense)">-' + fmtWon(sum.expense) + '</span>' : "") +
      (sum.income === 0 && sum.expense === 0 ? '기록 없음' : "") +
      '</span></div>';
    if (dayList.length === 0) {
      html += '<p class="empty-hint">이 날은 기록이 없어요.</p>';
    } else {
      dayList.forEach(function(t){
        var cat = t.type === "expense" ? catById(t.categoryId) : incomeCatById(t.categoryId);
        html += '<div class="txn-row">' +
          '<span class="cat-dot ' + (t.type==="expense" ? "cat-"+cat.slot : "") + '" style="' + (t.type==="income" ? "background:var(--income)" : "") + '"></span>' +
          '<span class="txn-cat">' + esc(cat.name) + '</span>' +
          '<span class="txn-memo' + (t.memo ? '' : ' empty') + '">' + (t.memo ? esc(t.memo) : "메모 없음") + '</span>' +
          (t.virtual ? '<span class="pill-fixed">고정</span>' : '') +
          '<span class="txn-amt ' + t.type + ' tabular">' + (t.type==="income"?"+":"-") + fmtWon(t.amount) + '</span>' +
          (t.virtual ? '' : '<button type="button" class="txn-del" data-action="delete-txn" data-id="' + t.id + '" aria-label="삭제">×</button>') +
          '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderBudgetCard(sum){
    var b = state.budgets.total;
    var html = '<div class="card budget-card"><h2 class="section-title">이번 달 예산</h2>';
    if (b == null) {
      html += '<p class="no-budget-hint">아직 총 예산을 설정하지 않았어요. <b>예산 설정</b> 탭에서 이번 달 목표를 정해보세요.</p>';
    } else {
      var status = budgetStatus(sum.expense, b) || "good";
      var pct = Math.min(100, Math.round((sum.expense / b) * 100));
      var remain = b - sum.expense;
      html += '<div class="budget-summary">' +
        '<div class="progress-row"><span>' + fmtWon(sum.expense) + ' 사용</span><span class="status-pill ' + status + '">' + pct + '%</span></div>' +
        '<div class="progress-track"><div class="progress-fill ' + (status==="good"?"":status) + '" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-row"><span>총 예산 ' + fmtWon(b) + '</span><span>' + (remain >= 0 ? (fmtWon(remain) + ' 남음') : (fmtWon(-remain) + ' 초과')) + '</span></div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderCategoryCard(sum){
    var rows = EXPENSE_CATS.map(function(c){ return { cat:c, amt: sum.byCat[c.id] || 0, budget: state.budgets.byCategory[c.id] || null }; })
      .filter(function(r){ return r.amt > 0 || r.budget; })
      .sort(function(a,b){ return b.amt - a.amt; });

    var html = '<div class="card">' +
      '<h2 class="section-title">카테고리별 지출</h2>' +
      '<p class="section-sub">이번 달 지출이 어디에 가장 많이 쓰였는지 보여줘요.</p>';

    if (rows.length === 0) {
      html += '<p class="empty-hint">이번 달 지출 기록이 아직 없어요.</p></div>';
      return html;
    }

    var maxVal = Math.max.apply(null, rows.map(function(r){ return Math.max(r.amt, r.budget || 0); }).concat([1]));
    html += '<div class="cat-list">';
    rows.forEach(function(r){
      var pct = Math.min(100, (r.amt / maxVal) * 100);
      var over = r.budget && r.amt > r.budget;
      var markPct = r.budget ? Math.min(100, (r.budget / maxVal) * 100) : null;
      html += '<div class="cat-row">' +
        '<div class="cat-row-head"><span class="cat-dot cat-' + r.cat.slot + '"></span><span class="cat-name">' + r.cat.name + '</span><span class="cat-amt tabular">' + fmtWon(r.amt) + '</span></div>' +
        '<div class="cat-track"><div class="cat-fill cat-' + r.cat.slot + '" style="width:' + pct + '%"></div>' +
        (markPct !== null ? '<div class="cat-budget-mark" style="left:' + markPct + '%"></div>' : '') +
        '</div>' +
        (over ? '<div class="cat-over">예산 ' + fmtWon(r.budget) + ' 초과</div>' : '') +
        '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderAddTxnForm(){
    var cats = ui.txnType === "expense" ? EXPENSE_CATS : INCOME_CATS;
    var options = cats.map(function(c){ return '<option value="'+c.id+'">'+c.name+'</option>'; }).join("");
    return '<form class="card form-card" id="addTxnForm" data-action-form="add-txn">' +
      '<h2 class="section-title" style="padding:0">거래 추가</h2>' +
      '<div class="seg">' +
        '<button type="button" class="t-expense" data-action="txn-type" data-type="expense" aria-pressed="' + (ui.txnType==="expense") + '">지출</button>' +
        '<button type="button" class="t-income" data-action="txn-type" data-type="income" aria-pressed="' + (ui.txnType==="income") + '">수입</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="txnDate">날짜</label><input type="date" id="txnDate" name="date" value="' + todayStr() + '" required></div>' +
        '<div class="field"><label for="txnCat">카테고리</label><select id="txnCat" name="category">' + options + '</select></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="txnAmount">금액</label><div class="amount-row"><input type="text" id="txnAmount" name="amount" inputmode="numeric" placeholder="0" required><span>원</span></div></div>' +
        '<div class="field"><label for="txnMemo">메모 (선택)</label><input type="text" id="txnMemo" name="memo" placeholder="예: 장보기"></div>' +
      '</div>' +
      '<div class="btn-row"><button type="submit" class="btn accent">추가하기</button></div>' +
      '</form>';
  }

  function renderTxnListBody(list){
    if (list.length === 0) {
      return '<p class="empty-hint">이번 달 기록이 아직 없어요. 위에서 첫 거래를 추가해보세요.</p>';
    }
    var html = "";
    var lastDay = null;
    list.forEach(function(t){
      var d = t.date;
      if (d !== lastDay) { html += '<div class="txn-day">' + dayLabel(d) + '</div>'; lastDay = d; }
      var cat = t.type === "expense" ? catById(t.categoryId) : incomeCatById(t.categoryId);
      html += '<div class="txn-row">' +
        '<span class="cat-dot ' + (t.type==="expense" ? "cat-"+cat.slot : "") + '" style="' + (t.type==="income" ? "background:var(--income)" : "") + '"></span>' +
        '<span class="txn-cat">' + esc(cat.name) + '</span>' +
        '<span class="txn-memo' + (t.memo ? '' : ' empty') + '">' + (t.memo ? esc(t.memo) : "메모 없음") + '</span>' +
        (t.virtual ? '<span class="pill-fixed">고정</span>' : '') +
        '<span class="txn-amt ' + t.type + ' tabular">' + (t.type==="income"?"+":"-") + fmtWon(t.amount) + '</span>' +
        (t.virtual ? '' : '<button type="button" class="txn-del" data-action="delete-txn" data-id="' + t.id + '" aria-label="삭제">×</button>') +
        '</div>';
    });
    return html;
  }

  function renderRecurring(){
    var html = '<div class="layout"><div class="col">';
    html += '<form class="card form-card" id="addRecForm" data-action-form="add-rec">' +
      '<h2 class="section-title" style="padding:0">고정 지출·수입 추가</h2>' +
      '<div class="seg">' +
        '<button type="button" class="t-expense" data-action="rec-type" data-type="expense" aria-pressed="' + (ui.txnType==="expense") + '">지출</button>' +
        '<button type="button" class="t-income" data-action="rec-type" data-type="income" aria-pressed="' + (ui.txnType==="income") + '">수입</button>' +
      '</div>' +
      '<div class="field"><label for="recName">이름</label><input type="text" id="recName" name="name" placeholder="예: 넷플릭스 구독" required></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="recCat">카테고리</label><select id="recCat" name="category">' +
          (ui.txnType === "expense" ? EXPENSE_CATS : INCOME_CATS).map(function(c){ return '<option value="'+c.id+'">'+c.name+'</option>'; }).join("") +
        '</select></div>' +
        '<div class="field"><label for="recDay">매달 며칠</label><input type="number" id="recDay" name="day" min="1" max="31" value="1" required></div>' +
      '</div>' +
      '<div class="field"><label for="recAmount">금액</label><div class="amount-row"><input type="text" id="recAmount" name="amount" inputmode="numeric" placeholder="0" required><span>원</span></div></div>' +
      '<div class="btn-row"><button type="submit" class="btn accent">추가하기</button></div>' +
      '</form>';
    html += '</div><div class="col">';
    html += '<div class="card"><h2 class="section-title">등록된 고정 항목</h2><p class="section-sub">매달 같은 날짜에 자동으로 이번 달 내역에 반영돼요.</p>';
    if (state.recurring.length === 0) {
      html += '<p class="empty-hint">아직 등록된 고정 지출·수입이 없어요.</p></div>';
    } else {
      html += '<div class="rec-list">';
      state.recurring.slice().sort(function(a,b){ return a.day - b.day; }).forEach(function(r){
        var cat = r.type === "expense" ? catById(r.categoryId) : incomeCatById(r.categoryId);
        html += '<div class="rec-row' + (r.active ? "" : " inactive") + '">' +
          '<div class="rec-main"><div class="rec-name">' + esc(r.name) + '</div><div class="rec-meta">매달 ' + r.day + '일 · ' + esc(cat.name) + '</div></div>' +
          '<span class="rec-amt ' + r.type + ' tabular">' + (r.type==="income"?"+":"-") + fmtWon(r.amount) + '</span>' +
          '<label class="switch"><input type="checkbox" data-action="toggle-rec" data-id="' + r.id + '" ' + (r.active?"checked":"") + '><span class="track"><span class="knob"></span></span></label>' +
          '<button type="button" class="rec-del" data-action="delete-rec" data-id="' + r.id + '" aria-label="삭제">×</button>' +
          '</div>';
      });
      html += '</div></div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderBudgetTab(){
    var b = state.budgets;
    var html = '<form class="card form-card" id="budgetForm" data-action-form="save-budget" style="max-width:640px">' +
      '<h2 class="section-title" style="padding:0">이번 달 예산</h2>' +
      '<div class="field"><label for="budgetTotal">총 지출 예산 (비워두면 제한 없음)</label><div class="amount-row"><input type="text" id="budgetTotal" inputmode="numeric" placeholder="예: 1,500,000" value="' + fmtAmountInput(b.total) + '"><span>원</span></div></div>' +
      '<div class="section-sub" style="padding:6px 0 0">카테고리별 예산 (선택)</div>' +
      '<div class="budget-grid">';
    EXPENSE_CATS.forEach(function(c){
      html += '<div class="field"><label for="cat_'+c.id+'"><span class="cat-dot cat-'+c.slot+'" style="display:inline-block;margin-right:5px;vertical-align:middle;"></span>' + c.name + '</label>' +
        '<div class="amount-row"><input type="text" id="cat_'+c.id+'" data-cat="'+c.id+'" class="budget-cat-input" inputmode="numeric" placeholder="0" value="' + fmtAmountInput(b.byCategory[c.id]) + '"><span>원</span></div></div>';
    });
    html += '</div>' +
      '<div class="btn-row"><button type="submit" class="btn accent">예산 저장</button></div>' +
      '</form>';
    return html;
  }

  function renderFooter(){
    return '<footer class="foot">고정 지출·수입은 등록한 날짜를 기준으로 매달 자동 반영돼요. 예산 초과 여부는 참고용이며, 실제 은행 잔액과는 다를 수 있어요.</footer>';
  }

  function render(){
    document.getElementById("app").innerHTML = renderApp();
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
  function stashUi(){ try { sessionStorage.setItem("ledger-ui", JSON.stringify({ month: ui.month, tab: ui.tab, view: ui.view, selectedDay: ui.selectedDay })); } catch(e) {} }
  function saveLocal(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {} }

  function persistMutation(){
    stashUi();
    saveLocal();
    render();
  }

  /* ---------------- mutations ---------------- */
  function addTransaction(data){
    state.transactions.push({ id: uid(), date: data.date, type: data.type, categoryId: data.category, amount: data.amount, memo: data.memo || "" });
    persistMutation();
  }
  function deleteTransaction(id){
    state.transactions = state.transactions.filter(function(t){ return t.id !== id; });
    persistMutation();
  }
  function addRecurring(data){
    state.recurring.push({ id: uid(), name: data.name, type: data.type, categoryId: data.category, amount: data.amount, day: data.day, active: true, startMonth: ui.month });
    persistMutation();
  }
  function toggleRecurring(id){
    var r = state.recurring.find(function(r){ return r.id === id; });
    if (r) { r.active = !r.active; persistMutation(); }
  }
  function deleteRecurring(id){
    state.recurring = state.recurring.filter(function(r){ return r.id !== id; });
    persistMutation();
  }
  function saveBudget(data){
    state.budgets.total = data.total;
    state.budgets.byCategory = data.byCategory;
    persistMutation();
  }

  /* ---------------- events ---------------- */
  function onClick(e){
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    if (action === "nav-prev") { ui.month = addMonths(ui.month, -1); ui.selectedDay = shiftSelectedDayToMonth(ui.selectedDay, ui.month); stashUi(); render(); }
    else if (action === "nav-next") { ui.month = addMonths(ui.month, 1); ui.selectedDay = shiftSelectedDayToMonth(ui.selectedDay, ui.month); stashUi(); render(); }
    else if (action === "nav-today") { ui.month = todayMonthKey(); ui.selectedDay = todayStr(); stashUi(); render(); }
    else if (action === "set-tab") { ui.tab = t.getAttribute("data-tab"); stashUi(); render(); }
    else if (action === "set-view") { ui.view = t.getAttribute("data-view"); stashUi(); render(); }
    else if (action === "select-day") { ui.selectedDay = t.getAttribute("data-date"); stashUi(); render(); }
    else if (action === "txn-type") { ui.txnType = t.getAttribute("data-type"); render(); }
    else if (action === "rec-type") { ui.txnType = t.getAttribute("data-type"); render(); }
    else if (action === "delete-txn") { deleteTransaction(t.getAttribute("data-id")); }
    else if (action === "delete-rec") { deleteRecurring(t.getAttribute("data-id")); }
  }

  function onChange(e){
    if (e.target.matches('[data-action="toggle-rec"]')) {
      toggleRecurring(e.target.getAttribute("data-id"));
    }
  }

  function onInput(e){
    if (e.target.matches('.amount-row input[type="text"]') || e.target.matches(".budget-cat-input")) {
      var el = e.target;
      var caretFromEnd = el.value.length - el.selectionStart;
      var digits = el.value.replace(/[^0-9]/g, "");
      var n = digits ? parseInt(digits, 10) : 0;
      el.value = n ? n.toLocaleString("ko-KR") : "";
      var pos = Math.max(0, el.value.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch(e2) {}
    }
  }

  function onSubmit(e){
    var form = e.target.closest("[data-action-form]");
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute("data-action-form");
    if (kind === "add-txn") {
      var amount = parseAmount(document.getElementById("txnAmount").value);
      if (amount <= 0) { showToast("금액을 입력해주세요."); return; }
      addTransaction({
        date: document.getElementById("txnDate").value || todayStr(),
        type: ui.txnType,
        category: document.getElementById("txnCat").value,
        amount: amount,
        memo: document.getElementById("txnMemo").value.trim()
      });
    } else if (kind === "add-rec") {
      var ramount = parseAmount(document.getElementById("recAmount").value);
      var name = document.getElementById("recName").value.trim();
      var day = Math.min(31, Math.max(1, parseInt(document.getElementById("recDay").value, 10) || 1));
      if (!name || ramount <= 0) { showToast("이름과 금액을 확인해주세요."); return; }
      addRecurring({ name: name, type: ui.txnType, category: document.getElementById("recCat").value, amount: ramount, day: day });
    } else if (kind === "save-budget") {
      var total = parseAmount(document.getElementById("budgetTotal").value);
      var byCategory = {};
      document.querySelectorAll(".budget-cat-input").forEach(function(inp){
        var v = parseAmount(inp.value);
        if (v > 0) byCategory[inp.getAttribute("data-cat")] = v;
      });
      saveBudget({ total: total > 0 ? total : null, byCategory: byCategory });
      showToast("예산을 저장했어요.");
    }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  document.addEventListener("submit", onSubmit);

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").catch(function(){});
    });
  }
})();
