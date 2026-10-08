import { firebaseConfig, OWNER_EMAIL } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/12.4.0";
const $ = (id) => document.getElementById(id);

let fs = null;          // firestore module
let db = null, auth = null, authMod = null;
let me = null;          // { email, name, photo }
let role = null;        // "admin" | "member"
let items = [], logs = [], members = [];
let unsubs = [];
let editingId = null, moveId = null, moveKind = "in";
let busy = false;

// 장부: 부속(parts)과 상품(goods)은 품목·분류·기록을 따로 관리합니다. book 이 없는 예전 품목은 부속입니다.
const BOOKS = { parts: "부속", goods: "상품" };
let book = "goods", logBook = "goods"; // 첫 탭(상품)이 기본
const bookOf = (x) => (x && x.book) || "parts";
const curItems = () => items.filter((i) => bookOf(i) === book);

// 기록은 부속·상품 각각 최근 30건만 보여 주고, 버튼으로 30건씩 더 봅니다(읽기 사용량을 아끼려고).
// 두 장부의 기록이 한 컬렉션에 섞여 있어서, 보고 있는 장부가 30건을 채울 때까지 서버에서 조금씩 더 읽어 옵니다.
const LOG_PAGE = 30;
let logLimit = LOG_PAGE, logUnsub = null, logsMore = false;
const logWant = { parts: LOG_PAGE, goods: LOG_PAGE };
let todayLogs = [], todayUnsub = null;

// 선택 삭제 모드 (관리자)
let selectMode = false;
const selected = new Set();

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const fmtN = (n) => Number(n || 0).toLocaleString("ko-KR");
const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
const millis = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : 0);
function fmtWhen(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return "오늘 " + hm;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function status(it) {
  const q = Number(it.qty) || 0, m = Number(it.minQty) || 0;
  if (q <= 0) return "out";
  if (m > 0 && q <= m) return "low";
  return "ok";
}
const STATUS_LABEL = { ok: "충분", low: "부족", out: "없음" };
const isAdmin = () => role === "admin";

let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}
function errMsg(e) {
  const c = e && e.code;
  if (c === "negative") return `재고가 부족합니다. 현재 ${fmtN(e.cur)} 남아 있습니다.`;
  if (c === "gone") return "이 품목은 이미 삭제되었습니다.";
  if (c === "permission-denied") return "권한이 없습니다. 관리자에게 문의하세요.";
  if (c === "unavailable" || c === "failed-precondition") return "인터넷에 연결되어 있지 않습니다. 연결을 확인하고 다시 시도하세요.";
  if (c === "aborted") return "다른 사람이 동시에 수정했습니다. 다시 시도하세요.";
  if (c === "resource-exhausted") return "오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하세요.";
  console.error(e);
  return "저장하지 못했습니다. 다시 시도하세요.";
}

function show(screen) {
  for (const id of ["scrSetup", "scrLoading", "scrSignin", "scrDenied", "scrMain"]) $(id).hidden = id !== screen;
}

// ---------- render ----------
function renderStats() {
  const list = curItems();
  $("sBook").textContent = BOOKS[book];
  $("sItems").textContent = fmtN(list.length);
  $("sLow").textContent = fmtN(list.filter((i) => status(i) === "low").length);
  $("sOut").textContent = fmtN(list.filter((i) => status(i) === "out").length);
  const today = new Date().toDateString();
  $("sToday").textContent = fmtN(todayLogs.filter((l) => bookOf(l) === book && (l.type === "in" || l.type === "out") && new Date(l.at).toDateString() === today).length);
}

// 분류 필터: 칩으로 고르고, 부족만 보기도 칩 하나로 둡니다
let catFilter = "", lowOnly = false;
function renderCats() {
  const cats = [...new Set(curItems().map((i) => (i.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  if (catFilter && !cats.includes(catFilter)) catFilter = "";
  const chip = (label, active, onclick, extra = "") =>
    el("button", { type: "button", class: "chip" + extra, "aria-pressed": String(active), onclick }, label);
  $("catChips").replaceChildren(
    chip("전체", !catFilter, () => { catFilter = ""; renderCats(); renderItems(); }),
    ...cats.map((c) => chip(c, catFilter === c, () => { catFilter = c; renderCats(); renderItems(); })),
    chip("부족·없음만", lowOnly, () => { lowOnly = !lowOnly; renderCats(); renderItems(); }, " warn"),
  );
  $("catList").replaceChildren(...cats.map((c) => el("option", { value: c })));
}

const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "ko", { numeric: true });
function renderItems() {
  renderStats();
  const q = $("q").value.trim().toLowerCase();
  const all = curItems();
  const list = all
    .filter((i) => !catFilter || (i.category || "") === catFilter)
    .filter((i) => !lowOnly || status(i) !== "ok")
    .filter((i) => !q || [i.name, i.category, i.location, i.note].some((s) => (s || "").toLowerCase().includes(q)))
    .sort(byName); // 이름순(숫자 순서). 없음·부족은 색과 [부족·없음만] 칩으로 찾습니다

  const qtyEl = (it) => el("span", { class: "qty " + status(it) }, fmtN(it.qty), el("small", {}, it.unit || ""));
  const minus = (it) => el("button", { class: "step out", title: "1개 출고", "aria-label": `${it.name} 1개 출고`, disabled: (Number(it.qty) || 0) <= 0, onclick: () => quick(it.id, -1) }, "−");
  const plus = (it) => el("button", { class: "step in", title: "1개 입고", "aria-label": `${it.name} 1개 입고`, onclick: () => quick(it.id, 1) }, "+");
  const who = (it) => it.updatedAt ? `${it.updatedByName || it.updatedBy} · ${fmtWhen(it.updatedAt)}` : "";

  const selBox = (it) => {
    const c = el("input", { type: "checkbox", class: "sel", "aria-label": `${it.name} 선택` });
    c.checked = selected.has(it.id);
    c.addEventListener("change", () => { c.checked ? selected.add(it.id) : selected.delete(it.id); renderSelBar(list); });
    return c;
  };
  const delBtn = (it) => isAdmin() ? el("button", { class: "link del", onclick: () => confirmDelete([it]) }, "삭제") : null;

  // 넓은 화면: 표
  document.querySelector("th.selcol").hidden = !selectMode;
  $("rows").replaceChildren(...list.map((it) => el("tr", {},
    selectMode ? el("td", { class: "selcol" }, selBox(it)) : null,
    el("td", {}, el("div", { class: "iname" }, it.name || "(이름 없음)", it.note ? el("small", {}, it.note) : null)),
    el("td", {}, el("button", { class: "catbtn", title: "분류 바꾸기", onclick: () => openItem(it.id, "iCat") }, it.category || "분류 없음")),
    el("td", { class: "r" }, qtyEl(it)),
    el("td", { class: "meta" }, who(it)),
    el("td", {}, el("div", { class: "acts" },
      minus(it), plus(it),
      el("button", { class: "link", onclick: () => openMove(it.id) }, "입출고"),
      el("button", { class: "link", onclick: () => openItem(it.id) }, "수정"),
      delBtn(it),
    )),
  )));

  // 휴대폰: 한 줄 카드 — 이름을 누르면 입출고, 분류를 누르면 수정
  $("mrows").replaceChildren(...list.map((it) => el("li", { class: "mrow " + status(it) },
    selectMode ? selBox(it) : null,
    el("div", { class: "minfo" },
      el("button", { class: "mname", onclick: () => openMove(it.id) }, it.name || "(이름 없음)"),
      el("div", { class: "mmeta" },
        el("button", { class: "catbtn", title: "품목 수정", onclick: () => openItem(it.id, "iCat") }, it.category || "분류 없음"),
        who(it) ? el("span", {}, who(it)) : null,
        el("span", { class: "mact" },
          el("button", { class: "link", onclick: () => openItem(it.id) }, "수정"),
          delBtn(it)))),
    el("div", { class: "mstep" }, minus(it), qtyEl(it), plus(it)),
  )));
  renderSelBar(list);

  const empty = $("empty");
  if (!all.length) {
    empty.replaceChildren(
      el("strong", {}, `첫 ${BOOKS[book]} 품목을 등록해 보세요`),
      el("span", {}, "분류와 최소 수량을 정해 두면 부족한 품목이 위로 올라옵니다. 등록된 팀원 모두가 같은 목록을 실시간으로 봅니다."),
      el("button", { class: "btn primary", onclick: () => openItem(null) }, `+ ${BOOKS[book]} 추가`),
    );
  } else if (!list.length) {
    empty.replaceChildren(el("strong", {}, "조건에 맞는 품목이 없습니다"), el("span", {}, "검색어나 분류 필터를 바꿔 보세요."));
  }
  empty.hidden = list.length > 0;
  $("listWrap").hidden = !list.length;
}

const TYPE_LABEL = { in: "입고", out: "출고", adjust: "실사 조정", create: "등록", edit: "정보 수정", delete: "삭제" };
// 기록 검색: 품목명·사람·이메일·메모·종류(입고/출고 등)·날짜를 띄어쓰기로 나눈 단어가 모두 들어간 기록만 보여 줍니다
const logText = (l) => [l.itemName, l.byName, l.by, l.note, TYPE_LABEL[l.type], fmtWhen(l.at)].join(" ").toLowerCase();
function renderLog() {
  document.querySelectorAll("#logBooks .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.book === logBook)));
  const words = $("logQ").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const bookAll = logs.filter((l) => bookOf(l) === logBook);
  const inBook = bookAll.slice(0, logWant[logBook]);
  const hasMore = bookAll.length > inBook.length || logsMore;
  const list = words.length ? inBook.filter((l) => { const t = logText(l); return words.every((w) => t.includes(w)); }) : inBook;
  $("log").replaceChildren(...list.map((l) => {
    let delta = "", cls = "neu";
    if (l.type === "in") { delta = "+" + fmtN(l.delta); cls = "in"; }
    else if (l.type === "out") { delta = "−" + fmtN(Math.abs(l.delta)); cls = "out"; }
    else if (l.type === "adjust") { delta = (l.delta >= 0 ? "+" : "−") + fmtN(Math.abs(l.delta)); }
    else if (l.type === "create") { delta = "+" + fmtN(l.qtyAfter); cls = "in"; }
    const after = l.type === "delete" ? "" : ` → ${fmtN(l.qtyAfter)}${l.unit ? " " + l.unit : ""}`;
    const whoText = l.byName ? `${l.byName} (${l.by})` : l.by;
    return el("li", {},
      el("span", { class: "d" }, fmtWhen(l.at)),
      el("span", { class: "t" },
        el("b", {}, l.itemName || "품목"), " ",
        el("span", { class: "meta" }, `${TYPE_LABEL[l.type] || l.type}${after} · ${whoText}${l.note ? " · " + l.note : ""}`)),
      el("span", { class: "delta " + cls }, delta),
    );
  }));
  $("logEmpty").hidden = list.length > 0;
  $("logEmpty").replaceChildren(...(words.length
    ? [el("strong", {}, "검색 결과가 없습니다"), el("span", {}, hasMore ? "아래 [이전 기록 30건 더 보기]로 더 오래된 기록까지 찾아보세요." : "다른 단어로 찾아보세요.")]
    : [el("strong", {}, "아직 기록이 없습니다"), el("span", {}, "품목을 추가하거나 입고·출고하면 누가 언제 바꿨는지 여기에 남습니다.")]));
  const oldest = inBook.length ? fmtWhen(inBook[inBook.length - 1].at) : "";
  $("logInfo").textContent = !inBook.length ? "" : words.length
    ? `${fmtN(list.length)}건 찾음 · 최근 ${fmtN(inBook.length)}건(${oldest}부터) 안에서 검색`
    : `최근 ${fmtN(inBook.length)}건 (${oldest}부터)`;
  $("btnLogMore").hidden = !hasMore;
  renderStats();
}

let confirmRemove = null;
function renderMembers() {
  $("fMember").hidden = !isAdmin();
  const owner = OWNER_EMAIL.toLowerCase();
  const list = [...members].sort((a, b) =>
    (b.id === owner) - (a.id === owner) || (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) || a.id.localeCompare(b.id));
  $("members").replaceChildren(...list.map((m) => {
    const isSelf = m.id === me.email, isOwnerRow = m.id === owner;
    const roleLabel = isOwnerRow ? "소유자" : m.role === "admin" ? "관리자" : "팀원";
    let act = el("span", { class: "role" }, roleLabel);
    if (isAdmin() && !isSelf && !isOwnerRow) {
      if (confirmRemove === m.id) {
        act = el("span", { class: "mact" },
          el("span", { class: "meta" }, "제거할까요?"),
          el("button", { class: "btn", onclick: () => { confirmRemove = null; renderMembers(); } }, "취소"),
          el("button", { class: "btn danger solid", onclick: () => removeMember(m.id) }, "제거"));
      } else {
        const sel = el("select", { "aria-label": `${m.id} 권한`, onchange: (e) => setMemberRole(m.id, e.target.value) },
          el("option", { value: "member" }, "팀원"), el("option", { value: "admin" }, "관리자"));
        sel.value = m.role;
        act = el("span", { class: "mact" }, sel,
          el("button", { class: "btn danger", onclick: () => { confirmRemove = m.id; renderMembers(); } }, "제거"));
      }
    }
    return el("li", {},
      el("div", { class: "mwho" }, el("b", {}, (m.name || "아직 로그인 전") + (isSelf ? " (나)" : "")), el("span", {}, m.id)),
      act);
  }));
}

// ---------- writes ----------
// 품목 변경과 기록을 한 트랜잭션으로 묶습니다. 보안 규칙이 둘이 함께 있는지 검사합니다.
async function changeQty(itemId, kind, amount, note) {
  const itemRef = fs.doc(db, "items", itemId);
  const logRef = fs.doc(fs.collection(db, "logs"));
  return fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw { code: "gone" };
    const d = snap.data();
    const cur = Number(d.qty) || 0;
    let next;
    if (kind === "in") next = cur + amount;
    else if (kind === "out") { next = cur - amount; if (next < 0) throw { code: "negative", cur }; }
    else next = amount;
    tx.update(itemRef, { qty: next, updatedBy: me.email, updatedByName: me.name, updatedAt: fs.serverTimestamp(), lastLogId: logRef.id });
    tx.set(logRef, {
      itemId, itemName: d.name, unit: d.unit || "", type: kind, delta: next - cur, qtyAfter: next,
      note: note || "", by: me.email, byName: me.name, at: fs.serverTimestamp(), book: bookOf(d),
    });
    return { next, name: d.name, unit: d.unit || "" };
  });
}

async function quick(itemId, delta) {
  if (busy) return;
  busy = true;
  try {
    const r = await changeQty(itemId, delta > 0 ? "in" : "out", Math.abs(delta), "");
    toast(`${r.name} ${delta > 0 ? "입고" : "출고"}, 현재 ${fmtN(r.next)}${r.unit ? " " + r.unit : ""}`);
  } catch (e) { toast(errMsg(e)); }
  finally { busy = false; }
}

async function createItem(fields, qty, bk = book) {
  const itemRef = fs.doc(fs.collection(db, "items"));
  const logRef = fs.doc(fs.collection(db, "logs"));
  const b = fs.writeBatch(db);
  b.set(itemRef, {
    ...fields, qty, book: bk, createdBy: me.email, createdAt: fs.serverTimestamp(),
    updatedBy: me.email, updatedByName: me.name, updatedAt: fs.serverTimestamp(), lastLogId: logRef.id,
  });
  b.set(logRef, {
    itemId: itemRef.id, itemName: fields.name, unit: fields.unit, type: "create", delta: qty, qtyAfter: qty,
    note: "", by: me.email, byName: me.name, at: fs.serverTimestamp(), book: bk,
  });
  await b.commit();
}

async function editItem(itemId, fields, newQty = null) {
  const itemRef = fs.doc(db, "items", itemId);
  const logRef = fs.doc(fs.collection(db, "logs"));
  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw { code: "gone" };
    const cur = Number(snap.data().qty) || 0, bk = bookOf(snap.data());
    // 수량도 바꿨으면 실사 조정 기록으로 남깁니다
    const next = newQty === null ? cur : newQty;
    const qtyChanged = next !== cur;
    tx.update(itemRef, { ...fields, qty: next, updatedBy: me.email, updatedByName: me.name, updatedAt: fs.serverTimestamp(), lastLogId: logRef.id });
    tx.set(logRef, {
      itemId, itemName: fields.name, unit: fields.unit, type: qtyChanged ? "adjust" : "edit", delta: next - cur, qtyAfter: next,
      note: qtyChanged ? "수정 창에서 수량 변경" : "", by: me.email, byName: me.name, at: fs.serverTimestamp(), book: bk,
    });
  });
}

async function deleteItem(itemId) {
  const itemRef = fs.doc(db, "items", itemId);
  const logRef = fs.doc(fs.collection(db, "logs"));
  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw { code: "gone" };
    const d = snap.data();
    tx.delete(itemRef);
    tx.set(logRef, {
      itemId, itemName: d.name, unit: d.unit || "", type: "delete", delta: 0, qtyAfter: Number(d.qty) || 0,
      note: "", by: me.email, byName: me.name, at: fs.serverTimestamp(), book: bookOf(d),
    });
  });
}

async function setMemberRole(email, newRole) {
  try {
    const m = members.find((x) => x.id === email);
    await fs.setDoc(fs.doc(db, "members", email), {
      role: newRole, ...(m && m.name ? { name: m.name } : {}), addedBy: me.email, addedAt: fs.serverTimestamp(),
    });
    toast("권한을 바꿨습니다");
  } catch (e) { toast(errMsg(e)); renderMembers(); }
}
async function removeMember(email) {
  confirmRemove = null;
  try { await fs.deleteDoc(fs.doc(db, "members", email)); toast(`${email} 제거했습니다`); }
  catch (e) { toast(errMsg(e)); renderMembers(); }
}

// ---------- item dialog ----------
function openItem(id, focusId) {
  editingId = id;
  const it = id ? items.find((i) => i.id === id) : null;
  $("dItemTitle").textContent = it ? `${BOOKS[bookOf(it)]} 정보 수정` : `${BOOKS[book]} 추가`;
  $("iName").value = it?.name || "";
  $("iCat").value = it?.category || catFilter;
  $("iLoc").value = it?.location || "";
  $("iUnit").value = it?.unit || "";
  $("iMin").value = it ? (it.minQty || 0) : 0;
  $("iNote").value = it?.note || "";
  $("iQty").value = it ? (Number(it.qty) || 0) : 0;
  $("iQtyLabel").textContent = it ? "현재 수량" : "시작 수량";
  $("btnDel").hidden = !it || !isAdmin();
  $("delConfirm").hidden = true;
  $("iErr").textContent = "";
  $("dItem").showModal();
  const f = $(focusId || "iName"); f.focus(); if (focusId) f.select();
}

$("fItem").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = $("iName").value.trim();
  if (!name) { $("iErr").textContent = "품목명을 입력하세요."; return; }
  const fields = {
    name, category: $("iCat").value.trim(), location: $("iLoc").value.trim().toUpperCase(),
    unit: $("iUnit").value.trim(), minQty: toInt($("iMin").value), note: $("iNote").value.trim(),
  };
  $("iSave").disabled = true;
  try {
    if (editingId) { await editItem(editingId, fields, toInt($("iQty").value)); toast("수정했습니다"); }
    else { await createItem(fields, toInt($("iQty").value)); toast(`${name} 등록했습니다`); }
    $("dItem").close();
  } catch (e) { $("iErr").textContent = errMsg(e); }
  finally { $("iSave").disabled = false; }
});
$("btnDel").addEventListener("click", () => {
  const it = items.find((i) => i.id === editingId);
  if (it) { $("dItem").close(); confirmDelete([it]); }
});
$("delNo").addEventListener("click", () => { $("delConfirm").hidden = true; });
$("delYes").addEventListener("click", async () => {
  const it = items.find((i) => i.id === editingId);
  if (!it) { $("dItem").close(); return; }
  try { await deleteItem(it.id); $("dItem").close(); toast(`${it.name} 삭제했습니다`); }
  catch (e) { $("iErr").textContent = errMsg(e); }
});

// ---------- move dialog ----------
function setKind(k) {
  moveKind = k;
  document.querySelectorAll("#fMove .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
  $("mAmtLabel").textContent = k === "adjust" ? "실제로 센 수량" : k === "in" ? "입고 수량" : "출고 수량";
  $("mSave").textContent = k === "in" ? "입고 기록" : k === "out" ? "출고 기록" : "조정 기록";
  updatePreview();
}
function updatePreview() {
  const it = items.find((i) => i.id === moveId);
  if (!it) return;
  const cur = Number(it.qty) || 0, a = toInt($("mAmt").value);
  const next = moveKind === "in" ? cur + a : moveKind === "out" ? cur - a : a;
  $("mPreview").textContent = `현재 ${fmtN(cur)} → ${fmtN(next)} ${it.unit || ""}`;
  $("mErr").textContent = next < 0 ? `재고가 부족합니다. 최대 ${fmtN(cur)}까지 출고할 수 있습니다.` : "";
  $("mSave").disabled = next < 0;
}
function openMove(id) {
  moveId = id;
  const it = items.find((i) => i.id === id);
  $("mTitle").textContent = it ? it.name : "입출고";
  $("mAmt").value = 1; $("mNote").value = "";
  setKind("in");
  $("dMove").showModal();
  $("mAmt").select();
}
document.querySelectorAll("#fMove .seg button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.kind === "adjust") { const it = items.find((i) => i.id === moveId); $("mAmt").value = it ? it.qty || 0 : 0; }
  setKind(b.dataset.kind);
}));
$("mAmt").addEventListener("input", updatePreview);
$("fMove").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const a = toInt($("mAmt").value);
  if (moveKind !== "adjust" && a === 0) { $("mErr").textContent = "1 이상 입력하세요."; return; }
  const it = items.find((i) => i.id === moveId);
  if (moveKind === "adjust" && it && a === (Number(it.qty) || 0)) { $("mErr").textContent = "현재 수량과 같습니다."; return; }
  $("mSave").disabled = true;
  try {
    const r = await changeQty(moveId, moveKind, a, $("mNote").value.trim());
    $("dMove").close();
    toast(`${r.name}, 현재 ${fmtN(r.next)}${r.unit ? " " + r.unit : ""}`);
  } catch (e) { $("mErr").textContent = errMsg(e); }
  finally { $("mSave").disabled = false; }
});
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------- delete (single & bulk) ----------
let confirmAction = null;
function confirmDelete(list) {
  const names = list.map((i) => i.name);
  $("cfTitle").textContent = list.length === 1 ? `"${names[0]}" 삭제할까요?` : `${list.length}개 품목을 삭제할까요?`;
  $("cfMsg").textContent = (list.length > 1 ? names.slice(0, 8).join(", ") + (names.length > 8 ? ` 외 ${names.length - 8}개` : "") + ". " : "")
    + "삭제해도 입출고 기록은 남습니다.";
  $("cfErr").textContent = "";
  $("cfOk").disabled = false;
  $("cfOk").textContent = list.length === 1 ? "삭제" : `${list.length}개 삭제`;
  confirmAction = async () => {
    let done = 0;
    try {
      for (const it of list) {
        if (list.length > 1) $("cfOk").textContent = `삭제 중 ${done + 1}/${list.length}`;
        await deleteItem(it.id);
        selected.delete(it.id);
        done++;
      }
      $("dConfirm").close();
      toast(list.length === 1 ? `${names[0]} 삭제했습니다` : `${done}개 품목을 삭제했습니다`);
      if (selectMode && !selected.size) setSelectMode(false);
    } catch (e) {
      $("cfErr").textContent = (list.length > 1 ? `${done}개 삭제 후 멈췄습니다. ` : "") + errMsg(e);
      $("cfOk").textContent = "다시 시도";
      list = list.slice(done);
    }
  };
  $("dConfirm").showModal();
}
$("fConfirm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!confirmAction) return;
  $("cfOk").disabled = true;
  try { await confirmAction(); } finally { $("cfOk").disabled = false; }
});

function setSelectMode(on) {
  selectMode = on;
  selected.clear();
  $("btnSelect").textContent = on ? "선택 끝내기" : "선택 삭제";
  renderItems();
}
let shownList = [];
function renderSelBar(list) {
  shownList = list;
  $("selBar").hidden = !selectMode;
  if (!selectMode) return;
  const visible = list.filter((i) => selected.has(i.id)).length;
  $("selCount").textContent = `${selected.size}개 선택`;
  $("selDelete").disabled = !selected.size;
  $("selDelete").textContent = selected.size ? `${selected.size}개 삭제` : "삭제";
  $("selAll").checked = list.length > 0 && visible === list.length;
}
$("btnSelect").addEventListener("click", () => setSelectMode(!selectMode));
$("selCancel").addEventListener("click", () => setSelectMode(false));
// 전체 선택은 지금 화면에 보이는(검색·분류로 걸러진) 품목만 대상으로 합니다
$("selAll").addEventListener("change", (e) => {
  shownList.forEach((i) => (e.target.checked ? selected.add(i.id) : selected.delete(i.id)));
  renderItems();
});
$("selDelete").addEventListener("click", () => {
  const list = items.filter((i) => selected.has(i.id));
  if (list.length) confirmDelete(list);
});

// ---------- category management ----------
function renderCatRows() {
  const counts = new Map();
  curItems().forEach((i) => { const c = (i.category || "").trim(); counts.set(c, (counts.get(c) || 0) + 1); });
  const cats = [...counts.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "ko"));
  $("catRows").replaceChildren(...cats.map((c, idx) => {
    const input = el("input", { type: "text", id: "cat-" + idx, maxlength: "40", value: c, placeholder: "분류 없음", "aria-label": `${c || "분류 없음"} 새 이름` });
    const btn = el("button", { type: "button", class: "btn", disabled: true }, "변경");
    input.addEventListener("input", () => { btn.disabled = input.value.trim() === c; });
    btn.addEventListener("click", () => renameCategory(c, input.value.trim()));
    return el("li", {}, input, el("span", { class: "cnt" }, `${fmtN(counts.get(c))}개 품목`), btn);
  }));
  if (!cats.length) $("catRows").replaceChildren(el("li", { class: "meta" }, "아직 품목이 없습니다."));
}
// 품목마다 정보 수정 기록이 로그인 계정으로 남습니다
async function renameCategory(from, to) {
  if (busy) return;
  const targets = curItems().filter((i) => (i.category || "").trim() === from);
  if (!targets.length || from === to) return;
  busy = true;
  $("cErr").textContent = "";
  $("catRows").querySelectorAll("input, button").forEach((x) => (x.disabled = true));
  let done = 0;
  try {
    for (const it of targets) {
      await editItem(it.id, {
        name: it.name, category: to, location: it.location || "", unit: it.unit || "",
        minQty: toInt(it.minQty), note: it.note || "",
      });
      done++;
    }
    toast(`${done}개 품목의 분류를 "${to || "분류 없음"}"(으)로 바꿨습니다`);
  } catch (e) {
    $("cErr").textContent = `${done}개 바꾼 뒤 멈췄습니다. ${errMsg(e)}`;
  } finally {
    busy = false;
    if (catFilter === from) catFilter = to;
    setTimeout(renderCatRows, 300);
  }
}
$("btnCats").addEventListener("click", () => { $("cErr").textContent = ""; $("cTitle").textContent = `${BOOKS[book]} 분류 관리`; renderCatRows(); $("dCats").showModal(); });

// ---------- bulk import ----------
let impRows = [];
function parseImport(text) {
  const existing = new Set(curItems().map((i) => (i.name || "").trim().toLowerCase()));
  const seen = new Set();
  const rows = [];
  const isInt = (s) => /^\d+$/.test(s);
  text.split(/\r?\n/).filter((l) => l.trim()).forEach((line, idx) => {
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((s) => s.trim());
    const [name = "", category = "", qtyRaw = "", unit = "", location = "", minRaw = ""] = cells;
    const qtyS = qtyRaw.replace(/,/g, ""), minS = minRaw.replace(/,/g, "");
    if (idx === 0 && !isInt(qtyS)) return; // header row
    const r = { name, category, unit, location: location.toUpperCase(), qty: Number(qtyS), minQty: minS ? Number(minS) : 0 };
    const key = name.toLowerCase();
    if (!name) r.error = "품목명이 비어 있음";
    else if (!isInt(qtyS)) r.error = "수량이 숫자가 아님";
    else if (minS && !isInt(minS)) r.error = "최소 수량이 숫자가 아님";
    else if (name.length > 80 || category.length > 40 || unit.length > 10 || location.length > 30) r.error = "글자 수가 너무 김";
    else if (existing.has(key)) r.skip = "이미 있음";
    else if (seen.has(key)) r.skip = "중복된 줄";
    seen.add(key);
    rows.push(r);
  });
  return rows;
}
function renderImport() {
  impRows = parseImport($("impText").value);
  const ok = impRows.filter((r) => !r.error && !r.skip);
  const bad = impRows.filter((r) => r.error).length, skip = impRows.filter((r) => r.skip).length;
  $("impPreview").replaceChildren(...(impRows.length ? [el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "품목명"), el("th", {}, "분류"), el("th", { class: "r" }, "수량"), el("th", {}, "단위"), el("th", {}, "확인"))),
    el("tbody", {}, impRows.map((r) => el("tr", { class: r.error ? "bad" : r.skip ? "skip" : "" },
      el("td", {}, r.name), el("td", {}, r.category), el("td", { class: "r num" }, Number.isFinite(r.qty) ? fmtN(r.qty) : ""), el("td", {}, r.unit),
      el("td", {}, r.error || r.skip || "등록"))))
  )] : []));
  $("impErr").textContent = bad ? `빨간 줄 ${bad}개는 고쳐야 등록됩니다.` : "";
  $("impSave").disabled = !ok.length || bad > 0;
  $("impSave").textContent = ok.length ? `${ok.length}개 등록${skip ? ` (${skip}개 건너뜀)` : ""}` : "등록";
}
$("btnImport").addEventListener("click", () => {
  $("impTitle").textContent = `${BOOKS[book]} 일괄 등록`;
  $("impText").value = ""; renderImport();
  $("dImport").showModal(); $("impText").focus();
});
$("impText").addEventListener("input", renderImport);
$("fImport").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const todo = impRows.filter((r) => !r.error && !r.skip), bk = book;
  $("impSave").disabled = true; $("impText").disabled = true;
  let done = 0;
  try {
    // 품목마다 등록 기록과 함께 한 번씩 저장합니다 (보안 규칙이 품목+기록 짝을 확인)
    for (const r of todo) {
      $("impSave").textContent = `등록 중 ${done + 1}/${todo.length}`;
      await createItem({ name: r.name, category: r.category, location: r.location, unit: r.unit, minQty: r.minQty, note: "" }, r.qty, bk);
      done++;
    }
    $("dImport").close();
    toast(`${BOOKS[bk]} ${done}개 품목을 등록했습니다`);
  } catch (e) {
    $("impErr").textContent = `${done}개 등록 후 멈췄습니다. ${errMsg(e)}`;
    renderImport();
  } finally { $("impText").disabled = false; }
});

// ---------- members form ----------
$("fMember").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("mEmail").value.trim().toLowerCase();
  $("memberErr").textContent = "";
  if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email)) { $("memberErr").textContent = "올바른 이메일을 입력하세요."; return; }
  if (members.some((m) => m.id === email)) { $("memberErr").textContent = "이미 등록된 이메일입니다."; return; }
  try {
    await fs.setDoc(fs.doc(db, "members", email), { role: $("mRole").value, addedBy: me.email, addedAt: fs.serverTimestamp() });
    $("mEmail").value = "";
    toast(`${email} 추가했습니다. 이 이메일로 로그인하면 바로 쓸 수 있습니다.`);
  } catch (e) { $("memberErr").textContent = errMsg(e); }
});

// ---------- toolbar / tabs ----------
$("q").addEventListener("input", renderItems);
$("btnAdd").addEventListener("click", () => openItem(null));
function showTab(which, bk) {
  if (which === "items" && BOOKS[bk] && bk !== book) {
    book = bk; logBook = bk; catFilter = ""; lowOnly = false; $("q").value = "";
    selectMode = false; selected.clear(); $("btnSelect").textContent = "선택 삭제";
    renderCats(); renderItems(); renderLog(); ensureLogs();
  }
  $("btnAdd").textContent = `+ ${BOOKS[book]} 추가`;
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === which && (which !== "items" || b.dataset.book === book))));
  $("viewItems").hidden = which !== "items";
  $("viewLog").hidden = which !== "log";
  $("viewMembers").hidden = which !== "members";
  try { localStorage.setItem("stock.tab", which); localStorage.setItem("stock.book", book); } catch (e) {}
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab, b.dataset.book)));
document.querySelectorAll("#logBooks .chip").forEach((c) => c.addEventListener("click", () => { logBook = c.dataset.book; renderLog(); ensureLogs(); }));
try {
  const t = localStorage.getItem("stock.tab"), b = localStorage.getItem("stock.book");
  showTab(t || "items", b && BOOKS[b] ? b : "goods");
} catch (e) {}

$("btnCsv").addEventListener("click", () => {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ["품목", "분류", "위치", "수량", "단위", "최소 수량", "상태", "메모", "최근 변경자", "최근 변경 시각"];
  const rows = curItems().map((i) => [i.name, i.category, i.location, i.qty, i.unit, i.minQty, STATUS_LABEL[status(i)], i.note,
    i.updatedBy, i.updatedAt ? new Date(i.updatedAt).toLocaleString("ko-KR") : ""]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `${BOOKS[book]}_${stamp}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- auth & data ----------
// 품목 변경이 연달아 들어와도(일괄 등록 등) 화면은 한 프레임에 한 번만 다시 그립니다
let itemsRenderQueued = false;
function scheduleItemsRender() {
  if (itemsRenderQueued) return;
  itemsRenderQueued = true;
  requestAnimationFrame(() => { itemsRenderQueued = false; renderCats(); renderItems(); });
}

function stopData() {
  unsubs.forEach((u) => u()); unsubs = []; items = []; logs = []; members = [];
  if (logUnsub) { logUnsub(); logUnsub = null; }
  if (todayUnsub) { todayUnsub(); todayUnsub = null; }
  logLimit = LOG_PAGE; logsMore = false; logWant.parts = logWant.goods = LOG_PAGE; todayLogs = [];
}

function subscribeLogs() {
  if (logUnsub) logUnsub();
  const opts = { serverTimestamps: "estimate" };
  const asked = logLimit;
  logUnsub = fs.onSnapshot(fs.query(fs.collection(db, "logs"), fs.orderBy("at", "desc"), fs.limit(asked)), (snap) => {
    logs = snap.docs.map((d) => { const x = d.data(opts); return { id: d.id, ...x, at: millis(x.at) }; });
    logsMore = snap.size >= asked;
    $("btnLogMore").disabled = false;
    renderLog();
    ensureLogs();
  }, lostAccess);
}
// 보고 있는 장부의 기록이 원하는 만큼 안 모였고 서버에 더 있으면 읽는 양을 두 배로 늘려 다시 읽습니다
function ensureLogs() {
  if (!db || !logUnsub) return;
  const have = logs.filter((l) => bookOf(l) === logBook).length;
  if (have < logWant[logBook] && logsMore && logLimit === logs.length) {
    logLimit *= 2;
    subscribeLogs();
  }
}
// 오늘 입출고 숫자는 따로 오늘 기록만 읽어서 셉니다(최근 30건 제한과 상관없이 정확하도록)
function subscribeToday() {
  if (todayUnsub) todayUnsub();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  todayUnsub = fs.onSnapshot(fs.query(fs.collection(db, "logs"), fs.where("at", ">=", fs.Timestamp.fromDate(start)), fs.orderBy("at", "desc")), (snap) => {
    todayLogs = snap.docs.map((d) => { const x = d.data({ serverTimestamps: "estimate" }); return { book: x.book, type: x.type, at: millis(x.at) }; });
    renderStats();
  }, () => {});
}
$("btnLogMore").addEventListener("click", () => {
  logWant[logBook] += LOG_PAGE;
  $("btnLogMore").disabled = true;
  renderLog();
  ensureLogs();
  $("btnLogMore").disabled = false;
});
$("logQ").addEventListener("input", renderLog);

function lostAccess(e) {
  if (e && e.code === "permission-denied") { stopData(); role = null; $("deniedEmail").textContent = me?.email || ""; show("scrDenied"); }
  else { $("banner").textContent = "데이터를 불러오지 못했습니다. 새로고침해 주세요."; $("banner").hidden = false; }
}

function startData() {
  const opts = { serverTimestamps: "estimate" };
  unsubs.push(fs.onSnapshot(fs.collection(db, "items"), (snap) => {
    items = snap.docs.map((d) => { const x = d.data(opts); return { id: d.id, ...x, updatedAt: millis(x.updatedAt) }; });
    scheduleItemsRender();
  }, lostAccess));
  subscribeLogs();
  subscribeToday();
  unsubs.push(fs.onSnapshot(fs.collection(db, "members"), (snap) => {
    members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const mine = members.find((m) => m.id === me.email);
    const newRole = me.email === OWNER_EMAIL.toLowerCase() ? "admin" : mine ? mine.role : null;
    if (!newRole) { lostAccess({ code: "permission-denied" }); return; }
    if (newRole !== role) { role = newRole; renderHeader(); renderItems(); }
    renderMembers();
  }, lostAccess));
}

function renderHeader() {
  $("who").hidden = !me;
  if (!me) return;
  if (me.photo) $("whoImg").src = me.photo; else $("whoImg").removeAttribute("src");
  $("whoName").textContent = me.name || me.email;
  $("whoRole").textContent = role === "admin" ? "관리자" : role === "member" ? "팀원" : "";
  $("whoRole").hidden = !role;
  $("btnImport").hidden = !isAdmin();
  $("btnSelect").hidden = !isAdmin();
}

async function onUser(u) {
  stopData();
  role = null;
  if (!u) { me = null; renderHeader(); show("scrSignin"); return; }
  me = { email: (u.email || "").toLowerCase(), name: u.displayName || "", photo: u.photoURL || "" };
  renderHeader();
  show("scrLoading");
  const isOwner = me.email === OWNER_EMAIL.toLowerCase();
  const myRef = fs.doc(db, "members", me.email);
  try {
    const snap = await fs.getDoc(myRef);
    if (snap.exists()) {
      role = snap.data().role;
      if (me.name && snap.data().name !== me.name) fs.updateDoc(myRef, { name: me.name }).catch(() => {});
    } else if (isOwner) {
      await fs.setDoc(myRef, { role: "admin", name: me.name, addedBy: me.email, addedAt: fs.serverTimestamp() });
      role = "admin";
    }
    if (isOwner) role = "admin";
  } catch (e) {
    if (e.code !== "permission-denied") { console.error(e); }
  }
  if (!role) { $("deniedEmail").textContent = me.email; show("scrDenied"); return; }
  renderHeader();
  show("scrMain");
  renderItems(); renderLog(); renderMembers();
  startData();
}

async function signIn() {
  $("signErr").textContent = "";
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await authMod.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await authMod.signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      console.error(e);
      $("signErr").textContent = e.code === "auth/unauthorized-domain"
        ? "이 주소는 Firebase 로그인 허용 도메인에 등록되어 있지 않습니다. SETUP.md 의 4단계를 확인하세요."
        : "로그인하지 못했습니다. 다시 시도하세요.";
    }
  }
}
$("btnSignIn").addEventListener("click", signIn);
$("btnSignOut").addEventListener("click", () => authMod.signOut(auth));
$("btnSwitch").addEventListener("click", async () => { await authMod.signOut(auth); signIn(); });

async function boot() {
  if (!firebaseConfig.apiKey) { show("scrSetup"); return; }
  const [appMod, fsMod, aMod] = await Promise.all([
    import(`${FB}/firebase-app.js`), import(`${FB}/firebase-firestore.js`), import(`${FB}/firebase-auth.js`),
  ]);
  fs = fsMod; authMod = aMod;
  const app = appMod.initializeApp(firebaseConfig);
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  auth = authMod.getAuth(app);
  authMod.getRedirectResult(auth).catch(() => {});
  authMod.onAuthStateChanged(auth, onUser);
}

boot().catch((e) => {
  console.error(e);
  show("scrSignin");
  $("signErr").textContent = "앱을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
