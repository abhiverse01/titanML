/**
 * AI Knowledge Base - Logic & Utilities
 * Dependencies: Requires data.json to be served alongside this file.
 */

// ==========================================
// HELPER FUNCTION
// ==========================================
function createTerm(config) {
    return {
        id: config.id || '',
        name: config.name || '',
        fullName: config.fullName || config.name || '',
        category: config.category || 'general',
        type: config.type || 'technique',
        shortDesc: config.shortDesc || '',
        definition: config.definition || '',
        related: config.related || [],
        tags: config.tags || [],
        codeExample: config.codeExample || '',
        createdAt: config.createdAt || new Date().toISOString(),
        importance: config.importance || 0
    };
}

// ==========================================
// STATE MANAGEMENT
// ==========================================
const KnowledgeBase = {
    meta: {
        version: '3.0.0', 
        lastUpdated: new Date().toISOString().split('T')[0],
        description: 'Interactive AI Knowledge Graph - Modularized'
    },
    categories: [],
    terms: [],
    isLoaded: false
};

// ==========================================
// ASYNC INITIALIZATION
// ==========================================
async function initKnowledgeBase() {
    try {
        const response = await fetch('data.json'); 
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (data.categories) {
            KnowledgeBase.categories = data.categories;
        }

        if (data.terms) {
            KnowledgeBase.terms = data.terms.map(t => createTerm(t));
        }

        KnowledgeBase.isLoaded = true;
        console.log('KnowledgeBase loaded:', KnowledgeBase.categories.length, 'categories,', KnowledgeBase.terms.length, 'terms');
        return KnowledgeBase;
        
    } catch (e) {
        console.error('Failed to load KnowledgeBase data:', e);
        // Helpful warning for beginners regarding CORS
        if (window.location.protocol === 'file:') {
             console.warn("⚠️ SECURITY ERROR: You are opening this file directly. Browsers block fetch() on local files. You must use a local server (e.g., VS Code 'Live Server' extension).");
        }
        return null;
    }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
const KnowledgeUtils = {
    // ... (Keep your existing utility functions exactly as they are) ...
    addCategory(category) {
        if (!category.id || !category.name) return false;
        if (KnowledgeBase.categories.find(c => c.id === category.id)) return false;
        KnowledgeBase.categories.push({...category});
        return true;
    },

    addTerm(termConfig) {
        if (!termConfig.id || !termConfig.name) return false;
        if (KnowledgeBase.terms.find(t => t.id === termConfig.id)) return false;
        KnowledgeBase.terms.push(createTerm(termConfig));
        return true;
    },

    getTerm(id) {
        return KnowledgeBase.terms.find(t => t.id === id);
    },

    getTermsByCategory(categoryId) {
        return KnowledgeBase.terms.filter(t => t.category === categoryId);
    },

    getRelatedTerms(termId) {
        const term = this.getTerm(termId);
        if (!term || !term.related) return [];
        return term.related.map(r => this.getTerm(r)).filter(Boolean);
    },

    searchTerms(query) {
        if (!query) return KnowledgeBase.terms;
        const q = query.toLowerCase();
        return KnowledgeBase.terms.filter(t => 
            t.name.toLowerCase().includes(q) ||
            t.shortDesc.toLowerCase().includes(q) ||
            t.fullName.toLowerCase().includes(q) ||
            t.tags.some(tag => tag.toLowerCase().includes(q))
        );
    },

    getStats() {
        return {
            categories: KnowledgeBase.categories.length,
            terms: KnowledgeBase.terms.length,
            connections: KnowledgeBase.terms.reduce((sum, t) => sum + (t.related?.length || 0), 0),
            byCategory: KnowledgeBase.categories.reduce((acc, cat) => {
                acc[cat.id] = this.getTermsByCategory(cat.id).length;
                return acc;
            }, {})
        };
    },

    export() {
        return JSON.stringify(KnowledgeBase, null, 2);
    },

    import(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data.categories && data.terms) {
                KnowledgeBase.categories = data.categories;
                KnowledgeBase.terms = data.terms;
                KnowledgeBase.isLoaded = true;
                return true;
            }
        } catch (e) {
            console.error('Import failed:', e);
        }
        return false;
    }
};

// ==========================================
// GLOBAL EXPORTS & AUTO-INIT
// ==========================================
window.KnowledgeBase = KnowledgeBase;
window.KnowledgeUtils = KnowledgeUtils;
window.initKnowledgeBase = initKnowledgeBase;

// ==========================================
// FIX: Initialize and expose the promise
// ==========================================
// We assign the promise to a global variable so App.js can await it
window.dataLoadPromise = initKnowledgeBase();
