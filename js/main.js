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

function requestFullscreen() {
    const request = rootElement.requestFullscreen || rootElement.webkitRequestFullscreen;
    if (!request || isFullscreenActive()) return;
    try {
        const result = request.call(rootElement);
        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
    } catch (err) {
        return;
    }
}

async function init() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a); // Will be covered by room
    scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 6);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas-3d'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // SINGLE SHARED KTX2 LOADER INSTANCE
    const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/')
        .detectSupport(renderer);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.4, 0.85));

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
    window.addEventListener('click', onMouseClick);

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

    window.addEventListener('resize', onResize);
    animate();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
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

    const updatePrompt = () => {
        const isMobile = mobilePointer.matches && mobileViewport.matches;
        const shouldShow = isMobile
            && !portraitOrientation.matches
            && !isFullscreenActive()
            && !isDismissed();
        setVisible(shouldShow);
    };

    yesButton.addEventListener('click', () => {
        setDismissed();
        setVisible(false);
        requestFullscreen();
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

function onMouseClick(event) {
    const panel = document.getElementById('product-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (!allowProductOrbit) return;
    if (cameraController && cameraController.isOrbiting) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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

setupOrientationGuard();
setupFullscreenPrompt();
init().catch(console.error);
