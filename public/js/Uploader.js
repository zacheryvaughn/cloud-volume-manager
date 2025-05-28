import FileItem from './FileItem.js';

/**
 * Handles file uploads using TUS protocol
 */
class Uploader {
    constructor(container) {
        this.container = container;
        this.currentPath = '/';
        this.isUploading = false;
        this.currentUpload = null;
        
        // DOM elements
        this.fileInput = null;
        this.uploadBtn = null;
        this.uploadProgress = null;
        this.progressFill = null;
        this.progressText = null;
        this.uploadPathSpan = null;
        
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
        
        // Upload button
        this.uploadBtn = document.getElementById('upload-btn');
        this.uploadPathSpan = document.getElementById('upload-path');
        
        // Progress elements
        this.uploadProgress = document.getElementById('upload-progress');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
    }

    /**
     * Attach event listeners
     */
    attachEvents() {
        // Upload button click
        this.uploadBtn.addEventListener('click', () => {
            this.fileInput.click();
        });

        // File selection
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.startUpload(file);
            }
        });
    }

    /**
     * Start uploading a file
     */
    startUpload(file) {
        if (this.isUploading) return;
        
        this.isUploading = true;
        this.showProgress();
        this.updateProgress(0);
        
        // Create TUS upload
        this.currentUpload = new tus.Upload(file, {
            endpoint: '/files/',
            chunkSize: 8 * 1024 * 1024, // 8MB chunks
            retryDelays: [0, 1000, 3000, 5000],
            metadata: {
                filename: file.name,
                filetype: file.type,
                useOriginalFilename: 'true',
                onDuplicateFiles: 'number',
                path: this.getRelativePath()
            },
            onError: (error) => {
                console.error('Upload failed:', error);
                this.handleUploadError(error);
            },
            onProgress: (bytesUploaded, bytesTotal) => {
                const percentage = Math.floor((bytesUploaded / bytesTotal) * 100);
                this.updateProgress(percentage);
            },
            onSuccess: () => {
                console.log('Upload completed:', this.currentUpload.url);
                this.handleUploadSuccess();
            }
        });

        this.currentUpload.start();
    }

    /**
     * Get the relative path for upload
     */
    getRelativePath() {
        // Remove leading slash for relative path
        return this.currentPath === '/' ? '' : this.currentPath.replace(/^\//, '');
    }

    /**
     * Show upload progress UI
     */
    showProgress() {
        this.uploadBtn.classList.add('hidden');
        this.uploadProgress.classList.remove('hidden');
    }

    /**
     * Hide upload progress UI
     */
    hideProgress() {
        this.uploadProgress.classList.add('hidden');
        this.uploadBtn.classList.remove('hidden');
    }

    /**
     * Update progress display
     */
    updateProgress(percentage) {
        this.progressFill.style.width = `${percentage}%`;
        this.progressText.textContent = `${percentage}%`;
    }

    /**
     * Handle upload success
     */
    handleUploadSuccess() {
        this.isUploading = false;
        this.currentUpload = null;
        this.hideProgress();
        this.resetFileInput();
        
        if (this.onUploadComplete) {
            this.onUploadComplete();
        }
    }

    /**
     * Handle upload error
     */
    handleUploadError(error) {
        this.isUploading = false;
        this.currentUpload = null;
        this.hideProgress();
        this.resetFileInput();
        
        const message = error.message || 'Upload failed';
        if (this.onError) {
            this.onError(message);
        }
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
     * Cancel current upload
     */
    cancelUpload() {
        if (this.currentUpload && this.isUploading) {
            this.currentUpload.abort();
            this.isUploading = false;
            this.currentUpload = null;
            this.hideProgress();
            this.resetFileInput();
        }
    }

    /**
     * Check if currently uploading
     */
    getIsUploading() {
        return this.isUploading;
    }
}

export default Uploader;