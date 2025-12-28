/**
 * ARIA Model Controller
 * Slower, more natural movement.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getProductBounds } from './product.js';

let ariaModel = null;
let ariaGroup = null;
let highlightLight = null;
let spotLight = null;
let mixer = null;

const ARIA_START_POS = new THREE.Vector3(0, 0, 2);

const PRODUCT_POSITIONS = {
    elegance: new THREE.Vector3(-6, 0, -5),
    minimal: new THREE.Vector3(0, 0, -5),
    luxury: new THREE.Vector3(6, 0, -5)
};

let ariaState = 'idle';
let targetRotation = 0;
let walkProgress = 0;
let walkStartPos = new THREE.Vector3();
let walkEndPos = new THREE.Vector3();
let walkDuration = 0;
let walkElapsed = 0;
let stepPhase = 0;
let lastUpdateTime = 0;

// Movement tuning
const walkSpeed = 1.1; // Units per second
const turnSpeed = 2.4; // Gentle but responsive
const ANGLE_TOLERANCE = 0.004; // Approx 0.23 degrees
const bobAmplitude = 0.02; // Subtle but present
const bobFrequency = 5.5;
const swayAmplitude = 0.015;
const leanAmplitude = 0.01;
const idleBreath = 0.012;

let lightIntensity = 1.0;
let targetLightIntensity = 1.0;
let isHighlighted = false;
let isSpeakingState = false;

let onWalkComplete = null;
let walkRequestId = 0;
let pendingWalkResolve = null;
let pendingWalkTimeout = null;

export async function loadARIA(scene, loadingManager, ktx2Loader) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader(loadingManager);
        if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
        loader.setMeshoptDecoder(MeshoptDecoder);

        loader.load(
            './Assets/ARIA.glb',
            (gltf) => {
                ariaModel = gltf.scene;
                ariaGroup = new THREE.Group();
                ariaGroup.add(ariaModel);
                ariaGroup.position.copy(ARIA_START_POS);
                ariaModel.scale.setScalar(1.35); // Enlaged ARIA

                if (gltf.animations && gltf.animations.length > 0) {
                    mixer = new THREE.AnimationMixer(ariaModel);
                    gltf.animations.forEach((clip) => {
                        const action = mixer.clipAction(clip);
                        action.timeScale = 0.8; // Slow down animation itself to match walk
                        action.play();
                    });
                }

                setupARIAMaterials();
                setupARIALighting(scene);

                scene.add(ariaGroup);
                resolve(ariaModel);
            },
            undefined,
            reject
        );
    });
}

function setupARIAMaterials() {
    ariaModel.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => m.clone());
                } else {
                    child.material = child.material.clone();
                }
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                        mat.envMapIntensity = 1.0;
                        mat.emissive = new THREE.Color(0x000000);
                        mat.emissiveIntensity = 0;
                        mat.needsUpdate = true;
                    }
                    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
                });
            }
        }
    });
}

function setupARIALighting(scene) {
    highlightLight = new THREE.PointLight(0xffffff, 3.0, 8);
    highlightLight.position.set(0, 2, 0);
    ariaGroup.add(highlightLight);

    // Softer rim
    const rimLight = new THREE.PointLight(0xffffff, 1.0, 5);
    rimLight.position.set(-1, 1.5, -1);
    ariaGroup.add(rimLight);

    const fillLight = new THREE.PointLight(0xffffff, 0.8, 5);
    fillLight.position.set(1, 1.5, 1);
    ariaGroup.add(fillLight);

    spotLight = new THREE.SpotLight(0xffffff, 0);
    spotLight.position.set(0, 8, 4);
    spotLight.angle = Math.PI / 5;
    spotLight.castShadow = true;
    scene.add(spotLight);

    const spotTarget = new THREE.Object3D();
    scene.add(spotTarget);
    spotLight.target = spotTarget;
}

export function walkToPosition(targetPos) {
    return new Promise((resolve) => {
        if (!ariaGroup) {
            resolve();
            return;
        }

        if (pendingWalkResolve) {
            pendingWalkResolve();
            pendingWalkResolve = null;
        }
        if (pendingWalkTimeout) {
            clearTimeout(pendingWalkTimeout);
            pendingWalkTimeout = null;
        }

        walkRequestId += 1;
        const requestId = walkRequestId;

        pendingWalkResolve = () => {
            if (requestId !== walkRequestId) return;
            if (pendingWalkTimeout) {
                clearTimeout(pendingWalkTimeout);
                pendingWalkTimeout = null;
            }
            onWalkComplete = null;
            pendingWalkResolve = null;
            resolve();
        };

        onWalkComplete = pendingWalkResolve;

        walkStartPos.copy(ariaGroup.position);
        walkEndPos.copy(targetPos);
        walkEndPos.y = 0;
        walkProgress = 0;
        walkElapsed = 0;
        stepPhase = 0;

        const walkDistance = walkStartPos.distanceTo(walkEndPos);
        walkDuration = Math.max(3.6, walkDistance / walkSpeed);

        // Timeout based on distance, with a safety cap
        const safetyTimeoutMs = Math.max(8000, walkDuration * 1500);
        pendingWalkTimeout = setTimeout(() => {
            if (requestId !== walkRequestId) return;
            if (ariaState !== 'idle' && ariaState !== 'speaking') {
                console.warn("ARIA walk timeout - Forcing complete callback");
                ariaGroup.position.copy(walkEndPos);
                ariaGroup.position.y = 0;
                if (onWalkComplete) {
                    const cb = onWalkComplete;
                    onWalkComplete = null;
                    cb();
                }
                resolve();
            }
        }, safetyTimeoutMs);

        const dirToTarget = new THREE.Vector3();
        dirToTarget.subVectors(walkEndPos, ariaGroup.position);
        targetRotation = Math.atan2(dirToTarget.x, dirToTarget.z);

        ariaState = 'turning_to_target';
    });
}

export function walkToStart() {
    return walkToPosition(ARIA_START_POS);
}

export function walkToProduct(collectionName) {
    const targetBase = PRODUCT_POSITIONS[collectionName] || PRODUCT_POSITIONS.elegance;
    const targetPos = targetBase.clone();
    const bounds = getProductBounds(collectionName);
    const radius = bounds ? bounds.radius : 1.6;
    const clearance = 1.1;
    const frontOffset = Math.max(1.6, radius + clearance);
    const sideOffset = Math.min(1.6, Math.max(0.9, radius * 0.35));

    if (collectionName === 'minimal') {
        targetPos.x += 0;
        targetPos.z += frontOffset;
    } else if (collectionName === 'luxury') {
        targetPos.x -= sideOffset;
        targetPos.z += frontOffset;
    } else {
        targetPos.x += sideOffset;
        targetPos.z += frontOffset;
    }

    const productPos = bounds ? bounds.center.clone() : targetBase.clone();
    const offset = targetPos.clone().sub(productPos);
    offset.y = 0;
    const minDistance = radius + clearance;
    if (offset.length() < minDistance) {
        offset.setLength(minDistance);
        targetPos.copy(productPos).add(offset);
        targetPos.y = 0;
    }

    return walkToPosition(targetPos);
}

export function updateARIA(elapsed, camera, isSpeaking) {
    if (!ariaGroup) return;

    const rawDelta = elapsed - lastUpdateTime;
    const delta = Math.min(0.05, rawDelta > 0 ? rawDelta : 0.016);
    lastUpdateTime = elapsed;
    if (mixer) mixer.update(delta);

    isSpeakingState = isSpeaking;
    if (spotLight && spotLight.target) {
        spotLight.target.position.copy(ariaGroup.position);
    }

    switch (ariaState) {
        case 'idle': updateIdle(elapsed, delta, camera); break;
        case 'turning_to_target': updateTurningToTarget(delta); break;
        case 'walking': updateWalking(elapsed, delta); break;
        case 'turning_to_camera': updateTurningToCamera(delta, camera); break;
        case 'speaking': updateSpeaking(elapsed, delta, camera); break;
    }
    updateLightState(elapsed);
}

function dampRotation(current, target, speed, dt) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // Exponential smoothing for natural ease-out
    const factor = 1.0 - Math.exp(-speed * dt * 2.0); // Multiplier to tune responsiveness
    let step = diff * factor;

    // Ensure minimum movement to avoid Zeno's paradox at ends
    const minSpeed = 0.1 * dt;
    if (Math.abs(step) < minSpeed && Math.abs(diff) > ANGLE_TOLERANCE) {
        step = Math.sign(diff) * minSpeed;
    }

    if (Math.abs(diff) < ANGLE_TOLERANCE) {
        return { value: target, finished: true };
    }

    return { value: current + step, finished: false };
}

function updateIdle(elapsed, delta, camera) {
    ariaGroup.position.y = Math.sin(elapsed * 0.7) * idleBreath;

    const idleSway = Math.sin(elapsed * 0.5) * swayAmplitude * 0.6;
    const idleLean = Math.sin(elapsed * 0.6) * leanAmplitude * 0.6;

    ariaGroup.rotation.z = THREE.MathUtils.damp(ariaGroup.rotation.z, idleSway, 3.5, delta);
    ariaGroup.rotation.x = THREE.MathUtils.damp(ariaGroup.rotation.x, idleLean, 3.5, delta);

    lookAtCamera(camera, delta, 1.4);
}

function updateTurningToTarget(delta) {
    const res = dampRotation(ariaGroup.rotation.y, targetRotation, turnSpeed, delta);
    ariaGroup.rotation.y = res.value;
    ariaGroup.rotation.x = THREE.MathUtils.damp(ariaGroup.rotation.x, 0, 4, delta);
    ariaGroup.rotation.z = THREE.MathUtils.damp(ariaGroup.rotation.z, 0, 4, delta);
    if (res.finished) {
        ariaState = 'walking';
    }
}

function updateWalking(elapsed, delta) {
    const safeDuration = Math.max(walkDuration, 0.001);
    walkElapsed += delta;
    walkProgress = Math.min(1, walkElapsed / safeDuration);
    const eased = walkProgress * walkProgress * (3 - 2 * walkProgress);

    if (walkProgress >= 1) {
        walkProgress = 1;
        ariaGroup.position.copy(walkEndPos);
        ariaGroup.position.y = 0;
        ariaGroup.rotation.x = 0;
        ariaGroup.rotation.z = 0;
        ariaState = 'turning_to_camera';
    } else {
        ariaGroup.position.lerpVectors(walkStartPos, walkEndPos, eased);

        stepPhase += delta * bobFrequency * 1.15;
        const stride = Math.sin(stepPhase);
        const bob = Math.abs(stride) * bobAmplitude;
        ariaGroup.position.y = bob;
        ariaGroup.rotation.z = stride * swayAmplitude;
        ariaGroup.rotation.x = Math.sin(stepPhase * 0.5) * leanAmplitude;

        if (!mixer) {
            ariaModel.rotation.z = stride * 0.01;
        }
    }
}

function updateTurningToCamera(delta, camera) {
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, ariaGroup.position);
    const targetAngle = Math.atan2(dirToCamera.x, dirToCamera.z);

    const res = dampRotation(ariaGroup.rotation.y, targetAngle, turnSpeed, delta);
    ariaGroup.rotation.y = res.value;
    ariaGroup.rotation.x = THREE.MathUtils.damp(ariaGroup.rotation.x, 0, 4, delta);
    ariaGroup.rotation.z = THREE.MathUtils.damp(ariaGroup.rotation.z, 0, 4, delta);

    if (res.finished) {
        ariaState = 'speaking';
        ariaGroup.rotation.x = 0;
        ariaGroup.rotation.z = 0;
        if (!mixer) {
            ariaModel.rotation.z = 0;
        }
        if (onWalkComplete) {
            const cb = onWalkComplete;
            onWalkComplete = null;
            cb();
        }
    }
}

function updateSpeaking(elapsed, delta, camera) {
    ariaGroup.position.y = Math.sin(elapsed * 0.8) * idleBreath;
    lookAtCamera(camera, delta, 1.1); // Slow tracking

    const speakLean = isSpeakingState ? Math.sin(elapsed * 1.4) * leanAmplitude * 0.8 : 0;
    ariaGroup.rotation.x = THREE.MathUtils.damp(ariaGroup.rotation.x, speakLean, 3.2, delta);
    ariaGroup.rotation.z = THREE.MathUtils.damp(ariaGroup.rotation.z, 0, 3.2, delta);

    if (!mixer) {
        if (isSpeakingState) {
            ariaModel.rotation.x = Math.sin(elapsed * 2) * 0.01;
        } else {
            ariaModel.rotation.x = THREE.MathUtils.damp(ariaModel.rotation.x, 0, 5, delta);
        }
    }
}

function lookAtCamera(camera, delta, speed) {
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, ariaGroup.position);
    const targetAngle = Math.atan2(dirToCamera.x, dirToCamera.z);
    const res = dampRotation(ariaGroup.rotation.y, targetAngle, speed, delta);
    ariaGroup.rotation.y = res.value;
}

function updateLightState(elapsed) {
    if (isSpeakingState) {
        targetLightIntensity = 2.0 + Math.sin(elapsed * 5) * 0.3;
    } else {
        targetLightIntensity = 1.0;
    }
    lightIntensity += (targetLightIntensity - lightIntensity) * 0.1;
    if (highlightLight) highlightLight.intensity = lightIntensity * 3.0;
}

export function resetToStart() {
    if (!ariaGroup) return;
    ariaState = 'idle';
    ariaGroup.position.copy(ARIA_START_POS);
    ariaGroup.rotation.y = 0;
    ariaGroup.rotation.x = 0;
    ariaGroup.rotation.z = 0;
    if (ariaModel && !mixer) {
        ariaModel.rotation.x = 0;
        ariaModel.rotation.z = 0;
    }
    lastUpdateTime = 0;
}

export function getARIAPosition() {
    return ariaGroup ? ariaGroup.position.clone() : ARIA_START_POS.clone();
}

export { ARIA_START_POS };
