/**
 * Manages upload queue state and processing
 */
class UploadQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.currentUpload = null;
        
        // Callbacks
        this.onQueueUpdate = null;
        this.onUploadComplete = null;
        this.onUploadError = null;
    }

    /**
     * Add files to the queue
     */
    addFiles(files, currentPath) {
        const newItems = Array.from(files).map(file => ({
            id: this.generateId(),
            file: file,
            status: 'pending',
            progress: 0,
            path: currentPath,
            error: null,
            tusUpload: null
        }));

        this.queue.push(...newItems);
        this.notifyQueueUpdate();
        
        // Start processing if not already running
        if (!this.isProcessing) {
            this.processNext();
        }
    }

    /**
     * Process the next item in the queue
     */
    async processNext() {
        if (this.isProcessing) return;
        
        const nextItem = this.queue.find(item => item.status === 'pending');
        if (!nextItem) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        this.currentUpload = nextItem;
        nextItem.status = 'uploading';
        this.notifyQueueUpdate();

        try {
            await this.uploadFile(nextItem);
        } catch (error) {
            this.handleUploadError(nextItem, error);
        }
    }

    /**
     * Upload a single file using TUS
     */
    uploadFile(queueItem) {
        return new Promise((resolve, reject) => {
            const tusUpload = new tus.Upload(queueItem.file, {
                endpoint: '/files/',
                chunkSize: 8 * 1024 * 1024, // 8MB chunks
                retryDelays: [0, 1000, 3000, 5000],
                metadata: {
                    filename: queueItem.file.name,
                    filetype: queueItem.file.type,
                    useOriginalFilename: 'true',
                    onDuplicateFiles: 'number',
                    path: this.getRelativePath(queueItem.path)
                },
                onError: (error) => {
                    reject(error);
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                    const percentage = Math.floor((bytesUploaded / bytesTotal) * 100);
                    queueItem.progress = percentage;
                    this.notifyQueueUpdate();
                },
                onSuccess: () => {
                    this.handleUploadSuccess(queueItem);
                    resolve();
                }
            });

            queueItem.tusUpload = tusUpload;
            tusUpload.start();
        });
    }

    /**
     * Handle successful upload
     */
    async handleUploadSuccess(queueItem) {
        queueItem.status = 'completed';
        queueItem.progress = 100;
        this.currentUpload = null;
        this.isProcessing = false;
        
        this.notifyQueueUpdate();
        this.notifyUploadComplete(queueItem);
        
        // Remove completed item after a short delay
        setTimeout(() => {
            this.removeFromQueue(queueItem.id);
        }, 2000);
        
        // Process next item
        setTimeout(() => {
            this.processNext();
        }, 500);
    }

    /**
     * Handle upload error
     */
    handleUploadError(queueItem, error) {
        queueItem.status = 'error';
        queueItem.error = error.message || 'Upload failed';
        this.currentUpload = null;
        this.isProcessing = false;
        
        this.notifyQueueUpdate();
        this.notifyUploadError(queueItem, error);
        
        // Process next item after error
        setTimeout(() => {
            this.processNext();
        }, 1000);
    }

    /**
     * Remove item from queue
     */
    removeFromQueue(id) {
        const index = this.queue.findIndex(item => item.id === id);
        if (index !== -1) {
            this.queue.splice(index, 1);
            this.notifyQueueUpdate();
        }
    }

    /**
     * Cancel upload
     */
    cancelUpload(id) {
        const item = this.queue.find(item => item.id === id);
        if (!item) return;

        if (item.tusUpload && item.status === 'uploading') {
            item.tusUpload.abort();
        }

        this.removeFromQueue(id);
        
        // If this was the current upload, process next
        if (this.currentUpload && this.currentUpload.id === id) {
            this.currentUpload = null;
            this.isProcessing = false;
            setTimeout(() => {
                this.processNext();
            }, 100);
        }
    }

    /**
     * Get relative path for upload
     */
    getRelativePath(path) {
        return path === '/' ? '' : path.replace(/^\//, '');
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Get queue status
     */
    getQueueStatus() {
        return {
            total: this.queue.length,
            pending: this.queue.filter(item => item.status === 'pending').length,
            uploading: this.queue.filter(item => item.status === 'uploading').length,
            completed: this.queue.filter(item => item.status === 'completed').length,
            error: this.queue.filter(item => item.status === 'error').length
        };
    }

    /**
     * Check if queue is empty
     */
    isEmpty() {
        return this.queue.length === 0;
    }

    /**
     * Notification methods
     */
    notifyQueueUpdate() {
        if (this.onQueueUpdate) {
            this.onQueueUpdate(this.queue);
        }
    }

    notifyUploadComplete(queueItem) {
        if (this.onUploadComplete) {
            this.onUploadComplete(queueItem);
        }
    }

    notifyUploadError(queueItem, error) {
        if (this.onUploadError) {
            this.onUploadError(queueItem, error);
        }
    }
}

export default UploadQueue;