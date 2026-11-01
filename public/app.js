/* Cook Book. — Minimalist Personal Recipe & Automatic Proportion Scaler */

const UNIT_DEFS = {
  mg: { family: 'mass', toBase: 0.001 },
  g: { family: 'mass', toBase: 1 },
  kg: { family: 'mass', toBase: 1000 },
  oz: { family: 'mass', toBase: 28.3495 },
  lb: { family: 'mass', toBase: 453.592 },
  ml: { family: 'volume', toBase: 1 },
  l: { family: 'volume', toBase: 1000 },
  tsp: { family: 'volume', toBase: 5 },
  tbsp: { family: 'volume', toBase: 15 },
  cup: { family: 'volume', toBase: 240 },
  pcs: { family: 'count', toBase: 1 },
  cloves: { family: 'count', toBase: 1 },
  slices: { family: 'count', toBase: 1 },
  stalks: { family: 'count', toBase: 1 },
  pinch: { family: 'count', toBase: 1 }
};

const ALL_UNITS = Object.keys(UNIT_DEFS);

const state = {
  recipes: [],
  activeRecipeId: null,
  categoryFilter: 'ALL',
  searchQuery: '',
  activeLinkIndex: 0,
  checkedSteps: {},
  scale: {
    factor: 1,
    anchorIngredientId: null,
    unitOverrides: {},
    smartUnits: true
  },
  serverInfo: null
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function roundNice(val) {
  if (!Number.isFinite(val) || val === 0) return 0;
  if (Math.abs(val) >= 100) return Math.round(val * 10) / 10;
  if (Math.abs(val) >= 10) return Math.round(val * 100) / 100;
  return Math.round(val * 1000) / 1000;
}

function convertAmountBetweenUnits(amount, fromUnit, toUnit) {
  const uFrom = UNIT_DEFS[String(fromUnit || '').toLowerCase()];
  const uTo = UNIT_DEFS[String(toUnit || '').toLowerCase()];
  if (!uFrom || !uTo || uFrom.family !== uTo.family) return amount;
  return (amount * uFrom.toBase) / uTo.toBase;
}

function computeSmartUnitBadge(scaledVal, unit) {
  if (!state.scale.smartUnits) return null;
  const u = String(unit || '').toLowerCase();
  if (u === 'g' && scaledVal >= 1000) return `${roundNice(scaledVal / 1000)} kg`;
  if (u === 'kg' && scaledVal > 0 && scaledVal < 0.1) return `${roundNice(scaledVal * 1000)} g`;
  if (u === 'ml' && scaledVal >= 1000) return `${roundNice(scaledVal / 1000)} L`;
  if (u === 'l' && scaledVal > 0 && scaledVal < 0.1) return `${roundNice(scaledVal * 1000)} ml`;
  if (u === 'tsp' && scaledVal >= 3 && scaledVal % 3 === 0) return `${roundNice(scaledVal / 3)} tbsp`;
  return null;
}

function resetScale() {
  state.scale.factor = 1;
  state.scale.anchorIngredientId = null;
  state.scale.unitOverrides = {};
}

function getActiveRecipe() {
  if (!state.recipes.length) return null;
  return state.recipes.find((r) => r.id === state.activeRecipeId) || state.recipes[0];
}

function getFilteredRecipes() {
  const q = state.searchQuery.trim().toLowerCase();
  return state.recipes.filter((r) => {
    if (state.categoryFilter !== 'ALL' && (r.category || 'General') !== state.categoryFilter) {
      return false;
    }
    if (q) {
      const hay = [
        r.title,
        r.category,
        r.chefNotes,
        ...(r.ingredients || []).map((i) => `${i.name} ${i.unit} ${i.notes}`)
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function parseYouTubeId(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const parts = u.pathname.split('/').filter(Boolean);
    const sIdx = parts.indexOf('shorts');
    if (sIdx !== -1 && parts[sIdx + 1]) return parts[sIdx + 1];
    const eIdx = parts.indexOf('embed');
    if (eIdx !== -1 && parts[eIdx + 1]) return parts[eIdx + 1];
  } catch (_) {}
  return null;
}

function parseTikTokVideoId(urlStr) {
  const m = String(urlStr || '').match(/\/(?:video|v)\/(\d{10,25})/);
  return m ? m[1] : null;
}

/* ---------- RENDERING ---------- */

function renderAll() {
  renderSidebar();
  renderMainWorkspace();
}

function renderSidebar() {
  const countEl = document.getElementById('sidebarRecipeCount');
  if (countEl) countEl.textContent = String(state.recipes.length);

  // Category filter pills built only from user's actual recipes
  const catBar = document.getElementById('categoryFilterBar');
  if (catBar) {
    const cats = Array.from(new Set(state.recipes.map((r) => r.category || 'General')));
    if (cats.length <= 1) {
      catBar.innerHTML = '';
    } else {
      catBar.innerHTML = [
        `<button type="button" class="cat-pill ${state.categoryFilter === 'ALL' ? 'active' : ''}" data-cat="ALL">All</button>`,
        ...cats.map(
          (c) =>
            `<button type="button" class="cat-pill ${state.categoryFilter === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
        )
      ].join('');

      catBar.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.categoryFilter = btn.getAttribute('data-cat') || 'ALL';
          renderAll();
        });
      });
    }
  }

  const listEl = document.getElementById('sidebarRecipeList');
  if (!listEl) return;

  if (!state.recipes.length) {
    listEl.innerHTML = `
      <div class="sidebar-empty-hint">
        <strong>Your recipe list is empty.</strong><br/>
        Click <strong>+ New Recipe</strong> to save your first recipe!
      </div>
    `;
    return;
  }

  const filtered = getFilteredRecipes();
  if (!filtered.length) {
    listEl.innerHTML = `<div class="sidebar-empty-hint">No matching recipes found.</div>`;
    return;
  }

  const active = getActiveRecipe();
  listEl.innerHTML = filtered
    .map((r) => {
      const isSelected = active && active.id === r.id;
      const ingCount = (r.ingredients || []).length;
      const linkCount = (r.links || []).length;
      return `
        <div class="recipe-list-item ${isSelected ? 'active' : ''}" data-select-id="${escapeHtml(r.id)}">
          <div class="recipe-item-title">${escapeHtml(r.title)}</div>
          <div class="recipe-item-meta">
            ${escapeHtml(r.category || 'General')} • ${ingCount} ingredient${ingCount === 1 ? '' : 's'}${linkCount ? ' • 🎬 Video/Link' : ''}
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-select-id]').forEach((el) => {
    el.addEventListener('click', () => {
      state.activeRecipeId = el.getAttribute('data-select-id');
      state.activeLinkIndex = 0;
      resetScale();
      renderAll();
    });
  });
}

function renderMainWorkspace() {
  const mainEl = document.getElementById('mainWorkspace');
  if (!mainEl) return;

  // GUIDED EMPTY STATE WHEN 0 RECIPES EXIST
  if (!state.recipes.length) {
    mainEl.innerHTML = `
      <div class="empty-guide-card">
        <span class="empty-guide-eyebrow">Welcome to Your Personal CookBook</span>
        <h1 class="empty-guide-title">Start by adding your first recipe</h1>
        <p class="empty-guide-sub">
          Everything is clean and empty so you can build your own personal recipe collection on this PC. Here is how it works:
        </p>

        <div class="guide-steps-grid">
          <div class="guide-step-box">
            <span class="guide-step-num">Step 1</span>
            <h3>Enter Your Base Recipe</h3>
            <p>Click the orange button below to enter your recipe title and base ingredients (like <code>1 kg Pork</code> and <code>1 tbsp Soy Sauce</code>).</p>
          </div>
          <div class="guide-step-box">
            <span class="guide-step-num">Step 2</span>
            <h3>Auto-Scale Portions</h3>
            <p>When cooking, type a new number into <strong>any ingredient box</strong> (e.g. change <code>1 kg</code> to <code>2 kg</code>) and every other ingredient scales automatically.</p>
          </div>
          <div class="guide-step-box">
            <span class="guide-step-num">Step 3</span>
            <h3>Attach YouTube or TikTok</h3>
            <p>Paste a YouTube, TikTok, or website link onto any recipe to watch the video right inside this window or open the source page.</p>
          </div>
        </div>

        <button type="button" class="btn-primary" id="emptyStateAddFirstBtn" style="font-size:0.95rem;padding:11px 22px;">
          + Add My First Recipe
        </button>
      </div>
    `;
    document.getElementById('emptyStateAddFirstBtn')?.addEventListener('click', () => {
      openRecipeModal(null);
    });
    return;
  }

  const recipe = getActiveRecipe();
  if (!recipe) return;

  const factor = roundNice(state.scale.factor);
  const isScaled = Math.abs(state.scale.factor - 1) >= 0.005;

  mainEl.innerHTML = `
    <!-- RECIPE HEADER -->
    <div class="recipe-header-card">
      <div class="recipe-header-left">
        ${recipe.imageUrl ? `<img class="recipe-photo-thumb" src="${escapeHtml(recipe.imageUrl)}" alt="${escapeHtml(recipe.title)}" />` : ''}
        <div>
          <span class="recipe-category-badge">${escapeHtml(recipe.category || 'General')}</span>
          <h1 class="recipe-main-title">${escapeHtml(recipe.title)}</h1>
          <div class="recipe-sub-meta">
            Base Servings: <strong>${roundNice(recipe.baseServings || 1)}</strong>
            ${recipe.prepTimeMin ? ` • Cook Time: <strong>${escapeHtml(recipe.prepTimeMin)} mins</strong>` : ''}
          </div>
        </div>
      </div>

      <div class="recipe-header-actions">
        <button type="button" class="btn-secondary" id="editCurrentRecipeBtn">✏️ Edit Recipe</button>
      </div>
    </div>

    <div class="recipe-workspace-grid">
      <!-- LEFT COLUMN: AUTOMATIC PROPORTION SCALER -->
      <div>
        <section class="section-card">
          <div class="section-bar">
            <span class="section-bar-title">⚖️ Automatic Ingredient Proportion Scaler</span>
            <span class="section-bar-pill" id="scaleBadgePill">${factor}× ${isScaled ? 'Scaled' : 'Base'}</span>
          </div>
          <div class="section-body">
            <div class="howto-callout">
              💡 <strong>Where to scale:</strong> Click inside any ingredient's number box below and type the amount you have (for example, change <code>1</code> to <code>2</code>)—all other ingredients will adjust automatically.
            </div>

            <div class="scaler-toolbar">
              <div class="mult-group">
                <span class="mult-label">Quick Multiply:</span>
                <button type="button" class="mult-pill ${Math.abs(factor - 0.5) < 0.01 ? 'active' : ''}" data-mult="0.5">0.5×</button>
                <button type="button" class="mult-pill ${Math.abs(factor - 1) < 0.01 ? 'active' : ''}" data-mult="1">1× (Original)</button>
                <button type="button" class="mult-pill ${Math.abs(factor - 1.5) < 0.01 ? 'active' : ''}" data-mult="1.5">1.5×</button>
                <button type="button" class="mult-pill ${Math.abs(factor - 2) < 0.01 ? 'active' : ''}" data-mult="2">2×</button>
                <button type="button" class="mult-pill ${Math.abs(factor - 3) < 0.01 ? 'active' : ''}" data-mult="3">3×</button>
              </div>

              <label class="smart-toggle">
                <input type="checkbox" id="smartUnitsCheckbox" ${state.scale.smartUnits ? 'checked' : ''} />
                <span>Smart Units (1000g → 1kg)</span>
              </label>
            </div>

            <div class="scale-active-banner ${isScaled ? '' : 'hidden'}" id="scaleStatusBanner">
              <span id="scaleStatusText">Currently scaled to <strong>${factor}×</strong></span>
              <div class="scale-banner-btns">
                <button type="button" class="btn-secondary-sm" id="resetScaleBtn">↺ Reset to 1×</button>
                <button type="button" class="btn-secondary-sm" id="saveScaledAsBaseBtn" title="Overwrite base recipe with these scaled amounts">💾 Save as New Base</button>
              </div>
            </div>

            <div class="ing-list" id="scalerIngredientsList"></div>

            <!-- Inline Quick Add Ingredient -->
            <form class="inline-add-form" id="quickAddIngredientForm">
              <input type="text" id="quickIngName" placeholder="+ Add ingredient (e.g. Garlic)" required />
              <input type="number" id="quickIngAmount" placeholder="Amount" step="any" min="0" required />
              <select id="quickIngUnit" aria-label="Unit">
                ${ALL_UNITS.map((u) => `<option value="${escapeHtml(u)}" ${u === 'tbsp' ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
              </select>
              <button type="submit" class="btn-secondary-sm">+ Add</button>
            </form>
          </div>
        </section>
      </div>

      <!-- RIGHT COLUMN: VIDEO/LINKS & COOKING STEPS -->
      <div>
        <!-- VIDEO & RECIPE LINKS -->
        <section class="section-card">
          <div class="section-bar">
            <span class="section-bar-title">🎬 YouTube, TikTok &amp; Recipe Links</span>
            <span class="section-bar-pill">${(recipe.links || []).length} Link${(recipe.links || []).length === 1 ? '' : 's'}</span>
          </div>
          <div class="section-body">
            <form class="link-add-bar" id="quickAddLinkForm">
              <input type="url" id="quickLinkUrl" placeholder="Paste YouTube, TikTok, or website link here..." required />
              <input type="text" id="quickLinkTitle" placeholder="Label (optional)" />
              <button type="submit" class="btn-secondary-sm">+ Attach Link</button>
            </form>

            <div class="link-tabs" id="videoLinkTabs"></div>
            <div id="videoEmbedStage"></div>
          </div>
        </section>

        <!-- COOKING STEPS & NOTES -->
        <section class="section-card">
          <div class="section-bar">
            <span class="section-bar-title">🍳 Cooking Steps &amp; Personal Notes</span>
          </div>
          <div class="section-body">
            <ol class="steps-list" id="studioStepsList"></ol>

            <div class="notes-box">
              <div class="notes-header">
                <span>📝 Personal Notes</span>
                <button type="button" class="btn-secondary-sm" id="saveChefNotesBtn">Save Notes</button>
              </div>
              <textarea id="studioChefNotesInput" rows="3" placeholder="Type any personal reminders or adjustments for this recipe...">${escapeHtml(recipe.chefNotes || '')}</textarea>
              <div id="notesSavedIndicator" class="hidden" style="color:#1b7e3c;font-size:0.75rem;font-weight:700;margin-top:4px;">✓ Notes saved</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  renderIngredientsRows(recipe);
  renderStepsList(recipe);
  renderVideoLinks(recipe);
  bindWorkspaceControls(recipe);
}

function renderIngredientsRows(recipe) {
  const listEl = document.getElementById('scalerIngredientsList');
  if (!listEl) return;

  const ings = recipe.ingredients || [];
  if (!ings.length) {
    listEl.innerHTML = `<div class="sidebar-empty-hint">No ingredients yet. Use the "+ Add ingredient" row below to add your first ingredient.</div>`;
    return;
  }

  listEl.innerHTML = ings
    .map((ing) => {
      const selectedUnit = state.scale.unitOverrides[ing.id] || ing.unit || 'g';
      const baseInUnit = convertAmountBetweenUnits(Number(ing.amount) || 0, ing.unit, selectedUnit);
      const scaledVal = roundNice(baseInUnit * state.scale.factor);
      const smartBadge = computeSmartUnitBadge(scaledVal, selectedUnit);
      const isAnchor = state.scale.anchorIngredientId === ing.id;

      const baseDef = UNIT_DEFS[String(ing.unit || '').toLowerCase()];
      const compatibleUnits = baseDef
        ? ALL_UNITS.filter((u) => UNIT_DEFS[u].family === baseDef.family)
        : [ing.unit || 'pcs'];
      if (ing.unit && !compatibleUnits.includes(ing.unit)) compatibleUnits.unshift(ing.unit);

      return `
        <div class="ing-row ${isAnchor ? 'anchor-active' : ''}" data-ing-row="${escapeHtml(ing.id)}">
          <div>
            <div class="ing-name">${escapeHtml(ing.name)}${ing.notes ? ` <span style="font-weight:400;color:var(--ink-muted);">(${escapeHtml(ing.notes)})</span>` : ''}</div>
            <div class="ing-base-sub">Base (1×): ${roundNice(ing.amount)} ${escapeHtml(ing.unit)}</div>
          </div>

          <div class="ing-controls">
            <input
              type="number"
              step="any"
              min="0"
              class="ing-amount-input"
              data-ing-id="${escapeHtml(ing.id)}"
              value="${scaledVal}"
              title="Type a new amount here to scale the entire recipe"
            />
            <select class="ing-unit-select" data-ing-unit="${escapeHtml(ing.id)}">
              ${compatibleUnits
                .map((u) => `<option value="${escapeHtml(u)}" ${u === selectedUnit ? 'selected' : ''}>${escapeHtml(u)}</option>`)
                .join('')}
            </select>
            <span class="ing-smart-badge ${smartBadge ? '' : 'hidden'}" data-smart-badge="${escapeHtml(ing.id)}">= ${escapeHtml(smartBadge || '')}</span>
          </div>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('.ing-amount-input').forEach((inputEl) => {
    inputEl.addEventListener('input', (e) => {
      const ingId = inputEl.getAttribute('data-ing-id');
      const rawVal = parseFloat(e.target.value);
      if (!Number.isFinite(rawVal) || rawVal < 0) return;

      const ing = (recipe.ingredients || []).find((i) => i.id === ingId);
      if (!ing) return;
      const selectedUnit = state.scale.unitOverrides[ingId] || ing.unit;
      const baseInSelected = convertAmountBetweenUnits(Number(ing.amount) || 0, ing.unit, selectedUnit);
      if (baseInSelected <= 0) return;

      state.scale.factor = Math.max(0.01, rawVal / baseInSelected);
      state.scale.anchorIngredientId = ingId;
      updateIngredientValuesInPlace(recipe, inputEl);
    });
  });

  listEl.querySelectorAll('.ing-unit-select').forEach((selEl) => {
    selEl.addEventListener('change', () => {
      const ingId = selEl.getAttribute('data-ing-unit');
      state.scale.unitOverrides[ingId] = selEl.value;
      updateIngredientValuesInPlace(recipe, null);
    });
  });
}

function updateIngredientValuesInPlace(recipe, skipInputEl = null) {
  const listEl = document.getElementById('scalerIngredientsList');
  if (!listEl) return;

  for (const ing of recipe.ingredients || []) {
    const rowEl = listEl.querySelector(`[data-ing-row="${CSS.escape(ing.id)}"]`);
    const inputEl = listEl.querySelector(`.ing-amount-input[data-ing-id="${CSS.escape(ing.id)}"]`);
    const badgeEl = listEl.querySelector(`[data-smart-badge="${CSS.escape(ing.id)}"]`);

    const isAnchor = state.scale.anchorIngredientId === ing.id;
    if (rowEl) rowEl.classList.toggle('anchor-active', isAnchor);

    const selectedUnit = state.scale.unitOverrides[ing.id] || ing.unit || 'g';
    const baseInUnit = convertAmountBetweenUnits(Number(ing.amount) || 0, ing.unit, selectedUnit);
    const scaledVal = roundNice(baseInUnit * state.scale.factor);

    if (inputEl && inputEl !== skipInputEl) {
      inputEl.value = String(scaledVal);
    }

    const smartBadge = computeSmartUnitBadge(scaledVal, selectedUnit);
    if (badgeEl) {
      if (smartBadge) {
        badgeEl.textContent = `= ${smartBadge}`;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  }

  const factor = roundNice(state.scale.factor);
  const isScaled = Math.abs(state.scale.factor - 1) >= 0.005;

  const pill = document.getElementById('scaleBadgePill');
  if (pill) pill.textContent = `${factor}× ${isScaled ? 'Scaled' : 'Base'}`;

  document.querySelectorAll('.mult-pill').forEach((btn) => {
    const m = parseFloat(btn.getAttribute('data-mult'));
    btn.classList.toggle('active', Math.abs(m - state.scale.factor) < 0.01);
  });

  const banner = document.getElementById('scaleStatusBanner');
  const bannerText = document.getElementById('scaleStatusText');
  if (banner && bannerText) {
    banner.classList.toggle('hidden', !isScaled);
    bannerText.innerHTML = `Scaled to <strong>${factor}×</strong>`;
  }
}

function renderStepsList(recipe) {
  const stepsEl = document.getElementById('studioStepsList');
  if (!stepsEl) return;

  const steps = recipe.steps || [];
  if (!steps.length) {
    stepsEl.innerHTML = `<li class="sidebar-empty-hint">No cooking steps added yet. Click "Edit Recipe" above to add steps.</li>`;
    return;
  }

  const checkedMap = state.checkedSteps[recipe.id] || {};
  stepsEl.innerHTML = steps
    .map((s, idx) => {
      const checked = Boolean(checkedMap[s.id]);
      return `
        <li class="step-row ${checked ? 'checked' : ''}" data-step-id="${escapeHtml(s.id)}">
          <span class="step-num">${checked ? '✓' : idx + 1}</span>
          <span>${escapeHtml(s.text)}</span>
        </li>
      `;
    })
    .join('');

  stepsEl.querySelectorAll('[data-step-id]').forEach((li) => {
    li.addEventListener('click', () => {
      const sId = li.getAttribute('data-step-id');
      if (!state.checkedSteps[recipe.id]) state.checkedSteps[recipe.id] = {};
      state.checkedSteps[recipe.id][sId] = !state.checkedSteps[recipe.id][sId];
      renderStepsList(recipe);
    });
  });
}

function renderVideoLinks(recipe) {
  const tabsEl = document.getElementById('videoLinkTabs');
  const stageEl = document.getElementById('videoEmbedStage');
  if (!tabsEl || !stageEl) return;

  const links = recipe.links || [];
  if (state.activeLinkIndex >= links.length) state.activeLinkIndex = 0;

  if (!links.length) {
    tabsEl.innerHTML = '';
    stageEl.innerHTML = `
      <div class="sidebar-empty-hint">
        No video or website link attached yet. Paste a YouTube, TikTok, or website link in the box above to watch or save it here.
      </div>
    `;
    return;
  }

  tabsEl.innerHTML = links
    .map((lnk, idx) => {
      const icon = lnk.platform === 'youtube' ? '▶ YouTube' : lnk.platform === 'tiktok' ? '🎵 TikTok' : '🔗 Link';
      return `
        <button type="button" class="link-tab ${idx === state.activeLinkIndex ? 'active' : ''}" data-link-idx="${idx}">
          <span>${icon}: ${escapeHtml(lnk.title)}</span>
          <span class="link-remove" data-remove-link="${escapeHtml(lnk.id)}" title="Remove link">✕</span>
        </button>
      `;
    })
    .join('');

  tabsEl.querySelectorAll('[data-link-idx]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const remId = e.target.getAttribute('data-remove-link');
      if (remId) {
        e.stopPropagation();
        const nextLinks = (recipe.links || []).filter((l) => l.id !== remId);
        await saveRecipeToServer({ ...recipe, links: nextLinks }, recipe.id);
        return;
      }
      state.activeLinkIndex = Number(btn.getAttribute('data-link-idx')) || 0;
      renderVideoLinks(recipe);
    });
  });

  const activeLink = links[state.activeLinkIndex];
  const ytId = parseYouTubeId(activeLink.url);
  const tiktokId = parseTikTokVideoId(activeLink.url);

  if (ytId) {
    stageEl.innerHTML = `
      <div class="video-stage">
        <div class="embed-frame-wrap">
          <iframe
            src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?rel=0"
            title="${escapeHtml(activeLink.title)}"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
        <div class="embed-bottom-bar">
          <span>▶ ${escapeHtml(activeLink.title)}</span>
          <a class="ext-link-btn" href="${escapeHtml(activeLink.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>
        </div>
      </div>
    `;
    return;
  }

  if (tiktokId) {
    stageEl.innerHTML = `
      <div class="video-stage">
        <div class="embed-frame-wrap tiktok-ratio">
          <iframe
            src="https://www.tiktok.com/embed/v2/${encodeURIComponent(tiktokId)}"
            title="${escapeHtml(activeLink.title)}"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="encrypted-media;"
            allowfullscreen
          ></iframe>
        </div>
        <div class="embed-bottom-bar">
          <span>🎵 ${escapeHtml(activeLink.title)}</span>
          <a class="ext-link-btn" href="${escapeHtml(activeLink.url)}" target="_blank" rel="noopener noreferrer">Open on TikTok ↗</a>
        </div>
      </div>
    `;
    return;
  }

  stageEl.innerHTML = `
    <div class="video-stage" style="background:#fff;color:var(--ink);">
      <div style="padding:16px;">
        <div style="font-weight:800;margin-bottom:4px;">${escapeHtml(activeLink.title)}</div>
        <div style="font-size:0.78rem;color:var(--ink-muted);word-break:break-all;margin-bottom:12px;">${escapeHtml(activeLink.url)}</div>
        <a class="ext-link-btn" href="${escapeHtml(activeLink.url)}" target="_blank" rel="noopener noreferrer">Open Original Recipe Link ↗</a>
      </div>
    </div>
  `;
}

function bindWorkspaceControls(recipe) {
  document.getElementById('editCurrentRecipeBtn')?.addEventListener('click', () => {
    openRecipeModal(recipe);
  });

  document.querySelectorAll('.mult-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = parseFloat(btn.getAttribute('data-mult'));
      if (!Number.isFinite(m) || m <= 0) return;
      state.scale.factor = m;
      state.scale.anchorIngredientId = null;
      updateIngredientValuesInPlace(recipe, null);
    });
  });

  document.getElementById('smartUnitsCheckbox')?.addEventListener('change', (e) => {
    state.scale.smartUnits = e.target.checked;
    updateIngredientValuesInPlace(recipe, null);
  });

  document.getElementById('resetScaleBtn')?.addEventListener('click', () => {
    resetScale();
    renderMainWorkspace();
  });

  document.getElementById('saveScaledAsBaseBtn')?.addEventListener('click', async () => {
    const updatedIngredients = (recipe.ingredients || []).map((ing) => {
      const targetUnit = state.scale.unitOverrides[ing.id] || ing.unit;
      const baseInTarget = convertAmountBetweenUnits(ing.amount, ing.unit, targetUnit);
      return {
        ...ing,
        amount: roundNice(baseInTarget * state.scale.factor),
        unit: targetUnit
      };
    });
    const newServings = roundNice((recipe.baseServings || 1) * state.scale.factor);
    resetScale();
    await saveRecipeToServer(
      { ...recipe, baseServings: newServings, ingredients: updatedIngredients },
      recipe.id
    );
  });

  document.getElementById('quickAddIngredientForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('quickIngName').value.trim();
    const amt = parseFloat(document.getElementById('quickIngAmount').value);
    const unit = document.getElementById('quickIngUnit').value;
    if (!name || !Number.isFinite(amt)) return;

    const baseAmt = roundNice(amt / (state.scale.factor || 1));
    const nextIngs = [
      ...(recipe.ingredients || []),
      { id: `ing-${Date.now()}`, name, amount: baseAmt, unit, notes: '' }
    ];
    await saveRecipeToServer({ ...recipe, ingredients: nextIngs }, recipe.id);
  });

  document.getElementById('quickAddLinkForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('quickLinkUrl').value.trim();
    const titleRaw = document.getElementById('quickLinkTitle').value.trim();
    if (!url) return;
    const isYt = url.includes('youtube.com') || url.includes('youtu.be');
    const isTt = url.includes('tiktok.com');
    const title = titleRaw || (isYt ? 'YouTube Video' : isTt ? 'TikTok Video' : 'Recipe Link');
    const nextLinks = [...(recipe.links || []), { id: `lnk-${Date.now()}`, title, url }];
    state.activeLinkIndex = nextLinks.length - 1;
    await saveRecipeToServer({ ...recipe, links: nextLinks }, recipe.id);
  });

  document.getElementById('saveChefNotesBtn')?.addEventListener('click', async () => {
    const notes = document.getElementById('studioChefNotesInput')?.value || '';
    await saveRecipeToServer({ ...recipe, chefNotes: notes }, recipe.id);
    const ind = document.getElementById('notesSavedIndicator');
    if (ind) {
      ind.classList.remove('hidden');
      setTimeout(() => ind.classList.add('hidden'), 2000);
    }
  });
}

/* ---------- SERVER API ---------- */

async function fetchInitialData() {
  try {
    const [rRes, hRes] = await Promise.all([fetch('/api/recipes'), fetch('/api/health')]);
    const rData = await rRes.json();
    const hData = await hRes.json();
    state.recipes = rData.recipes || [];
    state.serverInfo = hData;
    if (!state.activeRecipeId && state.recipes.length > 0) {
      state.activeRecipeId = state.recipes[0].id;
    }
    renderAll();
  } catch (err) {
    console.error('Failed to load from PC database:', err);
  }
}

async function saveRecipeToServer(payload, existingId = null) {
  const url = existingId ? `/api/recipes/${encodeURIComponent(existingId)}` : '/api/recipes';
  const method = existingId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  state.recipes = data.recipes || [];
  state.activeRecipeId = data.recipe?.id || state.activeRecipeId;
  renderAll();
  return data.recipe;
}

/* ---------- CREATE / EDIT MODAL ---------- */

function createModalIngredientRowHtml(ing = { name: '', amount: '', unit: 'kg', notes: '' }) {
  const opts = ALL_UNITS.map(
    (u) => `<option value="${escapeHtml(u)}" ${u === (ing.unit || 'kg') ? 'selected' : ''}>${escapeHtml(u)}</option>`
  ).join('');
  return `
    <div class="modal-ing-row">
      <input type="text" class="m-ing-name" placeholder="e.g. Pork or Soy Sauce" value="${escapeHtml(ing.name)}" required />
      <input type="number" class="m-ing-amount" placeholder="e.g. 1" step="any" min="0" value="${escapeHtml(ing.amount)}" required />
      <select class="m-ing-unit">${opts}</select>
      <input type="text" class="m-ing-notes" placeholder="Optional note" value="${escapeHtml(ing.notes || '')}" />
      <button type="button" class="btn-secondary-sm m-remove-row" title="Remove">✕</button>
    </div>
  `;
}

function createModalLinkRowHtml(lnk = { title: '', url: '' }) {
  return `
    <div class="modal-link-row">
      <input type="text" class="m-link-title" placeholder="Label (optional)" value="${escapeHtml(lnk.title)}" />
      <input type="url" class="m-link-url" placeholder="https://www.youtube.com/watch?v=... or TikTok link" value="${escapeHtml(lnk.url)}" />
      <button type="button" class="btn-secondary-sm m-remove-row" title="Remove">✕</button>
    </div>
  `;
}

function attachModalRowRemovers(container) {
  container.querySelectorAll('.m-remove-row').forEach((btn) => {
    btn.onclick = () => btn.parentElement.remove();
  });
}

function openRecipeModal(recipe = null) {
  const backdrop = document.getElementById('recipeModalBackdrop');
  const titleEl = document.getElementById('recipeModalTitle');
  const deleteBtn = document.getElementById('deleteRecipeBtn');
  if (!backdrop) return;

  const isEdit = Boolean(recipe && recipe.id);
  titleEl.textContent = isEdit ? `Edit Recipe: ${recipe.title}` : 'Add New Recipe';
  deleteBtn.classList.toggle('hidden', !isEdit);

  document.getElementById('formRecipeId').value = isEdit ? recipe.id : '';
  document.getElementById('formTitle').value = isEdit ? recipe.title : '';
  document.getElementById('formCategory').value = isEdit ? recipe.category || 'General' : 'General';
  document.getElementById('formBaseServings').value = isEdit ? recipe.baseServings || 1 : 1;
  document.getElementById('formPrepTime').value = isEdit ? recipe.prepTimeMin || 0 : 0;
  document.getElementById('formImageUrl').value = isEdit ? recipe.imageUrl || '' : '';
  document.getElementById('formImageUpload').value = '';
  document.getElementById('formStepsText').value = isEdit
    ? (recipe.steps || []).map((s) => s.text).join('\n')
    : '';
  document.getElementById('formChefNotes').value = isEdit ? recipe.chefNotes || '' : '';

  const ingBox = document.getElementById('modalIngredientsContainer');
  const rows =
    isEdit && recipe.ingredients?.length
      ? recipe.ingredients
      : [
          { name: '', amount: '', unit: 'kg', notes: '' },
          { name: '', amount: '', unit: 'tbsp', notes: '' }
        ];
  ingBox.innerHTML = rows.map(createModalIngredientRowHtml).join('');
  attachModalRowRemovers(ingBox);

  const linkBox = document.getElementById('modalLinksContainer');
  const lRows = isEdit && recipe.links?.length ? recipe.links : [{ title: '', url: '' }];
  linkBox.innerHTML = lRows.map(createModalLinkRowHtml).join('');
  attachModalRowRemovers(linkBox);

  backdrop.classList.remove('hidden');
  document.getElementById('formTitle')?.focus();
}

function closeRecipeModal() {
  document.getElementById('recipeModalBackdrop')?.classList.add('hidden');
}

function bindGlobalEvents() {
  document.getElementById('openNewRecipeBtn')?.addEventListener('click', () => openRecipeModal(null));
  document.getElementById('sidebarAddBtn')?.addEventListener('click', () => openRecipeModal(null));
  document.getElementById('closeRecipeModalBtn')?.addEventListener('click', closeRecipeModal);
  document.getElementById('cancelRecipeModalBtn')?.addEventListener('click', closeRecipeModal);

  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value || '';
    renderSidebar();
  });

  document.getElementById('addModalIngredientRowBtn')?.addEventListener('click', () => {
    const ingBox = document.getElementById('modalIngredientsContainer');
    ingBox.insertAdjacentHTML(
      'beforeend',
      createModalIngredientRowHtml({ name: '', amount: '', unit: 'tbsp', notes: '' })
    );
    attachModalRowRemovers(ingBox);
  });

  document.getElementById('addModalLinkRowBtn')?.addEventListener('click', () => {
    const linkBox = document.getElementById('modalLinksContainer');
    linkBox.insertAdjacentHTML('beforeend', createModalLinkRowHtml({ title: '', url: '' }));
    attachModalRowRemovers(linkBox);
  });

  document.getElementById('formImageUpload')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: reader.result })
      });
      const data = await res.json();
      if (data.imageUrl) document.getElementById('formImageUrl').value = data.imageUrl;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('recipeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const existingId = document.getElementById('formRecipeId').value.trim() || null;

    const ingredients = Array.from(
      document.querySelectorAll('#modalIngredientsContainer .modal-ing-row')
    )
      .map((row, idx) => ({
        id: `ing-${idx + 1}-${Date.now()}`,
        name: row.querySelector('.m-ing-name')?.value.trim() || '',
        amount: parseFloat(row.querySelector('.m-ing-amount')?.value) || 0,
        unit: row.querySelector('.m-ing-unit')?.value || 'g',
        notes: row.querySelector('.m-ing-notes')?.value.trim() || ''
      }))
      .filter((i) => i.name.length > 0);

    const links = Array.from(document.querySelectorAll('#modalLinksContainer .modal-link-row'))
      .map((row, idx) => ({
        id: `lnk-${idx + 1}-${Date.now()}`,
        title: row.querySelector('.m-link-title')?.value.trim() || `Video / Link #${idx + 1}`,
        url: row.querySelector('.m-link-url')?.value.trim() || ''
      }))
      .filter((l) => l.url.length > 0);

    const steps = document
      .getElementById('formStepsText')
      .value.split(/\r?\n/)
      .map((line, idx) => ({
        id: `step-${idx + 1}`,
        text: line.replace(/^\s*(\d+[.)]\s*|step\s*\d+[:.)-]?\s*)/i, '').trim()
      }))
      .filter((s) => s.text.length > 0);

    const payload = {
      title: document.getElementById('formTitle').value.trim(),
      category: document.getElementById('formCategory').value.trim() || 'General',
      baseServings: parseFloat(document.getElementById('formBaseServings').value) || 1,
      prepTimeMin: parseInt(document.getElementById('formPrepTime').value, 10) || 0,
      imageUrl: document.getElementById('formImageUrl').value.trim(),
      ingredients,
      links,
      steps,
      chefNotes: document.getElementById('formChefNotes').value
    };

    resetScale();
    await saveRecipeToServer(payload, existingId);
    closeRecipeModal();
  });

  document.getElementById('deleteRecipeBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('formRecipeId').value.trim();
    if (!id) return;
    const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      state.recipes = data.recipes || [];
      state.activeRecipeId = state.recipes[0]?.id || null;
      resetScale();
      closeRecipeModal();
      renderAll();
    }
  });

  // PC Database & Backup Modal
  document.getElementById('openDbModalBtn')?.addEventListener('click', async () => {
    const backdrop = document.getElementById('dbModalBackdrop');
    const infoBox = document.getElementById('dbModalInfoContent');
    if (!backdrop || !infoBox) return;

    const hRes = await fetch('/api/health').catch(() => null);
    const info = hRes ? await hRes.json() : state.serverInfo;
    const lanHtml = (info?.lanEndpoints || [])
      .map((ep) => `<li><strong>${escapeHtml(ep.interface)}:</strong> <code>${escapeHtml(ep.url)}</code></li>`)
      .join('');

    infoBox.innerHTML = `
      <div class="db-box">
        <div style="font-weight:800;margin-bottom:6px;">✅ Local PC Database Active</div>
        <div style="margin-bottom:4px;"><strong>SQLite File:</strong> <code>${escapeHtml(info?.databasePath || 'd:\\Cooking App\\data\\cookbook.sqlite')}</code></div>
        <div><strong>Saved Recipes:</strong> ${state.recipes.length}</div>
      </div>
      <div class="db-box">
        <div style="font-weight:800;margin-bottom:6px;">📱 Android Connection (Same Wi-Fi)</div>
        <ul style="margin:0;padding-left:18px;">
          ${lanHtml || `<li><code>${escapeHtml(info?.localUrl || 'http://127.0.0.1:3847')}</code></li>`}
        </ul>
      </div>
    `;
    backdrop.classList.remove('hidden');
  });

  document.getElementById('closeDbModalBtn')?.addEventListener('click', () => {
    document.getElementById('dbModalBackdrop')?.classList.add('hidden');
  });

  document.getElementById('exportRecipesBtn')?.addEventListener('click', () => {
    window.location.href = '/api/recipes/export';
  });

  document.getElementById('importRecipesTriggerBtn')?.addEventListener('click', () => {
    document.getElementById('importRecipesFileInput')?.click();
  });

  document.getElementById('importRecipesFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        const res = await fetch('/api/recipes/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        });
        if (res.ok) {
          const data = await res.json();
          state.recipes = data.recipes || [];
          state.activeRecipeId = state.recipes[0]?.id || null;
          renderAll();
          document.getElementById('dbModalBackdrop')?.classList.add('hidden');
        }
      } catch (err) {
        console.error('Import failed:', err);
      }
    };
    reader.readAsText(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindGlobalEvents();
  fetchInitialData();
});
