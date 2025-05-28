import FileItem from './FileItem.js';

/**
 * Represents a column in the file explorer
 */
class Column {
    constructor(path, items = [], width = 245) {
        this.path = path;
        this.items = items.map(item => new FileItem(item.name, item.path, item.isDirectory));
        this.width = width;
        this.element = null;
        this.contentElement = null;
        this.resizeHandle = null;
        this.isDropTarget = false;
        
        // Event handlers
        this.onItemClick = null;
        this.onItemContextMenu = null;
        this.onItemDragStart = null;
        this.onItemDragEnd = null;
        this.onItemDragOver = null;
        this.onItemDrop = null;
        this.onItemDragLeave = null;
        this.onColumnDragOver = null;
        this.onColumnDrop = null;
        this.onEmptyClick = null;
        this.onColumnContextMenu = null;
        this.onResize = null;
    }

    /**
     * Creates the DOM element for this column
     */
    createElement() {
        const column = document.createElement('div');
        column.className = 'column';
        column.style.width = `${this.width}px`;
        
        // Content container
        const content = document.createElement('div');
        content.className = 'column-content';
        
        // Resize handle
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        
        // Add items
        this.items.forEach(item => {
            const itemElement = item.createElement();
            this.attachItemEvents(item, itemElement);
            content.appendChild(itemElement);
        });
        
        // Add resize events
        this.attachResizeEvents(handle);
        
        column.appendChild(content);
        column.appendChild(handle);
        
        this.element = column;
        this.contentElement = content;
        this.resizeHandle = handle;
        
        // Add column drag events (after contentElement is assigned)
        this.attachColumnEvents(column);
        
        return column;
    }

    /**
     * Attaches event listeners to file items
     */
    attachItemEvents(item, element) {
        // Mouse events
        element.addEventListener('click', (e) => {
            // Prevent click handling if item is in rename mode
            if (item && item.isRenaming) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            
            if (this.onItemClick) {
                this.onItemClick(e, item);
            }
        });

        element.addEventListener('mousedown', (e) => {
            try {
                // Only start rename timer for selected items on left click
                if (e.button === 0 && item && item.selected && !item.isRenaming) {
                    item.startRenameTimer();
                }
            } catch (error) {
                console.error('Error in mousedown handler:', error);
            }
        });

        element.addEventListener('mouseup', (e) => {
            try {
                // If already in rename mode, don't do anything
                if (item && item.isRenaming) {
                    return;
                }
                
                // Clear rename timer on mouse up
                if (item && item.clearRenameTimer) {
                    item.clearRenameTimer();
                }
            } catch (error) {
                console.error('Error in mouseup handler:', error);
            }
        });

        element.addEventListener('mouseleave', (e) => {
            try {
                // Clear rename timer when mouse leaves, but don't exit rename mode if already renaming
                if (item && !item.isRenaming && item.clearRenameTimer) {
                    item.clearRenameTimer();
                }
            } catch (error) {
                console.error('Error in mouseleave handler:', error);
            }
        });

        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.onItemContextMenu) {
                this.onItemContextMenu(e, item);
            }
        });

        // Drag events
        element.addEventListener('dragstart', (e) => {
            if (this.onItemDragStart) {
                this.onItemDragStart(e, item);
            }
        });

        element.addEventListener('dragend', (e) => {
            if (this.onItemDragEnd) {
                this.onItemDragEnd(e, item);
            }
        });

        // Only add drop events for directories
        if (item.isDirectory) {
            element.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (this.onItemDragOver) {
                    this.onItemDragOver(e, item);
                }
            });

            element.addEventListener('drop', (e) => {
                e.preventDefault();
                if (this.onItemDrop) {
                    this.onItemDrop(e, item);
                }
            });

            element.addEventListener('dragleave', (e) => {
                if (this.onItemDragLeave) {
                    this.onItemDragLeave(e, item);
                }
            });
        }
    }

    /**
     * Attaches event listeners to the column itself
     */
    attachColumnEvents(element) {
        element.addEventListener('dragover', (e) => {
            // Only handle column drag if we're not over a directory item
            if (this.isDragOverDirectoryItem(e)) {
                return; // Let the directory item handle it
            }
            
            e.preventDefault();
            if (this.onColumnDragOver) {
                this.onColumnDragOver(e, this);
            }
        });

        element.addEventListener('drop', (e) => {
            // Only handle column drop if we're not over a directory item
            if (this.isDragOverDirectoryItem(e)) {
                return; // Let the directory item handle it
            }
            
            e.preventDefault();
            if (this.onColumnDrop) {
                this.onColumnDrop(e, this);
            }
        });

        // Click on empty space
        this.contentElement?.addEventListener('click', (e) => {
            if (e.target === this.contentElement && this.onEmptyClick) {
                this.onEmptyClick(e, this);
            }
        });

        // Right-click on empty space
        this.contentElement?.addEventListener('contextmenu', (e) => {
            if (e.target === this.contentElement && this.onColumnContextMenu) {
                e.preventDefault();
                this.onColumnContextMenu(e, this);
            }
        });
    }

    /**
     * Check if the drag event is over a directory item
     */
    isDragOverDirectoryItem(e) {
        // Find the closest file-item element
        const fileItem = e.target.closest('.file-item');
        if (!fileItem) {
            return false;
        }
        
        // Find the corresponding FileItem object
        const itemElement = fileItem;
        for (const item of this.items) {
            if (item.element === itemElement && item.isDirectory) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Attaches resize event listeners
     */
    attachResizeEvents(handle) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.width;
            
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(100, startWidth + deltaX);
            
            this.setWidth(newWidth);
            
            if (this.onResize) {
                this.onResize(this, newWidth);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    /**
     * Sets the column width
     */
    setWidth(width) {
        this.width = width;
        if (this.element) {
            this.element.style.width = `${width}px`;
        }
    }

    /**
     * Sets the drop target state
     */
    setDropTarget(isTarget) {
        this.isDropTarget = isTarget;
        if (this.element) {
            this.element.classList.toggle('drop-target', isTarget);
        }
    }

    /**
     * Finds an item by path
     */
    findItem(path) {
        return this.items.find(item => item.path === path);
    }

    /**
     * Updates the items in this column
     */
    updateItems(newItems) {
        this.items = newItems.map(item => new FileItem(item.name, item.path, item.isDirectory));
        this.render();
    }

    /**
     * Re-renders the column content
     */
    render() {
        if (!this.contentElement) return;
        
        // Clear existing content
        this.contentElement.innerHTML = '';
        
        // Add updated items
        this.items.forEach(item => {
            const itemElement = item.createElement();
            this.attachItemEvents(item, itemElement);
            this.contentElement.appendChild(itemElement);
        });
    }

    /**
     * Scrolls to the bottom of the column
     */
    scrollToBottom() {
        if (this.contentElement) {
            this.contentElement.scrollTop = this.contentElement.scrollHeight;
        }
    }
}

export default Column;