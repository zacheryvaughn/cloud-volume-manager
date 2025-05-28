/**
 * Represents a file or directory item
 */
class FileItem {
    constructor(name, path, isDirectory) {
        this.name = name;
        this.path = path;
        this.isDirectory = isDirectory;
        this.element = null;
        this.selected = false;
        this.isPath = false;
        this.isFlashing = false;
        this.isDragging = false;
        this.isDropTarget = false;
        this.isContextTarget = false;
        this.isRenaming = false;
        this.renameTimer = null;
        this.nameElement = null;
        this.renameInput = null;
        this.onRename = null;
    }

    /**
     * Creates the DOM element for this file item
     */
    createElement() {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.draggable = true;
        
        // File content container
        const content = document.createElement('div');
        content.className = 'file-content';
        
        // Icon
        const icon = document.createElement('img');
        icon.className = 'file-icon';
        icon.src = this.isDirectory ? 'icons/folder.png' : 'icons/file.png';
        icon.alt = this.isDirectory ? 'Folder' : 'File';
        
        // Name
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = this.name;
        this.nameElement = name;
        
        content.appendChild(icon);
        content.appendChild(name);
        item.appendChild(content);
        
        // Chevron for directories
        if (this.isDirectory) {
            const chevron = this.createChevron();
            item.appendChild(chevron);
        }
        
        this.element = item;
        this.updateClasses();
        
        return item;
    }

    /**
     * Creates a chevron SVG icon
     */
    createChevron() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'chevron');
        svg.setAttribute('viewBox', '0 0 320 512');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z');
        
        svg.appendChild(path);
        return svg;
    }

    /**
     * Updates the CSS classes based on current state
     */
    updateClasses() {
        if (!this.element) return;
        
        let classes = ['file-item'];
        
        if (this.selected) classes.push('selected');
        if (this.isPath) classes.push('path');
        if (this.isFlashing) classes.push('flashing');
        if (this.isDragging) classes.push('dragging');
        if (this.isDropTarget) classes.push('drop-target');
        if (this.isContextTarget) classes.push('context-target');
        if (this.isRenaming) classes.push('renaming');
        
        this.element.className = classes.join(' ');
    }

    /**
     * Sets the selected state
     */
    setSelected(selected) {
        this.selected = selected;
        this.updateClasses();
    }

    /**
     * Sets the path state (part of navigation path)
     */
    setPath(isPath) {
        this.isPath = isPath;
        this.updateClasses();
    }

    /**
     * Sets the flashing state
     */
    setFlashing(flashing) {
        this.isFlashing = flashing;
        this.updateClasses();
    }

    /**
     * Sets the dragging state
     */
    setDragging(dragging) {
        this.isDragging = dragging;
        this.updateClasses();
    }

    /**
     * Sets the drop target state
     */
    setDropTarget(isTarget) {
        this.isDropTarget = isTarget;
        this.updateClasses();
    }

    /**
     * Sets the context target state
     */
    setContextTarget(isTarget) {
        this.isContextTarget = isTarget;
        this.updateClasses();
    }

    /**
     * Start rename timer on mousedown
     */
    startRenameTimer() {
        this.clearRenameTimer();
        this.renameTimer = setTimeout(() => {
            this.enterRenameMode();
        }, 500);
    }

    /**
     * Clear rename timer
     */
    clearRenameTimer() {
        try {
            if (this.renameTimer) {
                clearTimeout(this.renameTimer);
                this.renameTimer = null;
            }
        } catch (error) {
            console.error('Error clearing rename timer:', error);
        }
    }

    /**
     * Enter rename mode
     */
    enterRenameMode() {
        try {
            if (this.isRenaming || !this.nameElement) return;
            
            this.isRenaming = true;
            this.updateClasses();
            
            // Create input element
            this.renameInput = document.createElement('input');
            this.renameInput.type = 'text';
            this.renameInput.className = 'rename-input';
            this.renameInput.value = this.name;
            
            // Replace name element with input
            this.nameElement.style.display = 'none';
            this.nameElement.parentNode.insertBefore(this.renameInput, this.nameElement.nextSibling);
            
            // Focus and select text
            this.renameInput.focus();
            this.renameInput.select();
            
            // Add event listeners
            this.renameInput.addEventListener('blur', () => this.exitRenameMode(true));
            this.renameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.exitRenameMode(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.exitRenameMode(false);
                }
            });
            
            // Prevent event bubbling
            this.renameInput.addEventListener('click', (e) => e.stopPropagation());
            this.renameInput.addEventListener('mousedown', (e) => e.stopPropagation());
        } catch (error) {
            console.error('Error entering rename mode:', error);
            this.isRenaming = false;
            this.updateClasses();
        }
    }

    /**
     * Exit rename mode
     */
    exitRenameMode(save = false) {
        try {
            if (!this.isRenaming || !this.renameInput) return;
            
            const newName = this.renameInput.value.trim();
            
            // Remove input element
            this.renameInput.remove();
            this.renameInput = null;
            
            // Show name element
            if (this.nameElement) {
                this.nameElement.style.display = '';
            }
            
            this.isRenaming = false;
            this.updateClasses();
            
            // Save if requested and name changed
            if (save && newName && newName !== this.name) {
                if (this.onRename) {
                    this.onRename(this, newName);
                }
            }
        } catch (error) {
            console.error('Error exiting rename mode:', error);
            // Ensure we reset the state even if there's an error
            this.isRenaming = false;
            this.renameInput = null;
            this.updateClasses();
            if (this.nameElement) {
                this.nameElement.style.display = '';
            }
        }
    }

    /**
     * Sets the renaming state
     */
    setRenaming(renaming) {
        if (renaming) {
            this.enterRenameMode();
        } else {
            this.exitRenameMode(false);
        }
    }

    /**
     * Gets the file name from a path
     */
    static getFileName(path) {
        return path.split('/').filter(Boolean).pop() || '';
    }

    /**
     * Gets the directory name for display
     */
    static getDisplayName(path) {
        if (!path || path === '/') return 'Volume';
        return FileItem.getFileName(path);
    }
}

export default FileItem;