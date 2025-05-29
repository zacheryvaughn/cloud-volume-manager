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
            tusUpload: null,
            parts: null, // Will store part upload instances for multi-part uploads
            partProgress: null // Will track individual part progress
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
     * Determine number of parts based on file size
     */
    getPartCount(fileSize) {
        const MB = 1024 * 1024;
        
        if (fileSize < 32 * MB) {
            return 1;
        } else if (fileSize < 512 * MB) {
            return 2;
        } else if (fileSize < 1024 * MB) {
            return 4;
        } else {
            return 6;
        }
    }

    /**
     * Split file into parts
     */
    splitFileIntoParts(file) {
        const partCount = this.getPartCount(file.size);
        
        if (partCount === 1) {
            return [{
                blob: file,
                partNumber: 1,
                totalParts: 1,
                filename: file.name
            }];
        }

        const partSize = Math.ceil(file.size / partCount);
        const parts = [];

        for (let i = 0; i < partCount; i++) {
            const start = i * partSize;
            const end = Math.min(start + partSize, file.size);
            const blob = file.slice(start, end);

            parts.push({
                blob: blob,
                partNumber: i + 1,
                totalParts: partCount,
                filename: `${file.name}.part${i + 1}`
            });
        }

        return parts;
    }

    /**
     * Upload a single file using TUS (with parted upload support)
     */
    async uploadFile(queueItem) {
        const parts = this.splitFileIntoParts(queueItem.file);
        
        console.log(`Uploading file ${queueItem.file.name} in ${parts.length} part(s)`);
        
        if (parts.length === 1) {
            // Single part upload (existing logic)
            return this.uploadSinglePart(queueItem, parts[0]);
        } else {
            // Multi-part upload
            return this.uploadMultipleParts(queueItem, parts);
        }
    }

    /**
     * Upload multiple parts in parallel
     */
    async uploadMultipleParts(queueItem, parts) {
        // Initialize part tracking
        queueItem.parts = new Map();
        queueItem.partProgress = new Map();
        
        // Create upload promises for all parts
        const uploadPromises = parts.map(part =>
            this.uploadSinglePart(queueItem, part)
        );

        try {
            await Promise.all(uploadPromises);
            console.log(`All parts uploaded successfully for ${queueItem.file.name}`);
        } catch (error) {
            console.error(`Error uploading parts for ${queueItem.file.name}:`, error);
            throw error;
        }
    }

    /**
     * Upload a single part using TUS
     */
    uploadSinglePart(queueItem, part) {
        return new Promise((resolve, reject) => {
            const endpoint = `${window.location.protocol}//${window.location.host}/files/`;
            
            const isPartedUpload = part.totalParts > 1;
            
            const metadata = {
                filename: part.filename,
                filetype: queueItem.file.type,
                useOriginalFilename: 'true',
                onDuplicateFiles: 'number',
                path: this.getRelativePath(queueItem.path),
                isPartedUpload: isPartedUpload ? 'true' : 'false'
            };

            // Add part-specific metadata for multi-part uploads
            if (isPartedUpload) {
                metadata.originalFilename = queueItem.file.name;
                metadata.partNumber = part.partNumber.toString();
                metadata.totalParts = part.totalParts.toString();
                metadata.partId = `${queueItem.id}_part${part.partNumber}`;
            }
            
            const tusUpload = new tus.Upload(part.blob, {
                endpoint: endpoint,
                chunkSize: 8 * 1024 * 1024, // 8MB chunks
                retryDelays: [0, 1000, 3000, 5000],
                metadata: metadata,
                onError: (error) => {
                    console.error(`Error uploading part ${part.partNumber}:`, error);
                    reject(error);
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                    if (isPartedUpload) {
                        // Track individual part progress
                        const partProgress = Math.floor((bytesUploaded / bytesTotal) * 100);
                        queueItem.partProgress.set(part.partNumber, partProgress);
                        
                        // Calculate overall progress
                        const totalProgress = Array.from(queueItem.partProgress.values())
                            .reduce((sum, progress) => sum + progress, 0) / part.totalParts;
                        
                        queueItem.progress = Math.floor(totalProgress);
                    } else {
                        // Single part progress
                        queueItem.progress = Math.floor((bytesUploaded / bytesTotal) * 100);
                    }
                    
                    this.notifyQueueUpdate();
                },
                onSuccess: () => {
                    console.log(`Part ${part.partNumber} uploaded successfully`);
                    
                    if (isPartedUpload) {
                        queueItem.parts.set(part.partNumber, tusUpload);
                        queueItem.partProgress.set(part.partNumber, 100);
                        
                        // Check if all parts are complete
                        if (queueItem.parts.size === part.totalParts) {
                            queueItem.progress = 100;
                            this.handleUploadSuccess(queueItem);
                        }
                    } else {
                        queueItem.tusUpload = tusUpload;
                        this.handleUploadSuccess(queueItem);
                    }
                    
                    resolve();
                }
            });

            if (isPartedUpload) {
                queueItem.parts.set(part.partNumber, tusUpload);
            } else {
                queueItem.tusUpload = tusUpload;
            }
            
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

        // Cancel single upload
        if (item.tusUpload && item.status === 'uploading') {
            item.tusUpload.abort();
        }

        // Cancel all parts for multi-part uploads
        if (item.parts && item.status === 'uploading') {
            item.parts.forEach(partUpload => {
                if (partUpload) {
                    partUpload.abort();
                }
            });
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