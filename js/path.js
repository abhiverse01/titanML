/* ==========================================
   TITANML KNOWLEDGE PATH ENGINE
   ========================================== */

class KnowledgePaths {
    constructor() {
        this.paths = [];
        this.activePath = null;
        this.container = null;
        this.mode = 'gallery'; // 'gallery' or 'steps'
    }

    async init() {
        try {
            const res = await fetch("data/knowledgePath.json");
            const data = await res.json();

            // Flatten the JSON structure in case of nested paths (like LLM Engineer)
            if (data.paths) {
                this.paths = data.paths;
            } else {
                this.paths = data; // Fallback if structure is flat
            }

            this.renderPathGallery();
            console.log("🧭 Knowledge Paths Loaded:", this.paths.length, "paths");
        } catch (err) {
            console.error("Knowledge Paths failed:", err);
        }
    }

    // --- UI RENDERERS ---

    renderPathGallery() {
        const container = document.getElementById("pathGallery");
        if(!container) return;

        container.innerHTML = "";

        this.paths.forEach(path => {
            const card = document.createElement("div");
            card.className = "path-card";
            
            card.innerHTML = `
                <div class="path-title">${path.title}</div>
                <div class="path-desc">${path.description}</div>
                <div class="path-meta">
                    <span class="badge">${path.difficulty}</span>
                </div>
                <button class="path-start">Start Path</button>
            `;

            card.querySelector(".path-start").addEventListener("click", () => {
                this.startPath(path.id);
            });

            container.appendChild(card);
        });
    }

    startPath(pathId) {
        const path = this.paths.find(p => p.id === pathId || p.title === pathId);
        if(!path) return;

        // If path has nested paths, flatten them or handle as a sub-view. 
        // For simplicity in this version, we just show the immediate steps.
        let steps = path.steps;
        
        // If it's a "path of paths" (like LLM Engineer), we render the sub-paths as clickable
        if(path.paths && !path.steps) {
            this.renderSubPaths(path.paths);
            this.mode = 'subpaths';
        } else {
            // Regular path of terms
            this.activePath = path;
            this.renderPathSteps(steps);
            this.mode = 'steps';
        }
    }
    
    renderSubPaths(subPaths) {
        const viewer = document.getElementById("pathViewer");
        if(!viewer) return;

        // Update Header
        const header = viewer.querySelector('.viz-header');
        if(header) {
            header.innerHTML = `
                <button class="viz-back-btn">← Back</button>
                <h2 style="font-size: 1.5rem; color: var(--text-primary);">Specializations</h2>
            `;
            // Re-attach listener for back button
            header.querySelector('.viz-back-btn').onclick = () => {
                this.renderPathGallery(); // Go back to main gallery
            };
        }

        const container = document.getElementById("pathGallery");
        container.innerHTML = ""; // Clear previous
        
        subPaths.forEach(path => {
            const card = document.createElement("div");
            card.className = "path-card";
            
            card.innerHTML = `
                <div class="path-title">${path.title}</div>
                <div class="path-desc">${path.description}</div>
                <div class="path-meta">
                    <span class="badge">${path.difficulty || 'Advanced'}</span>
                </div>
                <button class="path-start">Explore</button>
            `;

            card.querySelector(".path-start").addEventListener("click", () => {
                // Recursively handle sub-paths or term opening
                if (path.paths) {
                    this.renderSubPaths(path.paths);
                } else {
                    this.renderPathSteps(path.steps); // Render steps if no more sub-paths
                }
            });

            container.appendChild(card);
        });
    }

    renderPathSteps(steps) {
        const viewer = document.getElementById("pathViewer");
        const gallery = document.getElementById("pathGallery");
        const header = document.querySelector('.viz-header');
        
        if(!viewer) return;

        // Update Header
        if(header) {
            header.innerHTML = `
                <button class="viz-back-btn">← Back</button>
                <h2 style="font-size: 1.5rem; color: var(--text-primary);">${this.activePath.title}</h2>
            `;
            // Re-attach listener for back button
            header.querySelector('.viz-back-btn').onclick = () => {
                // Check if we came from a sub-path
                if (this.mode === 'subpaths') {
                    // Logic to go back to parent path is complex without state stack. 
                    // For now, just go back to main gallery.
                    this.renderPathGallery();
                } else {
                    this.renderPathGallery(); // Go back to main gallery
                }
            };
        }

        gallery.style.display = 'none';
        viewer.style.display = 'block';

        const viewerContainer = document.createElement('div');
        viewerContainer.className = 'path-steps-container';
        
        this.activePath.steps.forEach((step, i) => {
            const stepEl = document.createElement("div");
            stepEl.className = "path-step";
            
            stepEl.innerHTML = `
                <div class="step-index">${i+1}</div>
                <div class="step-name">${step}</div>
                <button class="step-open">Open</button>
            `;

            stepEl.querySelector(".step-open").addEventListener("click", () => {
                this.focusTerm(step);
            });

            viewerContainer.appendChild(stepEl);
        });

        // Replace old content in viewer
        const oldViewer = viewer.querySelector('.path-steps-container');
        if(oldViewer) oldViewer.remove();
        
        viewer.appendChild(viewerContainer);
    }

    // --- LOGIC ---

    focusTerm(termName) {
        // 1. Hide Paths View
        document.getElementById('pathView').style.display = 'none';
        
        // 2. Show Main Graph
        const content = document.getElementById('content');
        if(content) content.style.display = 'flex';

        // 3. Try to find the term in the graph
        if (window.app && window.app.focusTerm) {
            window.app.focusTerm(termName);
        } else {
            console.warn("Window.app not found. Make sure app.js exposes window.app.");
        }
    }
}

// Initialize globally
window.KnowledgePaths = new KnowledgePaths();
