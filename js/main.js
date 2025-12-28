/**
 * Main Entry Point
 * Orchestrates multi-product logic, interaction events, and shared Asset Loaders.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { createShowroom, updateShowroom } from './showroom.js';
import { loadARIA, updateARIA, walkToProduct, walkToStart } from './aria.js';
import { loadProduct, updateProduct, changeProductColor, activateProductSpotlight, getProductBounds, getProductFocusPosition, setCurrentProduct, clearCurrentProduct } from './product.js';
import { CameraController } from './camera.js';
import { AudioSystem } from './audio.js';
import { UIController } from './ui.js';

let scene, camera, renderer, composer;
let clock, cameraController, audioSystem, uiController;
let currentCollection = 'elegance';
let raycaster, mouse;
let allowProductOrbit = false;
let introState = null;
let collectionRequestLock = false;
let collectionRequestId = 0;
let pendingCollectionRequest = null;
let cinematicState = null;
const VALID_COLLECTIONS = new Set(['elegance', 'minimal', 'luxury']);
const rootElement = document.documentElement;

function isFullscreenActive() {
    return document.fullscreenElement || document.webkitFullscreenElement;
}

function isFullscreenSupported() {
    return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled
        || rootElement.requestFullscreen || rootElement.webkitRequestFullscreen);
}

function requestFullscreen(targets = rootElement) {
    if (isFullscreenActive()) return false;
    const list = Array.isArray(targets) ? targets.slice() : [targets];
    list.push(renderer?.domElement, document.body, rootElement);
    const unique = Array.from(new Set(list.filter(Boolean)));

    for (const element of unique) {
        const request = element.requestFullscreen || element.webkitRequestFullscreen;
        if (!request) continue;
        try {
            if (element.requestFullscreen) {
                const result = element.requestFullscreen({ navigationUI: 'hide' });
                if (result && typeof result.catch === 'function') {
                    result.catch(() => {});
                }
            } else {
                const result = request.call(element);
                if (result && typeof result.catch === 'function') {
                    result.catch(() => {});
                }
            }
            return true;
        } catch (err) {
            continue;
        }
    }
    return false;
}

function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit || !isFullscreenActive()) return false;
    try {
        const result = exit.call(document);
        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
        return true;
    } catch (err) {
        return false;
    }
}

function getViewportSize() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width ?? window.innerWidth);
    const height = Math.round(viewport?.height ?? window.innerHeight);
    return { width, height };
}

function syncViewportUnits() {
    const { width, height } = getViewportSize();
    rootElement.style.setProperty('--vh', `${height * 0.01}px`);
    rootElement.style.setProperty('--vw', `${width * 0.01}px`);
    return { width, height };
}

async function init() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a); // Will be covered by room
    scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);

    const { width, height } = getViewportSize();
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.6, 6);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas-3d'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = 'none';

    // SINGLE SHARED KTX2 LOADER INSTANCE
    const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/')
        .detectSupport(renderer);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.4, 0.4, 0.85));

    setupViewportListeners();

    cameraController = new CameraController(camera, renderer);

    audioSystem = new AudioSystem();
    uiController = new UIController({
        onStart: startExperience,
        onCollectionSelect: requestCollection,
        onColorChange: (color) => changeProductColor(color),
        onCTAClick: () => uiController.showContactModal(),
        onBack: handleBack
    });

    const skipIntroButton = document.getElementById('skip-intro');
    if (skipIntroButton) {
        skipIntroButton.addEventListener('click', skipIntro);
    }

    const stopCinematicButton = document.getElementById('stop-cinematic');
    if (stopCinematicButton) {
        stopCinematicButton.addEventListener('click', () => cancelActiveCinematic('user'));
    }

    window.addEventListener('aria:collectionSelect', (event) => {
        requestCollection(event?.detail || {});
    });

    // INTERACTION
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    setupCanvasInteractions();

    // LOADING MANAGER
    const loadingManager = new THREE.LoadingManager();

    loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        const percentage = Math.round((itemsLoaded / itemsTotal) * 100);
        const progressBar = document.querySelector('.loader-progress-bar');
        const percentageText = document.querySelector('.loader-percentage');

        if (progressBar) progressBar.style.width = percentage + '%';
        if (percentageText) percentageText.textContent = percentage + '%';
    };

    loadingManager.onLoad = () => {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');

            // Force removal after transition to ensure UI is clickable
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 1000); // Wait for CSS transition (0.8s)
        }

        // Reveal Intro Screen
        setTimeout(() => {
            const intro = document.getElementById('intro-screen');
            if (intro) intro.classList.remove('hidden');
        }, 500);
    };

    loadingManager.onError = (url) => {
        console.error('Error loading ' + url);
    };

    // PASS MANAGER TO SHOWROOM (Crucial for progress tracking)
    createShowroom(scene, ktx2Loader, loadingManager);

    // LOAD MODELS
    await Promise.all([
        loadARIA(scene, loadingManager, ktx2Loader),
        loadProduct(scene, loadingManager, ktx2Loader)
    ]);

    animate();
}

function onResize() {
    const { width, height } = syncViewportUnits();
    if (!camera || !renderer || !composer) return;
    if (width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
}

function setupViewportListeners() {
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize);
        window.visualViewport.addEventListener('scroll', onResize);
    }
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
}

function setupOrientationGuard() {
    const orientationScreen = document.getElementById('orientation-screen');
    if (!orientationScreen) return;

    const mobilePointer = window.matchMedia('(pointer: coarse)');
    const mobileViewport = window.matchMedia('(max-width: 1024px)');
    const portraitOrientation = window.matchMedia('(orientation: portrait)');
    let hasGesture = false;

    const tryEnterFullscreen = () => {
        if (!hasGesture) return;
        const isMobile = mobilePointer.matches && mobileViewport.matches;
        const isPortrait = portraitOrientation.matches;
        if (!isMobile || isPortrait) return;
        if (!isFullscreenSupported()) return;
        requestFullscreen();
        setTimeout(() => window.scrollTo(0, 1), 200);
    };

    const updateOrientation = () => {
        const isMobile = mobilePointer.matches && mobileViewport.matches;
        const shouldLock = isMobile && portraitOrientation.matches;
        orientationScreen.classList.toggle('hidden', !shouldLock);
        orientationScreen.setAttribute('aria-hidden', shouldLock ? 'false' : 'true');
        document.body.classList.toggle('orientation-locked', shouldLock);
        if (!shouldLock) {
            tryEnterFullscreen();
        }
    };

    updateOrientation();

    const markGesture = () => {
        hasGesture = true;
        tryEnterFullscreen();
    };

    window.addEventListener('pointerdown', markGesture, { once: true, passive: true });
    window.addEventListener('touchstart', markGesture, { once: true, passive: true });
    window.addEventListener('keydown', markGesture, { once: true });

    [mobilePointer, mobileViewport, portraitOrientation].forEach(media => {
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updateOrientation);
        } else if (typeof media.addListener === 'function') {
            media.addListener(updateOrientation);
        }
    });
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);
}

function setupFullscreenPrompt() {
    const prompt = document.getElementById('fullscreen-prompt');
    const yesButton = document.getElementById('fullscreen-yes');
    const noButton = document.getElementById('fullscreen-no');
    if (!prompt || !yesButton || !noButton) return;

    const promptText = prompt.querySelector('.fullscreen-text');
    const defaultPromptText = promptText ? promptText.textContent : '';
    const storageKey = 'ariaFullscreenPromptDismissed';
    const mobilePointer = window.matchMedia('(pointer: coarse)');
    const mobileViewport = window.matchMedia('(max-width: 1024px)');
    const portraitOrientation = window.matchMedia('(orientation: portrait)');
    const storage = (() => {
        try {
            return window.localStorage;
        } catch (err) {
            return null;
        }
    })();

    const isDismissed = () => storage?.getItem(storageKey) === '1';
    const setDismissed = () => {
        if (!storage) return;
        storage.setItem(storageKey, '1');
    };

    const setVisible = (show) => {
        prompt.classList.toggle('hidden', !show);
        prompt.setAttribute('aria-hidden', show ? 'false' : 'true');
    };

    const resetPromptState = () => {
        if (promptText) promptText.textContent = defaultPromptText;
    };

    const showFallback = () => {
        if (promptText) {
            promptText.textContent = 'Aggiungi alla Home per il tutto schermo.';
        }
    };

    const updatePrompt = () => {
        const isMobile = mobilePointer.matches && mobileViewport.matches;
        const shouldShow = isMobile
            && !portraitOrientation.matches
            && !isFullscreenActive()
            && !isDismissed();
        if (shouldShow) {
            resetPromptState();
        }
        setVisible(shouldShow);
    };

    yesButton.addEventListener('click', () => {
        const requested = requestFullscreen([renderer?.domElement, rootElement]);
        setTimeout(() => window.scrollTo(0, 1), 200);
        if (!requested) {
            showFallback();
            return;
        }
        setTimeout(() => {
            if (isFullscreenActive()) {
                setDismissed();
                setVisible(false);
            } else {
                showFallback();
            }
        }, 600);
    });

    noButton.addEventListener('click', () => {
        setDismissed();
        setVisible(false);
    });

    updatePrompt();

    [mobilePointer, mobileViewport, portraitOrientation].forEach(media => {
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updatePrompt);
        } else if (typeof media.addListener === 'function') {
            media.addListener(updatePrompt);
        }
    });

    document.addEventListener('fullscreenchange', updatePrompt);
    document.addEventListener('webkitfullscreenchange', updatePrompt);
    window.addEventListener('orientationchange', updatePrompt);
    window.addEventListener('resize', updatePrompt);
}

function setupFullscreenToggle() {
    const toggle = document.getElementById('fullscreen-toggle');
    const toast = document.getElementById('fullscreen-toast');
    if (!toggle) return;

    const mobilePointer = window.matchMedia('(pointer: coarse)');
    const mobileViewport = window.matchMedia('(max-width: 1024px)');

    const updateToggle = () => {
        const isMobile = mobilePointer.matches && mobileViewport.matches;
        const active = isFullscreenActive();
        toggle.classList.toggle('hidden', !isMobile);
        toggle.removeAttribute('disabled');
        toggle.setAttribute('aria-disabled', 'false');
        toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
        toggle.setAttribute('aria-label', active ? 'Esci da schermo intero' : 'Schermo intero');
        toggle.setAttribute('title', active ? 'Esci da schermo intero' : 'Schermo intero');
    };

    const showToast = (message) => {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(showToast.timeoutId);
        showToast.timeoutId = setTimeout(() => {
            toast.classList.add('hidden');
        }, 2600);
    };
    showToast.timeoutId = null;

    toggle.addEventListener('click', () => {
        if (isFullscreenActive()) {
            exitFullscreen();
        } else {
            const requested = requestFullscreen([renderer?.domElement, rootElement]);
            setTimeout(() => window.scrollTo(0, 1), 200);
            if (!requested) {
                showToast('Aggiungi alla Home per il tutto schermo.');
                return;
            }
            setTimeout(() => {
                if (!isFullscreenActive()) {
                    showToast('Aggiungi alla Home per il tutto schermo.');
                }
            }, 600);
        }
    });

    updateToggle();

    [mobilePointer, mobileViewport].forEach(media => {
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updateToggle);
        } else if (typeof media.addListener === 'function') {
            media.addListener(updateToggle);
        }
    });
    document.addEventListener('fullscreenchange', updateToggle);
    document.addEventListener('webkitfullscreenchange', updateToggle);
    window.addEventListener('orientationchange', updateToggle);
    window.addEventListener('resize', updateToggle);
}

function setupCanvasInteractions() {
    if (!renderer || !renderer.domElement) return;
    const canvas = renderer.domElement;
    if (window.PointerEvent) {
        canvas.addEventListener('pointerdown', onCanvasPointerDown, { passive: true, capture: true });
    } else {
        canvas.addEventListener('mousedown', onCanvasPointerDown, { passive: true, capture: true });
        canvas.addEventListener('touchstart', onCanvasPointerDown, { passive: true, capture: true });
    }
}

function getPointerCoords(event) {
    if (event?.changedTouches && event.changedTouches.length) {
        return {
            x: event.changedTouches[0].clientX,
            y: event.changedTouches[0].clientY
        };
    }
    if (event?.touches && event.touches.length) {
        return {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY
        };
    }
    return { x: event.clientX, y: event.clientY };
}

function onCanvasPointerDown(event) {
    const panel = document.getElementById('product-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (!allowProductOrbit) return;
    if (!cameraController) return;
    if (cameraController.isOrbiting) return;

    const { width, height } = getViewportSize();
    const coords = getPointerCoords(event);
    if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return;

    mouse.x = (coords.x / width) * 2 - 1;
    mouse.y = -(coords.y / height) * 2 + 1;

    const isTouch = event?.pointerType === 'touch'
        || event?.touches
        || event?.changedTouches
        || window.matchMedia('(pointer: coarse)').matches;

    if (isTouch) {
        const targetPos = getProductFocusPosition(currentCollection);
        const bounds = getProductBounds(currentCollection);
        const radius = bounds ? bounds.radius : 2.8;
        cameraController.enableOrbitMode(targetPos, { radius });
        uiController.hideInteractHint();
        return;
    }

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        let target = intersects[0].object;
        let isInteractable = false;

        while (target) {
            if (target.userData && target.userData.isInteractable) {
                isInteractable = true;
                break;
            }
            target = target.parent;
        }

        if (isInteractable) {
            const targetPos = getProductFocusPosition(currentCollection);
            const bounds = getProductBounds(currentCollection);
            const radius = bounds ? bounds.radius : 2.8;

            cameraController.enableOrbitMode(targetPos, { radius });
            uiController.hideInteractHint();
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    updateShowroom(elapsed);
    if (audioSystem) updateARIA(elapsed, camera, audioSystem.isSpeaking());
    updateProduct(elapsed);
    if (cameraController) cameraController.update(delta);

    composer.render();
}

function setUILocked(locked) {
    const canLock = uiController
        && typeof uiController.lockUI === 'function'
        && typeof uiController.unlockUI === 'function';

    if (canLock) {
        if (locked) {
            uiController.lockUI();
        } else {
            uiController.unlockUI();
        }
        return;
    }

    document.body.classList.toggle('ui-locked', locked);
}

function createIntroState() {
    const state = {
        cancelled: false,
        cancelHooks: [],
        skipResolve: null,
        skipPromise: null
    };
    state.skipPromise = new Promise(resolve => {
        state.skipResolve = resolve;
    });
    return state;
}

function showSkipIntro(show) {
    const skipIntroButton = document.getElementById('skip-intro');
    if (skipIntroButton) {
        skipIntroButton.classList.toggle('hidden', !show);
    }
}

function showStopCinematic(show) {
    const stopCinematicButton = document.getElementById('stop-cinematic');
    if (stopCinematicButton) {
        stopCinematicButton.classList.toggle('hidden', !show);
    }
}

function createCinematicState() {
    const state = {
        cancelled: false,
        reason: null,
        resolve: null,
        promise: null
    };
    state.promise = new Promise(resolve => {
        state.resolve = resolve;
    });
    return state;
}

function cancelActiveCinematic(reason = 'user') {
    if (!cinematicState || cinematicState.cancelled) return;
    cinematicState.cancelled = true;
    cinematicState.reason = reason;
    if (audioSystem) audioSystem.stop();
    if (cameraController && typeof cameraController.stopTour === 'function') {
        cameraController.stopTour();
    }
    if (uiController) uiController.hideSubtitle();
    showStopCinematic(false);
    if (cinematicState.resolve) cinematicState.resolve();
}

function waitWithCancel(ms, state) {
    return new Promise(resolve => {
        const timeout = setTimeout(resolve, ms);
        if (state && Array.isArray(state.cancelHooks)) {
            state.cancelHooks.push(() => {
                clearTimeout(timeout);
                resolve();
            });
        }
    });
}

async function playIntroSequence(state) {
    if (!cameraController) return;

    if (state?.cancelled) return;
    await cameraController.transitionTo('custom', 5.5, new THREE.Vector3(0, 2.1, 4.8), new THREE.Vector3(0, 1, -4));
    if (state?.cancelled) return;
    await waitWithCancel(1400, state);

    if (state?.cancelled) return;
    await cameraController.transitionTo('custom', 7.0, new THREE.Vector3(-7.2, 1.6, 2.3), new THREE.Vector3(-6, 1, -5));
    if (state?.cancelled) return;
    await waitWithCancel(1600, state);

    if (state?.cancelled) return;
    await cameraController.transitionTo('custom', 7.0, new THREE.Vector3(0, 1.6, 2.3), new THREE.Vector3(0, 1, -5));
    if (state?.cancelled) return;
    await waitWithCancel(1600, state);

    if (state?.cancelled) return;
    await cameraController.transitionTo('custom', 7.0, new THREE.Vector3(7.2, 1.6, 2.3), new THREE.Vector3(6, 1, -5));
    if (state?.cancelled) return;
    await waitWithCancel(1600, state);

    if (state?.cancelled) return;
    // CLOSE-UP ON ARIA START
    // POS: (0, 0.5, 3.5), LOOKAT: (0, 0, 0)
    await cameraController.transitionTo('custom', 4.5, new THREE.Vector3(0, 0.5, 3.5), new THREE.Vector3(0, 0, 0));
}

function skipIntro() {
    if (!introState || introState.cancelled) return;
    introState.cancelled = true;
    introState.cancelHooks.forEach(fn => fn());
    introState.cancelHooks = [];
    if (introState.skipResolve) {
        introState.skipResolve();
    }

    if (audioSystem) audioSystem.stop();
    if (cameraController && typeof cameraController.cancelTransition === 'function') {
        cameraController.cancelTransition();
    }

    const transitionPromise = cameraController
        ? cameraController.transitionTo('custom', 1.4, new THREE.Vector3(0, 0.5, 3.5), new THREE.Vector3(0, 0, 0))
        : null;
    uiController.showCollectionButtons();
    setUILocked(false);
    showSkipIntro(false);
    introState = null;
    return transitionPromise;
}

async function startExperience() {
    setUILocked(true);

    if (audioSystem && typeof audioSystem.unlock === 'function') {
        audioSystem.unlock('apertura');
    }

    await uiController.hideIntro();
    uiController.showOverlay();

    introState = createIntroState();
    showSkipIntro(true);

    const introAudio = audioSystem ? audioSystem.playApertura() : Promise.resolve(true);
    const introSequence = playIntroSequence(introState);

    await Promise.race([introSequence, introState.skipPromise]);

    if (introState && !introState.cancelled) {
        await introAudio;
    } else {
        return;
    }

    await new Promise(r => setTimeout(r, 500));
    uiController.showCollectionButtons();
    setUILocked(false);
    showSkipIntro(false);
    introState = null;
}

function parseCollectionRequest(input, sourceFallback = 'ui') {
    let collection = '';
    let source = sourceFallback;

    if (input && typeof input === 'object') {
        collection = typeof input.collection === 'string' ? input.collection : '';
        source = typeof input.source === 'string' ? input.source : source;
    } else if (typeof input === 'string') {
        collection = input;
    }

    const normalized = collection.toLowerCase().trim();
    return { collection: normalized, source };
}

async function requestCollection(input, source = 'ui') {
    const parsed = parseCollectionRequest(input, source);
    if (!VALID_COLLECTIONS.has(parsed.collection)) return;

    if (collectionRequestLock) {
        pendingCollectionRequest = parsed;
        collectionRequestId += 1;
        cancelActiveCinematic('switch');
        if (cameraController) {
            if (typeof cameraController.cancelTransition === 'function') {
                cameraController.cancelTransition();
            }
            if (typeof cameraController.stopTour === 'function') {
                cameraController.stopTour();
            }
            if (typeof cameraController.disableOrbitMode === 'function') {
                cameraController.disableOrbitMode();
            }
        }
        return;
    }

    collectionRequestLock = true;
    const requestId = ++collectionRequestId;
    try {
        if (introState && !introState.cancelled) {
            const skipPromise = skipIntro();
            if (skipPromise && typeof skipPromise.then === 'function') {
                await skipPromise;
            } else {
                await new Promise(r => setTimeout(r, 1400));
            }
        }
        await handleCollectionSelect(parsed.collection, { source: parsed.source, requestId });
    } finally {
        collectionRequestLock = false;
        if (pendingCollectionRequest) {
            const next = pendingCollectionRequest;
            pendingCollectionRequest = null;
            requestCollection(next.collection, next.source);
        }
    }
}

async function handleCollectionSelect(collection, options = {}) {
    const requestId = options.requestId ?? collectionRequestId;
    const isActiveRequest = () => requestId === collectionRequestId;

    cancelActiveCinematic('switch');
    if (cameraController) {
        if (typeof cameraController.cancelTransition === 'function') {
            cameraController.cancelTransition();
        }
        if (typeof cameraController.stopTour === 'function') {
            cameraController.stopTour();
        }
        if (typeof cameraController.disableOrbitMode === 'function') {
            cameraController.disableOrbitMode();
        }
    }

    if (!isActiveRequest()) return;

    currentCollection = collection;
    setCurrentProduct(collection);
    uiController.hideCollectionButtons();
    uiController.hideInteractHint();
    uiController.hideProductPanel();
    allowProductOrbit = false;

    if (audioSystem && typeof audioSystem.prepareCollection === 'function') {
        audioSystem.prepareCollection(collection);
    }

    await new Promise(r => setTimeout(r, 300));
    if (!isActiveRequest()) return;

    const walkPromise = walkToProduct(collection);

    await new Promise(r => setTimeout(r, 500));
    if (!isActiveRequest()) return;
    cameraController.followARIA(true);

    await walkPromise;
    if (!isActiveRequest()) return;

    cameraController.followARIA(false);
    await cameraController.transitionTo('product_with_aria', 1.5, collection);
    if (!isActiveRequest()) return;

    const productInfo = {
        elegance: { name: "Divano Bonton 200", desc: "Bonton 200. Design morbido e comfort avvolgente." },
        minimal: { name: "Divano Dolores 274X", desc: "Dolores 274X. Linee essenziali per spazi moderni." },
        luxury: { name: "Divano Eclipse", desc: "Eclipse. Presenza scenica e stile iconico." }
    };

    const info = productInfo[collection];
    let cancelledByUser = false;
    if (info) {
        uiController.updateProductInfo(info.name, info.desc);
        uiController.showSubtitle(info.desc);

        const shouldMuteVoice = options.source === 'voice';
        if (shouldMuteVoice) {
            window.dispatchEvent(new CustomEvent('aria:voiceMute'));
        }

        const localCinematicState = createCinematicState();
        cinematicState = localCinematicState;
        showStopCinematic(true);

        const audioPromise = audioSystem ? audioSystem.playCollection(collection) : Promise.resolve(true);
        const cinematicDuration = audioSystem?.getCollectionDuration(collection) || 12;
        const cinematicPromise = cameraController && typeof cameraController.playProductCinematic === 'function'
            ? cameraController.playProductCinematic(collection, { duration: Math.max(8, cinematicDuration) })
            : Promise.resolve();

        try {
            await Promise.race([Promise.all([audioPromise, cinematicPromise]), localCinematicState.promise]);
        } finally {
            if (shouldMuteVoice) {
                window.dispatchEvent(new CustomEvent('aria:voiceUnmute'));
            }
        }

        if (!isActiveRequest()) return;
        cancelledByUser = localCinematicState.cancelled && localCinematicState.reason === 'user';
        if (localCinematicState.cancelled && localCinematicState.reason === 'switch') {
            showStopCinematic(false);
            if (cinematicState === localCinematicState) {
                cinematicState = null;
            }
            return;
        }

        showStopCinematic(false);
        if (cinematicState === localCinematicState) {
            cinematicState = null;
        }
        uiController.hideSubtitle();
    }

    if (!isActiveRequest()) return;

    if (cameraController && typeof cameraController.frameAriaAndProduct === 'function') {
        const frameDuration = cancelledByUser ? 0.9 : 1.4;
        await cameraController.frameAriaAndProduct(collection, { duration: frameDuration });
        if (!isActiveRequest()) return;
    }

    uiController.showProductPanel();
    uiController.showInteractHint();
    allowProductOrbit = true;
}

async function handleBack() {
    uiController.hideProductPanel();
    uiController.hideInteractHint();
    activateProductSpotlight(false);
    allowProductOrbit = false;
    clearCurrentProduct();

    cameraController.disableOrbitMode();

    // Safety timeout for walk back logic
    const safetyPromise = new Promise(resolve => setTimeout(resolve, 3500));
    const walkBackPromise = Promise.race([walkToStart(), safetyPromise]);

    // Use 'return_start' for smooth, continuous return to start position
    // Sync duration (8.0s) with ARIA's walk time so they arrive roughly together
    const cameraPromise = cameraController.transitionTo('return_start', 8.0);

    await Promise.all([walkBackPromise, cameraPromise]);

    uiController.showCollectionButtons();
}

syncViewportUnits();
setupOrientationGuard();
setupFullscreenPrompt();
setupFullscreenToggle();
init().catch(console.error);
