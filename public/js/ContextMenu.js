/**
 * Handles context menu functionality
 */
class ContextMenu {
    constructor() {
        this.element = null;
        this.deleteBtn = null;
        this.newFolderBtn = null;
        this.isVisible = false;
        this.targetItem = null;
        this.targetColumn = null;
        this.isMultipleSelection = false;
        this.menuType = 'item'; // 'item' or 'column'
        
        // Callbacks
        this.onDelete = null;
        this.onNewFolder = null;
        
        this.init();
    }

    /**
     * Initialize the context menu
     */
    init() {
        this.element = document.getElementById('context-menu');
        this.deleteBtn = document.getElementById('delete-item');
        this.newFolderBtn = document.getElementById('new-folder');
        
        this.attachEvents();
    }

    /**
     * Attach event listeners
     */
    attachEvents() {
        // Delete button click
        this.deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleDelete();
        });

        // New folder button click
        this.newFolderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleNewFolder();
        });

        // Hide menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isVisible && !this.element.contains(e.target)) {
                this.hide();
            }
        });

        // Hide menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });

        // Prevent context menu from closing when clicking inside it
        this.element.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    /**
     * Show the context menu at specified coordinates
     */
    show(x, y, item = null, isMultipleSelection = false, column = null) {
        this.targetItem = item;
        this.targetColumn = column;
        this.isMultipleSelection = isMultipleSelection;
        
        // Determine menu type and show/hide appropriate buttons
        if (column && !item) {
            // Column context menu (right-click on empty space)
            this.menuType = 'column';
            this.newFolderBtn.style.display = 'block';
            this.deleteBtn.style.display = 'none';
        } else {
            // Item context menu (right-click on file/folder)
            this.menuType = 'item';
            this.newFolderBtn.style.display = 'none';
            this.deleteBtn.style.display = 'block';
            
            // Update delete button text
            if (isMultipleSelection) {
                this.deleteBtn.textContent = 'Delete Selected Items';
            } else {
                this.deleteBtn.textContent = 'Delete';
            }
        }
        
        // Position the menu
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        
        // Show the menu
        this.element.classList.remove('hidden');
        this.isVisible = true;
        
        // Adjust position if menu goes off screen
        this.adjustPosition();
    }

    /**
     * Hide the context menu
     */
    hide() {
        this.element.classList.add('hidden');
        this.isVisible = false;
        this.targetItem = null;
        this.targetColumn = null;
        this.isMultipleSelection = false;
        this.menuType = 'item';
    }

    /**
     * Adjust menu position to stay within viewport
     */
    adjustPosition() {
        const rect = this.element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let x = parseInt(this.element.style.left);
        let y = parseInt(this.element.style.top);
        
        // Adjust horizontal position
        if (rect.right > viewportWidth) {
            x = viewportWidth - rect.width - 10;
        }
        if (x < 10) {
            x = 10;
        }
        
        // Adjust vertical position
        if (rect.bottom > viewportHeight) {
            y = viewportHeight - rect.height - 10;
        }
        if (y < 10) {
            y = 10;
        }
        
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
    }

    /**
     * Handle delete action
     */
    handleDelete() {
        if (this.onDelete && this.targetItem) {
            this.onDelete(this.targetItem, this.isMultipleSelection);
        }
        this.hide();
    }

    /**
     * Handle new folder action
     */
    handleNewFolder() {
        if (this.onNewFolder && this.targetColumn) {
            this.onNewFolder(this.targetColumn);
        }
        this.hide();
    }

    /**
     * Check if menu is currently visible
     */
    getIsVisible() {
        return this.isVisible;
    }

    /**
     * Get the current target item
     */
    getTargetItem() {
        return this.targetItem;
    }
}

export default ContextMenu;