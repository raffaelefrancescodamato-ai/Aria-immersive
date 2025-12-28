/**
 * Showroom Environment
 * Uses GLB Materials for Floor/Walls and High Intensity Fire Lighting.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let roomGroup;
const ROOM_WIDTH = 20;
const ROOM_DEPTH = 20;
const ROOM_HEIGHT = 6;
let fireLight;
let floorMesh, backWall, leftWall, rightWall;

export function createShowroom(scene, ktx2Loader, loadingManager) {
    roomGroup = new THREE.Group();
    scene.add(roomGroup);

    // ... (geometry creation unchanged)
    // Geometry
    const floorGeo = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
    const wallGeoBack = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT);
    const wallGeoSide = new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT);

    // Default Materials (Placeholder until GLB loads)
    const defaultMat = new THREE.MeshStandardMaterial({ color: 0x808080 });

    // FLOOR
    floorMesh = new THREE.Mesh(floorGeo, defaultMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // WALLS
    backWall = new THREE.Mesh(wallGeoBack, defaultMat);
    backWall.position.set(0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2);
    backWall.receiveShadow = true;
    roomGroup.add(backWall);

    leftWall = new THREE.Mesh(wallGeoSide, defaultMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);
    leftWall.receiveShadow = true;
    roomGroup.add(leftWall);

    rightWall = new THREE.Mesh(wallGeoSide, defaultMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);
    rightWall.receiveShadow = true;
    roomGroup.add(rightWall);

    createCeiling();

    // LOAD MATERIALS FROM GLBS
    loadMaterials(ktx2Loader, loadingManager);

    loadFireplace(scene, ktx2Loader, loadingManager);
    setupLights(scene);
}

function loadMaterials(ktx2Loader, loadingManager) {
    const loader = new GLTFLoader(loadingManager);
    if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    // ... (rest unchanged)

    // 1. FLOOR (parquet.glb)
    loader.load('./Assets/parquet.glb', (gltf) => {
        gltf.scene.traverse((child) => {
            if (child.isMesh && child.material) {
                // Apply this material to our floor
                const mat = child.material.clone();
                mat.colorSpace = THREE.SRGBColorSpace;

                // Ensure texture repeats
                if (mat.map) {
                    mat.map.wrapS = THREE.RepeatWrapping;
                    mat.map.wrapT = THREE.RepeatWrapping;
                    mat.map.repeat.set(4, 4);
                    mat.map.needsUpdate = true;
                }

                floorMesh.material = mat;
            }
        });
    }, undefined, err => console.error("Error loading parquet.glb", err));

    // 2. WALLS (wall-marble.glb)
    loader.load('./Assets/OLD/wall-marble.glb', (gltf) => {
        gltf.scene.traverse((child) => {
            if (child.isMesh && child.material) {
                const mat = child.material.clone();
                mat.colorSpace = THREE.SRGBColorSpace;

                // WHITE MARBLE SIMULATION
                // Since we cannot download the specific asset, we simulate the look
                mat.color.setHex(0xffffff); // Pure White
                mat.roughness = 0.1; // Polished/Glossy
                mat.metalness = 0.1; // Slight stone reflectivity

                if (mat.map) {
                    mat.map.wrapS = THREE.RepeatWrapping;
                    mat.map.wrapT = THREE.RepeatWrapping;
                    mat.map.repeat.set(2, 1);
                    mat.map.needsUpdate = true;
                }

                backWall.material = mat;
                leftWall.material = mat;
                rightWall.material = mat;
            }
        });
    }, undefined, err => console.error("Error loading wall-marble.glb", err));
}

function loadFireplace(scene, ktx2Loader, loadingManager) {
    const loader = new GLTFLoader(loadingManager);
    if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load('./Assets/camino.glb', (gltf) => {
        const model = gltf.scene;
        model.position.set(0, 0, -ROOM_DEPTH / 2 + 0.5);
        model.scale.set(1.5, 1.5, 1.5); // Much smaller fireplace
        model.traverse(c => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
            }
        });
        roomGroup.add(model);

        // POWERFUL FIRE LIGHT
        fireLight = new THREE.PointLight(0xffaa00, 40, 40); // Intensity 40!
        fireLight.position.set(0, 1.5, -ROOM_DEPTH / 2 + 2.0);
        fireLight.castShadow = true;
        fireLight.shadow.bias = -0.001;
        scene.add(fireLight);

    }, undefined, err => console.error("Error loading camino.glb", err));
}

function createCeiling() {
    const geometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
    const material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide });
    const ceiling = new THREE.Mesh(geometry, material);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM_HEIGHT;
    roomGroup.add(ceiling);
}

function setupLights(scene) {
    // Brighter ambient
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Directional
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);
}

export function updateShowroom(elapsed) {
    if (fireLight) {
        // High intensity flicker
        const flicker = Math.sin(elapsed * 10) * 2 + Math.random() * 2;
        fireLight.intensity = 40 + flicker;
    }
}
