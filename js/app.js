/**
 * AI Knowledge Nexus - Main Application
 * Production-grade rewrite with defensive engineering, memory safety, and UX polish.
 */

class App {
    constructor() {
        this.graph = null;
        this.state = {
            searchQuery: '',
            selectedCategory: null,
            selectedTerm: null,
            history: [],
            historyIndex: -1,
            isFullscreen: false,
        };
        this.initialized = false;

        // Store bound listener references so they can be removed cleanly
        this._listeners = [];
        // Track pending timers for cleanup
        this._timers = [];

        this.init();
    }

    async init() {
        try {
            if (window.dataLoadPromise) {
                await window.dataLoadPromise;
            } else {
                throw new Error('dataLoadPromise not found. Is data.js loaded?');
            }

            if (!KnowledgeBase?.isLoaded) {
                throw new Error('Data failed to load. Check console for CORS or JSON errors.');
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup());
            } else {
                this.setup();
            }
        } catch (err) {
            console.error('[App.init]', err.message);
            this._showFatalError(err.message);
        }
    }

    /**
     * Renders a user-visible fatal error and aborts setup.
     * @param {string} message
     */
    _showFatalError(message) {
        const safe = String(message)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        document.body.innerHTML = `
            <div style="
                display:flex;align-items:center;justify-content:center;
                height:100vh;font-family:system-ui,sans-serif;
                background:#0f172a;color:#f87171;text-align:center;padding:24px;">
                <div>
                    <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                    <strong>Failed to initialise.</strong><br>
                    <span style="color:#94a3b8;font-size:0.875rem;">${safe}</span><br>
                    <span style="color:#64748b;font-size:0.8rem;margin-top:8px;display:block;">
                        Tip: serve this project via a local dev server (e.g. VS Code Live Server).
                    </span>
                </div>
            </div>`;
    }

    setup() {
        console.log('[App] Setting up…');

        try {
            const required = ['KnowledgeBase', 'KnowledgeGraph', 'KnowledgeUtils'];
            for (const dep of required) {
                if (!window[dep]) throw new Error(`${dep} is not loaded.`);
            }

            // Initialise graph
            this.graph = new KnowledgeGraph('graphCanvas');
            this.graph.loadData();

            // Wire graph callbacks (always check term exists first)
            this.graph.onNodeSelect = (term) => { if (term) this.navigateTerm(term); };
            this.graph.onHoverChange = (node, e) => this.handleHover(node, e);

            // Build UI
            this.renderCategories();
            this.renderLegend();
            this.updateStats();
            this.populateCategorySelect();

            // Bind all DOM events
            this.bindEvents();

            // Handle deep-link URL on first load
            this.handleInitialRoute();

            // Visitor counter (FIXED: was incorrectly inside catch block)
            updateVisitorCount();

            // Resize graph when window changes
            this._addResizeObserver();

            this.initialized = true;
            console.log('[App] Ready. Shortcuts: "/" = search, "F" = fullscreen, Alt+←/→ = history.');

        } catch (err) {
            console.error('[App.setup] Critical error:', err);
        }
    }

    // ==========================================
    // UTILITY
    // ==========================================

    /**
     * Debounce helper – returns a function that delays invoking `func` by `wait` ms.
     * @param {Function} func
     * @param {number} wait
     * @returns {Function}
     */
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Register an event listener AND track it for later cleanup.
     * @param {EventTarget} target
     * @param {string} type
     * @param {Function} handler
     * @param {object} [options]
     */
    _on(target, type, handler, options) {
        if (!target) return;
        target.addEventListener(type, handler, options);
        this._listeners.push({ target, type, handler, options });
    }

    /**
     * Tear down all registered listeners (useful for SPA navigations / hot-reload).
     */
    destroy() {
        for (const { target, type, handler, options } of this._listeners) {
            target.removeEventListener(type, handler, options);
        }
        this._listeners = [];
        for (const id of this._timers) clearTimeout(id);
        this._timers = [];
        if (this._resizeObserver) this._resizeObserver.disconnect();
    }

    /**
     * Observe the canvas container so the graph re-fits on window / panel resize.
     */
    _addResizeObserver() {
        const canvas = document.getElementById('graphCanvas');
        if (!canvas || !window.ResizeObserver) return;

        const debouncedResize = this.debounce(() => {
            if (this.graph?.resize) this.graph.resize();
        }, 200);

        this._resizeObserver = new ResizeObserver(debouncedResize);
        this._resizeObserver.observe(canvas.parentElement ?? canvas);
    }

    // ==========================================
    // EVENT BINDING
    // ==========================================

    bindEvents() {
        const searchInput = document.getElementById('searchInput');

        // Debounced search – also clears highlights when query is empty
        if (searchInput) {
            const debouncedSearch = this.debounce((value) => {
                this.state.searchQuery = value;
                if (this.graph) this.graph.highlightNodes(value || null);
            }, 150);

            this._on(searchInput, 'input', (e) => debouncedSearch(e.target.value));
        }

        // Global keyboard shortcuts
        this._on(document, 'keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active?.matches('input,textarea,[contenteditable]');

            switch (e.key) {
                case '/':
                    if (!isTyping) {
                        e.preventDefault();
                        searchInput?.focus();
                    }
                    break;

                case 'Escape':
                    this.closeDetailPanel();
                    this.closeModal();
                    searchInput?.blur();
                    break;

                case 'f':
                case 'F':
                    if (!isTyping) this.toggleFullscreen();
                    break;

                case 'ArrowLeft':
                    if (e.altKey) { e.preventDefault(); this.goBack(); }
                    break;

                case 'ArrowRight':
                    if (e.altKey) { e.preventDefault(); this.goForward(); }
                    break;
            }
        });

        // Browser back / forward button support
        this._on(window, 'hashchange', () => this.handleRouteChange());

        // Fullscreen state tracking
        this._on(document, 'fullscreenchange', () => {
            this.state.isFullscreen = !!document.fullscreenElement;
        });

        // ---- Sidebar ----
        const toggleBtn = document.getElementById('toggleSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebar = document.getElementById('sidebar');

        if (toggleBtn && sidebar) {
            this._on(toggleBtn, 'click', () => {
                if (window.innerWidth < 768) {
                    sidebar.classList.toggle('active');
                    overlay?.classList.toggle('active');
                } else {
                    sidebar.classList.toggle('collapsed');
                }
            });
        }

        if (overlay && sidebar) {
            this._on(overlay, 'click', () => {
                sidebar.classList.remove('active');
                overlay.classList.remove('active');
            });
        }

        // ---- Architecture button ----
        const archBtn = document.getElementById('navArchitecture');
        if (archBtn) {
            this._on(archBtn, 'click', async () => {
                if (window.archManager) {
                    await window.archManager.showVisual(null);
                } else {
                    console.warn('[App] archManager not found – is architecture.js loaded?');
                    this.showToast('Architecture view unavailable.', 'error');
                }
            });
        }

        // ---- Category list ----
        const categoryList = document.getElementById('categoryList');
        if (categoryList) {
            this._on(categoryList, 'click', (e) => {
                const item = e.target.closest('.category-item');
                if (!item) return;

                document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));

                const categoryId = item.dataset.category;
                if (this.state.selectedCategory === categoryId) {
                    this.state.selectedCategory = null;
                    this.graph?.filterByCategory(null);
                } else {
                    item.classList.add('active');
                    this.state.selectedCategory = categoryId;
                    this.graph?.filterByCategory(categoryId);
                }
            });
        }

        // ---- Type filters ----
        const filterList = document.getElementById('filterList');
        if (filterList) {
            this._on(filterList, 'click', (e) => {
                const item = e.target.closest('.filter-item');
                if (!item || !this.graph) return;

                document.querySelectorAll('.filter-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const filter = item.dataset.filter;
                this.graph.nodes.forEach(n => {
                    n.visible = filter === 'all' ? true : n.term.type === filter;
                });

                if (filter === 'all') this.state.selectedCategory = null;
            });
        }

        // ---- Graph controls ----
        const $el = (id) => document.getElementById(id);
        const safeCall = (id, fn) => {
            const el = $el(id);
            if (el) this._on(el, 'click', fn);
        };

        safeCall('zoomIn',    () => this.graph?.zoomIn());
        safeCall('zoomOut',   () => this.graph?.zoomOut());
        safeCall('resetView', () => this.graph?.resetView());

        // ---- Detail panel ----
        const closePanel = $el('closePanel');
        if (closePanel) this._on(closePanel, 'click', () => this.closeDetailPanel());

        // ---- Related terms (event delegation) ----
        const relatedTerms = $el('relatedTerms');
        if (relatedTerms) {
            this._on(relatedTerms, 'click', (e) => {
                const item = e.target.closest('.related-item');
                if (!item) return;

                const termId = item.dataset.termId;
                const term = KnowledgeUtils.getTerm(termId);
                if (!term) {
                    console.warn(`[App] Related term "${termId}" not found in KnowledgeBase.`);
                    return;
                }

                this.navigateTerm(term);
                if (this.graph) this.graph.selectedNode = this.graph.findNode(termId);
            });
        }

        // ---- Add-term modal ----
        const addTermBtn  = $el('addTermBtn');
        const closeModal  = $el('closeModal');
        const cancelAdd   = $el('cancelAdd');
        const addModal    = $el('addModal');
        const addTermForm = $el('addTermForm');

        if (addTermBtn)  this._on(addTermBtn,  'click', () => this.openModal());
        if (closeModal)  this._on(closeModal,  'click', () => this.closeModal());
        if (cancelAdd)   this._on(cancelAdd,   'click', () => this.closeModal());

        // Close modal on backdrop click
        if (addModal) {
            this._on(addModal, 'click', (e) => {
                if (e.target === addModal) this.closeModal();
            });
        }

        if (addTermForm) {
            this._on(addTermForm, 'submit', (e) => {
                e.preventDefault();
                this.handleAddTerm(new FormData(e.target));
            });
        }
    }

    // ==========================================
    // ROUTING & HISTORY
    // ==========================================

    handleInitialRoute() {
        const hash = window.location.hash.slice(1);
        if (!hash) return;

        const term = KnowledgeUtils.getTerm(hash);
        if (term) {
            this.showTermDetail(term, false);
            if (this.graph) this.graph.selectedNode = this.graph.findNode(hash);
        } else {
            console.warn(`[App] Deep-link term "${hash}" not found.`);
        }
    }

    handleRouteChange() {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            // Only close if we're not already mid-navigation (prevents loop)
            if (this.state.selectedTerm) this.closeDetailPanel(false);
            return;
        }

        // Avoid re-rendering the same term (breaks loops from goBack / goForward)
        if (this.state.selectedTerm?.id === hash) return;

        const term = KnowledgeUtils.getTerm(hash);
        if (term) this.showTermDetail(term, false);
    }

    navigateTerm(term) {
        if (!term?.id) return;

        // Truncate forward history when branching
        if (this.state.historyIndex < this.state.history.length - 1) {
            this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        }

        // Avoid duplicate consecutive entries
        if (this.state.history[this.state.historyIndex] !== term.id) {
            this.state.history.push(term.id);
            this.state.historyIndex = this.state.history.length - 1;
        }

        this.showTermDetail(term, true);
    }

    goBack() {
        if (this.state.historyIndex <= 0) return;
        this._navigateHistory(this.state.historyIndex - 1);
    }

    goForward() {
        if (this.state.historyIndex >= this.state.history.length - 1) return;
        this._navigateHistory(this.state.historyIndex + 1);
    }

    /**
     * Internal: move to a specific history index without adding a new entry.
     * Uses replaceState instead of setting location.hash to avoid triggering
     * the hashchange listener and creating a loop.
     * @param {number} index
     */
    _navigateHistory(index) {
        this.state.historyIndex = index;
        const termId = this.state.history[index];
        const term = KnowledgeUtils.getTerm(termId);
        if (!term) return;

        // replaceState so hashchange does NOT fire (prevents the feedback loop)
        history.replaceState(null, '', `#${term.id}`);
        this.showTermDetail(term, false);

        if (this.graph) {
            this.graph.selectedNode = this.graph.findNode(termId) ?? null;
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err) => {
                console.warn(`[App] Fullscreen request denied: ${err.message}`);
                this.showToast('Fullscreen not available.', 'error');
            });
        } else {
            document.exitFullscreen?.();
        }
    }

    // ==========================================
    // RENDERING & UI
    // ==========================================

    renderCategories() {
        const container = document.getElementById('categoryList');
        if (!container || !window.KnowledgeUtils) return;

        const stats = KnowledgeUtils.getStats();

        container.innerHTML = KnowledgeBase.categories.map(cat => `
            <div class="category-item" data-category="${this.escapeAttr(cat.id)}">
                <div class="category-dot" style="background:${this.escapeAttr(cat.color)};"></div>
                <span class="category-name">${this.escapeHTML(cat.name)}</span>
                <span class="category-count">${stats.byCategory[cat.id] ?? 0}</span>
            </div>
        `).join('');
    }

    renderLegend() {
        const container = document.getElementById('legendItems');
        if (!container || !window.KnowledgeBase) return;

        container.innerHTML = KnowledgeBase.categories.map(cat => `
            <div class="legend-item">
                <div class="legend-dot" style="background:${this.escapeAttr(cat.color)};"></div>
                <span>${this.escapeHTML(cat.name)}</span>
            </div>
        `).join('');
    }

    updateStats() {
        if (!window.KnowledgeUtils) return;
        const stats = KnowledgeUtils.getStats();

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        set('statCategories', stats.categories);
        set('statTerms',      stats.terms);
        set('statConnections', stats.connections);
        set('totalCount',     stats.terms);
    }

    populateCategorySelect() {
        const select = document.getElementById('categorySelect');
        if (!select || !window.KnowledgeBase) return;

        // Prepend a placeholder option for better UX
        select.innerHTML =
            `<option value="" disabled selected>Select a category…</option>` +
            KnowledgeBase.categories
                .map(cat => `<option value="${this.escapeAttr(cat.id)}">${this.escapeHTML(cat.name)}</option>`)
                .join('');
    }

    showTermDetail(term, pushState = true) {
        if (!term) return;

        const panel = document.getElementById('detailPanel');
        if (!panel) return;

        const category = KnowledgeBase.categories.find(c => c.id === term.category);

        // Badge
        const badge = document.getElementById('panelBadge');
        if (badge) {
            badge.textContent = category?.name ?? 'General';
            badge.style.color      = category?.color ?? '#6b7280';
            badge.style.background = category ? `${category.color}15` : '#f3f4f6';
        }

        // Title & subtitle
        const title    = document.getElementById('panelTitle');
        const subtitle = document.getElementById('panelSubtitle');
        if (title)    title.textContent    = term.fullName || term.name;
        if (subtitle) subtitle.textContent = term.shortDesc ?? '';

        // Definition (Markdown)
        const definition = document.getElementById('panelDefinition');
        if (definition) definition.innerHTML = this.parseMarkdown(term.definition ?? '');

        // Related terms
        const relatedContainer = document.getElementById('relatedTerms');
        if (relatedContainer) {
            const items = (term.related ?? []).map(relId => {
                const relTerm = KnowledgeUtils.getTerm(relId);
                if (!relTerm) return '';
                const relCat = KnowledgeBase.categories.find(c => c.id === relTerm.category);
                return `
                    <div class="related-item" data-term-id="${this.escapeAttr(relId)}" role="button" tabindex="0"
                         aria-label="Navigate to ${this.escapeAttr(relTerm.name)}">
                        <div class="related-name">${this.escapeHTML(relTerm.name)}</div>
                        <div class="related-type">${this.escapeHTML(relCat?.name ?? 'General')}</div>
                    </div>`;
            }).filter(Boolean).join('');

            relatedContainer.innerHTML = items ||
                '<p style="color:var(--text-muted);font-size:var(--font-size-sm);">No related terms</p>';
        }

        // Code example
        const codeContainer = document.getElementById('panelCode');
        if (codeContainer) {
            codeContainer.textContent = term.codeExample ?? '// No code example available';
            this.injectCopyButton(codeContainer.parentElement);
        }

        // Tags
        const tagContainer = document.getElementById('panelTags');
        if (tagContainer) {
            tagContainer.innerHTML = (term.tags ?? [])
                .map(tag => `<span class="tag">${this.escapeHTML(tag)}</span>`)
                .join('');
        }

        panel.classList.add('open');
        this.state.selectedTerm = term;

        // URL update
        if (pushState) {
            // Use replaceState if same term, pushState if new
            const current = window.location.hash.slice(1);
            if (current !== term.id) {
                history.pushState(null, '', `#${term.id}`);
            }
        }

        // Announce for screen readers
        panel.setAttribute('aria-label', `Detail: ${term.fullName || term.name}`);
        // Move focus to panel title for accessibility
        if (title) {
            title.setAttribute('tabindex', '-1');
            title.focus({ preventScroll: true });
        }
    }

    /**
     * Inject or refresh the "Copy" button inside a code block container.
     * Falls back to execCommand if clipboard API is unavailable (HTTP context).
     * @param {HTMLElement|null} container
     */
    injectCopyButton(container) {
        if (!container) return;

        const existing = container.querySelector('.copy-btn-dynamic');
        if (existing) existing.remove();

        const btn = document.createElement('button');
        btn.className = 'copy-btn-dynamic';
        btn.textContent = 'Copy';
        btn.setAttribute('aria-label', 'Copy code to clipboard');
        btn.style.cssText = `
            position:absolute;top:8px;right:8px;
            padding:4px 10px;font-size:11px;
            font-family:var(--font-family);
            background:rgba(255,255,255,0.1);
            color:#cbd5e1;
            border:1px solid rgba(255,255,255,0.2);
            border-radius:4px;cursor:pointer;
            transition:background 0.2s,color 0.2s;
        `;

        btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.1)'; });

        btn.addEventListener('click', async () => {
            const codeEl = container.querySelector('code');
            if (!codeEl) return;

            const text = codeEl.textContent ?? '';

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    // Fallback for HTTP (non-secure) contexts
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                }

                btn.textContent = '✓ Copied';
                btn.style.color = '#4ade80';
                const t = setTimeout(() => {
                    btn.textContent = 'Copy';
                    btn.style.color = '#cbd5e1';
                }, 1500);
                this._timers.push(t);

            } catch (err) {
                console.warn('[App] Copy failed:', err);
                btn.textContent = 'Failed';
                const t = setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                this._timers.push(t);
            }
        });

        container.style.position = 'relative';
        container.appendChild(btn);
    }

    closeDetailPanel(clearHash = true) {
        const panel = document.getElementById('detailPanel');
        if (panel) panel.classList.remove('open');

        this.state.selectedTerm = null;
        if (this.graph) this.graph.selectedNode = null;

        if (clearHash && window.location.hash) {
            history.pushState('', document.title, window.location.pathname + window.location.search);
        }
    }

    handleHover(node, e) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;

        if (node?.term) {
            tooltip.innerHTML =
                `<strong>${this.escapeHTML(node.term.name)}</strong><br>
                 <span style="color:var(--text-muted);">${this.escapeHTML(node.term.shortDesc ?? '')}</span>`;

            // Clamp to viewport so tooltip never overflows
            const tipW = 220; // approximate max width
            const x = Math.min(e.clientX + 12, window.innerWidth - tipW - 8);
            const y = e.clientY + 12;

            tooltip.style.left = `${x}px`;
            tooltip.style.top  = `${y}px`;
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.remove('visible');
        }
    }

    openModal() {
        const modal = document.getElementById('addModal');
        if (modal) {
            modal.classList.add('open');
            // Focus first input for accessibility
            const first = modal.querySelector('input,textarea,select');
            first?.focus();
        }
    }

    closeModal() {
        const modal = document.getElementById('addModal');
        const form  = document.getElementById('addTermForm');
        if (modal) modal.classList.remove('open');
        if (form)  form.reset();
    }

    handleAddTerm(formData) {
        const name       = formData.get('name')?.trim()       ?? '';
        const categoryId = formData.get('category')?.trim()   ?? '';
        const shortDesc  = formData.get('shortDesc')?.trim()  ?? '';
        const definition = formData.get('definition')?.trim() ?? '';
        const relatedStr = formData.get('related')?.trim()    ?? '';
        const tagsStr    = formData.get('tags')?.trim()       ?? '';

        if (!name || !categoryId || !shortDesc || !definition) {
            this.showToast('Please fill all required fields.', 'error');
            return;
        }

        if (name.length > 80) {
            this.showToast('Name is too long (max 80 characters).', 'error');
            return;
        }

        // Generate stable, collision-resistant ID
        const baseId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!baseId) {
            this.showToast('Could not generate a valid ID from that name.', 'error');
            return;
        }

        // Suffix if ID already exists
        let id = baseId;
        let suffix = 1;
        while (KnowledgeUtils.getTerm(id)) {
            id = `${baseId}-${++suffix}`;
        }

        const related = relatedStr
            .split(',')
            .map(s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
            .filter(Boolean);

        const tags = tagsStr.split(',').map(s => s.trim()).filter(Boolean);

        const success = KnowledgeUtils.addTerm({
            id, name, category: categoryId,
            type: 'technique',
            shortDesc, definition, related, tags
        });

        if (success) {
            this.graph?.loadData();
            this.updateStats();
            this.renderCategories();
            this.closeModal();

            const newTerm = KnowledgeUtils.getTerm(id);
            if (newTerm) {
                const t = setTimeout(() => this.navigateTerm(newTerm), 100);
                this._timers.push(t);
                this.showToast(`"${name}" added successfully!`, 'success');
            }
        } else {
            this.showToast('Failed to add term. It may already exist.', 'error');
        }
    }

    // ==========================================
    // TOAST NOTIFICATIONS
    // ==========================================

    /**
     * Shows a non-blocking toast message.
     * @param {string} message
     * @param {'info'|'success'|'error'} type
     */
    showToast(message, type = 'info') {
        const existing = document.querySelector('.app-toast');
        if (existing) existing.remove();

        const bgMap = {
            success: 'var(--accent-success, #22c55e)',
            error:   'var(--accent-danger, #ef4444)',
            info:    'var(--text-primary, #1e293b)',
        };

        const toast = document.createElement('div');
        toast.className  = 'app-toast';
        toast.textContent = message;
        toast.setAttribute('role', 'status');      // screen reader live region
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = `
            position:fixed;bottom:24px;left:50%;
            transform:translateX(-50%) translateY(20px);
            padding:12px 24px;
            background:${bgMap[type] ?? bgMap.info};
            color:#fff;border-radius:8px;
            font-size:13px;font-weight:500;
            z-index:5000;
            box-shadow:0 4px 12px rgba(0,0,0,0.15);
            opacity:0;pointer-events:none;
            transition:opacity 0.3s cubic-bezier(0.4,0,0.2,1),
                        transform 0.3s cubic-bezier(0.4,0,0.2,1);
        `;

        document.body.appendChild(toast);

        // Force reflow then animate in
        void toast.offsetWidth;
        toast.style.opacity   = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        const t = setTimeout(() => {
            toast.style.opacity   = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            const t2 = setTimeout(() => toast.remove(), 320);
            this._timers.push(t2);
        }, 3000);
        this._timers.push(t);
    }

    // ==========================================
    // STRING UTILITIES
    // ==========================================

    /**
     * Escapes a string for safe injection into HTML text nodes.
     * @param {string} text
     * @returns {string}
     */
    escapeHTML(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Escapes a string for safe injection into HTML attribute values.
     * @param {string} text
     * @returns {string}
     */
    escapeAttr(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Lightweight Markdown → HTML renderer.
     * Operates on pre-escaped text to prevent XSS.
     * @param {string} text  Raw markdown string
     * @returns {string}     Safe HTML string
     */
    parseMarkdown(text) {
        if (!text) return '';

        // 1. Escape HTML entities first to prevent injection
        let out = this.escapeHTML(text);

        // 2. Fenced code blocks  ```…```  (capture before inline rules corrupt them)
        out = out.replace(/```([\s\S]*?)```/g, (_, code) =>
            `<pre><code>${code.trim()}</code></pre>`
        );

        // 3. Inline code  `…`
        out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // 4. Bold  **…**
        out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 5. Italic  *…*  (after bold so **…** is matched first)
        out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

        // 6. Headings (only at line start)
        out = out.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        out = out.replace(/^## (.+)$/gm,  '<h3>$1</h3>');
        out = out.replace(/^# (.+)$/gm,   '<h2>$1</h2>');

        // 7. Bullet lists  (group consecutive lines into <ul>)
        out = out.replace(/(?:^- .+\n?)+/gm, (block) => {
            const items = block.trim().split('\n')
                .map(l => `<li>${l.replace(/^- /, '').trim()}</li>`)
                .join('');
            return `<ul>${items}</ul>`;
        });

        // 8. Ordered lists
        out = out.replace(/(?:^\d+\. .+\n?)+/gm, (block) => {
            const items = block.trim().split('\n')
                .map(l => `<li>${l.replace(/^\d+\. /, '').trim()}</li>`)
                .join('');
            return `<ol>${items}</ol>`;
        });

        // 9. Wrap remaining blocks in <p> tags (skip block-level elements)
        const BLOCK_START = /^<(ul|ol|pre|h[1-6]|blockquote)/;
        out = out
            .split(/\n{2,}/)
            .map(block => {
                const trimmed = block.trim();
                if (!trimmed) return '';
                if (BLOCK_START.test(trimmed)) return trimmed;
                // Replace single newlines within a paragraph with <br>
                return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
            })
            .filter(Boolean)
            .join('');

        return out;
    }
}

// Initialise and expose globally
window.app = new App();

// ==========================================
// VISITOR COUNTER
// Isolated from App class so it can run independently.
// Includes a silent fallback if the API is unreachable.
// ==========================================
async function updateVisitorCount() {
    const el = document.getElementById('visitorCount');
    if (!el) return;

    const NAMESPACE = 'titanml-ai-nexus';
    const KEY       = 'visits';
    const STORAGE_KEY = 'titanml_visited';

    try {
        const endpoint = localStorage.getItem(STORAGE_KEY)
            ? `https://api.countapi.xyz/get/${NAMESPACE}/${KEY}`
            : `https://api.countapi.xyz/hit/${NAMESPACE}/${KEY}`;

        // Abort if the API takes longer than 4 s
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        if (typeof data.value === 'number') {
            el.textContent = data.value.toLocaleString();
            if (!localStorage.getItem(STORAGE_KEY)) {
                localStorage.setItem(STORAGE_KEY, 'true');
            }
        }

    } catch (err) {
        if (err.name !== 'AbortError') {
            // Silently degrade – visitor count is non-critical
            console.info('[VisitorCounter] Unavailable:', err.message);
        }
        el.textContent = '—';
    }
}

document.addEventListener('DOMContentLoaded', updateVisitorCount);
