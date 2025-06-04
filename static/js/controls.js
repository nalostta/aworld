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
        this.moveSpeed = 0.15;  // Slightly faster base movement
        this.sprintMultiplier = 2;
        this.crouchMultiplier = 0.5;
        this.jumpForce = 0.45;  // Increased for higher jumps
        this.gravity = 0.025;   // Increased for snappier jumps
        this.terminalVelocity = 0.5;  // Max fall speed
        
        // Enhanced movement properties
        this.verticalVelocity = 0;
        this.velocity = { x: 0, z: 0 };
        this.acceleration = 0.02;
        this.deceleration = 0.05;
        this.maxVelocity = 0.2;
        
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
        
        // Slightly reduce speed when in air for better control
        const airControlFactor = this.isGrounded ? 1.0 : 0.7;

        // Calculate target velocity based on inputs and camera rotation
        let targetVx = 0;
        let targetVz = 0;
        
        // Apply air control factor to target speed
        speed *= airControlFactor;

        // Calculate movement based on camera rotation
        if (this.keys.forward) {
            targetVz -= Math.cos(this.cameraRotation) * speed;
            targetVx -= Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.backward) {
            targetVz += Math.cos(this.cameraRotation) * speed;
            targetVx += Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.left) {
            targetVx -= Math.cos(this.cameraRotation) * speed;
            targetVz += Math.sin(this.cameraRotation) * speed;
        }
        if (this.keys.right) {
            targetVx += Math.cos(this.cameraRotation) * speed;
            targetVz -= Math.sin(this.cameraRotation) * speed;
        }

        // Apply acceleration/deceleration towards target velocity
        const currentAcceleration = this.isGrounded ? this.acceleration : (this.acceleration * 0.7);
        const currentDeceleration = this.isGrounded ? this.deceleration : (this.deceleration * 0.5);
        
        if (Math.abs(targetVx) > 0.001) {
            // If we have input, accelerate in that direction
            this.velocity.x += (targetVx - this.velocity.x) * currentAcceleration;
        } else {
            // Decelerate when no input
            this.velocity.x *= (1 - currentDeceleration);
            if (Math.abs(this.velocity.x) < 0.001) this.velocity.x = 0;
        }

        if (Math.abs(targetVz) > 0.001) {
            this.velocity.z += (targetVz - this.velocity.z) * currentAcceleration;
        } else {
            this.velocity.z *= (1 - currentDeceleration);
            if (Math.abs(this.velocity.z) < 0.001) this.velocity.z = 0;
        }

        // Cap maximum velocity
        const currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        if (currentSpeed > this.maxVelocity) {
            const scaleFactor = this.maxVelocity / currentSpeed;
            this.velocity.x *= scaleFactor;
            this.velocity.z *= scaleFactor;
        }

        // Debug output for movement and jump state
        if (this.debug && (this.velocity.x !== 0 || this.velocity.z !== 0 || this.verticalVelocity !== 0)) {
            console.log("Movement:", { 
                x: this.velocity.x.toFixed(3), 
                y: this.verticalVelocity.toFixed(3), 
                z: this.velocity.z.toFixed(3),
                grounded: this.isGrounded,
                jumping: !this.isGrounded && this.verticalVelocity > 0,
                falling: !this.isGrounded && this.verticalVelocity < 0
            });
        }

        return { x: this.velocity.x, y: this.verticalVelocity, z: this.velocity.z };
    }

    update(playerY = 0) {
        if (!this.isActive) return { x: 0, y: 0, z: 0 };

        // Handle jumping with improved logic
        if (this.keys.jump && this.isGrounded) {
            this.verticalVelocity = this.jumpForce;
            this.isGrounded = false;
            this.jumpStartTime = Date.now();
            // Trigger jump animation or effect
            if (typeof this.onJump === 'function') {
                this.onJump();
            }
        }

        // Apply gravity with terminal velocity
        if (!this.isGrounded) {
            this.verticalVelocity = Math.max(
                this.verticalVelocity - this.gravity, 
                -this.terminalVelocity
            );
            
            // Apply air resistance (slight horizontal drag while in air)
            this.velocity.x *= 0.99;
            this.velocity.z *= 0.99;
        }

        // Ground check with improved landing behavior
        const groundLevel = 1.0; // Player mesh origin is center; feet are at playerY - 1. Ground is at Y=0 for feet.
        if (this.verticalVelocity <= 0 && playerY <= groundLevel) {
            // Only trigger landing effects if we were in the air
            if (!this.isGrounded) {
                this.verticalVelocity = 0;
                this.isGrounded = true;
                
                // Landing effects
                if (typeof this.onLand === 'function') {
                    this.onLand();
                }
                
                // Dampening effect on landing based on fall speed
                const fallSpeed = Math.abs(this.verticalVelocity);
                const dampenFactor = Math.max(0.7, 1 - (fallSpeed * 0.5));
                this.velocity.x *= dampenFactor;
                this.velocity.z *= dampenFactor;
            }
        } else if (playerY > groundLevel) {
            this.isGrounded = false;
        }
        
        // Update jump state for next frame
        this.wasGrounded = this.isGrounded;

        // Calculate movement vector with current velocity
        return this.getMovementVector();
    }
}

export default PlayerControls;