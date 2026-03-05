class ArchitectureManager {
    constructor() {
        this.data = [];
        this.container = document.getElementById('archView');
        this.galleryContainer = document.getElementById('archGallery');
        this.visualizerContainer = document.getElementById('archVisualizer');
        this.isLoaded = false;
    }

    async init() {
        if (this.isLoaded) return;
        try {
            const response = await fetch('data/architecture.json');
            if (!response.ok) throw new Error('Failed to load architecture data');
            this.data = await response.json();
            this.isLoaded = true;
            this.renderGallery();
            console.log('Architecture Manager Loaded:', this.data.length, 'architectures');
        } catch (error) {
            console.error('Architecture Manager Error:', error);
        }
    }

    // 1. Render the Grid of Cards
    renderGallery() {
        if (!this.galleryContainer) return;
        
        this.galleryContainer.innerHTML = this.data.map(arch => `
            <div class="arch-card" onclick="window.archManager.showVisual('${arch.id}')">
                <div class="arch-category">${arch.category}</div>
                <div class="arch-title">${arch.name}</div>
                <div class="arch-desc">${arch.shortDesc}</div>
            </div>
        `).join('');
    }

    
    // 2. Switch to Visualizer View
    async showVisual(archId) {
        // 1. Ensure data is loaded before doing anything
        if (!this.isLoaded) {
            await this.init();
        }

        // 2. Hide Content (Graph) and Sidebar, Show Arch View
        const content = document.getElementById('content');
        const sidebar = document.querySelector('.sidebar');
        
        if(content) content.style.display = 'none';
        if(sidebar) sidebar.classList.add('hidden'); 
        
        this.container.style.display = 'flex';
        this.container.classList.add('active');

        // 3. Handle View Logic
        if (!archId) {
            // --- SHOW GALLERY ---
            const header = this.visualizerContainer.querySelector('.viz-header');
            header.innerHTML = `
                <button class="viz-back-btn" onclick="window.archManager.hideVisual()">← Back to Graph</button>
                <div>
                    <h2 style="font-size: 1.5rem; color: var(--text-primary);">AI Architectures</h2>
                    <p style="color: var(--text-tertiary);">Explore the blueprints of modern AI.</p>
                </div>
            `;
            // Ensure gallery is visible, visualizer is hidden
            this.visualizerContainer.style.display = 'none';
            this.galleryContainer.style.display = 'grid';
        } else {
            // --- SHOW SPECIFIC ARCHITECTURE ---
            const arch = this.data.find(a => a.id === archId);
            if (!arch) return;

            const header = this.visualizerContainer.querySelector('.viz-header');
            header.innerHTML = `
                <button class="viz-back-btn" onclick="window.archManager.showVisual(null)">← Back to Gallery</button>
                <div>
                    <h2 style="font-size: 1.5rem; color: var(--text-primary);">${arch.name}</h2>
                    <p style="color: var(--text-tertiary);">${arch.shortDesc}</p>
                </div>
            `;

            // Render Flowchart
            const flowContainer = this.visualizerContainer.querySelector('.flow-container');
            flowContainer.innerHTML = this.renderSteps(arch.steps);
            
            // Swap visibility
            this.galleryContainer.style.display = 'none';
            this.visualizerContainer.style.display = 'block';
        }
    }
    

    // 3. Hide Visualizer (Return to Graph)
    hideVisual() {
        this.container.style.display = 'none';
        this.container.classList.remove('active');
        document.getElementById('content').style.display = 'flex';
        document.querySelector('.sidebar').classList.remove('hidden');
    }

    // 4. Recursive Function to Render Steps (Handles Nesting)
    renderSteps(steps) {
        return steps.map((step, index) => {
            let typeClass = `step-type-${step.type || 'process'}`;
            
            // If this step has children, we need a container
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
