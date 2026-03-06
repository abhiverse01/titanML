class ArchitectureManager {
    constructor() {
        this.data = [];
        this.container = document.getElementById('archView');
        this.galleryContainer = document.getElementById('archGallery');
        this.visualizerContainer = document.getElementById('archVisualizer');
        this.isLoaded = false;
        this.currentView = 'graph';   // 'graph' | 'gallery' | 'architecture'
        this.currentArchId = null;    // FIX #3: track which arch is open (null = gallery)

        // Bind methods to keep 'this' context
        this.handleGalleryClick = this.handleGalleryClick.bind(this);
        this.handleViewClick    = this.handleViewClick.bind(this);
        this.handlePopState     = this.handlePopState.bind(this);

        this.init();
    }

    async init() {
        if (this.isLoaded) return;
        try {
            const response = await fetch('data/architecture.json');
            if (!response.ok) throw new Error('Failed to load architecture data');
            this.data = await response.json();
            this.isLoaded = true;
            this.renderGallery();
            this.setupEventListeners();
            console.log('Architecture Manager Loaded:', this.data.length, 'architectures');
        } catch (error) {
            console.error('Architecture Manager Error:', error);
        }
    }

    setupEventListeners() {
        if (this.galleryContainer) {
            this.galleryContainer.addEventListener('click', this.handleGalleryClick);
        }
        if (this.container) {
            this.container.addEventListener('click', this.handleViewClick);
        }
        window.addEventListener('popstate', this.handlePopState);
    }

    // --- CLICK HANDLERS ---

    handleGalleryClick(e) {
        const card = e.target.closest('.arch-card');
        if (!card) return;
        const archId = card.dataset.id;
        if (archId) {
            this.showVisual(archId);
        }
    }

    handleViewClick(e) {
        if (e.target.closest('.viz-back-btn')) {
            this.handleBackClick();
        }
    }

    handleBackClick() {
        // FIX #1 + #2: always use history.back() so popstate handles
        // the correct state transition (arch-detail → gallery → graph)
        if (this.currentView === 'gallery' || this.currentView === 'architecture') {
            window.history.back();
        }
    }

    // FIX #1 + #2: popstate now restores the correct view based on saved state
    handlePopState(event) {
        const state = event.state;

        if (state && state.mode === 'architecture') {
            // Popped to an arch-detail state (shouldn't normally happen via back,
            // but handles forward navigation correctly)
            this._activateContainer();
            this._showArchView(state.archId);
        } else if (state && state.mode === 'gallery') {
            // Popped back from arch-detail → restore gallery
            this._activateContainer();
            this._showGalleryView();
        } else {
            // Popped all the way back → hide the arch view entirely
            if (this.currentView !== 'graph') {
                this.hideVisual(false);
            }
        }
    }

    // --- RENDERING ---

    renderGallery() {
        if (!this.galleryContainer) return;
        this.galleryContainer.innerHTML = this.data.map(arch => `
            <div class="arch-card" data-id="${arch.id}">
                <div class="arch-category">${arch.category}</div>
                <div class="arch-title">${arch.name}</div>
                <div class="arch-desc">${arch.shortDesc}</div>
            </div>
        `).join('');
    }

    // --- VIEW SWITCHING ---

    async showVisual(archId) {
        if (!this.isLoaded) {
            await this.init();
        }

        this._activateContainer();

        if (!archId) {
            // --- SHOW GALLERY ---
            // FIX #2: push a gallery-specific history state
            history.pushState({ mode: 'gallery' }, '', '#arch');
            this._showGalleryView();
        } else {
            // --- SHOW SPECIFIC ARCHITECTURE ---
            // FIX #2: always push a new state so browser back returns to gallery first
            history.pushState({ mode: 'architecture', archId }, '', '#arch');
            this._showArchView(archId);
        }
    }

    // FIX #9: extracted helper — shows/hides the outer container & sidebar once
    _activateContainer() {
        const content = document.getElementById('content');
        const sidebar = document.querySelector('.sidebar');

        if (content) content.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        this.container.style.display = 'flex';
        this.currentView = 'architecture'; // outer state (inside arch section)
    }

    // FIX #9: dedicated gallery renderer
    _showGalleryView() {
        this.currentArchId = null;          // FIX #3
        this.currentView = 'gallery';

        const header = this.container.querySelector('.viz-header');
        if (header) {
            header.innerHTML = `
                <button class="viz-back-btn">← Back to Graph</button>
                <div>
                    <h2 style="font-size: 1.5rem; color: var(--text-primary);">AI Architectures</h2>
                    <p style="color: var(--text-tertiary);">Explore the blueprints of modern AI.</p>
                </div>
            `;
        }

        // FIX #5: null-guard before access
        if (this.visualizerContainer) {
            this.visualizerContainer.innerHTML = '';
            this.visualizerContainer.style.display = 'none';
        }
        if (this.galleryContainer) {
            this.galleryContainer.style.display = 'grid';
        }
    }

    // FIX #9: dedicated arch-detail renderer
    _showArchView(archId) {
        const arch = this.data.find(a => a.id === archId);

        if (!arch) {
            console.error('Architecture not found for ID:', archId);
            // FIX #4: replaced alert() with a graceful inline error message
            if (this.visualizerContainer) {
                this.visualizerContainer.innerHTML = `
                    <p style="color: var(--text-tertiary); padding: 2rem;">
                        Architecture data not found for "${archId}".
                    </p>`;
                this.visualizerContainer.style.display = 'block';
            }
            return;
        }

        this.currentArchId = archId;        // FIX #3
        this.currentView = 'architecture';

        const header = this.container.querySelector('.viz-header');
        if (header) {
            header.innerHTML = `
                <button class="viz-back-btn">← Back to Gallery</button>
                <div>
                    <h2 style="font-size: 1.5rem; color: var(--text-primary);">${arch.name}</h2>
                    <p style="color: var(--text-tertiary);">${arch.shortDesc}</p>
                </div>
            `;
        }

        // FIX #5: null-guard before access
        if (this.visualizerContainer) {
            this.visualizerContainer.innerHTML = `
                <div class="flow-container">
                    ${this.renderSteps(arch.steps)}
                </div>
            `;
            this.visualizerContainer.style.display = 'block';
        }
        if (this.galleryContainer) {
            this.galleryContainer.style.display = 'none';
        }
    }

    hideVisual(manageHistory = true) {
        // FIX #10: restore transition after hiding so future shows aren't broken
        this.container.style.transition = 'none';
        this.container.style.display = 'none';
        this.container.classList.remove('active');

        const content = document.getElementById('content');
        const sidebar = document.querySelector('.sidebar');

        if (content) content.style.display = 'flex';
        if (sidebar) sidebar.style.display = 'flex';

        this.currentView = 'graph';
        this.currentArchId = null;          // FIX #3

        // Re-enable transitions on next frame so restoring doesn't skip animations
        requestAnimationFrame(() => {
            this.container.style.transition = '';  // FIX #10
        });

        if (manageHistory && window.location.hash === '#arch') {
            // FIX #6: use pathname instead of ' ' to reliably clear the hash
            history.pushState(null, '', window.location.pathname);
        }
    }

    // --- RECURSIVE RENDERER ---
    renderSteps(steps) {
        // FIX #8: guard both null/undefined and empty array
        if (!steps || !steps.length) return '';

        return steps.map((step) => {   // FIX #7: removed unused `index` param
            let typeClass = `step-type-${step.type || 'process'}`;

            let childrenHtml = '';
            if (step.children && step.children.length > 0) {
                typeClass += ' step-type-container';
                childrenHtml = `<div class="step-children">${this.renderSteps(step.children)}</div>`;
            }

            return `
                <div class="flow-step">
                    <div class="step-box ${typeClass}">
                        <div class="step-label">${step.label}</div>
                        ${step.desc ? `<div class="step-desc">${step.desc}</div>` : ''}
                    </div>
                    ${childrenHtml}
                </div>
            `;
        }).join('');
    }
}

// Initialize globally
window.archManager = new ArchitectureManager();
