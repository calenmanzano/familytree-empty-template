(() => {
  'use strict';

  /* ======================================================== constants */
  const W = 184, H = 72, GX = 28, GY = 96;
  const UNIT = W + GX;
  const ROW = H + GY;
  const UP = 4;    // generations of ancestors shown (parents, grandparents, great- and great-great-grandparents)
  const DOWN = 4;  // generations of descendants shown (children down to great-great-grandchildren)
  // Generations shown below siblings (and the spouse's siblings): nieces/nephews, their children and grandchildren
  const SIB_DOWN = 3;
  // Generations shown below aunts and uncles: cousins, cousins' children, grandchildren and great-grandchildren
  const AUNT_DOWN = 4;
  // Rows 0..n, for checking what's already placed
  const rowsTo = (n, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => from + i);
  const EVENT_TYPES = ['Baptism', 'Christening', 'Bar/Bat Mitzvah', 'Graduation', 'Occupation', 'Military service',
    'Immigration', 'Emigration', 'Residence', 'Retirement', 'Burial', 'Other'];

  const state = { meta: {}, people: new Map(), focusId: null, view: { x: 0, y: 0, k: 1 }, showPartnerFamily: true, showBirthSurname: true };

  // Remember the "Spouse's relatives" switch in this browser
  try { state.showPartnerFamily = localStorage.getItem('showPartnerFamily') !== 'off'; } catch { /* storage unavailable */ }
  // ...and the "Show birth surname" switch
  try { state.showBirthSurname = localStorage.getItem('showBirthSurname') !== 'off'; } catch { /* storage unavailable */ }
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const viewport = $('#viewport');
  const world = $('#world');
  const linksEl = $('#links');
  const panel = $('#panel');
  const mobile = window.matchMedia('(max-width: 900px)');

  /* ======================================================== api */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function reload() {
    const data = await api('GET', '/api/tree');
    state.meta = data.meta || {};
    state.people = new Map(data.people.map((p) => [p.id, p]));
  }

  /* ======================================================== relations */
  const get = (id) => state.people.get(id);
  const dateKey = (d) => d || '9999';
  const birthKey = (id) => dateKey(get(id)?.birth?.date);
  const parentRank = (id) => ({ male: 0, other: 1, unknown: 1, female: 2 }[get(id)?.gender] ?? 1);

  const parentsOf = (id) => (get(id)?.parents || []).filter((x) => state.people.has(x))
    .sort((a, b) => parentRank(a) - parentRank(b));
  const childrenOf = (id) => (get(id)?.children || []).filter((x) => state.people.has(x))
    .sort((a, b) => birthKey(a).localeCompare(birthKey(b)));
  const partnershipsOf = (id) => (get(id)?.spouses || []).filter((s) => state.people.has(s.id))
    .sort((a, b) => dateKey(a.marriageDate).localeCompare(dateKey(b.marriageDate)));
  const spousesOf = (id) => partnershipsOf(id).map((s) => s.id);
  const partnership = (a, b) => (get(a)?.spouses || []).find((s) => s.id === b);

  // Can a father or mother still be added? (at most two parents, one of each gender we know about)
  function canAddParent(id, role) {
    const ps = parentsOf(id);
    if (ps.length >= 2) return false;
    const gender = role === 'father' ? 'male' : 'female';
    return !ps.some((pid) => get(pid).gender === gender);
  }

  function siblingsOf(id) {
    const set = new Set();
    for (const pid of parentsOf(id)) for (const c of childrenOf(pid)) if (c !== id) set.add(c);
    return [...set].sort((a, b) => birthKey(a).localeCompare(birthKey(b)));
  }

  /* ======================================================== formatting */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unnamed';
  // Name on the tree cards: uses the birth surname (e.g. a wife's maiden name) when the switch is on
  const cardName = (p) => {
    const surname = state.showBirthSurname && p.maidenName ? p.maidenName : p.lastName;
    return [p.firstName, surname].filter(Boolean).join(' ') || 'Unnamed';
  };
  const fullName = (p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || 'Unnamed';
  // Initials follow the same surname as the name card
  const initials = (p) => {
    const surname = state.showBirthSurname && p.maidenName ? p.maidenName : p.lastName;
    return ((p.firstName || '')[0] || '') + ((surname || '')[0] || '') || '?';
  };
  const year = (d) => (d ? d.slice(0, 4) : '');
  const isDeceased = (p) => !p.living || !!(p.death && (p.death.date || p.death.place));

  const fmtDate = (d) => FamilyDates.format(d);

  function lifeShort(p) {
    const b = year(p.birth?.date), d = year(p.death?.date);
    if (isDeceased(p)) {
      if (b || d) return `${b || '?'} – ${d || '?'}`;
      return 'Deceased';
    }
    return b ? `Born ${b}` : 'Living';
  }

  function ageOf(p) {
    const b = p.birth?.date;
    if (!b) return null;
    let end;
    if (isDeceased(p)) {
      if (!p.death?.date) return null;
      end = p.death.date;
    } else {
      end = new Date().toISOString().slice(0, 10);
    }
    const [by, bm = 1, bd = 1] = b.split('-').map(Number);
    const [ey, em = 12, ed = 31] = end.split('-').map(Number);
    let age = ey - by;
    if (em < bm || (em === bm && ed < bd)) age -= 1;
    return age >= 0 ? age : null;
  }

  function avatarHTML(p) {
    const inner = p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p).toUpperCase());
    return `<span class="avatar g-${esc(p.gender)}">${inner}</span>`;
  }

  /* ======================================================== layout */
  // Every node: { key, id, x (center), y (top), role, moreUp, moreDown }
  function computeLayout(fid) {
    const nodes = [];
    const links = [];
    const used = new Map();

    const add = (id, x, y, role) => {
      const n = used.get(id) || 0;
      used.set(id, n + 1);
      const node = { key: n ? `${id}#${n}` : id, id, x, y, role, moreUp: false, moreDown: false };
      nodes.push(node);
      return node;
    };

    const coupleLine = (a, b, y, ended) => {
      const [l, r] = a < b ? [a, b] : [b, a];
      links.push({ d: `M${l + W / 2},${y + H / 2}H${r - W / 2}`, cls: ended ? 'couple ended' : 'couple' });
    };

    // Connect a parent junction to its children. `offset` moves the horizontal line up or down,
    // so separate families on the same row never share (and appear to merge into) one line.
    const drop = (jx, jy, kids, offset = 0) => {
      if (!kids.length) return;
      const busY = kids[0].y - GY / 2 + offset;
      let d = `M${jx},${jy}V${busY}`;
      const xs = kids.map((k) => k.x).concat(jx);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      if (maxX > minX) d += `M${minX},${busY}H${maxX}`;
      for (const k of kids) d += `M${k.x},${busY}V${k.y}`;
      links.push({ d, cls: '' });
    };

    /* ---- ancestors */
    const ancWidth = (id, g) => {
      if (g >= UP) return UNIT;
      const ps = parentsOf(id);
      if (!ps.length) return UNIT;
      return Math.max(UNIT, ps.reduce((s, p) => s + ancWidth(p, g + 1), 0));
    };

    // Put the parents of `id` on generation row g, centered on cx. Returns their nodes.
    const placeParentRow = (id, cx, g) => {
      const ps = parentsOf(id);
      const widths = ps.map((p) => ancWidth(p, g));
      let left = cx - widths.reduce((a, b) => a + b, 0) / 2;
      return ps.map((p, i) => {
        const x = left + widths[i] / 2;
        left += widths[i];
        return add(p, x, -g * ROW, 'ancestor');
      });
    };

    // Draw the couple line between parents and connect each child card to the right parent(s).
    // Half-siblings connect to just the parent they share.
    const linkParents = (placed, kidCards, baseOffset = 0) => {
      if (!placed.length) return;
      const y = placed[0].y;
      let both = null;
      if (placed.length === 2) {
        coupleLine(placed[0].x, placed[1].x, y, !!partnership(placed[0].id, placed[1].id)?.divorceDate);
        both = { x: (placed[0].x + placed[1].x) / 2, y: y + H / 2, kids: [] };
      }
      const single = new Map(placed.map((n) => [n.id, { x: n.x, y: y + H, kids: [] }]));
      for (const kid of kidCards) {
        const shared = parentsOf(kid.id).filter((pid) => single.has(pid));
        if (both && shared.length !== 1) both.kids.push(kid);
        else single.get(shared[0] || placed[0].id).kids.push(kid);
      }
      dropGroups([both, ...single.values()].filter((j) => j && j.kids.length), baseOffset);
    };

    // Draw each family group with its own line height (only needed when there is more than one)
    const BUS_STEP = 18;
    const dropGroups = (groups, baseOffset = 0) => {
      const active = groups.filter((g) => g.kids.length).sort((a, b) => a.x - b.x);
      active.forEach((g, i) => drop(g.x, g.y, g.kids, baseOffset + (i - (active.length - 1) / 2) * BUS_STEP));
    };

    const placeAncestors = (id, cx, g, kidCards) => {
      const placed = placeParentRow(id, cx, g);
      linkParents(placed, kidCards);
      for (const n of placed) {
        if (g < UP) placeAncestors(n.id, n.x, g + 1, [n]);
        else n.moreUp = parentsOf(n.id).length > 0;
      }
    };

    /* ---- family blocks: a person, their partners, and their children below them */
    // depth 0 is the person; children are depth 1, and so on, down to maxDepth.
    // withSpouses(depth) decides whether partners are shown at that depth.
    // One partner sits to the right. With several, they alternate left and right of the person,
    // so each partner's children can hang directly below that couple.
    const leftPartnerCount = (n) => (n <= 1 ? 0 : Math.ceil(n / 2));
    const partnerSide = (i, n) => (n <= 1 || i % 2 === 1 ? 1 : -1);

    const blockWidth = (id, depth, maxDepth, withSpouses) => {
      const gw = (1 + (withSpouses(depth) ? spousesOf(id).length : 0)) * UNIT;
      if (depth >= maxDepth) return gw;
      const cw = childrenOf(id).reduce((s, c) => s + blockWidth(c, depth + 1, maxDepth, withSpouses), 0);
      return Math.max(gw, cw);
    };

    // Place the children of an already-placed person (and partners) on the next row down.
    const placeChildren = (ownerNode, spouseNodes, depth, maxDepth, withSpouses, roleAt) => {
      const kids = childrenOf(ownerNode.id);
      if (!kids.length) return;
      const spouseIds = spouseNodes.map((s) => s.id);
      // Group 0: children whose other parent isn't a shown partner. Then one group per partner,
      // joined at the gap between the person and that partner.
      const groups = [{ x: ownerNode.x, y: ownerNode.y + H, kids: [] }];
      spouseNodes.forEach((sn) => groups.push({
        x: sn.x > ownerNode.x ? sn.x - UNIT / 2 : sn.x + UNIT / 2, y: ownerNode.y + H / 2, kids: []
      }));
      for (const k of kids) {
        const other = get(k).parents.find((pid) => pid !== ownerNode.id);
        groups[spouseIds.indexOf(other) + 1].kids.push(k);
      }
      // Lay children out left to right in the same order as their parents' junctions
      const ordered = [...groups].sort((a, b) => a.x - b.x).flatMap((g) => g.kids);
      const widths = ordered.map((k) => blockWidth(k, depth + 1, maxDepth, withSpouses));
      const memberXs = [ownerNode.x, ...spouseNodes.map((sn) => sn.x)];
      const center = (Math.min(...memberXs) + Math.max(...memberXs)) / 2;
      let left = center - widths.reduce((a, b) => a + b, 0) / 2;
      const placed = new Map();
      ordered.forEach((k, i) => {
        placed.set(k, placeBlock(k, left, widths[i], ownerNode.y + ROW, depth + 1, maxDepth, withSpouses, roleAt));
        left += widths[i];
      });
      dropGroups(groups.map((g) => ({ ...g, kids: g.kids.map((k) => placed.get(k)) })));
    };

    const placeBlock = (id, left, w, y, depth, maxDepth, withSpouses, roleAt) => {
      const sps = withSpouses(depth) ? spousesOf(id) : [];
      const gw = (1 + sps.length) * UNIT;
      const x = left + (w - gw) / 2 + leftPartnerCount(sps.length) * UNIT + UNIT / 2;
      const node = add(id, x, y, roleAt(depth));
      let onLeft = 0, onRight = 0;
      const spouseNodes = sps.map((sid, i) => {
        const slot = partnerSide(i, sps.length) < 0 ? -(++onLeft) : ++onRight;
        const sn = add(sid, x + slot * UNIT, y, 'in-law');
        coupleLine(x, sn.x, y, !!partnership(id, sid)?.divorceDate);
        sn.moreUp = parentsOf(sid).length > 0;
        return sn;
      });
      if (depth < maxDepth) placeChildren(node, spouseNodes, depth, maxDepth, withSpouses, roleAt);
      else node.moreDown = childrenOf(id).length > 0;
      return node;
    };

    /* ---- the focus person's own family block: partners and four generations of descendants */
    const focusSpouses = () => true;
    const focusRole = (depth) => (depth === 0 ? 'focus' : 'descendant');
    const focusW = blockWidth(fid, 0, DOWN, focusSpouses);
    const focusGroupW = (1 + spousesOf(fid).length) * UNIT;
    // Position the block so the focus person lands exactly at x = 0
    const focusLeft = -((focusW - focusGroupW) / 2 + leftPartnerCount(spousesOf(fid).length) * UNIT + UNIT / 2);
    const focus = placeBlock(fid, focusLeft, focusW, 0, 0, DOWN, focusSpouses, focusRole);

    /* ---- siblings, each with partners and their children (nieces and nephews) */
    // Partners are shown wherever their children are shown, so each child connects to the right couple
    const sibSpouses = (depth) => depth < SIB_DOWN;
    const sibRole = (depth) => (depth === 0 ? 'sibling' : 'niece-nephew');
    // Half-siblings first (father's side, then mother's side), full siblings next to the focus person
    const myParents = parentsOf(fid);
    const sibGroup = (sid) => {
      const shared = parentsOf(sid).filter((pid) => myParents.includes(pid));
      if (shared.length >= 2 || myParents.length < 2) return 2;
      return shared[0] === myParents[0] ? 0 : 1;
    };
    const sibs = siblingsOf(fid).sort((a, b) => sibGroup(a) - sibGroup(b) || birthKey(a).localeCompare(birthKey(b)));
    const sibNodes = [];
    let sibRight = focusLeft;
    for (let k = sibs.length - 1; k >= 0; k--) {
      const w = blockWidth(sibs[k], 0, SIB_DOWN, sibSpouses);
      sibRight -= w;
      sibNodes.unshift(placeBlock(sibs[k], sibRight, w, 0, 0, SIB_DOWN, sibSpouses, sibRole));
    }
    const rowCards = [...sibNodes, focus];

    // Left and right edges of everything placed so far on the given rows
    const edges = (rows) => {
      const xs = nodes.filter((n) => rows.includes(n.y / ROW)).map((n) => n.x);
      if (!xs.length) return { left: Infinity, right: -Infinity };
      return { left: Math.min(...xs) - UNIT / 2, right: Math.max(...xs) + UNIT / 2 };
    };

    /* ---- parents, then aunts & uncles with partners, first cousins with partners, and cousins' children */
    const parentNodes = placeParentRow(fid, (rowCards[0].x + focus.x) / 2, 1);
    linkParents(parentNodes, rowCards);

    /* ---- the partner's family: their parents, siblings (with partners) and nieces and nephews */
    // Shown for the partner on the right: the only partner, or the most recent when there are several.
    const myPartners = spousesOf(fid);
    const partnerId = myPartners.length === 1 ? myPartners[0] : myPartners[1];
    const partnerNode = partnerId && nodes.find((n) => n.id === partnerId && n.y === 0 && n.role === 'in-law');
    if (partnerNode && state.showPartnerFamily) {
      const inLawSpouses = (depth) => depth < SIB_DOWN;
      const inLawRole = (depth) => (depth === 0 ? 'partner-sibling' : 'partner-niece-nephew');
      const pSibs = siblingsOf(partnerId).filter((sid) => sid !== fid);
      const pSibNodes = [];
      let left = edges(rowsTo(SIB_DOWN)).right;
      for (const sid of pSibs) {
        const w = blockWidth(sid, 0, SIB_DOWN, inLawSpouses);
        pSibNodes.push(placeBlock(sid, left, w, 0, 0, SIB_DOWN, inLawSpouses, inLawRole));
        left += w;
      }
      const pParents = parentsOf(partnerId);
      if (pParents.length) {
        const kids = [partnerNode, ...pSibNodes];
        const xs = kids.map((n) => n.x);
        let cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        // Keep them clear of the selected person's own parents on the same row
        const minLeft = edges([-1]).right;
        const half = (pParents.length * UNIT) / 2;
        if (cx - half < minLeft) cx = minLeft + half;
        const placed = pParents.map((pid, k) => {
          const n = add(pid, cx - half + UNIT / 2 + k * UNIT, -ROW, 'partner-parent');
          n.moreUp = parentsOf(pid).length > 0;
          return n;
        });
        // A slightly lower line keeps this family's connector separate from the selected person's parents
        linkParents(placed, kids, BUS_STEP);
        partnerNode.moreUp = false;
      }
    }

    const auntSpouses = (depth) => depth < AUNT_DOWN;
    const auntRole = (depth) => (['aunt-uncle', 'cousin'][depth] || 'cousin-descendant');
    const parentIds = new Set(parentNodes.map((n) => n.id));

    parentNodes.forEach((pn, i) => {
      // Father's side goes to the left, mother's side to the right
      const toLeft = parentNodes.length === 2 ? i === 0 : get(pn.id).gender !== 'female';
      const aunts = siblingsOf(pn.id).filter((a) => !parentIds.has(a) && a !== fid);
      const widths = aunts.map((a) => blockWidth(a, 0, AUNT_DOWN, auntSpouses));
      const auntNodes = [];
      // Aunt blocks use rows -1 (aunts), 0 (cousins) and below (their descendants); keep clear of what's there,
      // including the partner's family
      const busy = edges(rowsTo(AUNT_DOWN - 1, -1));
      if (toLeft) {
        let right = Math.min(pn.x - UNIT / 2, busy.left);
        for (let k = aunts.length - 1; k >= 0; k--) {
          right -= widths[k];
          auntNodes.unshift(placeBlock(aunts[k], right, widths[k], pn.y, 0, AUNT_DOWN, auntSpouses, auntRole));
        }
      } else {
        let left = Math.max(pn.x + UNIT / 2, busy.right);
        aunts.forEach((a, k) => {
          auntNodes.push(placeBlock(a, left, widths[k], pn.y, 0, AUNT_DOWN, auntSpouses, auntRole));
          left += widths[k];
        });
      }
      // Grandparents sit over the whole group of their children (this parent plus aunts and uncles)
      if (UP >= 2) {
        const xs = [pn.x, ...auntNodes.map((n) => n.x)];
        const lo = Math.min(...xs), hi = Math.max(...xs);
        // Center over the group unless the partner's parents sit in between, which would make
        // the grandparents look like their parents. In that case stay above this parent.
        const blocked = nodes.some((n) => n.role === 'partner-parent' && n.x > lo && n.x < hi);
        const cx = blocked ? pn.x : (lo + hi) / 2;
        placeAncestors(pn.id, cx, 2, [pn, ...auntNodes]);
      } else {
        pn.moreUp = parentsOf(pn.id).length > 0;
      }
    });

    const ys = nodes.map((n) => n.y);
    const halfW = Math.max(...nodes.map((n) => Math.abs(n.x))) + W / 2;
    state.bounds = { minY: Math.min(...ys), maxY: Math.max(...ys) + H, halfW };
    return { nodes, links };
  }

  /* ======================================================== rendering */
  const cardEls = new Map();
  let linkTimer = null;

  function cardMarkup(p, node) {
    let html = `${avatarHTML(p)}<div class="meta"><div class="name">${esc(cardName(p))}</div><div class="life">${esc(lifeShort(p))}</div></div>`;
    if (node.moreUp) html += '<span class="more-up" title="More ancestors">&#9650;</span>';
    if (node.moreDown) html += '<span class="more-down" title="More descendants">&#9660;</span>';
    if (node.role === 'focus') {
      const ups = ['father', 'mother'].filter((role) => canAddParent(p.id, role));
      if (ups.length) {
        html += `<span class="qa-up">${ups.map((role) => `<button type="button" class="qa" data-add="${role}">${role === 'father' ? 'Father' : 'Mother'}</button>`).join('')}</span>`;
      }
      html += '<button type="button" class="qa right" data-add="partner">Partner</button>'
        + '<button type="button" class="qa down" data-add="child">Child</button>';
      if (parentsOf(p.id).length && spousesOf(p.id).length < 2) html += '<button type="button" class="qa left" data-add="sibling">Sibling</button>';
    }
    return html;
  }

  function updateCard(el, node) {
    const p = get(node.id);
    el.dataset.id = node.id;
    el.className = [
      'card', `g-${p.gender}`,
      node.role === 'focus' ? 'focus' : '',
      isDeceased(p) ? 'deceased' : '',
      parentsOf(p.id).length >= 2 ? 'has-parents' : '',
      childrenOf(p.id).length ? 'has-children' : '',
      spousesOf(p.id).length ? 'has-partner' : '',
      siblingsOf(p.id).length ? 'has-siblings' : '',
      el.classList.contains('entering') ? 'entering' : ''
    ].filter(Boolean).join(' ');
    el.setAttribute('aria-label', `${fullName(p)}, ${lifeShort(p)}`);
    el.innerHTML = cardMarkup(p, node);
    el.style.transform = `translate(${node.x - W / 2}px, ${node.y}px)`;
  }

  function render({ instant = false } = {}) {
    const empty = state.people.size === 0;
    $('#emptyState').hidden = !empty;
    if (empty) {
      for (const el of cardEls.values()) el.remove();
      cardEls.clear();
      linksEl.innerHTML = '';
      panel.innerHTML = '';
      return;
    }
    if (!state.people.has(state.focusId)) state.focusId = state.meta.rootPersonId && get(state.meta.rootPersonId) ? state.meta.rootPersonId : [...state.people.keys()][0];

    const { nodes, links } = computeLayout(state.focusId);
    const keep = new Set();

    for (const node of nodes) {
      keep.add(node.key);
      let el = cardEls.get(node.key);
      if (!el) {
        el = document.createElement('div');
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.classList.add('entering');
        world.appendChild(el);
        cardEls.set(node.key, el);
        updateCard(el, node);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
      } else {
        updateCard(el, node);
      }
    }
    for (const [key, el] of cardEls) {
      if (keep.has(key)) continue;
      cardEls.delete(key);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), instant ? 0 : 320);
    }

    clearTimeout(linkTimer);
    const draw = () => {
      linksEl.innerHTML = links.map((l) => `<path d="${l.d}" class="${l.cls}"/>`).join('');
      linksEl.classList.remove('hidden');
    };
    if (instant) draw();
    else {
      linksEl.classList.add('hidden');
      linkTimer = setTimeout(draw, 430);
    }
  }

  /* ======================================================== pan & zoom */
  function applyView(animate) {
    world.classList.toggle('animate', !!animate);
    const { x, y, k } = state.view;
    world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }

  // Pick a zoom level that fits all visible generations (within limits).
  function fitZoom() {
    const r = viewport.getBoundingClientRect();
    const b = state.bounds || { minY: 0, maxY: H };
    const fit = Math.min((r.height - 90) / (b.maxY - b.minY), (r.width / 2 - 16) / (b.halfW || W));
    state.view.k = Math.max(mobile.matches ? 0.35 : 0.45, Math.min(1, fit));
  }

  // Center horizontally on the focus person and vertically on the visible generations,
  // while keeping the focus card on screen.
  function centerOnFocus(animate = true) {
    const r = viewport.getBoundingClientRect();
    const k = state.view.k;
    const b = state.bounds || { minY: 0, maxY: H };
    let y = r.height / 2 - ((b.minY + b.maxY) / 2) * k;
    const minY = 70, maxY = r.height - H * k - 70;
    y = Math.min(Math.max(y, minY - 0), Math.max(minY, maxY));
    if (y + H * k > r.height - 40) y = r.height - 40 - H * k;
    if (y < 40) y = 40;
    state.view.x = r.width / 2;
    state.view.y = y;
    applyView(animate);
  }

  function zoomAt(factor, cx, cy, animate = false) {
    const v = state.view;
    const k = Math.min(2, Math.max(0.12, v.k * factor));
    v.x = cx - (cx - v.x) * (k / v.k);
    v.y = cy - (cy - v.y) * (k / v.k);
    v.k = k;
    applyView(animate);
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  const pointers = new Map();
  let drag = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card')) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, dist: null };
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = viewport.getBoundingClientRect();
      if (drag.dist) zoomAt(dist / drag.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      drag.dist = dist;
      return;
    }
    state.view.x = drag.vx + (e.clientX - drag.x);
    state.view.y = drag.vy + (e.clientY - drag.y);
    applyView(false);
  });
  const endDrag = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { drag = null; viewport.classList.remove('dragging'); }
    else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      drag = { x: p.x, y: p.y, vx: state.view.x, vy: state.view.y, dist: null };
    }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  const zoomCenter = (f) => { const r = viewport.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2, true); };
  $('#zoomIn').onclick = () => zoomCenter(1.2);
  $('#zoomOut').onclick = () => zoomCenter(1 / 1.2);
  $('#zoomReset').onclick = () => { fitZoom(); centerOnFocus(true); };

  /* ---- light / dark theme */
  const themeBtn = $('#themeBtn');
  const root = document.documentElement;
  const syncThemeBtn = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  };
  const setTheme = (theme, animate) => {
    if (animate) {
      root.classList.add('theme-switching');
      setTimeout(() => root.classList.remove('theme-switching'), 260);
    }
    root.setAttribute('data-theme', theme);
    syncThemeBtn();
  };
  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    setTheme(next, true);
  });
  // Until someone picks a theme with the button, follow the device's light/dark setting
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  systemDark.addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* ignore */ }
    if (!saved) setTheme(e.matches ? 'dark' : 'light', true);
  });
  syncThemeBtn();

  /* ---- "Spouse's relatives" switch */
  const partnerToggle = $('#partnerToggle');
  const syncPartnerToggle = () => partnerToggle.setAttribute('aria-checked', String(state.showPartnerFamily));
  partnerToggle.addEventListener('click', () => {
    state.showPartnerFamily = !state.showPartnerFamily;
    try { localStorage.setItem('showPartnerFamily', state.showPartnerFamily ? 'on' : 'off'); } catch { /* ignore */ }
    syncPartnerToggle();
    if (state.people.size) render();
  });
  syncPartnerToggle();

  /* ---- "Show birth surname" switch */
  const surnameToggle = $('#surnameToggle');
  const syncSurnameToggle = () => surnameToggle.setAttribute('aria-checked', String(state.showBirthSurname));
  surnameToggle.addEventListener('click', () => {
    state.showBirthSurname = !state.showBirthSurname;
    try { localStorage.setItem('showBirthSurname', state.showBirthSurname ? 'on' : 'off'); } catch { /* ignore */ }
    syncSurnameToggle();
    if (state.people.size) render({ instant: true });
  });
  syncSurnameToggle();

  /* ======================================================== navigation */
  function go(id) {
    if (!id || !state.people.has(id)) return;
    if (location.hash !== `#/${id}`) location.hash = `#/${id}`;
    else setFocus(id);
  }

  function setFocus(id, { instant = false } = {}) {
    state.focusId = id;
    render({ instant });
    centerOnFocus(!instant);
    renderPanel();
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#\//, '');
    if (state.people.has(id)) setFocus(id);
  });

  world.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const qa = e.target.closest('.qa');
    if (qa) { openPersonDialog({ relation: qa.dataset.add, anchorId: card.dataset.id }); return; }
    if (card.dataset.id === state.focusId) openPanel();
    else go(card.dataset.id);
  });
  world.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('.qa')) {
      e.preventDefault();
      card.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = state.focusId;
    if (!id) return;
    const pick = { ArrowUp: parentsOf(id)[0], ArrowDown: childrenOf(id)[0], ArrowRight: spousesOf(id)[0], ArrowLeft: siblingsOf(id).slice(-1)[0] }[e.key];
    if (pick) { e.preventDefault(); go(pick); }
  });

  $('#homeBtn').onclick = () => go(state.meta.rootPersonId || [...state.people.keys()][0]);

  /* ======================================================== profile panel */
  const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const ICON_UNLINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function openPanel() { panel.classList.remove('collapsed'); }

  function timelineItems(p) {
    const items = [];
    if (p.birth?.date || p.birth?.place) items.push({ cls: 't-birth', what: 'Born', date: p.birth.date, place: p.birth.place, order: -1 });
    for (const s of partnershipsOf(p.id)) {
      const sp = get(s.id);
      if (s.marriageDate || s.marriagePlace) items.push({ cls: 't-family', what: `Married ${shortName(sp)}`, date: s.marriageDate, place: s.marriagePlace });
      if (s.divorceDate) items.push({ cls: 't-family', what: `Divorced ${shortName(sp)}`, date: s.divorceDate });
    }
    for (const c of childrenOf(p.id)) {
      const ch = get(c);
      if (ch.birth?.date) items.push({ cls: 't-family', what: `Birth of ${ch.gender === 'male' ? 'son' : ch.gender === 'female' ? 'daughter' : 'child'} ${ch.firstName || shortName(ch)}`, date: ch.birth.date, place: ch.birth.place });
    }
    for (const ev of p.events || []) {
      const range = ev.endDate ? `${fmtDate(ev.date)} – ${fmtDate(ev.endDate)}` : null;
      items.push({ cls: 't-event', what: ev.type, date: ev.date, range, place: ev.place, note: ev.note });
    }
    if (isDeceased(p) && (p.death?.date || p.death?.place)) items.push({ cls: 't-death', what: 'Died', date: p.death.date, place: p.death.place, order: 1 });
    return items.sort((a, b) => (a.order || 0) - (b.order || 0) || dateKey(a.date).localeCompare(dateKey(b.date)));
  }

  function relRow(id, kind, sub = '') {
    const p = get(id);
    const tools = [];
    if (kind === 'partner') tools.push(`<button type="button" data-edit-partner="${esc(id)}" title="Edit marriage details" aria-label="Edit marriage details">${ICON_EDIT}</button>`);
    if (kind !== 'sibling') tools.push(`<button type="button" data-unlink="${kind}" data-other="${esc(id)}" title="Remove this link" aria-label="Remove link to ${esc(shortName(p))}">${ICON_UNLINK}</button>`);
    return `<div class="rel">${avatarHTML(p)}
      <button type="button" class="rel-main" data-go="${esc(id)}"><span class="r-name">${esc(fullName(p))}</span><span class="r-sub">${esc(sub || lifeShort(p))}</span></button>
      <span class="rel-tools">${tools.join('')}</span></div>`;
  }

  function relGroup(label, ids, kind, subFn) {
    const rows = ids.length ? ids.map((id) => relRow(id, kind, subFn && subFn(id))).join('') : '<div class="rel-empty">None added yet</div>';
    return `<div class="rel-group"><div class="rel-label"><span>${label}</span></div><div class="rel-list">${rows}</div></div>`;
  }

  function renderPanel() {
    const p = get(state.focusId);
    if (!p) { panel.innerHTML = ''; return; }
    const age = ageOf(p);
    const aka = [p.maidenName ? `born ${p.maidenName}` : '', p.nickname ? `“${p.nickname}”` : ''].filter(Boolean).join(', ');
    let lifespan;
    if (isDeceased(p)) lifespan = `${fmtDate(p.birth?.date) || 'Unknown'} – ${fmtDate(p.death?.date) || 'unknown'}`;
    else lifespan = p.birth?.date ? `Born ${fmtDate(p.birth.date)}` : 'Living';
    const ageText = age === null ? '' : isDeceased(p) ? ` (aged ${age})` : ` (age ${age})`;

    const tl = timelineItems(p);
    const timeline = tl.length
      ? `<ol class="timeline">${tl.map((t) => `<li class="${t.cls}"><div class="t-when">${esc(t.range || fmtDate(t.date) || 'Date unknown')}</div><div class="t-what">${esc(t.what)}</div>${t.place ? `<div class="t-where">${esc(t.place)}</div>` : ''}${t.note ? `<div class="t-note">${esc(t.note)}</div>` : ''}</li>`).join('')}</ol>`
      : '<div class="rel-empty">No dates yet. Edit the profile to add birth, marriage and other events.</div>';

    const isHome = state.meta.rootPersonId === p.id;
    const partnerSub = (sid) => {
      const s = partnership(p.id, sid);
      if (!s) return '';
      if (s.divorceDate) return `Married ${year(s.marriageDate) || '?'}, divorced ${year(s.divorceDate)}`;
      return s.marriageDate ? `Married ${fmtDate(s.marriageDate)}` : 'Partner';
    };

    panel.innerHTML = `
      <div class="p-head">
        ${avatarHTML(p)}
        <div>
          <h2>${esc(fullName(p))}</h2>
          ${aka ? `<div class="aka">${esc(aka)}</div>` : ''}
          <div class="lifespan">${esc(lifespan + ageText)}</div>
          ${isHome ? '<span class="home-badge">Home person</span>' : ''}
        </div>
        <button type="button" class="icon-btn p-close" data-act="close" aria-label="Close profile">&times;</button>
      </div>
      <div class="p-actions">
        <button type="button" class="btn primary small" data-act="edit">Edit profile</button>
        <button type="button" class="btn ghost small" data-act="link">Link existing relative</button>
      </div>
      <section class="p-section">
        <h3>Add a relative</h3>
        <div class="p-actions" style="padding:0;border:0">
          <button type="button" class="btn ghost small" data-add="father" ${canAddParent(p.id, 'father') ? '' : 'disabled title="Father already added"'}>Add father</button>
          <button type="button" class="btn ghost small" data-add="mother" ${canAddParent(p.id, 'mother') ? '' : 'disabled title="Mother already added"'}>Add mother</button>
          <button type="button" class="btn ghost small" data-add="partner">Add partner</button>
          <button type="button" class="btn ghost small" data-add="child">Add child</button>
          <button type="button" class="btn ghost small" data-add="sibling" ${parentsOf(p.id).length ? '' : 'disabled title="Add a father or mother first"'}>Add sibling</button>
        </div>
      </section>
      <section class="p-section"><h3>Life events</h3>${timeline}</section>
      <section class="p-section">
        <h3>Family</h3>
        ${relGroup('Parents', parentsOf(p.id), 'parent')}
        ${relGroup('Partners', spousesOf(p.id), 'partner', partnerSub)}
        ${relGroup('Children', childrenOf(p.id), 'child')}
        ${siblingsOf(p.id).length ? relGroup('Siblings', siblingsOf(p.id), 'sibling') : ''}
      </section>
      ${p.bio ? `<section class="p-section"><h3>Life story</h3><p class="bio">${esc(p.bio)}</p></section>` : ''}
      <section class="p-section">
        ${isHome ? '' : '<button type="button" class="btn text" data-act="home">Make this the home person</button>'}
        <button type="button" class="btn text danger-text" data-act="delete">Delete ${esc(p.firstName || 'person')}</button>
      </section>`;
  }

  panel.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const id = state.focusId;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.add) return openPersonDialog({ relation: t.dataset.add, anchorId: id });
    if (t.dataset.editPartner) return openLinkDialog(id, { partnerId: t.dataset.editPartner });
    if (t.dataset.unlink) return unlink(id, t.dataset.unlink, t.dataset.other);
    switch (t.dataset.act) {
      case 'edit': return openPersonDialog({ personId: id });
      case 'link': return openLinkDialog(id);
      case 'close': return panel.classList.add('collapsed');
      case 'home':
        await run(() => api('PUT', '/api/meta', { rootPersonId: id }), 'Home person updated');
        return;
      case 'delete': return deletePerson(id);
    }
  });

  async function unlink(id, kind, otherId) {
    const p = get(id), o = get(otherId);
    const words = { parent: `${shortName(o)} as a parent of ${shortName(p)}`, child: `${shortName(o)} as a child of ${shortName(p)}`, partner: `the partnership between ${shortName(p)} and ${shortName(o)}` };
    const ok = await confirmBox('Remove this link?', `This removes ${words[kind]}. Both profiles stay in the tree.`, 'Remove link');
    if (!ok) return;
    const url = { parent: `/api/people/${id}/parents/${otherId}`, child: `/api/people/${id}/children/${otherId}`, partner: `/api/people/${id}/spouses/${otherId}` }[kind];
    await run(() => api('DELETE', url), 'Link removed');
  }

  async function deletePerson(id) {
    const p = get(id);
    const ok = await confirmBox(`Delete ${fullName(p)}?`, 'Their profile and all their family links will be removed. Their relatives stay in the tree.', 'Delete person');
    if (!ok) return;
    const next = parentsOf(id)[0] || spousesOf(id)[0] || childrenOf(id)[0] || siblingsOf(id)[0];
    await run(() => api('DELETE', `/api/people/${id}`), 'Person deleted', next);
  }

  // Run an API change, reload data, re-render, and show feedback.
  async function run(fn, message, focusAfter) {
    try {
      const result = await fn();
      await reload();
      $('#familyNameText').textContent = state.meta.name || 'Our Family';
      if (focusAfter && state.people.has(focusAfter)) {
        if (focusAfter === state.focusId) { render(); renderPanel(); }
        else go(focusAfter);
      } else {
        render();
        renderPanel();
      }
      if (message) toast(message);
      return result;
    } catch (err) {
      toast(err.message, true);
      throw err;
    }
  }

  /* ======================================================== person dialog */
  const personDialog = $('#personDialog');
  const personForm = $('#personForm');
  let personCtx = null;

  function eventRow(ev = {}) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.id = ev.id || '';
    const type = ev.type || 'Residence';
    const types = EVENT_TYPES.includes(type) ? EVENT_TYPES : [type, ...EVENT_TYPES];
    row.innerHTML = `
      <select aria-label="Event type" data-f="type">${types.map((t) => `<option ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <input data-f="date" data-date placeholder="12 May 1948" aria-label="Event date" autocomplete="off" value="${esc(fmtDate(ev.date))}">
      <input data-f="place" placeholder="Place" aria-label="Event place" value="${esc(ev.place || '')}">
      <button type="button" class="icon-btn remove" aria-label="Remove event">&times;</button>
      <input class="note" data-f="note" placeholder="Note" aria-label="Event note" value="${esc(ev.note || '')}">
      <input type="hidden" data-f="endDate" value="${esc(ev.endDate || '')}">`;
    row.querySelector('.remove').onclick = () => row.remove();
    return row;
  }
  $('#addEventRow').onclick = () => {
    const row = eventRow();
    $('#eventRows').appendChild(row);
    row.querySelector('select').focus();
  };

  const deceasedBox = personForm.elements.deceased;
  deceasedBox.addEventListener('change', () => { $('#deathFields').hidden = !deceasedBox.checked; });

  $('#photoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      personForm.elements.photo.value = await shrinkImage(file, 320);
      toast('Photo added');
    } catch {
      toast('That file could not be read as an image', true);
    }
    e.target.value = '';
  });

  function shrinkImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = Math.min(size, s);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function openPersonDialog({ personId = null, relation = null, anchorId = null } = {}) {
    // "father" and "mother" are parents with the gender already chosen
    let parentRole = null;
    if (relation === 'father' || relation === 'mother') {
      parentRole = relation;
      relation = 'parent';
    }
    personCtx = { personId, relation, anchorId };
    personForm.reset();
    if (parentRole) personForm.elements.gender.value = parentRole === 'father' ? 'male' : 'female';
    $('#eventRows').innerHTML = '';
    $('#personError').hidden = true;
    $$('.invalid', personForm).forEach((el) => el.classList.remove('invalid'));
    const f = personForm.elements;
    const anchor = anchorId ? get(anchorId) : null;
    const editing = personId ? get(personId) : null;

    $('#personDialogTitle').textContent = editing ? `Edit ${shortName(editing)}` : relation ? `Add ${parentRole || relation}` : 'Add person';
    $('#personSubmit').textContent = editing ? 'Save changes' : 'Add person';
    $('#relationNote').hidden = !anchor;
    $('#otherParentRow').hidden = true;
    $('#coParentRow').hidden = true;
    $('#marriageFields').hidden = relation !== 'partner';
    personForm.querySelector('details.more').open = false;

    if (anchor) {
      const name = shortName(anchor);
      const noteText = {
        parent: `New ${parentRole || 'parent'} of ${name}`,
        child: `New child of ${name}`,
        partner: `New partner of ${name}`,
        sibling: `New sibling of ${name}, sharing ${parentsOf(anchorId).map((x) => get(x).firstName).join(' and ')} as ${parentsOf(anchorId).length > 1 ? 'parents' : 'parent'}`
      }[relation];
      $('#relationNote').textContent = noteText;
      if (relation !== 'partner') f.lastName.value = anchor.lastName || '';

      if (relation === 'child') {
        const sps = spousesOf(anchorId);
        f.otherParent.innerHTML = sps.map((s) => `<option value="${esc(s)}">${esc(fullName(get(s)))}</option>`).join('') + '<option value="">Unknown or not listed</option>';
        $('#otherParentRow').hidden = false;
      }
      if (relation === 'parent') {
        const existing = parentsOf(anchorId);
        if (existing.length === 1 && !spousesOf(existing[0]).length) {
          $('#coParentRow').hidden = false;
          $('#coParentText').textContent = `Also add as partner of ${shortName(get(existing[0]))}`;
        }
      }
    }

    if (editing) {
      f.gender.value = editing.gender || 'unknown';
      for (const k of ['firstName', 'middleName', 'lastName', 'maidenName', 'photo', 'bio']) f[k].value = editing[k] || '';
      f.birthDate.value = fmtDate(editing.birth?.date);
      f.birthPlace.value = editing.birth?.place || '';
      f.deceased.checked = isDeceased(editing);
      f.deathDate.value = fmtDate(editing.death?.date);
      f.deathPlace.value = editing.death?.place || '';
      for (const ev of editing.events || []) $('#eventRows').appendChild(eventRow(ev));
      if (editing.photo || editing.bio || (editing.events || []).length) personForm.querySelector('details.more').open = true;
    }
    $('#deathFields').hidden = !f.deceased.checked;
    personDialog.showModal();
    f.firstName.focus();
  }

  // Read a date field. Returns the stored form (1948-05-12, 1948-05, 1948 or null),
  // or undefined if the text isn't a date. Marks the field red when it can't be read.
  function readDate(input) {
    const result = FamilyDates.parse(input.value);
    input.classList.toggle('invalid', !!result.error);
    input.title = result.error || '';
    return result.error ? undefined : result.value;
  }

  // Check every date field in a form and show the first problem.
  function checkDates(inputs, errEl) {
    for (const input of inputs) {
      const result = FamilyDates.parse(input.value);
      readDate(input);
      if (result.error) {
        errEl.textContent = result.error;
        errEl.hidden = false;
        input.focus();
        return false;
      }
    }
    return true;
  }

  // When someone leaves a date field, tidy what they typed ("may 12, 1948" becomes "12 May 1948")
  // so they can see how it was understood.
  document.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-date]');
    if (!input) return;
    const value = readDate(input);
    if (value) input.value = fmtDate(value);
  });

  personForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = personForm.elements;
    const err = $('#personError');
    err.hidden = true;

    const dateInputs = [f.birthDate, f.deathDate, f.marriageDate, ...$$('#eventRows input[data-f="date"]')];
    if (!checkDates(dateInputs, err)) return;
    if (!f.firstName.value.trim() && !f.lastName.value.trim()) {
      err.textContent = 'Add at least a first or last name.';
      err.hidden = false;
      f.firstName.focus();
      return;
    }

    const body = {
      firstName: f.firstName.value, middleName: f.middleName.value, lastName: f.lastName.value, maidenName: f.maidenName.value,
      gender: f.gender.value,
      birth: { date: readDate(f.birthDate), place: f.birthPlace.value },
      living: !f.deceased.checked,
      death: f.deceased.checked ? { date: readDate(f.deathDate), place: f.deathPlace.value } : null,
      photo: f.photo.value, bio: f.bio.value,
      events: $$('#eventRows .event-row').map((row) => {
        const val = (k) => row.querySelector(`[data-f="${k}"]`).value.trim();
        const ev = { type: val('type'), date: readDate(row.querySelector('[data-f="date"]')), place: val('place'), note: val('note'), endDate: val('endDate') || null };
        if (row.dataset.id) ev.id = row.dataset.id;
        return ev;
      }).filter((ev) => ev.date || ev.place || ev.note)
    };

    const { personId, relation, anchorId } = personCtx;
    const btn = $('#personSubmit');
    btn.disabled = true;
    try {
      if (personId) {
        await run(() => api('PUT', `/api/people/${personId}`, body), 'Changes saved');
      } else {
        if (relation === 'parent') {
          body.children = [anchorId];
          const existing = parentsOf(anchorId);
          if (!$('#coParentRow').hidden && f.coParent.checked) body.spouses = [{ id: existing[0] }];
        } else if (relation === 'child') {
          body.parents = [anchorId, f.otherParent.value].filter(Boolean);
        } else if (relation === 'partner') {
          body.spouses = [{ id: anchorId, marriageDate: readDate(f.marriageDate), marriagePlace: f.marriagePlace.value }];
        } else if (relation === 'sibling') {
          body.parents = parentsOf(anchorId);
        }
        const created = await run(() => api('POST', '/api/people', body), relation ? 'Relative added' : 'Person added', relation ? null : undefined);
        if (!relation && created) go(created.id);
      }
      personDialog.close();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* ======================================================== link dialog */
  const linkDialog = $('#linkDialog');
  const linkForm = $('#linkForm');
  let linkCtx = null;

  function fillLinkOptions() {
    const { anchorId } = linkCtx;
    const rel = linkForm.elements.relation.value;
    const q = $('#linkFilter').value.trim().toLowerCase();
    const exclude = new Set([anchorId, ...parentsOf(anchorId), ...childrenOf(anchorId), ...spousesOf(anchorId)]);
    const people = [...state.people.values()]
      .filter((p) => !exclude.has(p.id))
      .filter((p) => !q || `${fullName(p)} ${p.maidenName}`.toLowerCase().includes(q))
      .sort((a, b) => shortName(a).localeCompare(shortName(b)));
    $('#linkPerson').innerHTML = people.length
      ? people.map((p) => `<option value="${esc(p.id)}">${esc(fullName(p))} (${esc(lifeShort(p))})</option>`).join('')
      : '<option disabled>No matching people</option>';
    if (people.length) $('#linkPerson').selectedIndex = 0;
    $('#linkMarriage').hidden = rel !== 'partner';
    $('#linkSubmit').disabled = !people.length;
  }

  function openLinkDialog(anchorId, { partnerId = null } = {}) {
    linkCtx = { anchorId, partnerId };
    linkForm.reset();
    $('#linkError').hidden = true;
    $$('.invalid', linkForm).forEach((el) => el.classList.remove('invalid'));
    const anchor = get(anchorId);
    $('#linkAnchorName').textContent = shortName(anchor);
    if (partnerId) {
      const s = partnership(anchorId, partnerId) || {};
      $('#linkTitle').textContent = `${shortName(anchor)} and ${shortName(get(partnerId))}`;
      $('#linkPick').hidden = true;
      $('#linkMarriage').hidden = false;
      linkForm.elements.marriageDate.value = fmtDate(s.marriageDate);
      linkForm.elements.marriagePlace.value = s.marriagePlace || '';
      linkForm.elements.divorceDate.value = fmtDate(s.divorceDate);
      $('#linkSubmit').textContent = 'Save changes';
      $('#linkSubmit').disabled = false;
    } else {
      $('#linkTitle').textContent = 'Link an existing relative';
      $('#linkPick').hidden = false;
      $('#linkSubmit').textContent = 'Link';
      fillLinkOptions();
    }
    linkDialog.showModal();
    (partnerId ? linkForm.elements.marriageDate : $('#linkFilter')).focus();
  }
  $('#linkFilter').addEventListener('input', fillLinkOptions);
  $$('input[name="relation"]', linkForm).forEach((r) => r.addEventListener('change', fillLinkOptions));
  $('#linkPerson').addEventListener('dblclick', () => linkForm.requestSubmit());

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = linkForm.elements;
    const err = $('#linkError');
    err.hidden = true;
    const { anchorId, partnerId } = linkCtx;
    const rel = partnerId ? 'partner' : f.relation.value;
    const otherId = partnerId || $('#linkPerson').value;
    if (rel === 'partner' && !checkDates([f.marriageDate, f.divorceDate], err)) return;
    if (!otherId) return;
    const details = { marriageDate: readDate(f.marriageDate), marriagePlace: f.marriagePlace.value, divorceDate: readDate(f.divorceDate) };
    try {
      if (partnerId) await run(() => api('PUT', `/api/people/${anchorId}/spouses/${partnerId}`, details), 'Changes saved');
      else if (rel === 'parent') await run(() => api('POST', `/api/people/${anchorId}/parents`, { parentId: otherId }), 'Parent linked');
      else if (rel === 'child') await run(() => api('POST', `/api/people/${anchorId}/children`, { childId: otherId }), 'Child linked');
      else await run(() => api('POST', `/api/people/${anchorId}/spouses`, { spouseId: otherId, ...details }), 'Partner linked');
      linkDialog.close();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  /* ======================================================== confirm, toast, misc */
  function confirmBox(title, text, okLabel) {
    const d = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel;
    d.returnValue = '';
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
  }

  function toast(msg, error = false) {
    const el = document.createElement('div');
    el.className = `toast${error ? ' error' : ''}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), error ? 5000 : 2600);
  }

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  $('#addPersonBtn').onclick = () => openPersonDialog();
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="add-first"]')) openPersonDialog(); });

  // Rename the tree inline
  $('#familyName').addEventListener('click', () => {
    const span = $('#familyNameText');
    if (span.querySelector('input')) return;
    const input = document.createElement('input');
    input.value = state.meta.name || '';
    input.setAttribute('aria-label', 'Tree name');
    input.style.cssText = 'font:inherit;color:inherit;background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:0 6px;width:14ch';
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      span.textContent = state.meta.name || 'Our Family';
      if (save && name && name !== state.meta.name) await run(() => api('PUT', '/api/meta', { name }), 'Tree renamed').catch(() => {});
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  });

  /* ======================================================== search */
  const searchInput = $('#searchInput');
  const results = $('#searchResults');
  let active = -1;

  function showResults() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { results.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); return; }
    const hits = [...state.people.values()]
      .filter((p) => `${fullName(p)} ${p.maidenName} ${p.nickname}`.toLowerCase().includes(q))
      .slice(0, 8);
    active = hits.length ? 0 : -1;
    results.innerHTML = hits.length
      ? hits.map((p, i) => `<li role="option" data-id="${esc(p.id)}" aria-selected="${i === 0}">${avatarHTML(p)}<div><div class="r-name">${esc(fullName(p))}</div><div class="r-life">${esc(lifeShort(p))}${p.birth?.place ? `, ${esc(p.birth.place)}` : ''}</div></div></li>`).join('')
      : '<li class="none">No one by that name yet</li>';
    results.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function pickResult(id) {
    searchInput.value = '';
    results.hidden = true;
    searchInput.blur();
    go(id);
  }

  searchInput.addEventListener('input', showResults);
  searchInput.addEventListener('keydown', (e) => {
    const items = $$('li[data-id]', results);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute('aria-selected', i === active));
    } else if (e.key === 'Enter' && items[active]) {
      pickResult(items[active].dataset.id);
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      results.hidden = true;
    }
  });
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) { e.preventDefault(); pickResult(li.dataset.id); }
  });
  searchInput.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 120));

  /* ======================================================== start */
  // dates.js holds the date reading/formatting code. Load it here too, in case index.html
  // is an older copy that doesn't include it.
  function ensureDates() {
    if (window.FamilyDates) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'dates.js';
      script.onload = () => (window.FamilyDates ? resolve() : reject());
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function init() {
    try {
      await ensureDates();
    } catch {
      const msg = 'The file public/dates.js is missing. Copy it from the latest download into your public folder, then reload this page.';
      document.body.insertAdjacentHTML('afterbegin', `<div role="alert" style="background:#a5352f;color:#fff;padding:12px 18px;font-weight:700">${msg}</div>`);
      return;
    }
    try {
      await reload();
    } catch (err) {
      toast(`Could not load the tree: ${err.message}`, true);
      return;
    }
    $('#familyNameText').textContent = state.meta.name || 'Our Family';
    document.title = `${state.meta.name || 'Family'} tree`;
    const fromHash = location.hash.replace(/^#\//, '');
    state.focusId = state.people.has(fromHash) ? fromHash : state.meta.rootPersonId;
    if (mobile.matches) panel.classList.add('collapsed');
    render({ instant: true });
    fitZoom();
    centerOnFocus(false);
    renderPanel();
  }

  window.addEventListener('resize', () => centerOnFocus(false));
  init();
})();
