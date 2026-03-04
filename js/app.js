/**
 * AI Knowledge Nexus - Main Application (POWERED UP)
 */

class App {
    constructor() {
        this.graph = null;
        this.state = {
            searchQuery: '',
            selectedCategory: null,
            selectedTerm: null,
            // PowerUp: Navigation History
            history: [],
            historyIndex: -1
        };
        this.initialized = false;
        
        this.init(); 
    }
    
    async init() {
        // 1. Wait for the data to load first!
        if (window.dataLoadPromise) {
            await window.dataLoadPromise;
        } else {
            console.error("dataLoadPromise not found. Is data.js loaded?");
            return;
        }

        // 2. Check if data actually loaded
        if (!KnowledgeBase.isLoaded) {
            console.error("Data failed to load. Check console for CORS or JSON errors.");
            // Optional: Show a friendly error to the user on the page
            document.body.innerHTML = '<div style="color:red;padding:20px;text-align:center;">Failed to load knowledge data. Please run this project using a local server (e.g., "Live Server" in VS Code).</div>';
            return;
        }

        // 3. Proceed with DOM readiness
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }
    
    setup() {
        console.log('Setting up app...');
        
        try {
            if (!window.KnowledgeBase) { console.error('KnowledgeBase not loaded'); return; }
            if (!window.KnowledgeGraph) { console.error('KnowledgeGraph not loaded'); return; }
            if (!window.KnowledgeUtils) { console.error('KnowledgeUtils not loaded'); return; }
            
            // Initialize graph
            this.graph = new KnowledgeGraph('graphCanvas');
            this.graph.loadData();
            
            // Set callbacks
            this.graph.onNodeSelect = (term) => this.navigateTerm(term); // Changed to navigateTerm
            this.graph.onHoverChange = (node, e) => this.handleHover(node, e);
            
            // Render UI
            this.renderCategories();
            this.renderLegend();
            this.updateStats();
            this.populateCategorySelect();
            
            // Bind events
            this.bindEvents();
            
            // PowerUp: Handle Deep Linking on start
            this.handleInitialRoute();
            
            this.initialized = true;
            console.log('App initialized successfully. Press "/" to search, "F" for fullscreen.');
            
        } catch (error) {
            console.error("CRITICAL ERROR IN SETUP:", error);
        }
    }

    // PowerUp: Debounce helper for performance
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    bindEvents() {
        // PowerUp: Debounced Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            const debouncedSearch = this.debounce((value) => {
                this.state.searchQuery = value;
                if (this.graph) this.graph.highlightNodes(value);
            }, 150);
            
            searchInput.addEventListener('input', (e) => {
                debouncedSearch(e.target.value);
            });
        }
        
        // PowerUp: Enhanced Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            // Focus Search (/)
            if (e.key === '/' && document.activeElement !== searchInput) {
                e.preventDefault();
                if (searchInput) searchInput.focus();
            }
            
            // Escape
            if (e.key === 'Escape') {
                this.closeDetailPanel();
                this.closeModal();
                if (searchInput) searchInput.blur();
            }
            
            // PowerUp: Fullscreen (F)
            if (e.key === 'f' || e.key === 'F') {
                if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                    this.toggleFullscreen();
                }
            }

            // PowerUp: History Navigation (Alt + Left/Right)
            if (e.altKey) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.goBack();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.goForward();
                }
            }
        });
        
        // PowerUp: Listen for URL hash changes (Back/Forward button in browser)
        window.addEventListener('hashchange', () => {
            this.handleRouteChange();
        });

        // Sidebar toggle
        const toggleBtn = document.getElementById('toggleSidebar');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (window.innerWidth <= 1024) {
                    sidebar.classList.toggle('open'); 
                } else {
                    sidebar.classList.toggle('collapsed');
                }
            });
        }
        
        // Category list
        const categoryList = document.getElementById('categoryList');
        if (categoryList) {
            categoryList.addEventListener('click', (e) => {
                const item = e.target.closest('.category-item');
                if (!item) return;
                
                document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
                
                const categoryId = item.dataset.category;
                if (this.state.selectedCategory === categoryId) {
                    this.state.selectedCategory = null;
                    if (this.graph) this.graph.filterByCategory(null);
                } else {
                    item.classList.add('active');
                    this.state.selectedCategory = categoryId;
                    if (this.graph) this.graph.filterByCategory(categoryId);
                }
            });
        }
        
        // Filters
        const filterList = document.getElementById('filterList');
        if (filterList) {
            filterList.addEventListener('click', (e) => {
                const item = e.target.closest('.filter-item');
                if (!item) return;
                
                document.querySelectorAll('.filter-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                const filter = item.dataset.filter;
                if (this.graph) {
                    if (filter === 'all') {
                        this.state.selectedCategory = null;
                        this.graph.nodes.forEach(n => n.visible = true);
                    } else {
                        this.graph.nodes.forEach(n => n.visible = n.term.type === filter);
                    }
                }
            });
        }
        
        // Graph controls
        const zoomIn = document.getElementById('zoomIn');
        const zoomOut = document.getElementById('zoomOut');
        const resetView = document.getElementById('resetView');
        
        if (zoomIn) zoomIn.addEventListener('click', () => this.graph && this.graph.zoomIn());
        if (zoomOut) zoomOut.addEventListener('click', () => this.graph && this.graph.zoomOut());
        if (resetView) resetView.addEventListener('click', () => this.graph && this.graph.resetView());
        
        // Detail panel
        const closePanel = document.getElementById('closePanel');
        if (closePanel) {
            closePanel.addEventListener('click', () => this.closeDetailPanel());
        }
        
        // Related terms
        const relatedTerms = document.getElementById('relatedTerms');
        if (relatedTerms) {
            relatedTerms.addEventListener('click', (e) => {
                const item = e.target.closest('.related-item');
                if (!item) return;
                
                const termId = item.dataset.termId;
                const term = KnowledgeUtils.getTerm(termId);
                if (term) {
                    this.navigateTerm(term);
                    if (this.graph) this.graph.selectedNode = this.graph.findNode(termId);
                }
            });
        }
        
        // Add term modal
        const addTermBtn = document.getElementById('addTermBtn');
        const closeModalBtn = document.getElementById('closeModal');
        const cancelAdd = document.getElementById('cancelAdd');
        const addModal = document.getElementById('addModal');
        
        if (addTermBtn) addTermBtn.addEventListener('click', () => this.openModal());
        if (closeModalBtn) closeModalBtn.addEventListener('click', () => this.closeModal());
        if (cancelAdd) cancelAdd.addEventListener('click', () => this.closeModal());
        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target.id === 'addModal') this.closeModal();
            });
        }
        
        // Add term form
        const addTermForm = document.getElementById('addTermForm');
        if (addTermForm) {
            addTermForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddTerm(new FormData(e.target));
            });
        }
    }

    // ==========================================
    // POWERUP: ROUTING & HISTORY
    // ==========================================

    handleInitialRoute() {
        const hash = window.location.hash.slice(1);
        if (hash) {
            const term = KnowledgeUtils.getTerm(hash);
            if (term) {
                this.showTermDetail(term, false); // false = don't push to history yet
                if (this.graph) {
                    this.graph.selectedNode = this.graph.findNode(hash);
                }
            }
        }
    }

    handleRouteChange() {
        const hash = window.location.hash.slice(1);
        // If hash is empty, close panel
        if (!hash) {
            this.closeDetailPanel(false);
        } else {
            // Only update if it's different from current selection to avoid loops
            if (!this.state.selectedTerm || this.state.selectedTerm.id !== hash) {
                const term = KnowledgeUtils.getTerm(hash);
                if (term) {
                    this.showTermDetail(term, false);
                }
            }
        }
    }

    navigateTerm(term) {
        if (!term) return;
        
        // Push to history stack
        // Remove future history if we navigated back and then clicked a new node
        if (this.state.historyIndex < this.state.history.length - 1) {
            this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        }
        
        this.state.history.push(term.id);
        this.state.historyIndex = this.state.history.length - 1;

        this.showTermDetail(term, true);
    }

    goBack() {
        if (this.state.historyIndex > 0) {
            this.state.historyIndex--;
            const termId = this.state.history[this.state.historyIndex];
            const term = KnowledgeUtils.getTerm(termId);
            if (term) {
                this.showTermDetail(term, false); // Don't push
                window.location.hash = term.id; // Update URL silently
            }
        }
    }

    goForward() {
        if (this.state.historyIndex < this.state.history.length - 1) {
            this.state.historyIndex++;
            const termId = this.state.history[this.state.historyIndex];
            const term = KnowledgeUtils.getTerm(termId);
            if (term) {
                this.showTermDetail(term, false); // Don't push
                window.location.hash = term.id; // Update URL silently
            }
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
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
            <div class="category-item" data-category="${cat.id}">
                <div class="category-dot" style="background: ${cat.color};"></div>
                <span class="category-name">${cat.name}</span>
                <span class="category-count">${stats.byCategory[cat.id] || 0}</span>
            </div>
        `).join('');
    }
    
    renderLegend() {
        const container = document.getElementById('legendItems');
        if (!container || !window.KnowledgeBase) return;
        
        container.innerHTML = KnowledgeBase.categories.map(cat => `
            <div class="legend-item">
                <div class="legend-dot" style="background: ${cat.color};"></div>
                <span>${cat.name}</span>
            </div>
        `).join('');
    }
    
    updateStats() {
        if (!window.KnowledgeUtils) return;
        
        const stats = KnowledgeUtils.getStats();
        
        const statCategories = document.getElementById('statCategories');
        const statTerms = document.getElementById('statTerms');
        const statConnections = document.getElementById('statConnections');
        const totalCount = document.getElementById('totalCount');
        
        if (statCategories) statCategories.textContent = stats.categories;
        if (statTerms) statTerms.textContent = stats.terms;
        if (statConnections) statConnections.textContent = stats.connections;
        if (totalCount) totalCount.textContent = stats.terms;
    }
    
    populateCategorySelect() {
        const select = document.getElementById('categorySelect');
        if (!select || !window.KnowledgeBase) return;
        
        select.innerHTML = KnowledgeBase.categories.map(cat => 
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');
    }
    
    showTermDetail(term, pushState = true) {
        if (!term) return;
        
        const panel = document.getElementById('detailPanel');
        if (!panel) return;
        
        const category = KnowledgeBase.categories.find(c => c.id === term.category);
        
        // Badge
        const badge = document.getElementById('panelBadge');
        if (badge) {
            badge.textContent = category ? category.name : 'General';
            badge.style.color = category ? category.color : '#6b7280';
            badge.style.background = category ? category.color + '15' : '#f3f4f6';
        }
        
        // Title & subtitle
        const title = document.getElementById('panelTitle');
        const subtitle = document.getElementById('panelSubtitle');
        if (title) title.textContent = term.fullName || term.name;
        if (subtitle) subtitle.textContent = term.shortDesc;
        
        // Definition
        // Definition (Markdown Enabled)
        const definition = document.getElementById('panelDefinition');
        if (definition) {
            definition.innerHTML = this.parseMarkdown(term.definition);
        }
        
        // Related terms
        const relatedContainer = document.getElementById('relatedTerms');
        if (relatedContainer) {
            if (term.related && term.related.length > 0) {
                relatedContainer.innerHTML = term.related.map(relId => {
                    const relTerm = KnowledgeUtils.getTerm(relId);
                    if (!relTerm) return '';
                    const relCat = KnowledgeBase.categories.find(c => c.id === relTerm.category);
                    return `
                        <div class="related-item" data-term-id="${relId}">
                            <div class="related-name">${relTerm.name}</div>
                            <div class="related-type">${relCat ? relCat.name : 'General'}</div>
                        </div>
                    `;
                }).filter(Boolean).join('') || '<p style="color:var(--text-muted);font-size:var(--font-size-sm);">No related terms found</p>';
            } else {
                relatedContainer.innerHTML = '<p style="color:var(--text-muted);font-size:var(--font-size-sm);">No related terms</p>';
            }
        }
        
        // Code
        const codeContainer = document.getElementById('panelCode');
        if (codeContainer) {
            codeContainer.textContent = term.codeExample || '// No code example available';
            
            // PowerUp: Inject Copy Button dynamically
            this.injectCopyButton(codeContainer.parentElement);
        }
        
        // Tags
        const tagContainer = document.getElementById('panelTags');
        if (tagContainer) {
            tagContainer.innerHTML = term.tags.map(tag => 
                `<span class="tag">${tag}</span>`
            ).join('');
        }
        
        panel.classList.add('open');
        this.state.selectedTerm = term;

        // PowerUp: Update URL
        if (pushState) {
            window.location.hash = term.id;
        }
    }
    
    // PowerUp: Inject Copy Button
    injectCopyButton(container) {
        if (!container) return;
        // Remove existing button if any
        const existingBtn = container.querySelector('.copy-btn-dynamic');
        if (existingBtn) existingBtn.remove();

        const btn = document.createElement('button');
        btn.className = 'copy-btn-dynamic';
        btn.textContent = 'Copy';
        btn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            padding: 4px 10px;
            font-size: 11px;
            font-family: var(--font-family);
            background: rgba(255,255,255,0.1);
            color: #cbd5e1;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        `;

        btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.2)'; };
        btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.1)'; };
        
        btn.onclick = () => {
            const code = container.querySelector('code').textContent;
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            });
        };

        container.style.position = 'relative';
        container.appendChild(btn);
    }

    closeDetailPanel(clearHash = true) {
        const panel = document.getElementById('detailPanel');
        if (panel) panel.classList.remove('open');
        this.state.selectedTerm = null;
        if (this.graph) this.graph.selectedNode = null;
        
        // PowerUp: Clear URL hash
        if (clearHash && window.location.hash) {
            history.pushState("", document.title, window.location.pathname + window.location.search);
        }
    }
    
    handleHover(node, e) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;
        
        if (node) {
            tooltip.innerHTML = `<strong>${node.term.name}</strong><br><span style="color:var(--text-muted);">${node.term.shortDesc}</span>`;
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.remove('visible');
        }
    }
    
    openModal() {
        const modal = document.getElementById('addModal');
        if (modal) modal.classList.add('open');
    }
    
    closeModal() {
        const modal = document.getElementById('addModal');
        const form = document.getElementById('addTermForm');
        if (modal) modal.classList.remove('open');
        if (form) form.reset();
    }
    
    handleAddTerm(formData) {
        const name = formData.get('name');
        const categoryId = formData.get('category');
        const shortDesc = formData.get('shortDesc');
        const definition = formData.get('definition');
        const relatedStr = formData.get('related') || '';
        const tagsStr = formData.get('tags') || '';
        
        // Enhanced Validation
        if (!name || !categoryId || !shortDesc || !definition) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }
        
        // Generate ID
        const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        
        // Parse arrays
        const related = relatedStr.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
        const tags = tagsStr.split(',').map(s => s.trim()).filter(Boolean);
        
        // Add term
        const success = KnowledgeUtils.addTerm({
            id,
            name,
            category: categoryId,
            type: 'technique',
            shortDesc,
            definition,
            related,
            tags
        });
        
        if (success) {
            if (this.graph) this.graph.loadData();
            this.updateStats();
            this.renderCategories();
            this.closeModal();
            
            const newTerm = KnowledgeUtils.getTerm(id);
            if (newTerm) {
                setTimeout(() => this.navigateTerm(newTerm), 100);
                this.showToast(`Term "${name}" added!`, 'success');
            }
        } else {
            this.showToast('Failed to add term. It may already exist.', 'error');
        }
    }

    // PowerUp: Simple Toast Notification System
    showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.app-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'app-toast';
        toast.textContent = message;
        
        const bgColor = type === 'success' ? 'var(--accent-success)' : 
                        type === 'error' ? 'var(--accent-danger)' : 'var(--text-primary)';

        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 12px 24px;
            background: ${bgColor};
            color: white;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            z-index: 5000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        // Auto remove
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    
    
    
    
    escapeHTML(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    
    parseMarkdown(text) {
        if (!text) return '';
    
        text = this.escapeHTML(text);
    
        // ---- CODE BLOCKS (handle first to prevent corruption) ----
        text = text.replace(/```([\s\S]*?)```/g, (match, p1) => {
            return `<pre><code>${p1.trim()}</code></pre>`;
        });
    
        // ---- INLINE CODE ----
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    
        // ---- BOLD ----
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
        // ---- HEADINGS (optional enhancement) ----
        text = text.replace(/^### (.*$)/gm, '<h4>$1</h4>');
        text = text.replace(/^## (.*$)/gm, '<h3>$1</h3>');
        text = text.replace(/^# (.*$)/gm, '<h2>$1</h2>');
    
        // ---- BULLET LISTS (group properly) ----
        text = text.replace(/(?:^- .+\n?)+/gm, (match) => {
            const items = match.trim().split('\n')
                .map(line => line.replace(/^- /, '').trim())
                .map(item => `<li>${item}</li>`)
                .join('');
            return `<ul>${items}</ul>`;
        });
    
        // ---- NUMBERED LISTS (group properly) ----
        text = text.replace(/(?:^\d+\. .+\n?)+/gm, (match) => {
            const items = match.trim().split('\n')
                .map(line => line.replace(/^\d+\. /, '').trim())
                .map(item => `<li>${item}</li>`)
                .join('');
            return `<ol>${items}</ol>`;
        });
    
        // ---- PARAGRAPHS ----
        text = text
            .split(/\n\s*\n/)
            .map(block => {
                if (
                    block.startsWith('<ul>') ||
                    block.startsWith('<ol>') ||
                    block.startsWith('<pre>') ||
                    block.startsWith('<h')
                ) {
                    return block;
                }
                return `<p>${block.trim()}</p>`;
            })
            .join('');
    
        return text;
    }
}

//Initialise and expose to the window
window.app = new App();
