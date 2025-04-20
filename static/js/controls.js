class PlayerControls {
    constructor() {
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            sprint: false,
            crouch: false
        };
        
        this.cameraRotation = 0;
        this.moveSpeed = 0.1;
        this.sprintMultiplier = 2;
        this.crouchMultiplier = 0.5;
        this.jumpForce = 0.2;
        this.gravity = 0.01;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        this.isActive = true; // Default to active
        this.lastActiveTime = Date.now();
        this.checkInterval = 100; // Check every 100ms

        this.setupEventListeners();
        this.startActiveSessionCheck();
    }

    setupEventListeners() {
        console.log("Setting up event listeners");
        
        // Always bind events initially
        document.addEventListener('keydown', (e) => {
            // Only handle keys if NOT typing in an input or textarea
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
            console.log("Keydown event detected:", e.key);
            this.handleKeyDown(e);
        });
        
        document.addEventListener('keyup', (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
            console.log("Keyup event detected:", e.key);
            this.handleKeyUp(e);
        });
        
        document.addEventListener('focus', () => {
            console.log("Focus event detected");
            this.handleFocus();
        });
        
        document.addEventListener('blur', () => {
            console.log("Blur event detected");
            this.handleBlur();
        });
        
        // Also attach to window for better focus detection
        window.addEventListener('focus', () => {
            console.log("Window focus event detected");
            this.handleFocus();
        });
        
        window.addEventListener('blur', () => {
            console.log("Window blur event detected");
            this.handleBlur();
        });
        
        console.log("Event listeners setup complete");
    }

    isActiveSession() {
        // Check if this is the most recently focused window/tab
        return document.hasFocus() && !document.hidden;
    }

    startActiveSessionCheck() {
        setInterval(() => {
            const wasActive = this.isActive;
            this.isActive = this.isActiveSession();
            
            if (this.isActive !== wasActive) {
                if (this.isActive) {
                    this.handleFocus();
                } else {
                    this.handleBlur();
                }
            }
        }, this.checkInterval);
    }

    handleFocus() {
        this.isActive = true;
        this.lastActiveTime = Date.now();
        console.log("Session focused - Controls enabled");
    }

    handleBlur() {
        this.isActive = false;
        // Reset all keys when losing focus
        Object.keys(this.keys).forEach(key => {
            this.keys[key] = false;
        });
        console.log("Session blurred - Controls disabled");
    }

    handleKeyDown(event) {
        if (!this.isActive) {
            console.log("Key pressed but controls inactive:", event.key);
            return;
        }
        
        // Prevent default behavior for game controls
        if (['w', 'a', 's', 'd', ' ', 'shift', 'c', 'q', 'e'].includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
        
        const key = event.key.toLowerCase();
        console.log("Processing keydown:", key);
        
        switch(key) {
            case 'w': this.keys.forward = true; break;
            case 's': this.keys.backward = true; break;
            case 'a': this.keys.left = true; break;
            case 'd': this.keys.right = true; break;
            case ' ': this.keys.jump = true; break;
            case 'shift': this.keys.sprint = true; break;
            case 'c': this.keys.crouch = true; break;
            case 'q': this.rotateCamera(-1); break;
            case 'e': this.rotateCamera(1); break;
        }
        
        // Debug output
        console.log("Key pressed:", event.key, "Active:", this.isActive, "Keys state:", this.keys);
    }

    handleKeyUp(event) {
        if (!this.isActive) {
            console.log("Key released but controls inactive:", event.key);
            return;
        }
        
        // Prevent default behavior for game controls
        if (['w', 'a', 's', 'd', ' ', 'shift', 'c'].includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
        
        const key = event.key.toLowerCase();
        console.log("Processing keyup:", key);
        
        switch(key) {
            case 'w': this.keys.forward = false; break;
            case 's': this.keys.backward = false; break;
            case 'a': this.keys.left = false; break;
            case 'd': this.keys.right = false; break;
            case ' ': this.keys.jump = false; break;
            case 'shift': this.keys.sprint = false; break;
            case 'c': this.keys.crouch = false; break;
        }
        
        // Debug output
        console.log("Key released:", event.key, "Active:", this.isActive, "Keys state:", this.keys);
    }

    rotateCamera(direction) {
        if (!this.isActive) return;
        this.cameraRotation += direction * Math.PI / 4;
    }

    getMovementVector() {
        if (!this.isActive) return { x: 0, y: 0, z: 0 };

        let speed = this.moveSpeed;
        if (this.keys.sprint) speed *= this.sprintMultiplier;
        if (this.keys.crouch) speed *= this.crouchMultiplier;

        let dx = 0;
        let dz = 0;

        // Calculate movement based on camera rotation
        if (this.keys.forward) {
            dz -= Math.cos(this.cameraRotation) * speed;
            dx -= Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.backward) {
            dz += Math.cos(this.cameraRotation) * speed;
            dx += Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.left) {
            dx -= Math.cos(this.cameraRotation) * speed;
            dz += Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.right) {
            dx += Math.cos(this.cameraRotation) * speed;
            dz -= Math.sin(this.cameraRotation) * speed;
        }

        // Debug output for movement
        if (dx !== 0 || dz !== 0) {
            console.log("Movement vector:", { x: dx, y: this.verticalVelocity, z: dz });
        }

        return { x: dx, y: this.verticalVelocity, z: dz };
    }

    update() {
        if (!this.isActive) return { x: 0, y: 0, z: 0 };

        // Handle jumping
        if (this.keys.jump && this.isGrounded) {
            this.verticalVelocity = this.jumpForce;
            this.isGrounded = false;
        }

        // Apply gravity
        if (!this.isGrounded) {
            this.verticalVelocity -= this.gravity;
        }

        // Ground check
        if (this.verticalVelocity < 0) {
            this.verticalVelocity = 0;
            this.isGrounded = true;
        }

        return this.getMovementVector();
    }
} 