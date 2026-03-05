class ArchitectureManager {
    constructor() {
        this.data = [];
        this.container = document.getElementById('archView');
        this.galleryContainer = document.getElementById('archGallery');
        this.visualizerContainer = document.getElementById('archVisualizer');
        this.isLoaded = false;
        this.currentView = 'graph'; // 'graph' or 'architecture'
        
        // Bind methods to keep 'this' context
        this.handleGalleryClick = this.handleGalleryClick.bind(this);
        this.handleViewClick = this.handleViewClick.bind(this);
        this.handlePopState = this.handlePopState.bind(this);
        
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
            // Fallback if JSON fails (for testing)
            console.warn("Ensure data/architecture.json exists and is valid JSON.");
        }
    }

    setupEventListeners() {
        // 1. Listen for clicks on the Gallery Grid
        if (this.galleryContainer) {
            this.galleryContainer.addEventListener('click', this.handleGalleryClick);
        }

        // 2. Listen for clicks ANYWHERE in the Architecture View (Catches Back Button)
        if (this.container) {
            this.container.addEventListener('click', this.handleViewClick);
        }

        // 3. Listen for Browser Back Button
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

    // Handles Back button clicks anywhere inside #archView
    handleViewClick(e) {
        if (e.target.closest('.viz-back-btn')) {
            this.handleBackClick();
        }
    }

    handleBackClick() {
        if (this.currentView === 'architecture') {
            window.history.back();
        }
    }

    handlePopState(event) {
        if (this.currentView === 'architecture') {
            this.hideVisual(false);
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
        // 1. Ensure data is loaded
        if (!this.isLoaded) {
            await this.init();
        }

        const content = document.getElementById('content');
        const sidebar = document.querySelector('.sidebar');
        
        // 2. Show Architecture Container
        if(content) content.style.display = 'none';
        if(sidebar) sidebar.style.display = 'none'; 
        this.container.style.display = 'flex';
        this.currentView = 'architecture';

        // 3. Update Browser History
        if (window.location.hash !== '#arch') {
            history.pushState({ mode: 'architecture' }, '', '#arch');
        }

        // 4. Render Content
        // We use 'this.container' (Parent) to find the Header, because Header is a sibling of Visualizer
        const header = this.container.querySelector('.viz-header');
        const flowContainer = this.visualizerContainer.querySelector('.flow-container');

        if (!archId) {
            // --- SHOW GALLERY ---
            if (header) {
                header.innerHTML = `
                    <button class="viz-back-btn">← Back to Graph</button>
                    <div>
                        <h2 style="font-size: 1.5rem; color: var(--text-primary);">AI Architectures</h2>
                        <p style="color: var(--text-tertiary);">Explore the blueprints of modern AI.</p>
                    </div>
                `;
            }
            this.visualizerContainer.style.display = 'none';
            this.galleryContainer.style.display = 'grid';
        } else {
            // --- SHOW SPECIFIC ARCHITECTURE ---
            const arch = this.data.find(a => a.id === archId);
            if (!arch) {
                console.error("Architecture not found:", archId);
                return;
            }

            if (header) {
                header.innerHTML = `
                    <button class="viz-back-btn">← Back to Gallery</button>
                    <div>
                        <h2 style="font-size: 1.5rem; color: var(--text-primary);">${arch.name}</h2>
                        <p style="color: var(--text-tertiary);">${arch.shortDesc}</p>
                    </div>
                `;
            }

            if (flowContainer) {
                flowContainer.innerHTML = this.renderSteps(arch.steps);
            } else {
                console.error("Flow container not found!");
            }
            
            this.galleryContainer.style.display = 'none';
            this.visualizerContainer.style.display = 'block';
        }
    }

    hideVisual(manageHistory = true) {
        if (manageHistory && window.location.hash === '#arch') {
            window.history.back();
            return;
        }

        this.container.style.display = 'none';
        this.container.classList.remove('active');
        
        const content = document.getElementById('content');
        const sidebar = document.querySelector('.sidebar');
        
        if(content) content.style.display = 'flex';
        if(sidebar) sidebar.style.display = 'flex';
        
        this.currentView = 'graph';
    }

    // --- RECURSIVE RENDERER ---
    renderSteps(steps) {
        if(!steps) return '';
        return steps.map((step, index) => {
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
