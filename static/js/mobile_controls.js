// MobileControls.js - Adds a virtual joystick and jump button for mobile devices
class MobileControls {
    constructor(onMove, onJump) {
        this.onMove = onMove; // (dx, dy) => void
        this.onJump = onJump; // () => void
        this.active = false;
        this.joystick = null;
        this.joystickKnob = null;
        this.jumpBtn = null;
        this.touchId = null;
        this.center = { x: 0, y: 0 };
        this.radius = 48;
        this._init();
    }
    _init() {
        // Create joystick base
        this.joystick = document.createElement('div');
        this.joystick.className = 'mobile-joystick';
        this.joystickKnob = document.createElement('div');
        this.joystickKnob.className = 'mobile-joystick-knob';
        this.joystick.appendChild(this.joystickKnob);
        document.body.appendChild(this.joystick);
        // Create jump button
        this.jumpBtn = document.createElement('button');
        this.jumpBtn.className = 'mobile-jump-btn';
        this.jumpBtn.innerText = 'Jump';
        document.body.appendChild(this.jumpBtn);
        // Position joystick bottom left, jump bottom right
        this.joystick.style.position = 'fixed';
        this.joystick.style.left = '32px';
        this.joystick.style.bottom = '32px';
        this.joystick.style.zIndex = '200';
        this.joystickKnob.style.position = 'absolute';
        this.joystickKnob.style.left = '32px';
        this.joystickKnob.style.top = '32px';
        this.jumpBtn.style.position = 'fixed';
        this.jumpBtn.style.right = '36px';
        this.jumpBtn.style.bottom = '48px';
        this.jumpBtn.style.zIndex = '200';
        // Joystick touch events
        this.joystick.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
        this.joystick.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
        this.joystick.addEventListener('touchend', this._onTouchEnd.bind(this), { passive: false });
        // Jump button
        this.jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.onJump) this.onJump();
        });
    }
    _onTouchStart(e) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        this.touchId = touch.identifier;
        const rect = this.joystick.getBoundingClientRect();
        this.center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        this.active = true;
    }
    _onTouchMove(e) {
        if (!this.active) return;
        for (let touch of e.changedTouches) {
            if (touch.identifier === this.touchId) {
                const dx = touch.clientX - this.center.x;
                const dy = touch.clientY - this.center.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let normDx = dx, normDy = dy;
                if (dist > this.radius) {
                    normDx = (dx / dist) * this.radius;
                    normDy = (dy / dist) * this.radius;
                }
                this.joystickKnob.style.transform = `translate(${normDx}px, ${normDy}px)`;
                // Normalize to [-1, 1]
                const moveX = Math.max(-1, Math.min(1, normDx / this.radius));
                const moveY = Math.max(-1, Math.min(1, normDy / this.radius));
                if (this.onMove) this.onMove(moveX, moveY);
                break;
            }
        }
    }
    _onTouchEnd(e) {
        for (let touch of e.changedTouches) {
            if (touch.identifier === this.touchId) {
                this.active = false;
                this.joystickKnob.style.transform = '';
                if (this.onMove) this.onMove(0, 0);
                break;
            }
        }
    }
    show() {
        this.joystick.style.display = '';
        this.jumpBtn.style.display = '';
    }
    hide() {
        this.joystick.style.display = 'none';
        this.jumpBtn.style.display = 'none';
    }
}

// Helper to detect mobile
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

window.MobileControls = MobileControls;
window.isMobileDevice = isMobileDevice;
