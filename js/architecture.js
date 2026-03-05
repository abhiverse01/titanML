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
        this.handleBackClick = this.handleBackClick.bind(this);
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
            this.setupEventListeners(); // Setup clicks here
            console.log('Architecture Manager Loaded:', this.data.length, 'architectures');
        } catch (error) {
            console.error('Architecture Manager Error:', error);
        }
    }

    setupEventListeners() {
        // 1. Listen for clicks on the Gallery Grid
        if (this.galleryContainer) {
            this.galleryContainer.addEventListener('click', this.handleGalleryClick);
        }

        // 2. Listen for clicks on the Header (for the Back button)
        const header = document.querySelector('.viz-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.viz-back-btn')) {
                    this.handleBackClick();
                }
            });
        }

        // 3. Listen for Browser Back Button
        window.addEventListener('popstate', this.handlePopState);
    }

    // --- CLICK HANDLERS ---

    handleGalleryClick(e) {
        // Find the closest card that was clicked
        const card = e.target.closest('.arch-card');
        if (!card) return;

        // Get ID from the data attribute
        const archId = card.dataset.id;
        if (archId) {
            this.showVisual(archId);
        }
    }

    handleBackClick() {
        // If we are inside the architecture system, use browser back
        if (this.currentView === 'architecture') {
            window.history.back();
        }
    }

    handlePopState(event) {
        // If the user pressed Back in the browser and we were viewing architecture
        if (this.currentView === 'architecture') {
            this.hideVisual(false); // false = don't push state again
        }
    }

    // --- RENDERING ---

    renderGallery() {
        if (!this.galleryContainer) return;
        
        // Use data-id instead of onclick for better event handling
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

        // 3. Update Browser History (only if entering the view for the first time in this sequence)
        // We check if the current hash is NOT #arch
        if (window.location.hash !== '#arch') {
            history.pushState({ mode: 'architecture' }, '', '#arch');
        }

        if (!archId) {
            // --- SHOW GALLERY ---
            const header = this.visualizerContainer.querySelector('.viz-header');
            if(header) {
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
            if (!arch) return;

            const header = this.visualizerContainer.querySelector('.viz-header');
            if(header) {
                header.innerHTML = `
                    <button class="viz-back-btn">← Back to Gallery</button>
                    <div>
                        <h2 style="font-size: 1.5rem; color: var(--text-primary);">${arch.name}</h2>
                        <p style="color: var(--text-tertiary);">${arch.shortDesc}</p>
                    </div>
                `;
            }

            const flowContainer = this.visualizerContainer.querySelector('.flow-container');
            if(flowContainer) {
                flowContainer.innerHTML = this.renderSteps(arch.steps);
            }
            
            this.galleryContainer.style.display = 'none';
            this.visualizerContainer.style.display = 'block';
        }
    }

    hideVisual(manageHistory = true) {
        // If we are managing history (internal button click), go back
        if (manageHistory && window.location.hash === '#arch') {
            window.history.back();
            return;
        }

        // Otherwise, just update the UI (this happens when browser back is pressed)
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
