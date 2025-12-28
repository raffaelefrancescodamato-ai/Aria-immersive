export class UIController {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btn-start').addEventListener('click', () => this.callbacks.onStart());
        const btnCta = document.getElementById('btn-cta');
        if (btnCta) btnCta.addEventListener('click', () => this.callbacks.onCTAClick());

        document.getElementById('btn-back').addEventListener('click', () => this.callbacks.onBack());

        const modalClose = document.getElementById('modal-close');
        if (modalClose) modalClose.addEventListener('click', () => this.hideContactModal());

        const contactForm = document.getElementById('contact-form');
        if (contactForm) contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.hideContactModal();
            alert('Grazie! Ti contatteremo presto.');
        });

        // Color selector
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const color = target.dataset.color;
                document.querySelectorAll('.color-btn').forEach(node => node.classList.remove('active'));
                target.classList.add('active');
                this.callbacks.onColorChange(color);
            });
        });

        // Collection buttons
        document.querySelectorAll('.collection-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.callbacks.onCollectionSelect(e.target.dataset.collection);
            });
        });
    }

    lockUI() {
        document.body.classList.add('ui-locked');
    }

    unlockUI() {
        document.body.classList.remove('ui-locked');
    }

    hideIntro() {
        const intro = document.getElementById('intro-screen');
        return new Promise((resolve) => {
            if (!intro) {
                resolve();
                return;
            }
            if (typeof gsap !== 'undefined') {
                gsap.to(intro, {
                    opacity: 0,
                    duration: 1,
                    onComplete: () => {
                        intro.classList.add('hidden');
                        resolve();
                    }
                });
            } else {
                intro.classList.add('hidden');
                resolve();
            }
        });
    }

    showOverlay() {
        document.getElementById('ui-overlay').classList.remove('hidden');
    }

    showCollectionButtons() {
        const container = document.getElementById('collection-buttons');
        container.classList.remove('hidden');
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(container,
                { y: 50, opacity: 0 },
                { y: 0, opacity: 1, duration: 1, ease: 'power2.out' }
            );
        }
    }

    hideCollectionButtons() {
        const container = document.getElementById('collection-buttons');
        if (typeof gsap !== 'undefined') {
            gsap.to(container, {
                y: 50, opacity: 0, duration: 0.5,
                onComplete: () => container.classList.add('hidden')
            });
        } else {
            container.classList.add('hidden');
        }
    }

    showProductPanel() {
        const panel = document.getElementById('product-panel');
        panel.classList.remove('hidden');
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(panel,
                { x: 100, opacity: 0 },
                { x: 0, opacity: 1, duration: 0.8, ease: 'power2.out' }
            );
        }
    }

    updateProductInfo(name, desc) {
        document.getElementById('product-name').textContent = name;
        document.getElementById('product-description').textContent = desc;
    }

    hideProductPanel() {
        const panel = document.getElementById('product-panel');
        if (typeof gsap !== 'undefined') {
            gsap.to(panel, {
                x: 100, opacity: 0, duration: 0.5,
                onComplete: () => panel.classList.add('hidden')
            });
        } else {
            panel.classList.add('hidden');
        }
    }

    showInteractHint() {
        const hint = document.getElementById('interact-hint');
        if (hint) {
            hint.classList.remove('hidden');
            hint.style.opacity = 1;
        }
    }

    hideInteractHint() {
        const hint = document.getElementById('interact-hint');
        if (hint) {
            hint.style.opacity = 0;
            setTimeout(() => hint.classList.add('hidden'), 500);
        }
    }

    showSubtitle(text) {
        const sub = document.getElementById('subtitle-text');
        sub.textContent = text;
        sub.parentElement.classList.remove('hidden');
    }

    hideSubtitle() {
        document.getElementById('subtitles').classList.add('hidden');
    }

    showContactModal() {
        const modal = document.getElementById('contact-modal');
        modal.classList.remove('hidden');
        gsap.fromTo(modal.children[0],
            { scale: 0.8, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out' }
        );
    }

    hideContactModal() {
        document.getElementById('contact-modal').classList.add('hidden');
    }
}
