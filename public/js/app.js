import FileExplorer from './FileExplorer.js';
import Uploader from './Uploader.js';
import ContextMenu from './ContextMenu.js';
import FileItem from './FileItem.js';

/**
 * Main application class
 */
class App {
    constructor() {
        this.fileExplorer = null;
        this.uploader = null;
        this.contextMenu = null;
        
        // DOM elements
        this.pathHeader = null;
        this.errorBanner = null;
        this.errorText = null;
        this.errorClose = null;
        
        this.init();
    }

    /**
     * Initialize the application
     */
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    /**
     * Setup the application components
     */
    setup() {
        this.initializeElements();
        this.initializeComponents();
        this.attachEvents();
    }

    /**
     * Initialize DOM element references
     */
    initializeElements() {
        this.pathHeader = document.getElementById('current-path');
        this.errorBanner = document.getElementById('error-banner');
        this.errorText = document.getElementById('error-text');
        this.errorClose = document.getElementById('error-close');
    }

    /**
     * Initialize application components
     */
    initializeComponents() {
        // Initialize file explorer
        const explorerContainer = document.getElementById('explorer');
        this.fileExplorer = new FileExplorer(explorerContainer);
        
        // Initialize uploader
        const uploaderContainer = document.querySelector('.uploader-section');
        this.uploader = new Uploader(uploaderContainer);
        
        // Initialize context menu
        this.contextMenu = new ContextMenu();
        
        // Connect components
        this.connectComponents();
    }

    /**
     * Connect components with callbacks
     */
    connectComponents() {
        // File explorer callbacks
        this.fileExplorer.onPathChange = (path) => {
            this.updatePathDisplay(path);
            this.uploader.setCurrentPath(path);
        };
        
        this.fileExplorer.onError = (message) => {
            this.showError(message);
        };
        
        this.fileExplorer.onContextMenu = (e, item, isMultipleSelection) => {
            this.contextMenu.show(e.clientX, e.clientY, item, isMultipleSelection);
        };
        
        this.fileExplorer.onColumnContextMenu = (e, column) => {
            this.contextMenu.show(e.clientX, e.clientY, null, false, column);
        };
        
        // Uploader callbacks
        this.uploader.onUploadComplete = () => {
            console.log('Upload completed, waiting for server processing...');
            // Poll for file processing completion instead of using a fixed delay
            this.waitForFileProcessing(this.uploader.currentPath);
        };
        
        this.uploader.onError = (message) => {
            this.showError(message);
        };
        
        // Context menu callbacks
        this.contextMenu.onDelete = (item, isMultipleSelection) => {
            if (isMultipleSelection) {
                this.fileExplorer.deleteSelected();
            } else {
                this.deleteItem(item);
            }
        };
        
        this.contextMenu.onNewFolder = (column) => {
            this.fileExplorer.createFolder(column);
        };
    }

    /**
     * Attach global event listeners
     */
    attachEvents() {
        // Error banner close button
        this.errorClose.addEventListener('click', () => {
            this.hideError();
        });

        // Global error handling
        window.addEventListener('error', (e) => {
            console.error('Global error:', e.error);
            this.showError('An unexpected error occurred');
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
            console.error('Unhandled promise rejection:', e.reason);
            this.showError('An unexpected error occurred');
            e.preventDefault();
        });
    }

    /**
     * Update the path display in the header
     */
    updatePathDisplay(path) {
        const displayName = FileItem.getDisplayName(path);
        this.pathHeader.textContent = displayName;
    }

    /**
     * Show an error message
     */
    showError(message) {
        this.errorText.textContent = message;
        this.errorBanner.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }

    /**
     * Hide the error message
     */
    hideError() {
        this.errorBanner.classList.add('hidden');
    }

    /**
     * Delete a single item
     */
    async deleteItem(item) {
        try {
            await this.fileExplorer.deleteItem(item.path);
            await this.fileExplorer.refreshColumns();
            this.fileExplorer.clearSelection();
        } catch (error) {
            this.showError('Failed to delete item: ' + error.message);
        }
    }

    /**
     * Get the current path
     */
    getCurrentPath() {
        return this.fileExplorer.getCurrentPath();
    }

    /**
     * Refresh the current directory
     */
    refresh() {
        this.fileExplorer.refreshCurrentColumn();
    }

    /**
     * Navigate to a specific path
     */
    async navigateTo(path) {
        // This could be implemented to navigate to a specific path
        // For now, we'll just refresh
        this.refresh();
    }

    /**
     * Wait for file processing to complete by polling the directory
     */
    async waitForFileProcessing(uploadPath) {
        const maxAttempts = 15; // Maximum 15 attempts (15 seconds)
        const pollInterval = 1000; // Poll every 1 second
        let attempts = 0;
        
        // Get the initial file count
        let initialFileCount = 0;
        try {
            const response = await fetch(`/api/files?path=${encodeURIComponent(uploadPath)}`);
            if (response.ok) {
                const files = await response.json();
                initialFileCount = files.length;
            }
        } catch (error) {
            console.error('Error getting initial file count:', error);
        }
        
        const pollForChanges = async () => {
            attempts++;
            
            try {
                const response = await fetch(`/api/files?path=${encodeURIComponent(uploadPath)}`);
                if (response.ok) {
                    const files = await response.json();
                    
                    // Check if file count has changed (file processing completed)
                    if (files.length !== initialFileCount) {
                        console.log('File processing completed, refreshing column');
                        this.fileExplorer.refreshColumnByPath(uploadPath);
                        return;
                    }
                }
            } catch (error) {
                console.error('Error polling for file changes:', error);
            }
            
            // Continue polling if we haven't reached max attempts
            if (attempts < maxAttempts) {
                setTimeout(pollForChanges, pollInterval);
            } else {
                console.log('Max polling attempts reached, refreshing column anyway');
                this.fileExplorer.refreshColumnByPath(uploadPath);
            }
        };
        
        // Start polling after a short delay to allow server processing to begin
        setTimeout(pollForChanges, 500);
    }
}

// Create and start the application
const app = new App();

// Export for global access if needed
window.app = app;

export default App;