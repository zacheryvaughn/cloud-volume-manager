import Column from './Column.js';
import FileItem from './FileItem.js';

/**
 * Main file explorer class that manages columns and interactions
 */
class FileExplorer {
    constructor(container) {
        this.container = container;
        this.columns = [];
        this.selectedItems = new Set();
        this.lastSelectedItem = null;
        this.activeColumn = null;
        this.draggedItems = new Set();
        this.dropTarget = null;
        this.contextTarget = null;
        
        // Keyboard state
        this.isShiftPressed = false;
        this.isCtrlPressed = false;
        
        // Selection state
        this.isRangeSelecting = false;
        
        // Hover state for folder opening
        this.hoverTarget = null;
        this.hoverTimer = null;
        this.flashTimer = null;
        this.flashCount = 0;
        
        // Event callbacks
        this.onPathChange = null;
        this.onError = null;
        this.onContextMenu = null;
        this.onColumnContextMenu = null;
        
        this.init();
    }

    /**
     * Initialize the file explorer
     */
    init() {
        this.attachGlobalEvents();
        this.loadInitialDirectory();
    }

    /**
     * Attach global event listeners
     */
    attachGlobalEvents() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            this.isShiftPressed = e.shiftKey;
            this.isCtrlPressed = e.ctrlKey || e.metaKey;
            
            // Keyboard shortcuts
            if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.selectAll();
            } else if (e.key === 'Escape') {
                this.exitAllRenameModes();
                this.clearSelection();
            } else if (e.key === 'Delete') {
                this.deleteSelected();
            }
        });

        document.addEventListener('keyup', (e) => {
            this.isShiftPressed = e.shiftKey;
            this.isCtrlPressed = e.ctrlKey || e.metaKey;
        });

        // Click outside to clear context menu and exit rename mode
        document.addEventListener('click', (e) => {
            // Check if click is outside any rename input
            if (!e.target.closest('.rename-input')) {
                this.exitAllRenameModes(true); // Save changes when clicking outside
            }
            this.clearContextTarget();
            
            // Only clear rename timers if not clicking on a file item
            if (!e.target.closest('.file-item')) {
                this.clearAllRenameTimers();
            }
        });

    }

    /**
     * Load the initial directory
     */
    async loadInitialDirectory() {
        try {
            const items = await this.fetchDirectory('/');
            const column = new Column('/', items);
            this.setupColumnEvents(column);
            this.addColumn(column);
            this.updatePathDisplay();
        } catch (error) {
            this.showError('Failed to load initial directory: ' + error.message);
        }
    }

    /**
     * Fetch directory contents from the server
     */
    async fetchDirectory(path) {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        if (!response.ok) {
            let errorMessage = 'Failed to fetch directory';
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch (parseError) {
                // If we can't parse the error response, use the status text
                errorMessage = `${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        return await response.json();
    }

    /**
     * Setup event handlers for a column
     */
    setupColumnEvents(column) {
        column.onItemClick = (e, item) => this.handleItemClick(e, item, column);
        column.onItemContextMenu = (e, item) => this.handleItemContextMenu(e, item);
        column.onItemDragStart = (e, item) => this.handleItemDragStart(e, item);
        column.onItemDragEnd = (e, item) => this.handleItemDragEnd(e, item);
        column.onItemDragOver = (e, item) => this.handleItemDragOver(e, item);
        column.onItemDrop = (e, item) => this.handleItemDrop(e, item);
        column.onItemDragLeave = (e, item) => this.handleItemDragLeave(e, item);
        column.onColumnDragOver = (e, col) => this.handleColumnDragOver(e, col);
        column.onColumnDrop = (e, col) => this.handleColumnDrop(e, col);
        column.onEmptyClick = (e, col) => this.handleEmptyClick(e, col);
        column.onColumnContextMenu = (e, col) => this.handleColumnContextMenu(e, col);
        column.onResize = (col, width) => this.handleColumnResize(col, width);
        
        // Setup rename handlers for all items in the column
        column.items.forEach(item => {
            item.onRename = (fileItem, newName) => this.handleItemRename(fileItem, newName, column);
        });
    }

    /**
     * Add a column to the explorer
     */
    addColumn(column) {
        this.columns.push(column);
        const element = column.createElement();
        this.container.appendChild(element);
        this.scrollToRight();
        this.updatePathStates();
    }

    /**
     * Remove columns from a specific index
     */
    removeColumnsFrom(index) {
        const columnsToRemove = this.columns.splice(index);
        columnsToRemove.forEach(column => {
            if (column.element) {
                column.element.remove();
            }
        });
        this.updatePathStates();
    }

    /**
     * Handle item click (selection and navigation)
     */
    async handleItemClick(e, item, column) {
        // Don't handle clicks if any item is in rename mode
        const hasRenamingItem = this.columns.some(col =>
            col.items.some(i => i.isRenaming)
        );
        if (hasRenamingItem) {
            return;
        }
        
        const columnIndex = this.columns.indexOf(column);
        
        // Clear any active rename timers
        this.clearAllRenameTimers();
        
        // Remove columns beyond current
        this.removeColumnsFrom(columnIndex + 1);
        
        // Handle selection
        if (this.isShiftPressed && this.lastSelectedItem) {
            this.handleRangeSelection(item, column);
        } else if (this.isCtrlPressed) {
            this.handleToggleSelection(item, column);
        } else {
            // Normal click - clear selection and select this item
            this.clearSelection();
            this.selectItem(item, column);
            
            // Navigate to directory if it's a folder
            if (item.isDirectory) {
                await this.navigateToDirectory(item);
            }
        }
    }

    /**
     * Handle range selection with Shift key
     */
    handleRangeSelection(item, column) {
        if (!this.lastSelectedItem || this.activeColumn !== column) {
            this.selectItem(item, column);
            return;
        }

        const items = column.items;
        const lastIndex = items.findIndex(i => i.path === this.lastSelectedItem.path);
        const currentIndex = items.findIndex(i => i.path === item.path);
        
        if (lastIndex === -1 || currentIndex === -1) return;
        
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        
        // Clear current selection if not holding Ctrl
        if (!this.isCtrlPressed) {
            this.clearSelection();
        }
        
        // Set range selecting flag to bypass parent-child checks within the same directory
        this.isRangeSelecting = true;
        
        // Select range
        for (let i = start; i <= end; i++) {
            this.selectItem(items[i], column);
        }
        
        // Clear range selecting flag
        this.isRangeSelecting = false;
    }

    /**
     * Handle toggle selection with Ctrl key
     */
    handleToggleSelection(item, column) {
        if (this.selectedItems.has(item.path)) {
            this.deselectItem(item);
        } else {
            // Check for parent-child conflicts before selecting
            if (this.hasParentChildConflict(item.path)) {
                return; // Don't select if it would create a parent-child conflict
            }
            this.selectItem(item, column);
        }
    }

    /**
     * Select an item
     */
    selectItem(item, column) {
        // Check for parent-child conflicts before selecting (except during range selection)
        if (!this.isRangeSelecting && this.hasParentChildConflict(item.path)) {
            return; // Don't select if it would create a parent-child conflict
        }
        
        this.selectedItems.add(item.path);
        item.setSelected(true);
        this.lastSelectedItem = item;
        this.activeColumn = column;
    }

    /**
     * Deselect an item
     */
    deselectItem(item) {
        this.selectedItems.delete(item.path);
        item.setSelected(false);
        if (this.lastSelectedItem === item) {
            this.lastSelectedItem = null;
        }
    }

    /**
     * Check if selecting an item would create a parent-child conflict
     */
    hasParentChildConflict(newItemPath) {
        for (const selectedPath of this.selectedItems) {
            // Check if the new item is a parent of an already selected item
            if (this.isParentPath(newItemPath, selectedPath)) {
                return true;
            }
            // Check if the new item is a child of an already selected item
            if (this.isParentPath(selectedPath, newItemPath)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if parentPath is a parent of childPath
     */
    isParentPath(parentPath, childPath) {
        // Normalize paths - remove trailing slashes and handle root
        const normalizePathForComparison = (path) => {
            if (path === '/' || path === '') return '';
            return path.replace(/\/$/, '');
        };

        const normalizedParent = normalizePathForComparison(parentPath);
        const normalizedChild = normalizePathForComparison(childPath);

        // Root is parent of everything except itself
        if (normalizedParent === '' && normalizedChild !== '') {
            return true;
        }

        // Check if child path starts with parent path followed by a slash
        return normalizedChild.startsWith(normalizedParent + '/');
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.columns.forEach(column => {
            column.items.forEach(item => {
                if (this.selectedItems.has(item.path)) {
                    item.setSelected(false);
                }
                // Also exit rename mode when clearing selection
                if (item.isRenaming) {
                    item.exitRenameMode(false);
                }
            });
        });
        this.selectedItems.clear();
        this.lastSelectedItem = null;
        this.activeColumn = null;
    }

    /**
     * Select all items in the current column
     */
    selectAll() {
        if (this.columns.length === 0) return;
        
        const currentColumn = this.columns[this.columns.length - 1];
        this.clearSelection();
        
        // Set range selecting flag to bypass parent-child checks within the same directory
        this.isRangeSelecting = true;
        
        currentColumn.items.forEach(item => {
            this.selectItem(item, currentColumn);
        });
        
        // Clear range selecting flag
        this.isRangeSelecting = false;
    }

    /**
     * Navigate to a directory
     */
    async navigateToDirectory(item) {
        try {
            const items = await this.fetchDirectory(item.path);
            const column = new Column(item.path, items);
            this.setupColumnEvents(column);
            this.addColumn(column);
            this.updatePathDisplay();
        } catch (error) {
            this.showError('Failed to open directory: ' + error.message);
        }
    }

    /**
     * Handle item context menu
     */
    handleItemContextMenu(e, item) {
        e.preventDefault();
        this.clearContextTarget();
        this.contextTarget = item;
        item.setContextTarget(true);
        
        if (this.onContextMenu) {
            this.onContextMenu(e, item, this.selectedItems.has(item.path));
        }
    }

    /**
     * Clear context target
     */
    clearContextTarget() {
        if (this.contextTarget) {
            this.contextTarget.setContextTarget(false);
            this.contextTarget = null;
        }
    }

    /**
     * Handle drag start
     */
    handleItemDragStart(e, item) {
        // If dragging an unselected item, select only it
        if (!this.selectedItems.has(item.path)) {
            this.clearSelection();
            this.selectItem(item, this.findColumnForItem(item));
        }
        
        // Set drag data
        this.draggedItems = new Set(this.selectedItems);
        
        // Create custom drag ghost for multiple selection
        if (this.draggedItems.size > 1) {
            this.createCustomDragGhost(e, this.draggedItems.size);
        }
        
        // Update visual state
        this.columns.forEach(column => {
            column.items.forEach(i => {
                i.setDragging(this.draggedItems.has(i.path));
            });
        });
        
        // Set drag data
        e.dataTransfer.setData('text/plain', JSON.stringify([...this.draggedItems]));
        e.dataTransfer.effectAllowed = 'move';
    }

    /**
     * Handle drag end
     */
    handleItemDragEnd(e, item) {
        // Clear drag state
        this.columns.forEach(column => {
            column.items.forEach(i => {
                i.setDragging(false);
                i.setDropTarget(false);
            });
        });
        
        this.draggedItems.clear();
        this.clearDropTarget();
        this.clearHoverTimer();
        this.cleanupDragGhost();
    }

    /**
     * Create a custom drag ghost for multiple selection
     */
    createCustomDragGhost(e, count) {
        // Create the ghost container
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.id = 'custom-drag-ghost';
        
        // Create the circle inside the container
        const circle = document.createElement('div');
        circle.className = 'drag-ghost-circle';
        circle.textContent = count.toString();
        
        // Add circle to ghost container
        ghost.appendChild(circle);
        
        // Add to document body
        document.body.appendChild(ghost);
        
        // Set as drag image with offset to position circle to the right of cursor
        // Container is 80px wide, circle is 40px, so offset by 20px to put circle to the right
        e.dataTransfer.setDragImage(ghost, 20, 20);
        
        // Clean up after a short delay (after drag image is captured)
        setTimeout(() => {
            this.cleanupDragGhost();
        }, 0);
    }

    /**
     * Clean up the custom drag ghost element
     */
    cleanupDragGhost() {
        const ghost = document.getElementById('custom-drag-ghost');
        if (ghost) {
            ghost.remove();
        }
    }

    /**
     * Handle drag over item
     */
    handleItemDragOver(e, item) {
        if (!item.isDirectory || this.draggedItems.has(item.path)) {
            return;
        }
        
        // Stop event propagation to prevent column handlers from firing
        e.stopPropagation();
        
        this.setDropTarget(item);
        this.startHoverTimer(item);
        e.dataTransfer.dropEffect = 'move';
    }

    /**
     * Handle drag leave item
     */
    handleItemDragLeave(e, item) {
        this.clearHoverTimer();
    }

    /**
     * Handle drop on item
     */
    async handleItemDrop(e, item) {
        if (!item.isDirectory || this.draggedItems.has(item.path)) {
            return;
        }
        
        // Stop event propagation to prevent column handlers from firing
        e.stopPropagation();
        
        this.clearDropTarget();
        this.clearHoverTimer();
        
        await this.performMoveOperation([...this.draggedItems], item.path);
    }

    /**
     * Handle drag over column
     */
    handleColumnDragOver(e, column) {
        // Additional check: make sure we're not over a directory item
        const fileItem = e.target.closest('.file-item');
        if (fileItem) {
            // Find the corresponding FileItem object to check if it's a directory
            for (const item of column.items) {
                if (item.element === fileItem && item.isDirectory) {
                    // We're over a directory item, don't handle as column drag
                    return;
                }
            }
        }
        
        this.setDropTarget(null, column);
        e.dataTransfer.dropEffect = 'move';
    }

    /**
     * Handle drop on column
     */
    async handleColumnDrop(e, column) {
        // Additional check: make sure we're not over a directory item
        const fileItem = e.target.closest('.file-item');
        if (fileItem) {
            // Find the corresponding FileItem object to check if it's a directory
            for (const item of column.items) {
                if (item.element === fileItem && item.isDirectory) {
                    // We're over a directory item, don't handle as column drop
                    return;
                }
            }
        }
        
        this.clearDropTarget();
        
        await this.performMoveOperation([...this.draggedItems], column.path);
    }

    /**
     * Handle empty space click
     */
    handleEmptyClick(e, column) {
        const columnIndex = this.columns.indexOf(column);
        this.removeColumnsFrom(columnIndex + 1);
        this.clearSelection();
        this.updatePathDisplay();
    }

    /**
     * Handle column context menu (right-click on empty space)
     */
    handleColumnContextMenu(e, column) {
        e.preventDefault();
        this.clearContextTarget();
        
        if (this.onColumnContextMenu) {
            this.onColumnContextMenu(e, column);
        }
    }

    /**
     * Handle column resize
     */
    handleColumnResize(column, width) {
        // Column handles its own width update
    }

    /**
     * Set drop target
     */
    setDropTarget(item, column = null) {
        this.clearDropTarget();
        
        if (item) {
            this.dropTarget = item;
            item.setDropTarget(true);
        } else if (column) {
            this.dropTarget = column;
            column.setDropTarget(true);
        }
    }

    /**
     * Clear drop target
     */
    clearDropTarget() {
        if (this.dropTarget) {
            if (this.dropTarget.setDropTarget) {
                this.dropTarget.setDropTarget(false);
            }
            this.dropTarget = null;
        }
    }

    /**
     * Start hover timer for folder opening
     */
    startHoverTimer(item) {
        // Only start timer if we don't already have one running for this item
        if (this.hoverTimer && this.hoverTarget === item) {
            return;
        }
        
        // Check if this folder is already open (has a column showing its contents)
        const isAlreadyOpen = this.columns.some(column => column.path === item.path);
        if (isAlreadyOpen) {
            return;
        }
        
        this.clearHoverTimer();
        this.hoverTarget = item;
        
        this.hoverTimer = setTimeout(() => {
            this.startFlashSequence(item);
        }, 600);
    }

    /**
     * Clear hover timer
     */
    clearHoverTimer() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }
        if (this.flashTimer) {
            clearTimeout(this.flashTimer);
            this.flashTimer = null;
        }
        this.hoverTarget = null;
        this.flashCount = 0;
    }

    /**
     * Start flash sequence for folder opening
     */
    startFlashSequence(item) {
        this.flashCount = 0;
        
        const flash = () => {
            this.flashCount++;
            item.setFlashing(this.flashCount % 2 === 1);
            
            if (this.flashCount < 4) {
                this.flashTimer = setTimeout(flash, 80);
            } else {
                item.setFlashing(false);
                this.navigateToDirectory(item);
            }
        };
        
        flash();
    }

    /**
     * Perform a move operation for multiple items with proper error handling
     */
    async performMoveOperation(itemPaths, destinationPath) {
        const results = {
            successful: [],
            failed: [],
            skipped: []
        };
        
        // Sort items to move files before folders to avoid conflicts
        const sortedPaths = [...itemPaths].sort((a, b) => {
            const aIsDir = this.isDirectoryPath(a);
            const bIsDir = this.isDirectoryPath(b);
            
            // Files first, then directories
            if (aIsDir && !bIsDir) return 1;
            if (!aIsDir && bIsDir) return -1;
            return 0;
        });
        
        console.log(`Starting move operation for ${sortedPaths.length} items to "${destinationPath}"`);
        
        // Process each item sequentially to avoid race conditions
        for (const itemPath of sortedPaths) {
            try {
                const moveResult = await this.moveItem(itemPath, destinationPath);
                if (moveResult.skipped) {
                    results.skipped.push({ path: itemPath, reason: moveResult.reason });
                } else {
                    results.successful.push(itemPath);
                }
            } catch (error) {
                console.error(`Failed to move "${itemPath}":`, error);
                results.failed.push({ path: itemPath, error: error.message });
            }
        }
        
        // Clear selection before refresh to avoid stale references
        this.clearSelection();
        
        // Always refresh columns after move operations
        try {
            await this.refreshColumns();
        } catch (refreshError) {
            console.error('Failed to refresh after move operation:', refreshError);
        }
        
        // Show appropriate feedback to user
        this.showMoveResults(results);
    }

    /**
     * Check if a path represents a directory based on current column data
     */
    isDirectoryPath(itemPath) {
        for (const column of this.columns) {
            const item = column.items.find(i => i.path === itemPath);
            if (item) {
                return item.isDirectory;
            }
        }
        // Default to false if not found
        return false;
    }

    /**
     * Show results of move operation to user
     */
    showMoveResults(results) {
        const { successful, failed, skipped } = results;
        const total = successful.length + failed.length + skipped.length;
        
        // Filter out "Same location" skips as they're expected behavior
        const actualSkipped = skipped.filter(skip => skip.reason !== 'Same location');
        
        if (failed.length === 0 && actualSkipped.length === 0) {
            // All successful or just same location skips
            if (successful.length === 1) {
                console.log('Item moved successfully');
            } else if (successful.length > 1) {
                console.log(`All ${successful.length} items moved successfully`);
            }
            // Don't show any message for same location drops
        } else if (successful.length === 0 && actualSkipped.length === 0) {
            // All failed (excluding same location)
            const firstError = failed[0]?.error || 'Unknown error';
            this.showError(`Failed to move items: ${firstError}`);
        } else if (failed.length > 0 || actualSkipped.length > 0) {
            // Mixed results with actual errors/skips
            let message = `Moved ${successful.length} of ${total} items successfully.`;
            if (failed.length > 0) {
                message += ` ${failed.length} failed.`;
            }
            if (actualSkipped.length > 0) {
                message += ` ${actualSkipped.length} skipped.`;
            }
            this.showError(message);
        }
    }

    /**
     * Move an item to a new location
     */
    async moveItem(sourcePath, destinationPath) {
        const fileName = FileItem.getFileName(sourcePath);
        
        // Normalize destination path - if it's root "/", make it empty for proper path construction
        let normalizedDestination = destinationPath === '/' ? '' : destinationPath;
        
        // Construct the new path
        let newPath;
        if (normalizedDestination === '') {
            // Moving to root directory
            newPath = fileName;
        } else if (normalizedDestination.endsWith('/')) {
            newPath = normalizedDestination + fileName;
        } else {
            newPath = normalizedDestination + '/' + fileName;
        }
        
        // Prevent moving to the same exact location
        if (sourcePath === newPath) {
            console.log(`Skipping move: source and destination are the same (${sourcePath})`);
            return { skipped: true, reason: 'Same location' };
        }
        
        // Prevent moving a directory into itself
        if (this.isParentPath(sourcePath, newPath)) {
            console.log(`Skipping move: cannot move directory into itself (${sourcePath} -> ${newPath})`);
            return { skipped: true, reason: 'Cannot move directory into itself' };
        }
        
        console.log(`Moving "${sourcePath}" to "${newPath}"`);
        
        const response = await fetch('/api/files', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath, destinationPath: newPath })
        });
        
        if (!response.ok) {
            let errorMessage = 'Failed to move item';
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch (parseError) {
                errorMessage = `${response.status} ${response.statusText}`;
            }
            
            // Handle specific error cases with user-friendly messages
            if (errorMessage.includes('ENOTEMPTY') || errorMessage.includes('directory not empty')) {
                console.log('Move operation skipped: An item with this name already exists in the destination directory.');
                return { skipped: true, reason: 'Item already exists' };
            } else if (errorMessage.includes('EEXIST') || errorMessage.includes('already exists')) {
                console.log('Move operation skipped: An item with this name already exists in the destination directory.');
                return { skipped: true, reason: 'Item already exists' };
            }
            
            throw new Error(errorMessage);
        }
        
        console.log(`Successfully moved "${sourcePath}" to "${newPath}"`);
        return { skipped: false };
    }

    /**
     * Delete selected items
     */
    async deleteSelected() {
        if (this.selectedItems.size === 0) return;
        
        try {
            for (const itemPath of this.selectedItems) {
                await this.deleteItem(itemPath);
            }
            await this.refreshColumns();
            this.clearSelection();
        } catch (error) {
            this.showError('Failed to delete items: ' + error.message);
        }
    }

    /**
     * Delete a single item
     */
    async deleteItem(path) {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete item');
        }
    }

    /**
     * Refresh all columns
     */
    async refreshColumns() {
        // Add a small delay to ensure file system operations are complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        for (let i = 0; i < this.columns.length; i++) {
            const column = this.columns[i];
            try {
                const items = await this.fetchDirectory(column.path);
                column.updateItems(items);
                this.setupColumnEvents(column);
            } catch (error) {
                // If column path no longer exists, remove it and all following columns
                console.log(`Column ${i} (${column.path}) no longer exists, removing it and following columns`);
                this.removeColumnsFrom(i);
                break;
            }
        }
        this.updatePathStates();
    }

    /**
     * Update path states for navigation highlighting
     */
    updatePathStates() {
        this.columns.forEach((column, columnIndex) => {
            column.items.forEach(item => {
                const isInPath = columnIndex < this.columns.length - 1 && 
                    this.columns[columnIndex + 1].path === item.path;
                item.setPath(isInPath);
            });
        });
    }

    /**
     * Find the column containing an item
     */
    findColumnForItem(item) {
        return this.columns.find(column => 
            column.items.some(i => i.path === item.path)
        );
    }

    /**
     * Scroll to the rightmost column
     */
    scrollToRight() {
        this.container.scrollLeft = this.container.scrollWidth;
    }

    /**
     * Update the path display
     */
    updatePathDisplay() {
        if (this.onPathChange && this.columns.length > 0) {
            const currentPath = this.columns[this.columns.length - 1].path;
            this.onPathChange(currentPath);
        }
    }

    /**
     * Show an error message
     */
    showError(message) {
        if (this.onError) {
            this.onError(message);
        }
    }

    /**
     * Get the current path
     */
    getCurrentPath() {
        return this.columns.length > 0 ? this.columns[this.columns.length - 1].path : '/';
    }

    /**
     * Refresh the current column
     */
    async refreshCurrentColumn() {
        if (this.columns.length === 0) return;
        
        const currentColumn = this.columns[this.columns.length - 1];
        try {
            const items = await this.fetchDirectory(currentColumn.path);
            currentColumn.updateItems(items);
            this.setupColumnEvents(currentColumn);
            this.updatePathStates();
        } catch (error) {
            this.showError('Failed to refresh directory: ' + error.message);
        }
    }

    /**
     * Refresh a specific column by path
     */
    async refreshColumnByPath(targetPath) {
        if (this.columns.length === 0) return;
        
        // Find the column with the matching path
        const columnToRefresh = this.columns.find(column => column.path === targetPath);
        
        if (columnToRefresh) {
            try {
                const items = await this.fetchDirectory(columnToRefresh.path);
                columnToRefresh.updateItems(items);
                this.setupColumnEvents(columnToRefresh);
                this.updatePathStates();
            } catch (error) {
                this.showError('Failed to refresh directory: ' + error.message);
            }
        }
    }

    /**
     * Create a new folder in the specified column
     */
    async createFolder(column) {
        try {
            // Generate a unique folder name
            const folderName = await this.generateUniqueFolderName(column.path);
            
            const response = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: column.path,
                    name: folderName
                })
            });
            
            if (!response.ok) {
                let errorMessage = 'Failed to create folder';
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (parseError) {
                    errorMessage = `${response.status} ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }
            
            // Refresh the column to show the new folder
            const items = await this.fetchDirectory(column.path);
            column.updateItems(items);
            this.setupColumnEvents(column);
            this.updatePathStates();
            
        } catch (error) {
            this.showError('Failed to create folder: ' + error.message);
        }
    }

    /**
     * Generate a unique folder name (New Folder, New Folder 2, etc.)
     */
    async generateUniqueFolderName(parentPath) {
        try {
            const items = await this.fetchDirectory(parentPath);
            const existingNames = items
                .filter(item => item.isDirectory)
                .map(item => item.name);
            
            let baseName = 'New Folder';
            let folderName = baseName;
            let counter = 2;
            
            while (existingNames.includes(folderName)) {
                folderName = `${baseName} ${counter}`;
                counter++;
            }
            
            return folderName;
        } catch (error) {
            // If we can't fetch directory contents, just use "New Folder"
            return 'New Folder';
        }
    }

    /**
     * Handle item rename
     */
    async handleItemRename(fileItem, newName, column) {
        try {
            // Validate the new name
            if (!newName || newName.trim() === '') {
                this.showError('Name cannot be empty');
                return;
            }

            const trimmedName = newName.trim();
            
            // Check if name actually changed
            if (trimmedName === fileItem.name) {
                return;
            }

            // Check for invalid characters (basic validation)
            if (trimmedName.includes('/') || trimmedName.includes('\\')) {
                this.showError('Name cannot contain / or \\ characters');
                return;
            }

            // Construct new path
            const parentPath = fileItem.path.substring(0, fileItem.path.lastIndexOf('/'));
            const newPath = parentPath ? `${parentPath}/${trimmedName}` : trimmedName;

            // Check if an item with the new name already exists
            const existingItem = column.items.find(item =>
                item.name.toLowerCase() === trimmedName.toLowerCase() && item.path !== fileItem.path
            );
            
            if (existingItem) {
                this.showError('An item with this name already exists');
                return;
            }

            console.log(`Renaming "${fileItem.path}" to "${newPath}"`);

            // Send rename request to server
            const response = await fetch('/api/files', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourcePath: fileItem.path,
                    destinationPath: newPath
                })
            });

            if (!response.ok) {
                let errorMessage = 'Failed to rename item';
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (parseError) {
                    errorMessage = `${response.status} ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            // Update the file item
            fileItem.name = trimmedName;
            fileItem.path = newPath;
            fileItem.nameElement.textContent = trimmedName;

            // Clear selection to avoid stale references
            this.clearSelection();

            // Refresh the column to ensure consistency
            await this.refreshColumnByPath(column.path);

            console.log(`Successfully renamed to "${newPath}"`);

        } catch (error) {
            console.error('Failed to rename item:', error);
            this.showError('Failed to rename item: ' + error.message);
        }
    }

    /**
     * Clear all rename timers across all columns
     */
    clearAllRenameTimers() {
        this.columns.forEach(column => {
            column.items.forEach(item => {
                // Only clear timer if not already in rename mode
                if (!item.isRenaming) {
                    item.clearRenameTimer();
                }
            });
        });
    }

    /**
     * Exit rename mode for all items
     */
    exitAllRenameModes(save = false) {
        this.columns.forEach(column => {
            column.items.forEach(item => {
                if (item.isRenaming) {
                    item.exitRenameMode(save);
                }
            });
        });
    }
}

export default FileExplorer;