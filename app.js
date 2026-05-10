class App {
    constructor() {
        this.canvas = document.getElementById('whiteboard');
        this.ctx = this.canvas.getContext('2d');
        this.textInput = document.getElementById('text-input');
        
        // State
        this.elements = [];
        this.undoStack = [];
        this.redoStack = [];
        
        // Viewport
        this.camera = { x: 0, y: 0, zoom: 1 };
        
        // Tool settings
        this.currentTool = 'select';
        this.strokeColor = '#1e1e1e';
        this.bgColor = 'transparent';
        this.strokeWidth = 4;
        
        // Interaction state
        this.isDrawing = false;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.cameraStart = { x: 0, y: 0 };
        this.currentElement = null;
        this.selectedElement = null;
        this.dragOffset = { x: 0, y: 0 };
        
        // Multi-touch for pinch zoom
        this.touchCache = [];
        this.initialPinchDistance = null;
        this.initialPinchZoom = null;

        this.init();
    }

    init() {
        this.setupCanvas();
        this.bindEvents();
        this.loadState();
        this.setupUI();
        this.render();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
        this.ctx.scale(dpr, dpr);
        this.render();
    }

    // Coordinate conversions
    screenToWorld(x, y) {
        return {
            x: (x - this.camera.x) / this.camera.zoom,
            y: (y - this.camera.y) / this.camera.zoom
        };
    }

    worldToScreen(x, y) {
        return {
            x: x * this.camera.zoom + this.camera.x,
            y: y * this.camera.zoom + this.camera.y
        };
    }

    // Events
    bindEvents() {
        const container = document.getElementById('canvas-container');
        
        // Mouse / Touch
        container.addEventListener('pointerdown', this.onPointerDown.bind(this));
        container.addEventListener('pointermove', this.onPointerMove.bind(this));
        window.addEventListener('pointerup', this.onPointerUp.bind(this));
        
        // Wheel for zoom / pan
        container.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        
        // Text input blur
        this.textInput.addEventListener('blur', this.onTextInputBlur.bind(this));
        
        // Keyboard shortcuts
        window.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    onPointerDown(e) {
        if (e.target !== this.canvas) return;
        
        // Middle click or Spacebar+Left click for pan
        if (e.button === 1 || (e.button === 0 && e.getModifierState('Alt'))) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.cameraStart = { ...this.camera };
            document.body.style.cursor = 'grabbing';
            return;
        }

        const worldPos = this.screenToWorld(e.clientX, e.clientY);

        if (this.currentTool === 'select') {
            this.selectedElement = this.findElementAt(worldPos.x, worldPos.y);
            if (this.selectedElement) {
                this.isDrawing = true; // reusing for dragging
                this.dragOffset = {
                    x: worldPos.x - this.selectedElement.x,
                    y: worldPos.y - this.selectedElement.y
                };
            }
            this.render();
            return;
        }

        if (this.currentTool === 'text' || this.currentTool === 'note') {
            this.startTextEntry(e.clientX, e.clientY, worldPos);
            return;
        }

        // Start drawing/shape
        this.isDrawing = true;
        this.currentElement = {
            id: Date.now().toString(),
            type: this.currentTool,
            x: worldPos.x,
            y: worldPos.y,
            width: 0,
            height: 0,
            strokeColor: this.strokeColor,
            bgColor: this.bgColor,
            strokeWidth: this.strokeWidth,
            points: [{ x: worldPos.x, y: worldPos.y }] // for draw
        };
    }

    onPointerMove(e) {
        if (this.isPanning) {
            const dx = e.clientX - this.panStart.x;
            const dy = e.clientY - this.panStart.y;
            this.camera.x = this.cameraStart.x + dx;
            this.camera.y = this.cameraStart.y + dy;
            this.render();
            return;
        }

        const worldPos = this.screenToWorld(e.clientX, e.clientY);

        if (this.isDrawing) {
            if (this.currentTool === 'select' && this.selectedElement) {
                // Dragging
                this.selectedElement.x = worldPos.x - this.dragOffset.x;
                this.selectedElement.y = worldPos.y - this.dragOffset.y;
                if (this.selectedElement.type === 'draw') {
                    // Offset all points
                    const dx = this.selectedElement.x - this.selectedElement.points[0].x;
                    const dy = this.selectedElement.y - this.selectedElement.points[0].y;
                    this.selectedElement.points = this.selectedElement.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                }
            } else if (this.currentElement) {
                if (this.currentTool === 'draw' || this.currentTool === 'eraser') {
                    this.currentElement.points.push({ x: worldPos.x, y: worldPos.y });
                } else {
                    this.currentElement.width = worldPos.x - this.currentElement.x;
                    this.currentElement.height = worldPos.y - this.currentElement.y;
                }
            }
            this.render();
        }
    }

    onPointerUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            document.body.style.cursor = 'default';
            return;
        }

        if (this.isDrawing) {
            if (this.currentTool === 'select' && this.selectedElement) {
                this.saveState();
            } else if (this.currentElement) {
                if (this.currentTool === 'eraser') {
                    // Execute erase
                    this.eraseElementsAt(this.currentElement.points);
                } else {
                    // Normalize dimensions for shapes
                    if (['rect', 'circle'].includes(this.currentTool)) {
                        if (this.currentElement.width < 0) {
                            this.currentElement.x += this.currentElement.width;
                            this.currentElement.width = Math.abs(this.currentElement.width);
                        }
                        if (this.currentElement.height < 0) {
                            this.currentElement.y += this.currentElement.height;
                            this.currentElement.height = Math.abs(this.currentElement.height);
                        }
                    }
                    
                    // Avoid saving empty clicks
                    if (this.currentElement.type !== 'draw' || this.currentElement.points.length > 1) {
                        this.elements.push(this.currentElement);
                        this.saveState();
                    }
                }
                this.currentElement = null;
            }
            this.isDrawing = false;
            this.render();
        }
    }

    onWheel(e) {
        e.preventDefault();
        
        if (e.ctrlKey || e.metaKey) {
            // Zoom
            const zoomAmount = e.deltaY * -0.01;
            const newZoom = Math.min(Math.max(0.1, this.camera.zoom * (1 + zoomAmount)), 5);
            
            // Zoom towards mouse pointer
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            
            this.camera.x = mouseX - (mouseX - this.camera.x) * (newZoom / this.camera.zoom);
            this.camera.y = mouseY - (mouseY - this.camera.y) * (newZoom / this.camera.zoom);
            this.camera.zoom = newZoom;
            
            document.getElementById('zoom-level').innerText = `${Math.round(this.camera.zoom * 100)}%`;
        } else {
            // Pan
            this.camera.x -= e.deltaX;
            this.camera.y -= e.deltaY;
        }
        
        this.render();
    }

    // Text & Notes
    startTextEntry(clientX, clientY, worldPos) {
        this.textInput.style.display = 'block';
        this.textInput.style.left = `${clientX}px`;
        this.textInput.style.top = `${clientY}px`;
        this.textInput.value = '';
        this.textInput.style.fontSize = `${16 * this.camera.zoom}px`;
        this.textInput.style.color = this.strokeColor;
        this.textInput.style.backgroundColor = this.currentTool === 'note' ? (this.bgColor === 'transparent' ? '#ffec99' : this.bgColor) : 'transparent';
        if (this.currentTool === 'note') {
            this.textInput.style.padding = `${10 * this.camera.zoom}px`;
            this.textInput.style.minWidth = `${150 * this.camera.zoom}px`;
            this.textInput.style.minHeight = `${150 * this.camera.zoom}px`;
            this.textInput.style.boxShadow = 'var(--shadow)';
        } else {
            this.textInput.style.padding = '0';
            this.textInput.style.minWidth = '50px';
            this.textInput.style.minHeight = '20px';
            this.textInput.style.boxShadow = 'none';
        }
        
        setTimeout(() => this.textInput.focus(), 10);
        
        this.currentElement = {
            id: Date.now().toString(),
            type: this.currentTool,
            x: worldPos.x,
            y: worldPos.y,
            text: '',
            strokeColor: this.strokeColor,
            bgColor: this.currentTool === 'note' ? (this.bgColor === 'transparent' ? '#ffec99' : this.bgColor) : 'transparent',
            fontSize: 16
        };
    }

    onTextInputBlur() {
        this.textInput.style.display = 'none';
        if (this.textInput.value.trim() !== '') {
            this.currentElement.text = this.textInput.value;
            this.elements.push(this.currentElement);
            this.saveState();
        }
        this.currentElement = null;
        this.render();
        this.currentTool = 'select';
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.tool-btn[data-tool="select"]').classList.add('active');
    }

    // Hit Testing & Erasing
    findElementAt(x, y) {
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'rect' || el.type === 'note') {
                const w = el.type === 'note' ? 150 : el.width;
                const h = el.type === 'note' ? 150 : el.height;
                if (x >= el.x && x <= el.x + w && y >= el.y && y <= el.y + h) {
                    return el;
                }
            } else if (el.type === 'circle') {
                const cx = el.x + el.width / 2;
                const cy = el.y + el.height / 2;
                const rx = Math.abs(el.width / 2);
                const ry = Math.abs(el.height / 2);
                if (Math.pow((x - cx) / rx, 2) + Math.pow((y - cy) / ry, 2) <= 1) {
                    return el;
                }
            } else if (el.type === 'text') {
                // Rough bounding box for text
                if (x >= el.x && x <= el.x + 100 && y >= el.y && y <= el.y + 30) return el;
            } else if (el.type === 'draw' || el.type === 'arrow') {
                // Rough bounding box for lines
                const minX = Math.min(...el.points.map(p => p.x));
                const maxX = Math.max(...el.points.map(p => p.x));
                const minY = Math.min(...el.points.map(p => p.y));
                const maxY = Math.max(...el.points.map(p => p.y));
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) return el;
            }
        }
        return null;
    }

    eraseElementsAt(points) {
        const initialLen = this.elements.length;
        this.elements = this.elements.filter(el => {
            // Very simple rough hit test for eraser
            const bb = this.getBoundingBox(el);
            for (let p of points) {
                if (p.x >= bb.minX && p.x <= bb.maxX && p.y >= bb.minY && p.y <= bb.maxY) {
                    return false; // remove
                }
            }
            return true;
        });
        if (this.elements.length !== initialLen) this.saveState();
    }

    getBoundingBox(el) {
        if (el.type === 'rect' || el.type === 'note') {
            const w = el.type === 'note' ? 150 : el.width;
            const h = el.type === 'note' ? 150 : el.height;
            return { minX: el.x, maxX: el.x + w, minY: el.y, maxY: el.y + h };
        }
        if (el.points) {
            return {
                minX: Math.min(...el.points.map(p => p.x)),
                maxX: Math.max(...el.points.map(p => p.x)),
                minY: Math.min(...el.points.map(p => p.y)),
                maxY: Math.max(...el.points.map(p => p.y))
            };
        }
        return { minX: el.x, maxX: el.x + 100, minY: el.y, maxY: el.y + 100 }; // fallback
    }

    // Rendering
    render() {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        
        this.ctx.save();
        this.ctx.translate(this.camera.x, this.camera.y);
        this.ctx.scale(this.camera.zoom, this.camera.zoom);

        // Draw saved elements
        this.elements.forEach(el => this.drawElement(el));

        // Draw current element
        if (this.currentElement && this.currentTool !== 'eraser') {
            this.drawElement(this.currentElement);
        }

        // Draw eraser trail
        if (this.currentTool === 'eraser' && this.currentElement) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            this.ctx.lineWidth = 10;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            for (let i = 0; i < this.currentElement.points.length; i++) {
                const p = this.currentElement.points[i];
                if (i === 0) this.ctx.moveTo(p.x, p.y);
                else this.ctx.lineTo(p.x, p.y);
            }
            this.ctx.stroke();
        }

        // Draw selection highlight
        if (this.selectedElement) {
            const bb = this.getBoundingBox(this.selectedElement);
            this.ctx.strokeStyle = '#339af0';
            this.ctx.lineWidth = 2 / this.camera.zoom;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(bb.minX - 5, bb.minY - 5, bb.maxX - bb.minX + 10, bb.maxY - bb.minY + 10);
            this.ctx.setLineDash([]);
        }

        this.ctx.restore();
    }

    drawElement(el) {
        this.ctx.strokeStyle = el.strokeColor;
        this.ctx.fillStyle = el.bgColor;
        this.ctx.lineWidth = el.strokeWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.ctx.beginPath();

        if (el.type === 'draw') {
            if (el.points.length === 0) return;
            this.ctx.moveTo(el.points[0].x, el.points[0].y);
            // Smooth curve drawing
            for (let i = 1; i < el.points.length - 2; i++) {
                const xc = (el.points[i].x + el.points[i + 1].x) / 2;
                const yc = (el.points[i].y + el.points[i + 1].y) / 2;
                this.ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, xc, yc);
            }
            // Curve to the last point
            if (el.points.length > 2) {
                const last = el.points.length - 1;
                this.ctx.quadraticCurveTo(el.points[last-1].x, el.points[last-1].y, el.points[last].x, el.points[last].y);
            } else if (el.points.length === 2) {
                this.ctx.lineTo(el.points[1].x, el.points[1].y);
            } else {
                this.ctx.lineTo(el.points[0].x + 0.1, el.points[0].y); // Dot
            }
            this.ctx.stroke();
        } 
        else if (el.type === 'rect') {
            if (el.bgColor !== 'transparent') this.ctx.fillRect(el.x, el.y, el.width, el.height);
            this.ctx.strokeRect(el.x, el.y, el.width, el.height);
        } 
        else if (el.type === 'circle') {
            const rx = Math.abs(el.width / 2);
            const ry = Math.abs(el.height / 2);
            const cx = el.x + el.width / 2;
            const cy = el.y + el.height / 2;
            this.ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
            if (el.bgColor !== 'transparent') this.ctx.fill();
            this.ctx.stroke();
        } 
        else if (el.type === 'arrow') {
            this.ctx.moveTo(el.x, el.y);
            this.ctx.lineTo(el.x + el.width, el.y + el.height);
            this.ctx.stroke();
            
            // Draw arrowhead
            const angle = Math.atan2(el.height, el.width);
            const headlen = 15;
            this.ctx.beginPath();
            this.ctx.moveTo(el.x + el.width, el.y + el.height);
            this.ctx.lineTo(el.x + el.width - headlen * Math.cos(angle - Math.PI / 6), el.y + el.height - headlen * Math.sin(angle - Math.PI / 6));
            this.ctx.moveTo(el.x + el.width, el.y + el.height);
            this.ctx.lineTo(el.x + el.width - headlen * Math.cos(angle + Math.PI / 6), el.y + el.height - headlen * Math.sin(angle + Math.PI / 6));
            this.ctx.stroke();
        }
        else if (el.type === 'text') {
            this.ctx.font = `${el.fontSize}px 'Inter', sans-serif`;
            this.ctx.fillStyle = el.strokeColor;
            this.ctx.textBaseline = 'top';
            const lines = el.text.split('\n');
            lines.forEach((line, i) => {
                this.ctx.fillText(line, el.x, el.y + (i * el.fontSize * 1.2));
            });
        }
        else if (el.type === 'note') {
            // Draw note background
            this.ctx.fillStyle = el.bgColor;
            this.ctx.shadowColor = 'rgba(0,0,0,0.1)';
            this.ctx.shadowBlur = 10;
            this.ctx.shadowOffsetY = 4;
            this.ctx.fillRect(el.x, el.y, 150, 150);
            this.ctx.shadowColor = 'transparent'; // reset
            
            // Draw text
            this.ctx.font = `14px 'Inter', sans-serif`;
            this.ctx.fillStyle = '#1e1e1e'; // Always dark text on notes
            this.ctx.textBaseline = 'top';
            const padding = 10;
            const lines = el.text.split('\n');
            lines.forEach((line, i) => {
                this.ctx.fillText(line, el.x + padding, el.y + padding + (i * 14 * 1.2));
            });
        }
    }

    // State & Storage
    saveState() {
        this.undoStack.push(JSON.stringify(this.elements));
        this.redoStack = [];
        this.persist();
    }

    persist() {
        localStorage.setItem('whiteboard_state', JSON.stringify(this.elements));
    }

    loadState() {
        const saved = localStorage.getItem('whiteboard_state');
        if (saved) {
            try {
                this.elements = JSON.parse(saved);
                this.undoStack.push(JSON.stringify(this.elements));
            } catch (e) {
                console.error("Failed to load state", e);
            }
        } else {
            this.undoStack.push("[]");
        }
    }

    undo() {
        if (this.undoStack.length > 1) {
            this.redoStack.push(this.undoStack.pop());
            this.elements = JSON.parse(this.undoStack[this.undoStack.length - 1]);
            this.persist();
            this.render();
        }
    }

    redo() {
        if (this.redoStack.length > 0) {
            const state = this.redoStack.pop();
            this.undoStack.push(state);
            this.elements = JSON.parse(state);
            this.persist();
            this.render();
        }
    }

    // Export
    exportPNG() {
        if (this.elements.length === 0) return;
        
        // Find bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.elements.forEach(el => {
            const bb = this.getBoundingBox(el);
            minX = Math.min(minX, bb.minX);
            minY = Math.min(minY, bb.minY);
            maxX = Math.max(maxX, bb.maxX);
            maxY = Math.max(maxY, bb.maxY);
        });
        
        const padding = 50;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tCtx = tempCanvas.getContext('2d');
        
        // Background
        tCtx.fillStyle = document.body.classList.contains('dark-mode') ? '#121212' : '#f8f9fa';
        tCtx.fillRect(0, 0, width, height);
        
        tCtx.translate(-minX + padding, -minY + padding);
        
        // Reuse render logic but with temp context
        const originalCtx = this.ctx;
        this.ctx = tCtx;
        this.elements.forEach(el => this.drawElement(el));
        this.ctx = originalCtx; // Restore
        
        const link = document.createElement('a');
        link.download = `whiteboard-${Date.now()}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    exportPDF() {
        // Since we are pure vanilla without libraries, we will use print dialog.
        // We open a new window with just the exported PNG image and call print.
        this.exportImageForPrint();
    }
    
    exportImageForPrint() {
        if (this.elements.length === 0) return;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.elements.forEach(el => {
            const bb = this.getBoundingBox(el);
            minX = Math.min(minX, bb.minX);
            minY = Math.min(minY, bb.minY);
            maxX = Math.max(maxX, bb.maxX);
            maxY = Math.max(maxY, bb.maxY);
        });
        
        const padding = 50;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tCtx = tempCanvas.getContext('2d');
        
        tCtx.fillStyle = '#ffffff'; // force white bg for pdf
        tCtx.fillRect(0, 0, width, height);
        tCtx.translate(-minX + padding, -minY + padding);
        
        const originalCtx = this.ctx;
        this.ctx = tCtx;
        this.elements.forEach(el => this.drawElement(el));
        this.ctx = originalCtx;
        
        const dataUrl = tempCanvas.toDataURL('image/png');
        
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Print Whiteboard</title>
                    <style>
                        body { margin: 0; display: flex; justify-content: center; align-items: center; }
                        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
                        @media print {
                            @page { margin: 0; }
                            body { margin: 0; }
                        }
                    </style>
                </head>
                <body>
                    <img src="${dataUrl}" onload="window.print(); window.close();" />
                </body>
            </html>
        `);
        printWindow.document.close();
    }

    // UI Binding
    setupUI() {
        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;
                this.selectedElement = null; // deselect
                this.render();
            });
        });

        // Colors
        document.querySelectorAll('#stroke-colors .color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#stroke-colors .color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.strokeColor = btn.dataset.color;
            });
        });

        document.querySelectorAll('#bg-colors .color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#bg-colors .color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.bgColor = btn.dataset.color;
            });
        });

        // Stroke width
        document.querySelectorAll('.stroke-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.stroke-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.strokeWidth = parseInt(btn.dataset.width);
            });
        });

        // Utils
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());
        document.getElementById('btn-clear').addEventListener('click', () => {
            this.elements = [];
            this.saveState();
            this.render();
        });
        document.getElementById('btn-export-png').addEventListener('click', () => this.exportPNG());
        document.getElementById('btn-export-pdf').addEventListener('click', () => this.exportPDF());
        
        // Theme
        document.getElementById('btn-theme').addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            this.render();
        });
        
        // Zoom
        document.getElementById('btn-zoom-in').addEventListener('click', () => {
            this.camera.zoom = Math.min(this.camera.zoom * 1.2, 5);
            document.getElementById('zoom-level').innerText = `${Math.round(this.camera.zoom * 100)}%`;
            this.render();
        });
        document.getElementById('btn-zoom-out').addEventListener('click', () => {
            this.camera.zoom = Math.max(this.camera.zoom / 1.2, 0.1);
            document.getElementById('zoom-level').innerText = `${Math.round(this.camera.zoom * 100)}%`;
            this.render();
        });
    }

    onKeyDown(e) {
        if (e.target === this.textInput) return; // Ignore if typing

        // Undo/Redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            this.redo();
        }
        
        // Delete selected
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedElement) {
            this.elements = this.elements.filter(el => el !== this.selectedElement);
            this.selectedElement = null;
            this.saveState();
            this.render();
        }

        // Tool Shortcuts
        const toolMap = {
            'v': 'select',
            'p': 'draw',
            'r': 'rect',
            'c': 'circle',
            'a': 'arrow',
            't': 'text',
            'n': 'note',
            'e': 'eraser'
        };

        if (toolMap[e.key.toLowerCase()]) {
            const tool = toolMap[e.key.toLowerCase()];
            document.querySelector(`.tool-btn[data-tool="${tool}"]`).click();
        }
    }
}

// Initialize App
window.onload = () => {
    new App();
};