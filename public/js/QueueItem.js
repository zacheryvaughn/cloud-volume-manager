/**
 * Represents a single item in the upload queue
 */
class QueueItem {
    constructor(queueData, onCancel) {
        this.data = queueData;
        this.onCancel = onCancel;
        this.element = null;
        this.progressBar = null;
        this.statusText = null;
        
        // Upload tracking
        this.uploadStartTime = null;
        this.lastProgressTime = null;
        this.lastBytesUploaded = 0;
        this.uploadSpeeds = []; // Array to track recent speeds for averaging
        this.lastTimeEstimate = null; // Cache the last time estimate to reduce flashing
        this.lastEstimateUpdate = 0; // Track when we last updated the estimate
        
        
        this.createElement();
    }

    /**
     * Create the DOM element for this queue item
     */
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'queue-item';
        this.element.dataset.id = this.data.id;
        
        this.element.innerHTML = `
            <div class="queue-item-content">
                <div class="queue-item-header">
                    <span class="queue-item-name">${this.escapeHtml(this.data.file.name)}</span>
                    <button class="queue-cancel-btn" title="Cancel upload">
                        <svg width="10" height="10" viewBox="0 0 12 12">
                            <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                        </svg>
                    </button>
                </div>
                <div class="queue-item-progress">
                    <div class="queue-progress-bar">
                        <div class="queue-progress-fill"></div>
                    </div>
                </div>
                <div class="queue-item-status">
                    <span class="queue-status-text"></span>
                </div>
            </div>
        `;

        // Get references to elements
        this.progressBar = this.element.querySelector('.queue-progress-fill');
        this.statusText = this.element.querySelector('.queue-status-text');
        
        // Attach cancel button event
        const cancelBtn = this.element.querySelector('.queue-cancel-btn');
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onCancel) {
                this.onCancel(this.data.id);
            }
        });

        this.updateDisplay();
    }

    /**
     * Update the visual display based on current data
     */
    updateDisplay() {
        if (!this.element) return;

        // Update status class
        this.element.className = `queue-item queue-item-${this.data.status}`;
        
        // Update progress bar
        if (this.progressBar) {
            this.progressBar.style.width = `${this.data.progress}%`;
        }

        // Update status text
        if (this.statusText) {
            switch (this.data.status) {
                case 'pending':
                    this.statusText.textContent = 'Waiting...';
                    break;
                case 'uploading':
                    // Initialize upload tracking if not already done
                    if (!this.uploadStartTime) {
                        this.uploadStartTime = Date.now();
                        this.lastProgressTime = Date.now();
                        this.lastBytesUploaded = 0;
                        this.lastTimeEstimate = null;
                        this.lastEstimateUpdate = 0;
                    }
                    this.updateUploadStatus();
                    break;
                case 'completed':
                    this.statusText.textContent = 'Upload complete';
                    break;
                case 'error':
                    this.statusText.textContent = 'Upload failed';
                    this.statusText.title = this.data.error || 'Upload failed';
                    break;
            }
        }

        // Hide cancel button for completed items
        const cancelBtn = this.element.querySelector('.queue-cancel-btn');
        if (cancelBtn) {
            cancelBtn.style.display = this.data.status === 'completed' ? 'none' : 'block';
        }
    }

    /**
     * Update the queue item with new data
     */
    update(newData) {
        const oldStatus = this.data.status;
        this.data = { ...this.data, ...newData };
        
        // Track upload start time
        if (oldStatus !== 'uploading' && this.data.status === 'uploading') {
            this.uploadStartTime = Date.now();
            this.lastProgressTime = Date.now();
            this.lastBytesUploaded = 0;
            this.lastTimeEstimate = null;
            this.lastEstimateUpdate = 0;
        }
        
        this.updateDisplay();
    }

    /**
     * Update upload status with progress and time estimate
     */
    updateUploadStatus() {
        const bytesUploaded = Math.floor((this.data.progress / 100) * this.data.file.size);
        const totalBytes = this.data.file.size;
        
        // Only update time estimate every 2 seconds to prevent flashing, except for the first estimate
        const now = Date.now();
        if (this.lastEstimateUpdate === 0 || now - this.lastEstimateUpdate > 2000) {
            const newTimeEstimate = this.calculateTimeEstimate(bytesUploaded, totalBytes);
            if (newTimeEstimate) {
                this.lastTimeEstimate = newTimeEstimate;
                this.lastEstimateUpdate = now;
            }
        }
        
        // Format status with both progress and cached time estimate
        let statusText = `${this.formatFileSize(bytesUploaded)} of ${this.formatFileSize(totalBytes)}`;
        if (this.lastTimeEstimate) {
            statusText += ` - ${this.lastTimeEstimate}`;
        }
        
        this.statusText.textContent = statusText;
    }


    /**
     * Calculate time estimate for upload completion
     */
    calculateTimeEstimate(bytesUploaded, totalBytes) {
        if (!this.uploadStartTime || bytesUploaded === 0) {
            return null;
        }
        
        const now = Date.now();
        const elapsedTime = now - this.uploadStartTime;
        
        // Need at least 3 seconds of data for reasonable estimate
        if (elapsedTime < 3000) {
            return null;
        }
        
        // Calculate current speed
        const timeSinceLastUpdate = now - this.lastProgressTime;
        if (timeSinceLastUpdate > 0) {
            const bytesSinceLastUpdate = bytesUploaded - this.lastBytesUploaded;
            const currentSpeed = bytesSinceLastUpdate / (timeSinceLastUpdate / 1000); // bytes per second
            
            // Keep track of recent speeds for averaging (last 10 measurements)
            this.uploadSpeeds.push(currentSpeed);
            if (this.uploadSpeeds.length > 10) {
                this.uploadSpeeds.shift();
            }
            
            this.lastProgressTime = now;
            this.lastBytesUploaded = bytesUploaded;
        }
        
        if (this.uploadSpeeds.length === 0) {
            return null;
        }
        
        // Calculate average speed
        const avgSpeed = this.uploadSpeeds.reduce((sum, speed) => sum + speed, 0) / this.uploadSpeeds.length;
        
        if (avgSpeed <= 0) {
            return null;
        }
        
        // Calculate remaining time
        const remainingBytes = totalBytes - bytesUploaded;
        const remainingSeconds = remainingBytes / avgSpeed;
        
        return this.formatTimeEstimate(remainingSeconds);
    }

    /**
     * Format time estimate in human readable format
     */
    formatTimeEstimate(seconds) {
        if (seconds < 60) {
            return '1 minute';
        } else if (seconds < 3600) {
            const minutes = Math.round(seconds / 60);
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.round((seconds % 3600) / 60);
            if (minutes === 0) {
                return `${hours} hour${hours !== 1 ? 's' : ''}`;
            } else {
                return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
            }
        }
    }

    /**
     * Get the DOM element
     */
    getElement() {
        return this.element;
    }

    /**
     * Remove the element from DOM
     */
    remove() {
        
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export default QueueItem;