/**
 * Product Manager
 * Handles loading, showing, and color Customization of Sofas, using shared KTX2Loader.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let productGroups = {};
let currentProduct = null;
let spotlight = null;
const productBounds = {};

const PRODUCT_POSITIONS = {
    elegance: new THREE.Vector3(-6, 0, -5),
    minimal: new THREE.Vector3(0, 0, -5),
    luxury: new THREE.Vector3(6, 0, -5)
};

const FABRIC_COLORS = {
    'cream': 0xf5f5dc,
    'grey': 0x808080,
    'navy': 0x000080,
    'brown': 0x8b4513
};

const MODELS = {
    elegance: './Assets/Modelli%203D/BONTON_200.glb',
    minimal: './Assets/Modelli%203D/DOLORES_274X.glb',
    luxury: './Assets/Modelli%203D/eclipse.glb'
};

const TARGET_MODEL_WIDTH = 2.0;

export async function loadProduct(scene, loadingManager, ktx2Loader) {
    const loader = new GLTFLoader(loadingManager);

    if (ktx2Loader) {
        loader.setKTX2Loader(ktx2Loader);
    }
    loader.setMeshoptDecoder(MeshoptDecoder);

    const modelCache = new Map();
    const loadModel = (path) => {
        if (modelCache.has(path)) {
            return modelCache.get(path);
        }
        const promise = new Promise((resolve, reject) => {
            loader.load(
                path,
                (gltf) => {
                    const baseModel = gltf.scene;
                    setupProductMaterials(baseModel);
                    normalizeProductModel(baseModel);
                    resolve(baseModel);
                },
                undefined,
                reject
            );
        });
        modelCache.set(path, promise);
        return promise;
    };

    const collections = ['elegance', 'minimal', 'luxury'];
    const baseModels = await Promise.all(collections.map(async (name) => ({
        name,
        baseModel: await loadModel(MODELS[name])
    })));

    baseModels.forEach(({ name, baseModel }) => {
        const group = new THREE.Group();
        const model = baseModel.clone(true);

        model.traverse(child => {
            if (child.isMesh) {
                child.userData.isInteractable = true;
            }
        });

        group.add(model);
        group.position.copy(PRODUCT_POSITIONS[name]);

        if (name === 'minimal') group.rotation.y = Math.PI / 6;
        if (name === 'luxury') group.rotation.y = -Math.PI / 6;

        group.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(group);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);
        const sphere = new THREE.Sphere();
        bounds.getBoundingSphere(sphere);
        productBounds[name] = {
            size,
            center,
            radius: sphere.radius
        };
        group.userData.bounds = productBounds[name];

        scene.add(group);
        productGroups[name] = group;
    });

    setupSpotlight(scene);
}

function setupProductMaterials(model) {
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            if (Array.isArray(child.material)) {
                child.material.forEach(mat => {
                    if (mat && !mat.name) mat.name = 'fabric';
                });
            } else if (child.material && !child.material.name) {
                child.material.name = 'fabric';
            }

            // HIDE FLOOR/PLANE helpers in GLB if present
            const name = child.name.toLowerCase();
            if (name.includes('floor') || name.includes('plane') || name.includes('ground') || name.includes('rug') || name.includes('tappeto') || name.includes('base')) {
                child.visible = false;
            } else {
                child.userData.isInteractable = true;
            }

            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => {
                        const cloned = mat.clone();
                        if (cloned.map) cloned.map.colorSpace = THREE.SRGBColorSpace;
                        return cloned;
                    });
                } else {
                    child.material = child.material.clone();
                    if (child.material.map) child.material.map.colorSpace = THREE.SRGBColorSpace;
                }
            }
        }
    });
    // Tag root too
    model.userData.isInteractable = true;
}

function normalizeProductModel(model) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const maxDim = Math.max(size.x, size.z, 0.001);
    const scale = TARGET_MODEL_WIDTH / maxDim;

    if (Number.isFinite(scale) && scale > 0) {
        model.scale.setScalar(scale);
    }

    model.updateMatrixWorld(true);
    const adjustedBounds = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    adjustedBounds.getCenter(center);

    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= adjustedBounds.min.y;

    model.updateMatrixWorld(true);
}

function setupSpotlight(scene) {
    spotlight = new THREE.SpotLight(0xffffff, 0);
    spotlight.position.set(0, 8, 2);
    spotlight.angle = Math.PI / 4;
    spotlight.penumbra = 0.5;
    spotlight.castShadow = true;

    // Target
    const target = new THREE.Object3D();
    scene.add(target);
    spotlight.target = target;

    scene.add(spotlight);
}

export function updateProduct(elapsed) {
    // maybe rotate spotlight or subtle effects
}

export function activateProductSpotlight(active, collectionName) {
    if (!spotlight) return;

    if (active && collectionName && productGroups[collectionName]) {
        spotlight.intensity = 2; // Bright highlight
        const bounds = getProductBounds(collectionName);
        const target = bounds ? bounds.center : productGroups[collectionName].position;
        spotlight.target.position.copy(target);
    } else {
        spotlight.intensity = 0;
    }
}

export function setCurrentProduct(collectionName) {
    currentProduct = productGroups[collectionName] || null;
}

export function clearCurrentProduct() {
    currentProduct = null;
}

export function changeProductColor(colorValue) {
    const hex = resolveColorHex(colorValue);
    if (hex === null) return;

    if (!currentProduct) return;
    applyColor(currentProduct, hex);
}

function resolveColorHex(colorValue) {
    if (!colorValue) return null;
    if (typeof colorValue === 'number' && Number.isFinite(colorValue)) {
        return colorValue;
    }
    if (typeof colorValue !== 'string') return null;

    const key = colorValue.toLowerCase().trim();
    if (FABRIC_COLORS[key]) return FABRIC_COLORS[key];

    if (key.startsWith('#')) {
        const hexValue = key.slice(1);
        if (hexValue.length === 3) {
            const expanded = hexValue.split('').map(ch => ch + ch).join('');
            return parseInt(expanded, 16);
        }
        if (hexValue.length === 6) {
            return parseInt(hexValue, 16);
        }
    }

    return null;
}

function applyColor(group, hex) {
    group.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
            if (!mat || !mat.color) return;
            const name = (mat.name || '').toLowerCase();
            if (name.includes('fabric') || !mat.map) {
                mat.color.setHex(hex);
            }
        });
    });
}

export function getProductPosition(name) {
    return PRODUCT_POSITIONS[name] || new THREE.Vector3();
}

export function getProductBounds(name) {
    const bounds = productBounds[name] || productGroups[name]?.userData?.bounds;
    if (!bounds) return null;
    return {
        size: bounds.size.clone(),
        center: bounds.center.clone(),
        radius: bounds.radius
    };
}

export function getProductFocusPosition(name) {
    const bounds = getProductBounds(name);
    if (bounds) {
        const focus = bounds.center.clone();
        focus.y = Math.max(0.5, focus.y);
        return focus;
    }
    const base = getProductPosition(name).clone();
    base.y += 0.5;
    return base;
}
