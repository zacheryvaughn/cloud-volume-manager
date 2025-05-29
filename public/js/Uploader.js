import FileItem from './FileItem.js';
import UploadQueue from './UploadQueue.js';
import QueueItem from './QueueItem.js';

/**
 * Handles file uploads using TUS protocol with queue support
 */
class Uploader {
    constructor(container) {
        this.container = container;
        this.currentPath = '/';
        
        // Queue system
        this.uploadQueue = new UploadQueue();
        this.queueItems = new Map(); // Map of queue item ID to QueueItem component
        
        // DOM elements
        this.fileInput = null;
        this.uploadBtn = null;
        this.uploadPathSpan = null;
        this.queueContainer = null;
        
        // Callbacks
        this.onUploadComplete = null;
        this.onError = null;
        
        this.init();
    }

    /**
     * Initialize the uploader
     */
    init() {
        this.createElements();
        this.attachEvents();
        this.updatePathDisplay();
    }

    /**
     * Create DOM elements
     */
    createElements() {
        // File input
        this.fileInput = document.getElementById('file-input');
        this.fileInput.setAttribute('multiple', true); // Enable multiple file selection
        
        // Upload button
        this.uploadBtn = document.getElementById('upload-btn');
        this.uploadPathSpan = document.getElementById('upload-path');
        
        // Queue container
        this.queueContainer = document.getElementById('queue-container');
    }

    /**
     * Attach event listeners
     */
    attachEvents() {
        // Upload button click
        this.uploadBtn.addEventListener('click', () => {
            this.fileInput.click();
        });

        // File selection - now handles multiple files
        this.fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                this.addFilesToQueue(files);
                this.resetFileInput();
            }
        });

        // Setup queue callbacks
        this.setupQueueCallbacks();
    }

    /**
     * Setup upload queue callbacks
     */
    setupQueueCallbacks() {
        this.uploadQueue.onQueueUpdate = (queue) => {
            this.updateQueueDisplay(queue);
        };

        this.uploadQueue.onUploadComplete = (queueItem) => {
            if (this.onUploadComplete) {
                this.onUploadComplete();
            }
        };

        this.uploadQueue.onUploadError = (queueItem, error) => {
            if (this.onError) {
                this.onError(error.message || 'Upload failed');
            }
        };
    }

    /**
     * Add files to the upload queue
     */
    addFilesToQueue(files) {
        this.uploadQueue.addFiles(files, this.currentPath);
    }

    /**
     * Update the queue display
     */
    updateQueueDisplay(queue) {
        if (!this.queueContainer) return;

        // Remove queue items that are no longer in the queue
        this.queueItems.forEach((queueItem, id) => {
            if (!queue.find(item => item.id === id)) {
                queueItem.remove();
                this.queueItems.delete(id);
            }
        });

        // Add or update queue items
        queue.forEach(queueData => {
            if (this.queueItems.has(queueData.id)) {
                // Update existing item
                this.queueItems.get(queueData.id).update(queueData);
            } else {
                // Create new item
                const queueItem = new QueueItem(queueData, (id) => {
                    this.uploadQueue.cancelUpload(id);
                });
                this.queueItems.set(queueData.id, queueItem);
                this.queueContainer.appendChild(queueItem.getElement());
            }
        });

    }

    /**
     * Get the relative path for upload
     */
    getRelativePath() {
        // Remove leading slash for relative path
        return this.currentPath === '/' ? '' : this.currentPath.replace(/^\//, '');
    }


    /**
     * Reset the file input
     */
    resetFileInput() {
        this.fileInput.value = '';
    }

    /**
     * Update the current path
     */
    setCurrentPath(path) {
        this.currentPath = path;
        this.updatePathDisplay();
    }

    /**
     * Update the path display in the button
     */
    updatePathDisplay() {
        const displayName = FileItem.getDisplayName(this.currentPath);
        this.uploadPathSpan.textContent = displayName;
    }

    /**
     * Check if queue has uploads
     */
    getIsUploading() {
        return !this.uploadQueue.isEmpty();
    }
}

export default Uploader;