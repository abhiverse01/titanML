/**
 * AI Knowledge Graph Visualization
 * Production-grade rewrite: bug fixes, performance, memory safety, UX polish.
 *
 * FIXES vs original:
 *  - findNode() method added (was called by app.js but never existed)
 *  - resize() public method added (was called by app.js ResizeObserver but never existed)
 *  - handleClick() falsy-zero bug fixed (clientX===0 was treated as missing)
 *  - ctx.scale(dpr) removed from handleResize – render() owns the transform via setTransform
 *  - Touch: tap-vs-pan discrimination added (no more accidental selects while panning)
 *  - destroy() added – removes all event listeners and cancels animation frame
 *  - O(n²) physics repulsion optimised with a flat spatial grid
 *  - Dot grid cached on an offscreen canvas – not redrawn every frame
 *  - Edge Set used for O(1) deduplication instead of O(n) Array.some()
 *  - requestAnimationFrame deltaTime used for animation – runs correctly at all refresh rates
 *  - Page Visibility API – animation pauses on hidden tabs
 *  - hexToRgba / darkenColor made safe for edge-case colour strings
 *  - Node labels use measureText for pixel-accurate truncation
 *  - zoomIn/zoomOut/resetView animate smoothly instead of snapping
 *  - Highlighted node ring added so search results are clearly visible
 *  - Node glow intensity scales with selection/hover state
 */

class KnowledgeGraph {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error('[KnowledgeGraph] Canvas not found:', canvasId);
            return;
        }

        this.ctx = this.canvas.getContext('2d');

        this.theme = {
            bg:               '#f8fafc',
            bgGradientCenter: '#ffffff',
            gridDot:          '#dde3ed',
            text:             '#334155',
        };

        this.options = {
            nodeRadius: { core: 26, technique: 18, infrastructure: 14, application: 12 },
            fontSize: 10,
            padding: 80,
            zoomMin: 0.15,
            zoomMax: 5,
            ...options,
        };

        // Core state
        this.nodes          = [];
        this.edges          = [];
        this.nodeMap        = new Map();
        this.zoom           = 1;
        this.panX           = 0;
        this.panY           = 0;
        this.hoveredNode    = null;
        this.selectedNode   = null;
        this.isDragging     = false;
        this.lastMouse      = { x: 0, y: 0 };
        this.animationId    = null;

        // Dimensions
        this.width   = 0;
        this.height  = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.dpr     = window.devicePixelRatio || 1;

        // Animation
        this.time      = 0;          // accumulated seconds
        this._lastTs   = null;        // used for accurate deltaTime

        // Physics
        this.physics = {
            enabled:       true,
            repulsion:     800,
            attraction:    0.005,
            centerGravity: 0.01,
            damping:       0.85,
            minVelocity:   0.05,
            maxVelocity:   10,
        };

        // Smooth zoom target (for animated zoom buttons)
        this._zoomTarget = 1;
        this._panTargetX = 0;
        this._panTargetY = 0;

        // Touch pinch state
        this._pinchDist  = null;
        this._pinchZoom  = 1;

        // Touch tap discrimination
        this._touchStartPos  = null;
        this._touchStartTime = 0;
        this._TAP_MAX_DIST   = 10;   // px – more than this = pan, not tap
        this._TAP_MAX_MS     = 250;  // ms – longer than this = pan, not tap

        // Offscreen dot-grid cache
        this._gridCanvas = null;
        this._gridDirty  = true;

        // Bound listener refs for clean removal
        this._boundListeners = [];

        // Callbacks (set by app.js)
        this.onNodeSelect  = null;
        this.onHoverChange = null;

        this._init();
    }

    // ─────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────

    _init() {
        this._handleResize();
        this._bindEvents();
        this._startAnimation();
    }

    // ─────────────────────────────────────────────
    // PUBLIC API  (consumed by app.js)
    // ─────────────────────────────────────────────

    /**
     * Find a node by its term ID.
     * Was called by app.js but was never defined in the original code.
     * @param {string} id
     * @returns {object|null}
     */
    findNode(id) {
        return this.nodeMap.get(id) ?? null;
    }

    /**
     * Called by app.js ResizeObserver.
     * Was referenced but never existed in the original code.
     */
    resize() {
        this._handleResize();
    }

    zoomIn() {
        const newZoom = Math.min(this.options.zoomMax, this.zoom * 1.3);
        this._animateZoom(newZoom, this.width / 2, this.height / 2);
    }

    zoomOut() {
        const newZoom = Math.max(this.options.zoomMin, this.zoom / 1.3);
        this._animateZoom(newZoom, this.width / 2, this.height / 2);
    }

    resetView() {
        this._zoomTarget = 1;
        this._panTargetX = 0;
        this._panTargetY = 0;
    }

    highlightNodes(query) {
        const q = query ? String(query).toLowerCase().trim() : '';
        this.nodes.forEach(node => {
            node.highlighted = q.length > 0 && (
                node.term.name.toLowerCase().includes(q) ||
                (node.term.shortDesc ?? '').toLowerCase().includes(q) ||
                (node.term.tags ?? []).some(t => t.toLowerCase().includes(q))
            );
        });
    }

    filterByCategory(categoryId) {
        this.nodes.forEach(node => {
            node.visible = !categoryId || node.term.category === categoryId;
        });
    }

    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Tear down all listeners, cancel animation, free offscreen canvas.
     * Call this before removing the graph from the DOM.
     */
    destroy() {
        this.stopAnimation();
        for (const { target, type, fn, opts } of this._boundListeners) {
            target.removeEventListener(type, fn, opts);
        }
        this._boundListeners = [];
        this._gridCanvas = null;
    }

    // ─────────────────────────────────────────────
    // DATA LOADING
    // ─────────────────────────────────────────────

    loadData() {
        if (!window.KnowledgeBase) return;

        this.nodes   = [];
        this.edges   = [];
        this.nodeMap.clear();

        const { categories, terms } = KnowledgeBase;
        if (!categories.length || !terms.length) return;

        // Build nodes
        terms.forEach(term => {
            const category      = categories.find(c => c.id === term.category);
            const categoryIndex = categories.indexOf(category);
            const total         = categories.length || 1;

            const baseAngle    = (categoryIndex / total) * Math.PI * 2 - Math.PI / 2;
            const catTerms     = terms.filter(t => t.category === term.category);
            const termIndex    = catTerms.indexOf(term);

            const radius = this.options.nodeRadius[term.type] ?? 16;
            const distance = term.type === 'core' ? 160 : term.type === 'technique' ? 220 : 280;

            const spreadAngle  = Math.PI / 4;
            const angleOffset  = catTerms.length > 1
                ? (termIndex - (catTerms.length - 1) / 2) * (spreadAngle / catTerms.length)
                : 0;
            const angle = baseAngle + angleOffset;

            const jx = (Math.random() - 0.5) * 40;
            const jy = (Math.random() - 0.5) * 40;

            const node = {
                id:            term.id,
                x:             this.centerX + Math.cos(angle) * distance + jx,
                y:             this.centerY + Math.sin(angle) * distance + jy,
                vx:            0,
                vy:            0,
                radius,
                term,
                color:         category?.color ?? '#94a3b8',
                highlighted:   false,
                visible:       true,
                currentRadius: radius,
                targetRadius:  radius,
            };

            this.nodes.push(node);
            this.nodeMap.set(term.id, node);
        });

        // Build edges – O(1) dedup with a Set instead of O(n) Array.some()
        const edgeSet = new Set();
        terms.forEach(term => {
            (term.related ?? []).forEach(relId => {
                const key = [term.id, relId].sort().join('|');
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    this.edges.push({ source: term.id, target: relId, strength: 1 });
                }
            });
        });

        // Warm up physics off the critical path using chunked micro-task
        this._warmUpPhysics(50);

        console.log(`[KnowledgeGraph] Loaded ${this.nodes.length} nodes, ${this.edges.length} edges.`);
    }

    /**
     * Run physics warm-up in small synchronous chunks to avoid jank.
     * @param {number} iterations
     */
    _warmUpPhysics(iterations) {
        const CHUNK = 10;
        let done = 0;
        const run = () => {
            const end = Math.min(done + CHUNK, iterations);
            for (; done < end; done++) this._simulatePhysics(0.15);
            if (done < iterations) setTimeout(run, 0);
        };
        run();
    }

    // ─────────────────────────────────────────────
    // PHYSICS  (O(n²) → spatial-grid optimised)
    // ─────────────────────────────────────────────

    _simulatePhysics(dt = 1) {
        if (!this.physics.enabled) return;

        const nodes       = this.nodes;
        const CELL        = 200;         // repulsion cutoff == cell size
        const eps         = 0.001;

        // --- Build spatial grid ---
        const grid = new Map();
        const cellOf = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

        nodes.forEach(node => {
            if (!node.visible) return;
            const key = cellOf(node.x, node.y);
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(node);
        });

        const neighbourCells = (cx, cy) => {
            const result = [];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const key = `${cx + dx},${cy + dy}`;
                    if (grid.has(key)) result.push(...grid.get(key));
                }
            }
            return result;
        };

        // --- Apply forces ---
        nodes.forEach(node => {
            if (!node.visible) return;

            // Centre gravity
            node.vx += (this.centerX - node.x) * this.physics.centerGravity * dt;
            node.vy += (this.centerY - node.y) * this.physics.centerGravity * dt;

            // Repulsion – only check nodes in neighbouring cells
            const cx = Math.floor(node.x / CELL);
            const cy = Math.floor(node.y / CELL);
            const neighbours = neighbourCells(cx, cy);

            neighbours.forEach(other => {
                if (node.id === other.id) return;
                const dx    = node.x - other.x;
                const dy    = node.y - other.y;
                const distSq = dx * dx + dy * dy;
                const dist  = Math.max(Math.sqrt(distSq), 1);
                if (dist < CELL) {
                    const force = this.physics.repulsion / (distSq + eps);
                    node.vx += (dx / dist) * force * dt;
                    node.vy += (dy / dist) * force * dt;
                }
            });
        });

        // Edge attraction
        this.edges.forEach(edge => {
            const src = this.nodeMap.get(edge.source);
            const tgt = this.nodeMap.get(edge.target);
            if (!src || !tgt || !src.visible || !tgt.visible) return;

            const dx  = tgt.x - src.x;
            const dy  = tgt.y - src.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const targetDist = 180;
            const force = (dist - targetDist) * this.physics.attraction;

            src.vx += (dx / dist) * force * dt;
            src.vy += (dy / dist) * force * dt;
            tgt.vx -= (dx / dist) * force * dt;
            tgt.vy -= (dy / dist) * force * dt;
        });

        // Integrate
        const maxV    = this.physics.maxVelocity;
        const padding = this.options.padding;

        nodes.forEach(node => {
            if (!node.visible) return;

            node.vx *= this.physics.damping;
            node.vy *= this.physics.damping;

            // Clamp velocity magnitude
            const v = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
            if (v > maxV) { node.vx = (node.vx / v) * maxV; node.vy = (node.vy / v) * maxV; }

            if (Math.abs(node.vx) > this.physics.minVelocity) node.x += node.vx;
            if (Math.abs(node.vy) > this.physics.minVelocity) node.y += node.vy;

            // Boundary
            node.x = Math.max(padding, Math.min(this.width  - padding, node.x));
            node.y = Math.max(padding, Math.min(this.height - padding, node.y));

            // Smooth radius animation
            node.currentRadius += (node.targetRadius - node.currentRadius) * 0.12;
        });
    }

    // ─────────────────────────────────────────────
    // INTERACTION
    // ─────────────────────────────────────────────

    screenToWorld(sx, sy) {
        return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
    }

    /**
     * Find the topmost visible node at world coordinates.
     * Uses a generous hit-test radius for touch.
     */
    findNodeAt(wx, wy, extra = 0) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            if (!node.visible) continue;
            const dx = wx - node.x;
            const dy = wy - node.y;
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 5 + extra) return node;
        }
        return null;
    }

    _clientPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // ── Mouse ──────────────────────────────────

    _onMouseMove(e) {
        const { x, y } = this._clientPos(e);

        if (this.isDragging) {
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;
            this.panX += dx;
            this.panY += dy;
            this._panTargetX = this.panX;
            this._panTargetY = this.panY;
            this.lastMouse = { x: e.clientX, y: e.clientY };
        } else {
            const world   = this.screenToWorld(x, y);
            const hovered = this.findNodeAt(world.x, world.y);
            if (hovered !== this.hoveredNode) {
                this.hoveredNode = hovered;
                this.canvas.style.cursor = hovered ? 'pointer' : 'grab';
                if (this.onHoverChange) this.onHoverChange(hovered, e);
            }
        }
    }

    _onMouseDown(e) {
        this.isDragging   = true;
        this.lastMouse    = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseUp() {
        this.isDragging = false;
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    }

    _onMouseLeave() {
        this.isDragging = false;
        this.hoveredNode = null;
        if (this.onHoverChange) this.onHoverChange(null, null);
    }

    _onWheel(e) {
        e.preventDefault();
        const { x, y } = this._clientPos(e);
        const delta   = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.options.zoomMin, Math.min(this.options.zoomMax, this.zoom * delta));
        this._animateZoom(newZoom, x, y);
    }

    _onClick(e) {
        // FIX: Original checked `if (!e.clientX)` which is falsy for x=0.
        // Now check for the property being defined instead.
        if (e.clientX === undefined && e.clientY === undefined) return;

        const { x, y } = this._clientPos(e);
        const world    = this.screenToWorld(x, y);
        const node     = this.findNodeAt(world.x, world.y);

        if (node) {
            this.selectedNode            = node;
            node.targetRadius            = node.radius * 1.2;
            setTimeout(() => { if (this.selectedNode === node) node.targetRadius = node.radius; }, 220);
            if (this.onNodeSelect) this.onNodeSelect(node.term);
        } else {
            this.selectedNode = null;
        }
    }

    // ── Touch ──────────────────────────────────

    _onTouchStart(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            const t    = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();

            // Record start for tap-vs-pan discrimination
            this._touchStartPos  = { x: t.clientX - rect.left, y: t.clientY - rect.top };
            this._touchStartTime = performance.now();

            this.isDragging = true;
            this.lastMouse  = { x: t.clientX, y: t.clientY };

        } else if (e.touches.length === 2) {
            e.preventDefault();
            this.isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this._pinchDist = Math.sqrt(dx * dx + dy * dy);
            this._pinchZoom = this.zoom;
        }
    }

    _onTouchMove(e) {
        if (e.touches.length === 1 && this.isDragging) {
            e.preventDefault();
            const t  = e.touches[0];
            const dx = t.clientX - this.lastMouse.x;
            const dy = t.clientY - this.lastMouse.y;
            this.panX += dx;
            this.panY += dy;
            this._panTargetX = this.panX;
            this._panTargetY = this.panY;
            this.lastMouse = { x: t.clientX, y: t.clientY };

        } else if (e.touches.length === 2 && this._pinchDist) {
            e.preventDefault();
            const dx      = e.touches[0].clientX - e.touches[1].clientX;
            const dy      = e.touches[0].clientY - e.touches[1].clientY;
            const dist    = Math.sqrt(dx * dx + dy * dy);
            const factor  = dist / this._pinchDist;
            const newZoom = Math.max(this.options.zoomMin, Math.min(this.options.zoomMax, this._pinchZoom * factor));

            const cx = this.width / 2;
            const cy = this.height / 2;
            this._animateZoom(newZoom, cx, cy);
        }
    }

    _onTouchEnd(e) {
        if (e.changedTouches.length > 0 && this._touchStartPos) {
            const t    = e.changedTouches[0];
            const rect = this.canvas.getBoundingClientRect();
            const ex   = t.clientX - rect.left;
            const ey   = t.clientY - rect.top;

            const distMoved = Math.sqrt(
                (ex - this._touchStartPos.x) ** 2 + (ey - this._touchStartPos.y) ** 2
            );
            const elapsed = performance.now() - this._touchStartTime;

            // Only treat as tap if finger barely moved and lift was quick
            if (distMoved < this._TAP_MAX_DIST && elapsed < this._TAP_MAX_MS) {
                const world = this.screenToWorld(ex, ey);
                // Larger hit buffer (12 px) for fat-finger touch
                const node = this.findNodeAt(world.x, world.y, 12);
                if (node) {
                    this.hoveredNode  = node;
                    this.selectedNode = node;
                    node.targetRadius = node.radius * 1.2;
                    setTimeout(() => { if (this.selectedNode === node) node.targetRadius = node.radius; }, 220);
                    if (this.onNodeSelect)  this.onNodeSelect(node.term);
                    if (this.onHoverChange) this.onHoverChange(node, e);
                } else {
                    this.selectedNode = null;
                    this.hoveredNode  = null;
                    if (this.onHoverChange) this.onHoverChange(null, null);
                }
            }
        }

        this.isDragging    = false;
        this._pinchDist    = null;
        this._touchStartPos = null;
        this.canvas.style.cursor = 'grab';
    }

    // ─────────────────────────────────────────────
    // BIND / UNBIND
    // ─────────────────────────────────────────────

    _bindEvents() {
        const add = (target, type, fn, opts) => {
            target.addEventListener(type, fn, opts);
            this._boundListeners.push({ target, type, fn, opts });
        };

        add(window,       'resize',           () => this._handleResize());
        add(this.canvas,  'mousemove',        (e) => this._onMouseMove(e));
        add(this.canvas,  'mousedown',        (e) => this._onMouseDown(e));
        add(this.canvas,  'mouseup',          ()  => this._onMouseUp());
        add(this.canvas,  'mouseleave',       ()  => this._onMouseLeave());
        add(this.canvas,  'wheel',            (e) => this._onWheel(e),        { passive: false });
        add(this.canvas,  'click',            (e) => this._onClick(e));
        add(this.canvas,  'touchstart',       (e) => this._onTouchStart(e),   { passive: false });
        add(this.canvas,  'touchmove',        (e) => this._onTouchMove(e),    { passive: false });
        add(this.canvas,  'touchend',         (e) => this._onTouchEnd(e));

        // Pause animation when tab is hidden – saves CPU/battery
        add(document, 'visibilitychange', () => {
            if (document.hidden) {
                this.stopAnimation();
            } else {
                this._lastTs = null; // reset deltaTime so no large jump on resume
                this._startAnimation();
            }
        });
    }

    // ─────────────────────────────────────────────
    // RESIZE
    // ─────────────────────────────────────────────

    _handleResize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();

        this.width   = rect.width  || 800;
        this.height  = rect.height || 600;
        this.centerX = this.width  / 2;
        this.centerY = this.height / 2;
        this.dpr     = window.devicePixelRatio || 1;

        this.canvas.width        = Math.round(this.width  * this.dpr);
        this.canvas.height       = Math.round(this.height * this.dpr);
        this.canvas.style.width  = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;

        // FIX: Original called ctx.scale(dpr, dpr) here which accumulates on each resize.
        // render() uses ctx.setTransform(dpr,0,0,dpr,0,0) which resets it absolutely each frame.
        // No scale call needed here.

        // Invalidate cached dot-grid so it redraws at the new size
        this._gridDirty = true;
    }

    // ─────────────────────────────────────────────
    // SMOOTH ZOOM HELPER
    // ─────────────────────────────────────────────

    /**
     * Set a zoom target; the render loop lerps toward it.
     * @param {number} newZoom
     * @param {number} pivotX – screen-space pivot point
     * @param {number} pivotY
     */
    _animateZoom(newZoom, pivotX, pivotY) {
        const scale = newZoom / this.zoom;
        this._panTargetX  = pivotX - (pivotX - this.panX) * scale;
        this._panTargetY  = pivotY - (pivotY - this.panY) * scale;
        this._zoomTarget  = newZoom;
    }

    // ─────────────────────────────────────────────
    // ANIMATION LOOP
    // ─────────────────────────────────────────────

    _startAnimation() {
        if (this.animationId) return; // already running

        const tick = (ts) => {
            // Accurate deltaTime instead of hardcoded 0.016
            const dt = this._lastTs ? Math.min((ts - this._lastTs) / 1000, 0.05) : 0.016;
            this._lastTs = ts;

            this.time += dt;

            // Lerp zoom and pan toward targets
            const LERP = 0.18;
            if (Math.abs(this._zoomTarget - this.zoom) > 0.0005) {
                this.zoom  += (this._zoomTarget  - this.zoom)  * LERP;
                this.panX  += (this._panTargetX  - this.panX)  * LERP;
                this.panY  += (this._panTargetY  - this.panY)  * LERP;
            }

            this._simulatePhysics(dt * 60); // scale physics to ~60fps equivalent
            this._render();
            this.animationId = requestAnimationFrame(tick);
        };

        this.animationId = requestAnimationFrame(tick);
    }

    // ─────────────────────────────────────────────
    // DOT GRID CACHE
    // ─────────────────────────────────────────────

    /**
     * Rebuild the offscreen dot-grid canvas (only on resize / first draw).
     */
    _rebuildGridCache() {
        const w = this.width;
        const h = this.height;

        this._gridCanvas        = document.createElement('canvas');
        this._gridCanvas.width  = Math.round(w * this.dpr);
        this._gridCanvas.height = Math.round(h * this.dpr);

        const gc  = this._gridCanvas.getContext('2d');
        gc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        gc.fillStyle = this.theme.gridDot;

        const gap = 40;
        for (let x = gap; x < w; x += gap) {
            for (let y = gap; y < h; y += gap) {
                gc.beginPath();
                gc.arc(x, y, 1.5, 0, Math.PI * 2);
                gc.fill();
            }
        }

        this._gridDirty = false;
    }

    // ─────────────────────────────────────────────
    // RENDERING
    // ─────────────────────────────────────────────

    _render() {
        const ctx = this.ctx;

        // Reset to device-pixel transform for every frame
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Background
        const bgGrad = ctx.createRadialGradient(
            this.centerX, this.centerY, 0,
            this.centerX, this.centerY, Math.max(this.width, this.height) * 0.7
        );
        bgGrad.addColorStop(0, this.theme.bgGradientCenter);
        bgGrad.addColorStop(1, this.theme.bg);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.width, this.height);

        // Dot grid – draw from cache
        if (this._gridDirty || !this._gridCanvas) this._rebuildGridCache();
        ctx.drawImage(this._gridCanvas, 0, 0, this.width, this.height);

        // World-space drawing
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        this._drawEdges(ctx);
        this._drawNodes(ctx);

        ctx.restore();
    }

    // ─────────────────────────────────────────────
    // EDGES
    // ─────────────────────────────────────────────

    _drawEdges(ctx) {
        const selected = this.selectedNode;
        const hovered  = this.hoveredNode;

        this.edges.forEach(edge => {
            const src = this.nodeMap.get(edge.source);
            const tgt = this.nodeMap.get(edge.target);
            if (!src || !tgt || !src.visible || !tgt.visible) return;

            const srcActive = selected && (selected.id === src.id || selected.id === tgt.id);
            const hovActive = hovered  && (hovered.id  === src.id || hovered.id  === tgt.id);

            let opacity;
            if (selected) {
                opacity = srcActive ? 1.0 : 0.06;
            } else if (hovered) {
                opacity = hovActive ? 0.85 : 0.12;
            } else {
                opacity = 0.55;
            }

            const dx   = tgt.x - src.x;
            const dy   = tgt.y - src.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);

            // Curved control point
            const mx  = (src.x + tgt.x) / 2;
            const my  = (src.y + tgt.y) / 2;
            const off = dist * 0.15;
            const dir = src.id < tgt.id ? 1 : -1;
            const cx  = mx + (dy / dist) * off * dir;
            const cy  = my - (dx / dist) * off * dir;

            // Gradient stroke
            const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
            grad.addColorStop(0, this._hexToRgba(src.color, opacity));
            grad.addColorStop(1, this._hexToRgba(tgt.color, opacity));

            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.quadraticCurveTo(cx, cy, tgt.x, tgt.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = (srcActive || hovActive) ? 2.5 : 1.5;
            ctx.lineCap     = 'round';
            ctx.setLineDash([]);
            ctx.stroke();

            // Arrowhead
            const tangX  = tgt.x - cx;
            const tangY  = tgt.y - cy;
            const angle  = Math.atan2(tangY, tangX);
            const arrowX = tgt.x - Math.cos(angle) * (tgt.radius + 6);
            const arrowY = tgt.y - Math.sin(angle) * (tgt.radius + 6);

            ctx.save();
            ctx.translate(arrowX, arrowY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-8,  4);
            ctx.lineTo(-8, -4);
            ctx.closePath();
            ctx.fillStyle = this._hexToRgba(tgt.color, opacity);
            ctx.fill();
            ctx.restore();

            // Quantum packets on active edges
            if (srcActive || hovActive) {
                ctx.save();
                ctx.shadowBlur  = 12;
                ctx.shadowColor = '#ffffff';

                for (let i = 0; i < 3; i++) {
                    const t   = ((this.time * 0.6) + (i / 3)) % 1;
                    const pos = this._bezierPoint(t, src.x, src.y, cx, cy, tgt.x, tgt.y);
                    const sz  = 2 + Math.sin(this.time * 10 + i) * 0.5;

                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, sz, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                }

                ctx.restore();
            }
        });
    }

    // ─────────────────────────────────────────────
    // NODES
    // ─────────────────────────────────────────────

    _drawNodes(ctx) {
        // Draw selected node last so it renders on top
        const sorted = [...this.nodes].sort((a, b) => {
            if (a.id === this.selectedNode?.id) return  1;
            if (b.id === this.selectedNode?.id) return -1;
            return 0;
        });

        sorted.forEach(node => {
            if (!node.visible) return;

            const isSel  = this.selectedNode?.id === node.id;
            const isHov  = this.hoveredNode?.id  === node.id;
            const dimmed = this.selectedNode && !isSel && !node.highlighted;

            let r = Math.max(1, node.currentRadius + (isSel ? Math.sin(this.time * 4) * 1.5 : 0));

            // Outer scanning rings (selected)
            if (isSel) {
                ctx.save();
                ctx.translate(node.x, node.y);
                ctx.globalAlpha = 0.6;
                ctx.strokeStyle = node.color;
                ctx.lineWidth   = 1.5;
                ctx.setLineDash([4, 8]);
                ctx.rotate(-this.time);
                ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Math.PI * 2); ctx.stroke();

                ctx.setLineDash([]);
                ctx.lineWidth   = 1;
                ctx.globalAlpha = 0.3 + Math.sin(this.time * 5) * 0.2;
                ctx.rotate(this.time * 2);
                ctx.beginPath(); ctx.arc(0, 0, r + 4 + Math.sin(this.time * 3) * 3, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }

            // Highlighted ring (search result)
            if (node.highlighted && !isSel) {
                ctx.save();
                ctx.globalAlpha = 0.7 + Math.sin(this.time * 6) * 0.2;
                ctx.strokeStyle = node.color;
                ctx.lineWidth   = 2;
                ctx.setLineDash([3, 5]);
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            // Shadow / glow
            ctx.shadowColor = (isSel || isHov) ? node.color : 'rgba(0,0,0,0.08)';
            ctx.shadowBlur  = (isSel || isHov) ? 22 : 5;

            // Node body
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

            const grad = ctx.createRadialGradient(
                node.x - r * 0.3, node.y - r * 0.3, r * 0.1,
                node.x,           node.y,            r
            );

            if (isSel || isHov || node.highlighted) {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.4, this._hexToRgba(node.color, dimmed ? 0.3 : 1));
                grad.addColorStop(1,   this._darkenColor(node.color, 20));
            } else {
                grad.addColorStop(0, dimmed ? 'rgba(255,255,255,0.4)' : '#ffffff');
                grad.addColorStop(1, dimmed ? 'rgba(241,245,249,0.3)' : '#f1f5f9');
            }

            ctx.globalAlpha = dimmed ? 0.35 : 1;
            ctx.fillStyle   = grad;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.shadowBlur  = 0;

            // Border
            ctx.strokeStyle = (isSel || isHov) ? node.color : '#cbd5e1';
            ctx.lineWidth   = (isSel || isHov) ? 2.5 : 1;
            ctx.stroke();

            // Label – pixel-accurate truncation via measureText
            ctx.font         = `600 ${this.options.fontSize}px 'Plus Jakarta Sans', sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = isSel ? '#0f172a' : isHov ? node.color : '#64748b';

            ctx.shadowColor = 'rgba(255,255,255,0.85)';
            ctx.shadowBlur  = 4;
            ctx.fillText(this._truncateLabel(ctx, node.term.name, (r - 3) * 2), node.x, node.y);
            ctx.shadowBlur  = 0;
        });
    }

    // ─────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────

    /**
     * Truncate a string to fit within maxPx using canvas measureText.
     * Much more accurate than character-count truncation.
     */
    _truncateLabel(ctx, text, maxPx) {
        if (ctx.measureText(text).width <= maxPx) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + '…').width > maxPx) {
            t = t.slice(0, -1);
        }
        return t + '…';
    }

    _bezierPoint(t, sx, sy, cx, cy, tx, ty) {
        const u = 1 - t;
        return {
            x: u * u * sx + 2 * u * t * cx + t * t * tx,
            y: u * u * sy + 2 * u * t * cy + t * t * ty,
        };
    }

    /**
     * Convert a 3 or 6 char hex colour to rgba() string.
     * Safe: returns a neutral grey for invalid input.
     */
    _hexToRgba(hex, alpha = 1) {
        if (typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(148,163,184,${alpha})`;

        let h = hex.slice(1);
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; // expand shorthand
        if (h.length !== 6) return `rgba(148,163,184,${alpha})`;

        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);

        if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(148,163,184,${alpha})`;
        return `rgba(${r},${g},${b},${alpha})`;
    }

    /**
     * Darken a hex colour by a percentage.
     * Safe: returns #94a3b8 for invalid input.
     */
    _darkenColor(hex, percent) {
        if (typeof hex !== 'string' || !hex.startsWith('#')) return '#94a3b8';

        let h = hex.slice(1);
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        if (h.length !== 6) return '#94a3b8';

        const amt = Math.round(2.55 * percent);
        const num = parseInt(h, 16);
        const R   = Math.max(0, (num >> 16)          - amt);
        const G   = Math.max(0, (num >> 8 & 0x00FF)  - amt);
        const B   = Math.max(0, (num        & 0xFF)  - amt);
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }
}

window.KnowledgeGraph = KnowledgeGraph;
